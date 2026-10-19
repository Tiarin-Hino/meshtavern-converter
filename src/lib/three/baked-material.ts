import * as THREE from 'three';
import type { BakedMaps } from '../pipeline/bake';
import { MAX_GROUPS } from '../pipeline/brush';
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

/** The tint over the look (#138): the mask's colour where the tint map's red is. */
const TINT_GLSL = /* glsl */ `
  diffuseColor.rgb = mix( diffuseColor.rgb, uTint.rgb, texture2D( uTintMap, vNormalMapUv ).r * uTint.w );
`;

/** The groups in the vertex shader (#139): the attribute, the uniform, and the group to the fragment. */
const GROUP_VERTEX_DECLARATIONS = /* glsl */ `
attribute float group;
uniform vec4 uGroups[ ${MAX_GROUPS} ];
flat varying float vGroup;
vec4 mtGroup;
`;
const GROUP_BEGIN_VERTEX = /* glsl */ `
mtGroup = uGroups[ int( group + 0.5 ) ];
vGroup = group;
transformed += mtGroup.xyz;
`;
/** A hidden group's vertices at one point outside the view: no area, no fragment. */
const GROUP_PROJECT_VERTEX = /* glsl */ `
if ( mtGroup.w > 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
`;
const groupFragmentDeclarations = (colours: number): string => /* glsl */ `
uniform vec3 uGroupColours[ ${colours} ];
uniform vec4 uGroupTint;
uniform sampler2D uGroupStrokeMap;
uniform vec4 uGroupStroke;
flat varying float vGroup;
`;

/**
 * The groups' tint over the look and the mask's (#139): every group but 0 in its colour, by the
 * tint's x; and while a group stroke is on the canvas, its coverage in the target group's colour.
 */
const groupTint = (colours: number): string => /* glsl */ `
  int mtGroupIndex = int( vGroup + 0.5 );
  if ( mtGroupIndex > 0 )
    diffuseColor.rgb = mix( diffuseColor.rgb, uGroupColours[ mtGroupIndex % ${colours} ], uGroupTint.x );
  diffuseColor.rgb = mix( diffuseColor.rgb, uGroupStroke.rgb, texture2D( uGroupStrokeMap, vNormalMapUv ).r * uGroupStroke.w );
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
  /**
   * A tint over the surface (#138: the painting view's mask): where the texture's red channel is
   * 1, the colour (`uniform`'s xyz, linear) is mixed in by `uniform`'s w after the look; w 0 shows
   * none. Laid out as `map`, and owned by the consumer as it.
   */
  tint?: { map: THREE.Texture; uniform: { value: THREE.Vector4 } } | null;
  /**
   * The groups (#139, the painting view's, `docs/design/paint-groups.md` §5.2): the geometry has a
   * `group` attribute (a byte a vertex), and `uniform` a vec4 a group (MAX_GROUPS), its offset in
   * mm in xyz added to every vertex of the group, 1 in w where it is hidden: a hidden group's
   * triangles are drawn nowhere. `colours` (linear, one a group by its index modulo their number)
   * are mixed into every group but 0 by `tint`'s x; `stroke`'s red, laid out as `map`, mixes in
   * `strokeTint`'s colour by its w. All owned by the consumer.
   */
  groups?: {
    uniform: { value: THREE.Vector4[] };
    colours: { value: THREE.Vector3[] };
    tint: { value: THREE.Vector4 };
    stroke: THREE.Texture;
    strokeTint: { value: THREE.Vector4 };
  } | null;
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
  const tint = options.tint ?? null;
  const groups = options.groups ?? null;
  const colours = groups?.colours.value.length ?? 0;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1, 1, 1),
    roughness: 0.75,
    metalness: 0,
    normalMap: texture,
    normalMapType: THREE.ObjectSpaceNormalMap,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBase = uniforms.uBase;
    shader.uniforms.uLook = uniforms.uLook;
    if (paint) shader.uniforms.uPaint = { value: paint };
    if (tint) {
      shader.uniforms.uTintMap = { value: tint.map };
      shader.uniforms.uTint = tint.uniform;
    }
    if (groups) {
      shader.uniforms.uGroups = groups.uniform;
      shader.uniforms.uGroupColours = groups.colours;
      shader.uniforms.uGroupTint = groups.tint;
      shader.uniforms.uGroupStrokeMap = { value: groups.stroke };
      shader.uniforms.uGroupStroke = groups.strokeTint;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute float occlusion;\nvarying float vOcclusion;${groups ? GROUP_VERTEX_DECLARATIONS : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvOcclusion = occlusion;${groups ? GROUP_BEGIN_VERTEX : ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>${groups ? GROUP_PROJECT_VERTEX : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uBase;\nuniform vec4 uLook;\n${paint ? 'uniform sampler2D uPaint;\n' : ''}${tint ? 'uniform sampler2D uTintMap;\nuniform vec4 uTint;\n' : ''}${groups ? groupFragmentDeclarations(colours) : ''}varying float vOcclusion;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${paint ? PAINTED_COAT_GLSL : COAT_GLSL}${LOOK_GLSL}${tint ? TINT_GLSL : ''}${groups ? groupTint(colours) : ''}`,
      );
  };
  // All baked minis share one compiled program, all painted ones another, the painting view's
  // tinted ones a third and its grouped ones (#139) a fourth; each material still has its own
  // uniforms (three.js asks every material for them once).
  const key = `meshtavern-baked${paint ? '-painted' : ''}${tint ? '-tinted' : ''}${groups ? `-grouped${colours}` : ''}`;
  material.customProgramCacheKey = () => key;
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
