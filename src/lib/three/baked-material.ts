import * as THREE from 'three';
import type { BakedMaps } from '../pipeline/bake';
import { CAVITY_GAIN, DARKEST, HIGHLIGHT, parseHexColour, type Look } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';

/**
 * Material for a baked mini. One RGBA texture carries the sculpt's object-space normal
 * (RGB) and fine cavity (alpha); the coarse occlusion comes from a vertex attribute. The
 * look is computed from those in the fragment shader, so changing it costs nothing: it is
 * two uniforms. An optional paint texture (issue #125) is the coat under the look.
 *
 * The look is per material: each material reads the `LookUniforms` it was made with. Make one
 * set per mini (`createLookUniforms`) for minis with their own look; pass the same set to every
 * material for minis that are all alike, as the page does, and one `updateLookUniforms` changes
 * them all.
 *
 * The GLSL below must stay in step with `pointColour` in pipeline/look.ts.
 */
export interface LookUniforms {
  uBase: { value: THREE.Vector3 };
  /** x = enabled (0 or 1), y = occlusion, z = wash, w = edges. */
  uLook: { value: THREE.Vector4 };
}

export function createLookUniforms(look: Look): LookUniforms {
  const uniforms = { uBase: { value: new THREE.Vector3() }, uLook: { value: new THREE.Vector4() } };
  updateLookUniforms(uniforms, look);
  return uniforms;
}

export function updateLookUniforms(uniforms: LookUniforms, look: Look): void {
  uniforms.uBase.value.set(...parseHexColour(look.base));
  uniforms.uLook.value.set(look.enabled ? 1 : 0, look.occlusion, look.wash, look.edges);
}

/** GPU memory of one detail texture with its mipmaps, in bytes. */
export const bakedTextureBytes = (resolution: number): number =>
  Math.round((resolution * resolution * 4 * 4) / 3);

/** The coat under the look: the paint over the base coat by its alpha (`paintedBase` in look.ts). */
const COAT_GLSL = /* glsl */ `
  vec3 mtBase = uBase;
`;
const PAINTED_COAT_GLSL = /* glsl */ `
  vec4 mtPaint = texture2D( uPaint, vNormalMapUv );
  vec3 mtBase = mix( uBase, mtPaint.rgb, mtPaint.a );
`;

const LOOK_GLSL = /* glsl */ `
  vec4 mtDetail = texture2D( normalMap, vNormalMapUv );
  float mtCavity = clamp( ( mtDetail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
  float mtShadow = ( 1.0 - uLook.y * ( 1.0 - vOcclusion ) ) * ( 1.0 - uLook.z * max( 0.0, -mtCavity ) );
  mtShadow = ${DARKEST} + ( 1.0 - ${DARKEST} ) * mtShadow;
  float mtHighlight = uLook.w * max( 0.0, mtCavity ) * ${HIGHLIGHT};
  vec3 mtCoat = mtBase * mtShadow;
  mtCoat += ( 1.0 - mtCoat ) * mtHighlight;
  diffuseColor.rgb = mix( mtBase, mtCoat, uLook.x );
`;

/**
 * Uncompressed detail texture. `detail` is uploaded as it is; pass a copy when several
 * minis must each own their texture (as different minis on a real table would).
 */
export function createDetailTexture(detail: Uint8Array, resolution: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(detail, resolution, resolution);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export interface BakedMaterialOptions {
  /**
   * The paint (issue #125): a colour texture on the table level's texture coordinates, laid out
   * like the detail texture (`Albedo` in the library: row 0 at v = 0, so `flipY` false), its
   * colour in sRGB (`colorSpace` SRGBColorSpace) and alpha straight. Where its alpha is 1 its
   * colour replaces the base coat, where it is 0 the base coat shows, in between the two mix;
   * the wash and the edges work on top either way. The consumer owns it: it is not disposed
   * with the material. Changing its texels needs `needsUpdate` on the texture only; adding or
   * removing it needs a new material.
   */
  map?: THREE.Texture | null;
}

/**
 * `texture` is a detail texture, uncompressed or GPU-compressed; the material owns it.
 * `uniforms` is the look this material reads (see LookUniforms: one set per mini, or one set
 * shared by every mini that looks alike).
 */
export function createBakedMaterial(
  texture: THREE.Texture,
  uniforms: LookUniforms,
  options: BakedMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const paint = options.map ?? null;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    metalness: 0,
    normalMap: texture,
    normalMapType: THREE.ObjectSpaceNormalMap,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBase = uniforms.uBase;
    shader.uniforms.uLook = uniforms.uLook;
    if (paint) shader.uniforms.uPaint = { value: paint };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float occlusion;\nvarying float vOcclusion;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOcclusion = occlusion;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uBase;\nuniform vec4 uLook;\n${paint ? 'uniform sampler2D uPaint;\n' : ''}varying float vOcclusion;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${paint ? PAINTED_COAT_GLSL : COAT_GLSL}${LOOK_GLSL}`,
      );
  };
  // All baked minis share one compiled program, and all painted ones another; each material
  // still has its own uniforms (three.js asks every material for them once).
  material.customProgramCacheKey = () => (paint ? 'meshtavern-baked-painted' : 'meshtavern-baked');
  return material;
}

/** Geometry for a baked mini: the unwrapped mesh with its texture coordinates and per-vertex occlusion. */
export function createBakedGeometry(mesh: IndexedMesh): THREE.BufferGeometry {
  const vertexCount = mesh.positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals!, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs!, 2));
  geometry.setAttribute(
    'occlusion',
    new THREE.BufferAttribute(mesh.occlusion ?? new Float32Array(vertexCount).fill(1), 1),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

export function disposeBakedMaterial(material: THREE.MeshStandardMaterial): void {
  material.normalMap?.dispose();
  material.dispose();
}

export type { BakedMaps };
