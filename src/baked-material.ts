import * as THREE from 'three';
import type { BakedMaps } from './pipeline/bake';
import { CAVITY_GAIN, DARKEST, HIGHLIGHT, parseHexColour, type Look } from './pipeline/look';
import type { IndexedMesh } from './pipeline/mesh';

/**
 * Material for a baked mini. One RGBA texture carries the sculpt's object-space normal
 * (RGB) and fine cavity (alpha); the coarse occlusion comes from a vertex attribute. The
 * look is computed from those in the fragment shader, so there is no colour texture to
 * store, and changing the look costs nothing: it is two uniforms shared by all minis.
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

const LOOK_GLSL = /* glsl */ `
  vec4 mtDetail = texture2D( normalMap, vNormalMapUv );
  float mtCavity = clamp( ( mtDetail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
  float mtShadow = ( 1.0 - uLook.y * ( 1.0 - vOcclusion ) ) * ( 1.0 - uLook.z * max( 0.0, -mtCavity ) );
  mtShadow = ${DARKEST} + ( 1.0 - ${DARKEST} ) * mtShadow;
  float mtHighlight = uLook.w * max( 0.0, mtCavity ) * ${HIGHLIGHT};
  vec3 mtCoat = uBase * mtShadow;
  mtCoat += ( 1.0 - mtCoat ) * mtHighlight;
  diffuseColor.rgb = mix( uBase, mtCoat, uLook.x );
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

/** `texture` is a detail texture, uncompressed or GPU-compressed; the material owns it. */
export function createBakedMaterial(
  texture: THREE.Texture,
  uniforms: LookUniforms,
): THREE.MeshStandardMaterial {
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
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float occlusion;\nvarying float vOcclusion;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOcclusion = occlusion;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uBase;\nuniform vec4 uLook;\nvarying float vOcclusion;',
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${LOOK_GLSL}`);
  };
  // All baked minis share one compiled program.
  material.customProgramCacheKey = () => 'meshtavern-baked';
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
