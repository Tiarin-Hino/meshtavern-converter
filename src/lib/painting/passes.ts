import * as THREE from 'three';
import {
  BORDER_TEXEL,
  DEFAULT_BRUSH,
  GUTTER_TEXEL,
  ISLAND_TEXEL,
  NO_OWNER,
  ownerMap,
  PAINT_SIZE,
  unitDirection,
  type BrushSettings,
  type MaskChange,
  type PaintMask,
  type StrokeCamera,
  type ToolId,
} from '../pipeline/brush';
import { CAVITY_GAIN } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Albedo } from '../pipeline/paint';
import { BLACK } from '../three/scene-colours';
import { dabGain, ontoMask, strokeOpacity, toolPass } from './tools';

/**
 * The painting engine's GPU side (issue #127, design note `docs/design/painting-engine.md` §5): the
 * render targets over the mini's unwrap and the passes that turn dabs into texels. Every pass
 * draws the mesh in texture space (each vertex at its texture coordinates) or a quad over the
 * whole texture, into a target of the view's renderer.
 *
 * - `atlas` (at open): which texels lie in an island (R 1), which an island's border crosses
 *   (R 0.5, drawn as the triangles' edges), the vertex occlusion (G).
 * - `depth` (at a stroke's start): the mesh from the stroke's camera, so a dab reaches only what
 *   was visible.
 * - `stroke` (every frame): each texel's coverage by the frame's dabs, its largest so far, or for
 *   the airbrush (#128) what every dab added, in whole steps of 1/255, so that a stroke drawn a
 *   few dabs a frame and its replay drawn at once give the same bytes; a stencil lets one
 *   fragment a texel add per draw, so a texel that a triangle and an edge both reach counts once.
 * - `live` (every frame): the stroke through the tool's mask over `paint`, each gutter texel taken
 *   from its owner (the composite and the dilation of §5.4 in one pass: a texel's result is a
 *   function of its owner's inputs alone).
 * - `paint`: the committed paint. A commit copies `live` into it, a cancel copies it back.
 * - `reference` (a stroke's first dab, for the dry brush, #133): the highest cavity under that
 *   dab, reduced from the stroke layer and the detail texture into one texel the composite reads.
 * - `stamp` (at every commit, #137): at each texel the number of the newest step that changed its
 *   bytes, which a lift stroke reads to find the step it takes away, and by which its composite
 *   changes only the texels where that step is the top layer (`docs/design/lift-eraser.md`).
 * - `mask` and `maskLive` (#138, `docs/design/paint-mask.md`): a byte a texel, 1 where the surface
 *   is masked. Every paint composite multiplies its alpha by `1 − mask` at the owner, so a masked
 *   texel keeps its bytes; the mask's own tools composite into `maskLive`, committed as the paint.
 * - `cut` (at a picked fill, #138): a texel a triangle, whether the mask covers its middle.
 *
 * `paint`, `live` and the keyframes are sRGB targets (SRGB8_ALPHA8): the GPU decodes on sampling,
 * encodes on writing, and the material samples `live` as it samples an sRGB `DataTexture`. Copies
 * between them are byte copies (`copyTextureToTexture`, a `copyTexSubImage2D`).
 */

/** A texel's depth may lie this far behind what the stroke's camera saw there, in mm, and still be painted. _(proposal)_ */
export const DEPTH_BIAS_MM = 0.25;
/** A texel is painted only where its surface faces the stroke's camera at least this much: about 81°. _(proposal)_ */
export const FACING_MIN_COS = 0.15;
/**
 * A dab reaches at most this far behind its centre along the stroke camera's line of sight, in mm
 * (#134): the depth a real brush reaches behind the surface it touches. Its full radius stays
 * sideways. _(proposal)_
 */
export const BRUSH_DEPTH_MM = 1.5;
/** The last stretch before `BRUSH_DEPTH_MM` over which a dab fades out, in mm, so the cut on a receding surface is not a hard line. _(proposal)_ */
export const BRUSH_DEPTH_SOFT_MM = 0.5;
/** Rings of gutter texels around every island that take the island's paint (§5.4). _(proposal)_ */
export const PAINT_DILATION_RINGS = 2;
/** Dabs per draw of the dab pass; more take further draws. _(proposal)_ */
export const DABS_PER_PASS = 64;
/** The reference's reduction (#133): each texel of a level is the highest of a block this many texels on a side of the level below. */
export const REFERENCE_BLOCK = 16;
/**
 * A stamp holds a step's index + 1 modulo this (two bytes), 0 for no step: bare, or the paint as
 * opened (#137). After this many steps in one session a stamp may name a step this far back as a
 * recent one; a lift there finds the paint beneath equal to the paint and takes nothing away.
 */
export const STAMP_MODULUS = 65536;
/** A triangle is cut from a fill where the mask at its middle is at least this (#138). _(proposal)_ */
export const MASK_CUT = 0.5;
/** A dab's hardness is at most this, so the falloff's two edges never meet. */
const HARDEST = 0.999;

const PRECISION = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** The mesh in texture space: what every texel-writing pass draws. */
const TEXTURE_SPACE_VERTEX = /* glsl */ `${PRECISION}
in vec3 position;
in vec3 normal;
in vec2 uv;
in float occlusion;
out vec3 vPosition;
out vec3 vNormal;
out float vOcclusion;
void main() {
  vPosition = position;
  vNormal = normal;
  vOcclusion = occlusion;
  gl_Position = vec4( uv * 2.0 - 1.0, 0.0, 1.0 );
}
`;

const ATLAS_FRAGMENT = /* glsl */ `${PRECISION}
uniform float uLevel;
in vec3 vPosition;
in vec3 vNormal;
in float vOcclusion;
out vec4 fragColor;
void main() {
  fragColor = vec4( uLevel, vOcclusion, 0.0, 1.0 );
}
`;

const DEPTH_VERTEX = /* glsl */ `${PRECISION}
uniform mat4 uViewProjection;
in vec3 position;
void main() {
  gl_Position = uViewProjection * vec4( position, 1.0 );
}
`;

const DEPTH_FRAGMENT = /* glsl */ `${PRECISION}
out vec4 fragColor;
void main() {
  fragColor = vec4( 0.0 );
}
`;

/**
 * The dab pass's fragment: the largest coverage of the dabs, or, adding, their sum, each dab's
 * `uGain × coverage` rounded to a whole 1/255 so that sums in any grouping are the same bytes.
 */
const dabFragment = (add: boolean): string => /* glsl */ `${PRECISION}
uniform sampler2D uDepth;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform vec2 uNearFar;
uniform vec4 uDabs[ ${DABS_PER_PASS} ];
uniform int uDabCount;
uniform float uRadius;
uniform float uHardness;
uniform float uGain;
in vec3 vPosition;
in vec3 vNormal;
in float vOcclusion;
out vec4 fragColor;

float linearDepth( float depth ) {
  float z = depth * 2.0 - 1.0;
  float near = uNearFar.x;
  float far = uNearFar.y;
  return 2.0 * near * far / ( far + near - z * ( far - near ) );
}

void main() {
  vec4 clip = uViewProjection * vec4( vPosition, 1.0 );
  if ( clip.w <= 0.0 ) discard;
  vec3 ndc = clip.xyz / clip.w;
  if ( any( greaterThan( abs( ndc.xy ), vec2( 1.0 ) ) ) ) discard;
  // Visible from the stroke's camera: no surface nearer than the bias in front of it.
  float seen = texture( uDepth, ndc.xy * 0.5 + 0.5 ).r;
  if ( linearDepth( ndc.z * 0.5 + 0.5 ) - linearDepth( seen ) > ${DEPTH_BIAS_MM.toFixed(4)} ) discard;
  // Facing it: a grazing surface at a silhouette would take a streak from the dab's sphere.
  if ( dot( normalize( vNormal ), normalize( uEye - vPosition ) ) < ${FACING_MIN_COS.toFixed(4)} ) discard;
  float coverage = 0.0;
  for ( int i = 0; i < uDabCount; i++ ) {
    vec3 centre = uDabs[ i ].xyz;
    float d = distance( vPosition, centre );
    // The sphere, cut behind the dab along the eye's ray through it (#134): a surface in sight
    // across a gap (the back behind a hand) is beyond the brush's reach.
    float behind = dot( vPosition - centre, normalize( centre - uEye ) );
    float dab = ( 1.0 - smoothstep( uHardness * uRadius, uRadius, d ) )
      * ( 1.0 - smoothstep( ${(BRUSH_DEPTH_MM - BRUSH_DEPTH_SOFT_MM).toFixed(4)}, ${BRUSH_DEPTH_MM.toFixed(4)}, behind ) );
    ${add ? 'coverage += floor( uGain * dab * 255.0 + 0.5 ) / 255.0;' : 'coverage = max( coverage, dab );'}
  }
  fragColor = vec4( coverage, 0.0, 0.0, 1.0 );
}
`;

const REGION_FRAGMENT = /* glsl */ `${PRECISION}
in vec3 vPosition;
in vec3 vNormal;
in float vOcclusion;
out vec4 fragColor;
void main() {
  fragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}
`;

/**
 * The reference's first level (#133, design note `docs/design/dry-brush-crests.md` §5): each texel
 * the highest cavity, as `cavity × 0.5 + 0.5`, of the texels of its block that the stroke layer
 * covers (0 where none is). The cavity is read as the composite reads it: at the texel's centre,
 * level 0, decoded and clamped. A covered texel owns itself (an island's or a border's).
 */
const REFERENCE_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uStroke;
uniform sampler2D uDetail;
out vec4 fragColor;
void main() {
  ivec2 origin = ivec2( gl_FragCoord.xy ) * ${REFERENCE_BLOCK};
  float highest = 0.0;
  for ( int y = 0; y < ${REFERENCE_BLOCK}; y++ ) {
    for ( int x = 0; x < ${REFERENCE_BLOCK}; x++ ) {
      ivec2 texel = origin + ivec2( x, y );
      if ( texelFetch( uStroke, texel, 0 ).r <= 0.0 ) continue;
      vec4 detail = textureLod( uDetail, ( vec2( texel ) + 0.5 ) / ${PAINT_SIZE.toFixed(1)}, 0.0 );
      float cavity = clamp( ( detail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
      highest = max( highest, cavity * 0.5 + 0.5 );
    }
  }
  fragColor = vec4( highest, 0.0, 0.0, 1.0 );
}
`;

/** The reference's further levels: each texel the highest of its block of the level below. */
const HIGHEST_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uSource;
uniform int uBlock;
out vec4 fragColor;
void main() {
  ivec2 origin = ivec2( gl_FragCoord.xy ) * uBlock;
  float highest = 0.0;
  for ( int y = 0; y < uBlock; y++ )
    for ( int x = 0; x < uBlock; x++ )
      highest = max( highest, texelFetch( uSource, origin + ivec2( x, y ), 0 ).r );
  fragColor = vec4( highest, 0.0, 0.0, 1.0 );
}
`;

/** A triangle over the whole target: the quad passes. */
const QUAD_VERTEX = /* glsl */ `${PRECISION}
in vec3 position;
void main() {
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const COPY_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uSource;
out vec4 fragColor;
void main() {
  fragColor = texelFetch( uSource, ivec2( gl_FragCoord.xy ), 0 );
}
`;

/**
 * The stamp pass (#137, design note `docs/design/lift-eraser.md` §5), into the stamp map before a
 * commit: a texel whose bytes the step left as they were keeps its stamp (equal bytes decode to
 * equal values); elsewhere the step's number, or for a lift the stamp beneath where the texel is
 * now the paint beneath, and the stamp it had where it was lifted only partly.
 */
const STAMP_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uPaint;
uniform sampler2D uLive;
uniform sampler2D uBeneath;
uniform sampler2D uBeneathStamp;
uniform bool uLift;
uniform vec2 uValue;
out vec4 fragColor;
void main() {
  ivec2 texel = ivec2( gl_FragCoord.xy );
  vec4 live = texelFetch( uLive, texel, 0 );
  if ( live == texelFetch( uPaint, texel, 0 ) ) discard;
  if ( uLift ) {
    if ( live != texelFetch( uBeneath, texel, 0 ) ) discard;
    fragColor = texelFetch( uBeneathStamp, texel, 0 );
  } else {
    fragColor = vec4( uValue, 0.0, 1.0 );
  }
}
`;

/** One texel of a texture into a 1 × 1 target, to be read back. */
const PROBE_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uSource;
uniform ivec2 uTexel;
out vec4 fragColor;
void main() {
  fragColor = texelFetch( uSource, uTexel, 0 );
}
`;

/**
 * The mask's composite (#138, design note `docs/design/paint-mask.md` §4), into `maskLive`: at the
 * texel's owner, as the paint's, the stroke's coverage by its opacity laid over the mask or taken
 * from it. Untouched texels keep their byte.
 */
const maskCompositeFragment = (lay: boolean): string => /* glsl */ `${PRECISION}
uniform sampler2D uMask;
uniform sampler2D uStroke;
uniform sampler2D uOwner;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  ivec2 texel = ivec2( gl_FragCoord.xy );
  vec4 owner = floor( texelFetch( uOwner, texel, 0 ) * 255.0 + 0.5 );
  if ( owner.a == 255.0 ) {
    fragColor = vec4( texelFetch( uMask, texel, 0 ).r, 0.0, 0.0, 1.0 );
    return;
  }
  ivec2 from = ivec2( int( owner.r + owner.g * 256.0 ), int( owner.b + owner.a * 256.0 ) );
  float mask = texelFetch( uMask, from, 0 ).r;
  float alpha = uOpacity * texelFetch( uStroke, from, 0 ).r;
  if ( alpha <= 0.0 ) {
    fragColor = vec4( mask, 0.0, 0.0, 1.0 );
    return;
  }
  fragColor = vec4( ${lay ? 'mask + alpha * ( 1.0 - mask )' : 'mask * ( 1.0 - alpha )'}, 0.0, 0.0, 1.0 );
}
`;

/** The mask changed whole (#138): cleared, or inverted at every texel. */
const MASK_CHANGE_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uMask;
uniform bool uInvert;
out vec4 fragColor;
void main() {
  float mask = texelFetch( uMask, ivec2( gl_FragCoord.xy ), 0 ).r;
  fragColor = vec4( uInvert ? 1.0 - mask : 0.0, 0.0, 0.0, 1.0 );
}
`;

/** The fill's cut (#138, §5): a point a triangle, at its slot, the mask at its middle's texel. */
const CUT_VERTEX = /* glsl */ `${PRECISION}
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
  gl_PointSize = 1.0;
}
`;

const CUT_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uMask;
in vec2 vUv;
out vec4 fragColor;
void main() {
  ivec2 texel = clamp( ivec2( floor( vUv * ${PAINT_SIZE.toFixed(1)} ) ), ivec2( 0 ), ivec2( ${PAINT_SIZE - 1} ) );
  float cut = texelFetch( uMask, texel, 0 ).r >= ${MASK_CUT.toFixed(4)} ? 1.0 : 0.0;
  fragColor = vec4( cut, 0.0, 0.0, 1.0 );
}
`;

/** The mask into an RGBA target, to be read back (#138): R8 is not a format every GPU reads. */
const MASK_OUT_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uMask;
out vec4 fragColor;
void main() {
  fragColor = vec4( texelFetch( uMask, ivec2( gl_FragCoord.xy ), 0 ).r, 0.0, 0.0, 1.0 );
}
`;

/**
 * What the masks read at every texel, at its owner as the composite reads it (#128, for tests):
 * with `uPart` 0 the cavity (R, as `cavity × 0.5 + 0.5`), the occlusion (G) and in B 1 where the
 * texel has an owner; with 1 the normal (RGB, as `n × 0.5 + 0.5`).
 */
const SURFACE_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uOwner;
uniform sampler2D uAtlas;
uniform sampler2D uDetail;
uniform int uPart;
out vec4 fragColor;
void main() {
  ivec2 texel = ivec2( gl_FragCoord.xy );
  vec4 owner = floor( texelFetch( uOwner, texel, 0 ) * 255.0 + 0.5 );
  if ( owner.a == 255.0 ) {
    fragColor = vec4( 0.0 );
    return;
  }
  ivec2 from = ivec2( int( owner.r + owner.g * 256.0 ), int( owner.b + owner.a * 256.0 ) );
  vec4 detail = textureLod( uDetail, ( vec2( from ) + 0.5 ) / ${PAINT_SIZE.toFixed(1)}, 0.0 );
  if ( uPart == 0 ) {
    float cavity = clamp( ( detail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
    fragColor = vec4( cavity * 0.5 + 0.5, texelFetch( uAtlas, from, 0 ).g, 1.0, 1.0 );
  } else {
    fragColor = vec4( detail.rgb, 1.0 );
  }
}
`;

/** What the masks read at every texel (`PaintPasses.readSurface`): for tests. */
export interface PaintSurface {
  /** −1 crease … +1 edge, as the composite decodes it, to within 1/127. */
  cavity: Float32Array;
  /** 0 buried … 1 open, to within 1/255. */
  occlusion: Float32Array;
  /** The object-space normal as stored, three numbers a texel. */
  normal: Float32Array;
  /** 1 where the texel takes paint (it has an owner), else 0. */
  owned: Uint8Array;
}

/** The composite and the dilation in one pass (§5.4), for one tool. */
function compositeFragment(tool: ToolId): string {
  const pass = toolPass(tool);
  const apply = {
    erase: /* glsl */ `fragColor = vec4( paint.rgb, paint.a * ( 1.0 - alpha ) );`,
    over: /* glsl */ `float outA = alpha + paint.a * ( 1.0 - alpha );
    vec3 rgb = outA > 0.0 ? ( uColour * alpha + paint.rgb * paint.a * ( 1.0 - alpha ) ) / outA : uColour;
    fragColor = vec4( rgb, outA );`,
    // Toward the paint beneath the lifted step (#137), straight alpha mixed premultiplied; all the
    // way, its bytes.
    lift: /* glsl */ `vec4 beneath = texelFetch( uBeneath, from, 0 );
    if ( alpha >= 1.0 ) {
      fragColor = beneath;
      return;
    }
    float outA = mix( paint.a, beneath.a, alpha );
    vec3 rgb = outA > 0.0 ? mix( paint.rgb * paint.a, beneath.rgb * beneath.a, alpha ) / outA : beneath.rgb;
    fragColor = vec4( rgb, outA );`,
    mask: '',
    unmask: '',
  }[pass.composite];
  // A lift changes only the texels whose newest step is the one it takes away (#137).
  const gate =
    pass.composite === 'lift'
      ? /* glsl */ `if ( floor( texelFetch( uStamp, from, 0 ).rg * 255.0 + 0.5 ) != uLifted ) {
    fragColor = paint;
    return;
  }`
      : '';
  return /* glsl */ `${PRECISION}
uniform sampler2D uPaint;
uniform sampler2D uStroke;
uniform sampler2D uOwner;
uniform sampler2D uAtlas;
uniform sampler2D uDetail;
uniform sampler2D uReference;
uniform sampler2D uStamp;
uniform sampler2D uBeneath;
uniform sampler2D uMask;
uniform vec2 uLifted;
uniform vec3 uColour;
uniform float uOpacity;
uniform float uPressure;
uniform vec4 uDirection;
out vec4 fragColor;

float mtMask( float cavity, float occlusion, vec3 normal, float reference ) {
  ${pass.mask}
}

void main() {
  ivec2 texel = ivec2( gl_FragCoord.xy );
  vec4 owner = floor( texelFetch( uOwner, texel, 0 ) * 255.0 + 0.5 );
  // Beyond the rings: the texel as it is.
  if ( owner.a == 255.0 ) {
    fragColor = texelFetch( uPaint, texel, 0 );
    return;
  }
  ivec2 from = ivec2( int( owner.r + owner.g * 256.0 ), int( owner.b + owner.a * 256.0 ) );
  vec4 paint = texelFetch( uPaint, from, 0 );
  float coverage = texelFetch( uStroke, from, 0 ).r;
  if ( coverage <= 0.0 ) {
    // Untouched: the owner's paint as it is, bit for bit through the sRGB round trip.
    fragColor = paint;
    return;
  }
  ${gate}
  // The full-size level, named: after the return above the implicit derivatives a mip level
  // comes from are undefined, and the surface a texel reads would follow which of its neighbours
  // the stroke covered (#128: a second airbrush pass found other normals than the first).
  vec4 detail = textureLod( uDetail, ( vec2( from ) + 0.5 ) / ${PAINT_SIZE.toFixed(1)}, 0.0 );
  float cavity = clamp( ( detail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
  vec3 normal = detail.rgb * 2.0 - 1.0;
  float occlusion = texelFetch( uAtlas, from, 0 ).g;
  // The stroke's reference (#133): −1 when its first dab covered nothing.
  float reference = texelFetch( uReference, ivec2( 0 ), 0 ).r * 2.0 - 1.0;
  // The mask protects the texel from every tool (#138): fully masked, its bytes as they are.
  float alpha = uOpacity * coverage * mtMask( cavity, occlusion, normal, reference )
    * ( 1.0 - texelFetch( uMask, from, 0 ).r );
  if ( alpha <= 0.0 ) {
    fragColor = paint;
    return;
  }
  ${apply}
}
`;
}

const raw = (
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform> = {},
  blend: 'none' | 'max' | 'add' = 'none',
): THREE.RawShaderMaterial => {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  if (blend === 'none') material.blending = THREE.NoBlending;
  else {
    material.blending = THREE.CustomBlending;
    material.blendEquation = blend === 'max' ? THREE.MaxEquation : THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
  }
  return material;
};

const textureTarget = (format: 'srgb' | 'rgba'): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(PAINT_SIZE, PAINT_SIZE, {
    depthBuffer: false,
    generateMipmaps: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: format === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    minFilter: format === 'srgb' ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: format === 'srgb' ? THREE.LinearFilter : THREE.NearestFilter,
  });
  return target;
};

/** The stamp map (#137): RG8, a step's number in two bytes, low first. */
const stampTarget = (): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(PAINT_SIZE, PAINT_SIZE, {
    depthBuffer: false,
    generateMipmaps: false,
    format: THREE.RGFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

/** The mask (#138): R8, a byte a texel, nearest. */
const maskTarget = (): THREE.WebGLRenderTarget => referenceTarget(PAINT_SIZE);

/** A keyframe (§8): the paint, since #137 its stamp map, since #138 its mask. */
export interface Keyframe {
  paint: THREE.WebGLRenderTarget;
  stamp: THREE.WebGLRenderTarget;
  mask: THREE.WebGLRenderTarget;
}

/** Releases a keyframe's targets. */
export function disposeKeyframe(keyframe: Keyframe): void {
  keyframe.paint.dispose();
  keyframe.stamp.dispose();
  keyframe.mask.dispose();
}

/** A stamp's two bytes for step `index` (0-based): index + 1 modulo STAMP_MODULUS, low byte first. */
export function stampBytes(index: number): [number, number] {
  const value = (index + 1) % STAMP_MODULUS;
  return [value & 255, value >> 8];
}

/**
 * The step a stamp names, as an index: of the steps it may name, the newest of the `applied`
 * ones. Null for no step.
 */
export function stampedStep(bytes: readonly [number, number], applied: number): number | null {
  const value = bytes[0] + bytes[1] * 256;
  if (value === 0) return null;
  const back = (((applied - value) % STAMP_MODULUS) + STAMP_MODULUS) % STAMP_MODULUS;
  const index = applied - back - 1;
  return index >= 0 ? index : null;
}

/** The stroke layer: R8, with a stencil for the adding draws (`onceATexel`). */
const strokeTarget = (): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(PAINT_SIZE, PAINT_SIZE, {
    depthBuffer: true,
    stencilBuffer: true,
    generateMipmaps: false,
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

/** A level of the reference's reduction: R8, `size` square, read texel by texel. */
const referenceTarget = (size: number): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    generateMipmaps: false,
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

/** The reduction's levels from PAINT_SIZE down to one texel: each one's side and the block it reduces. */
function referenceLevels(): { size: number; block: number }[] {
  const levels: { size: number; block: number }[] = [];
  for (let size = PAINT_SIZE; size > 1;) {
    const block = Math.min(REFERENCE_BLOCK, size);
    if (size % block !== 0) throw new RangeError(`${PAINT_SIZE} does not reduce by ${block}`);
    size /= block;
    levels.push({ size, block });
  }
  return levels;
}

/**
 * A material that writes a texel once a draw: the first fragment there marks the stencil (the
 * triangles are drawn before the edges), the later ones are dropped. A discarded fragment (out of
 * sight, facing away) marks nothing, so which fragment counts depends on the stroke's camera
 * alone, the same in every draw of the stroke and in its replay.
 */
function onceATexel(material: THREE.RawShaderMaterial): THREE.RawShaderMaterial {
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return material;
}

/** The edges of every triangle as line segments over the same vertices: the border texels. */
function edgeIndex(indices: ArrayLike<number>, triangles?: ArrayLike<number>): Uint32Array {
  const count = triangles ? triangles.length : indices.length / 3;
  const edges = new Uint32Array(count * 6);
  for (let k = 0; k < count; k++) {
    const t = triangles ? triangles[k]! : k;
    const a = indices[t * 3]!;
    const b = indices[t * 3 + 1]!;
    const c = indices[t * 3 + 2]!;
    edges.set([a, b, b, c, c, a], k * 6);
  }
  return edges;
}

/** A geometry over `source`'s attributes with an index of its own. */
function sharing(source: THREE.BufferGeometry, index: Uint32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'occlusion'])
    geometry.setAttribute(name, source.getAttribute(name));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** Releases a geometry made by `sharing`: its index only, the attributes are the source's. */
function releaseShared(geometry: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'uv', 'occlusion']) geometry.deleteAttribute(name);
  geometry.dispose();
}

/** The camera a stroke's depth map is rendered from, made from its record alone, so a replay sees what the stroke saw. */
export function cameraOfStroke(stroke: StrokeCamera): THREE.PerspectiveCamera {
  const [width, height] = stroke.viewport;
  const camera = new THREE.PerspectiveCamera(
    stroke.fovDeg,
    width / height,
    stroke.near,
    stroke.far,
  );
  camera.position.set(...stroke.position);
  camera.lookAt(...stroke.target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

export class PaintPasses {
  /** The committed paint and the paint with the stroke in progress (what the material shows). */
  readonly paint = textureTarget('srgb');
  readonly live = textureTarget('srgb');
  /** The newest step to change each texel (#137): kept with the keyframes. */
  private readonly stamp = stampTarget();
  /** The committed mask and the mask with a mask stroke in progress (#138): what the tint shows. */
  private readonly mask = maskTarget();
  private readonly maskLive = maskTarget();
  /** One texel read back: the stamp under a lift's start. */
  private readonly probe = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private readonly stroke = strokeTarget();
  private readonly atlas = textureTarget('rgba');
  private depth: THREE.WebGLRenderTarget | null = null;
  private owner: THREE.DataTexture | null = null;
  /** The raw shaders take their matrices as uniforms: this camera only satisfies `render`. */
  private readonly camera = new THREE.OrthographicCamera();
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly textureScene = new THREE.Scene();
  private readonly depthScene = new THREE.Scene();
  private mini: {
    triangles: THREE.Mesh;
    edges: THREE.LineSegments;
    depth: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    detail: THREE.Texture;
    /** A point a triangle at its middle's texture coordinates, and the target they draw into (#138). */
    cut: CutPoints;
  } | null = null;
  private readonly atlasMaterial = raw(
    TEXTURE_SPACE_VERTEX,
    ATLAS_FRAGMENT,
    { uLevel: { value: 1 } },
    'max',
  );
  private readonly depthMaterial = raw(DEPTH_VERTEX, DEPTH_FRAGMENT, {
    uViewProjection: { value: new THREE.Matrix4() },
  });
  private readonly dabUniforms = {
    uDepth: { value: null as THREE.Texture | null },
    uViewProjection: { value: new THREE.Matrix4() },
    uEye: { value: new THREE.Vector3() },
    uNearFar: { value: new THREE.Vector2() },
    uDabs: { value: new Float32Array(DABS_PER_PASS * 4) },
    uDabCount: { value: 0 },
    uRadius: { value: 1 },
    uHardness: { value: 0.8 },
    uGain: { value: 1 },
  };
  private readonly dabMaterials = {
    max: raw(TEXTURE_SPACE_VERTEX, dabFragment(false), this.dabUniforms, 'max'),
    add: onceATexel(raw(TEXTURE_SPACE_VERTEX, dabFragment(true), this.dabUniforms, 'add')),
  };
  private readonly regionMaterial = raw(TEXTURE_SPACE_VERTEX, REGION_FRAGMENT, {}, 'max');
  /** The reference's levels, the last one texel: what the composite reads (#133). */
  private readonly reference = referenceLevels().map(({ size, block }) => ({
    target: referenceTarget(size),
    block,
  }));
  private readonly referenceMaterial = raw(QUAD_VERTEX, REFERENCE_FRAGMENT, {
    uStroke: { value: this.stroke.texture },
    uDetail: { value: null },
  });
  private readonly highestMaterial = raw(QUAD_VERTEX, HIGHEST_FRAGMENT, {
    uSource: { value: null },
    uBlock: { value: REFERENCE_BLOCK },
  });
  private readonly copyMaterial = raw(QUAD_VERTEX, COPY_FRAGMENT, { uSource: { value: null } });
  private readonly stampMaterial = raw(QUAD_VERTEX, STAMP_FRAGMENT, {
    uPaint: { value: this.paint.texture },
    uLive: { value: this.live.texture },
    uBeneath: { value: null },
    uBeneathStamp: { value: null },
    uLift: { value: false },
    uValue: { value: new THREE.Vector2() },
  });
  private readonly probeMaterial = raw(QUAD_VERTEX, PROBE_FRAGMENT, {
    uSource: { value: this.stamp.texture },
    uTexel: { value: new THREE.Vector2() },
  });
  private readonly maskUniforms = {
    uMask: { value: this.mask.texture as THREE.Texture },
    uStroke: { value: this.stroke.texture as THREE.Texture },
    uOwner: { value: null as THREE.Texture | null },
    uOpacity: { value: 1 },
  };
  private readonly maskMaterials = {
    mask: raw(QUAD_VERTEX, maskCompositeFragment(true), this.maskUniforms),
    unmask: raw(QUAD_VERTEX, maskCompositeFragment(false), this.maskUniforms),
  };
  private readonly maskChangeMaterial = raw(QUAD_VERTEX, MASK_CHANGE_FRAGMENT, {
    uMask: { value: this.mask.texture },
    uInvert: { value: false },
  });
  private readonly cutMaterial = raw(CUT_VERTEX, CUT_FRAGMENT, {
    uMask: { value: this.mask.texture },
  });
  private readonly maskOutMaterial = raw(QUAD_VERTEX, MASK_OUT_FRAGMENT, {
    uMask: { value: this.mask.texture },
  });
  private readonly cutScene = new THREE.Scene();
  /** The paint beneath the step a lift takes away, while it strokes or replays (#137). */
  private beneath: Keyframe | null = null;
  private readonly compositeMaterials = new Map<ToolId, THREE.RawShaderMaterial>();
  private readonly compositeUniforms = {
    uPaint: { value: this.paint.texture as THREE.Texture },
    uStroke: { value: this.stroke.texture as THREE.Texture },
    uOwner: { value: null as THREE.Texture | null },
    uAtlas: { value: this.atlas.texture as THREE.Texture },
    uDetail: { value: null as THREE.Texture | null },
    uReference: { value: this.reference.at(-1)!.target.texture as THREE.Texture },
    uStamp: { value: this.stamp.texture as THREE.Texture },
    uBeneath: { value: this.paint.texture as THREE.Texture },
    uMask: { value: this.mask.texture as THREE.Texture },
    uLifted: { value: new THREE.Vector2() },
    uColour: { value: new THREE.Vector3() },
    uOpacity: { value: 1 },
    uPressure: { value: 1 },
    uDirection: { value: new THREE.Vector4() },
  };

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    // The depth map is the one pass that tests and writes depth.
    this.depthMaterial.depthTest = true;
    this.depthMaterial.depthWrite = true;
    this.quad = new THREE.Mesh(triangle, this.copyMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** The texture the mini is drawn with: the paint with the stroke in progress. */
  get liveTexture(): THREE.Texture {
    return this.live.texture;
  }

  /** The mask with a mask stroke in progress (#138): what the tint is drawn from. */
  get maskTexture(): THREE.Texture {
    return this.maskLive.texture;
  }

  /**
   * Prepares the passes for a mini (§5.1): the atlas maps, the owner map read back from them, the
   * paint (bare when null) in `paint` and `live`, the mask (none when null, #138) in `mask` and
   * `maskLive`. `geometry` is the display's (`createBakedGeometry`), shared; `detail` the view's
   * own copy of the detail texture.
   */
  async open(
    geometry: THREE.BufferGeometry,
    mesh: IndexedMesh,
    detail: THREE.Texture,
    paint: Albedo | null,
    mask: PaintMask | null = null,
  ): Promise<void> {
    this.close();
    const edges = sharing(geometry, edgeIndex(mesh.indices));
    const triangles = new THREE.Mesh(geometry, this.atlasMaterial);
    const lines = new THREE.LineSegments(edges, this.atlasMaterial);
    const depth = new THREE.Mesh(geometry, this.depthMaterial);
    for (const object of [triangles, lines, depth]) object.frustumCulled = false;
    // The triangles before the edges: an adding draw counts the first fragment at a texel.
    lines.renderOrder = 1;
    this.textureScene.add(triangles, lines);
    this.depthScene.add(depth);
    const cut = cutPoints(mesh, this.cutMaterial);
    this.cutScene.add(cut.points);
    const mini = { triangles, edges: lines, depth, geometry: edges, detail, cut };
    this.mini = mini;
    this.compositeUniforms.uDetail.value = detail;
    this.referenceMaterial.uniforms.uDetail!.value = detail;

    // The atlas: islands at 1, their borders at 0.5 (the edges, max-blended under the triangles).
    this.atlasMaterial.uniforms.uLevel!.value = 1;
    lines.visible = false;
    this.draw(this.atlas, this.textureScene, true);
    this.atlasMaterial.uniforms.uLevel!.value = 0.5;
    triangles.visible = false;
    lines.visible = true;
    this.draw(this.atlas, this.textureScene, false);
    triangles.visible = true;

    const texels = new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4);
    await this.renderer.readRenderTargetPixelsAsync(
      this.atlas,
      0,
      0,
      PAINT_SIZE,
      PAINT_SIZE,
      texels,
    );
    // Closed or disposed while the read-back was pending: nothing more to prepare.
    if (this.mini !== mini) return;
    const islands = new Uint8Array(PAINT_SIZE * PAINT_SIZE);
    for (let texel = 0; texel < islands.length; texel++) {
      const level = texels[texel * 4]!;
      islands[texel] = level > 191 ? ISLAND_TEXEL : level > 63 ? BORDER_TEXEL : GUTTER_TEXEL;
    }
    this.owner = ownerTexture(ownerMap(islands, PAINT_SIZE, PAINT_DILATION_RINGS));
    this.compositeUniforms.uOwner.value = this.owner;
    this.maskUniforms.uOwner.value = this.owner;

    // No step changed a texel yet.
    this.draw(this.stamp, null, true);
    // The paint: a byte copy into `paint`, then into `live`.
    this.renderer.initRenderTarget(this.paint);
    this.renderer.initRenderTarget(this.live);
    const bytes = paint?.data ?? new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4);
    const upload = new THREE.DataTexture(bytes, PAINT_SIZE, PAINT_SIZE);
    this.renderer.copyTextureToTexture(upload, this.paint.texture);
    upload.dispose();
    // The mask (#138): its bytes uploaded, or nothing masked.
    this.renderer.initRenderTarget(this.mask);
    this.renderer.initRenderTarget(this.maskLive);
    if (mask) {
      const masked = new THREE.DataTexture(
        mask.data,
        PAINT_SIZE,
        PAINT_SIZE,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      masked.unpackAlignment = 1;
      this.renderer.copyTextureToTexture(masked, this.mask.texture);
      masked.dispose();
    } else this.draw(this.mask, null, true);
    this.cancel();
  }

  /** A stroke starts (§5.2): its depth map from its camera, an empty stroke layer. */
  beginStroke(camera: StrokeCamera): void {
    const [width, height] = camera.viewport;
    if (!this.depth) {
      this.depth = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RedFormat,
        depthTexture: new THREE.DepthTexture(width, height),
        generateMipmaps: false,
      });
    } else if (this.depth.width !== width || this.depth.height !== height) {
      this.depth.setSize(width, height);
    }
    const view = cameraOfStroke(camera);
    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      view.projectionMatrix,
      view.matrixWorldInverse,
    );
    this.depthMaterial.uniforms.uViewProjection!.value.copy(viewProjection);
    this.draw(this.depth, this.depthScene, true);
    this.dabUniforms.uDepth.value = this.depth.depthTexture;
    this.dabUniforms.uViewProjection.value.copy(viewProjection);
    this.dabUniforms.uEye.value.set(...camera.position);
    this.dabUniforms.uNearFar.value.set(camera.near, camera.far);
    this.clearStroke();
  }

  /** Clears the stroke layer: a fill starts, or a stroke. */
  clearStroke(): void {
    this.draw(this.stroke, null, true);
  }

  /**
   * The dab pass (§5.3): the coverage of `dabs` (four numbers each, from `from` on, a dab index)
   * into the stroke layer, `DABS_PER_PASS` a draw. For a tool that reads a reference (the dry
   * brush, #133), a draw from the stroke's first dab draws that dab alone, measures the reference
   * under it (`measureReference`), then the rest: the largest coverage is the same bytes in any
   * grouping, and the live stroke and its replay both start there.
   */
  drawDabs(dabs: ArrayLike<number>, from: number, brush: BrushSettings, tool: ToolId): void {
    const mini = this.mini;
    if (!mini) return;
    const count = dabs.length / 4;
    const pass = toolPass(tool);
    const material = this.dabMaterials[pass.blend];
    this.dabUniforms.uRadius.value = brush.sizeMm / 2;
    this.dabUniforms.uHardness.value = Math.min(
      HARDEST,
      Math.max(0, pass.hardness ?? brush.hardness),
    );
    this.dabUniforms.uGain.value = dabGain(tool, brush);
    mini.triangles.material = material;
    mini.edges.material = material;
    const packed = this.dabUniforms.uDabs.value;
    const draw = (first: number, n: number): void => {
      for (let k = 0; k < n * 4; k++) packed[k] = dabs[first * 4 + k]!;
      this.dabUniforms.uDabCount.value = n;
      this.draw(this.stroke, this.textureScene, pass.blend === 'add' ? 'stencil' : false);
    };
    let first = from;
    if (from === 0 && pass.reference && count > 0) {
      draw(0, 1);
      this.measureReference();
      first = 1;
    }
    for (; first < count; first += DABS_PER_PASS)
      draw(first, Math.min(DABS_PER_PASS, count - first));
    mini.triangles.material = this.atlasMaterial;
    mini.edges.material = this.atlasMaterial;
  }

  /**
   * The stroke's reference (#133, design note `docs/design/dry-brush-crests.md` §5): the highest
   * cavity of the texels the stroke layer covers, reduced level by level into one texel, as
   * `cavity × 0.5 + 0.5` (0 when nothing is covered). Run with the first dab alone in the layer.
   */
  private measureReference(): void {
    let source: THREE.Texture | null = null;
    for (const { target, block } of this.reference) {
      if (source === null) this.quad.material = this.referenceMaterial;
      else {
        this.highestMaterial.uniforms.uSource!.value = source;
        this.highestMaterial.uniforms.uBlock!.value = block;
        this.quad.material = this.highestMaterial;
      }
      this.draw(target, this.quadScene, false);
      source = target.texture;
    }
  }

  /** A fill's region (§7.1) into the stroke layer at full coverage: its triangles and their edges. */
  drawRegion(mesh: IndexedMesh, triangles: Uint32Array): void {
    const mini = this.mini;
    if (!mini || triangles.length === 0) return;
    const index = new Uint32Array(triangles.length * 3);
    triangles.forEach((t, k) => index.set(mesh.indices.subarray(t * 3, t * 3 + 3), k * 3));
    const faces = sharing(mini.triangles.geometry, index);
    const edges = sharing(mini.triangles.geometry, edgeIndex(mesh.indices, triangles));
    const scene = new THREE.Scene();
    const meshes = [
      new THREE.Mesh(faces, this.regionMaterial),
      new THREE.LineSegments(edges, this.regionMaterial),
    ];
    for (const object of meshes) object.frustumCulled = false;
    scene.add(...meshes);
    this.draw(this.stroke, scene, false);
    releaseShared(faces);
    releaseShared(edges);
  }

  /** The stroke onto the paint into `live`, through the tool's mask, every gutter texel from its owner (§5.4). */
  composite(tool: ToolId, colour: readonly [number, number, number], brush: BrushSettings): void {
    const pass = toolPass(tool);
    // The mask's own tools (#138): onto `maskLive`.
    if (ontoMask(pass)) {
      this.maskUniforms.uOpacity.value = Math.max(0, Math.min(1, brush.opacity));
      this.quad.material = this.maskMaterials[pass.composite as 'mask' | 'unmask'];
      this.draw(this.maskLive, this.quadScene, false);
      return;
    }
    let material = this.compositeMaterials.get(tool);
    if (!material) {
      material = raw(QUAD_VERTEX, compositeFragment(tool), this.compositeUniforms);
      this.compositeMaterials.set(tool, material);
    }
    this.compositeUniforms.uColour.value.set(...colour);
    this.compositeUniforms.uOpacity.value = Math.max(0, Math.min(1, strokeOpacity(tool, brush)));
    this.compositeUniforms.uPressure.value = Math.max(0, Math.min(1, brush.opacity));
    const direction = unitDirection(brush.direction);
    if (direction) this.compositeUniforms.uDirection.value.set(...direction, 1);
    else this.compositeUniforms.uDirection.value.set(0, 0, 0, 0);
    this.quad.material = material;
    this.draw(this.live, this.quadScene, false);
  }

  /** The mask changed whole (#138): cleared or inverted into `maskLive`, committed by `commitMask`. */
  changeMask(change: MaskChange['change']): void {
    this.maskChangeMaterial.uniforms.uInvert!.value = change === 'invert';
    this.quad.material = this.maskChangeMaterial;
    this.draw(this.maskLive, this.quadScene, false);
  }

  /**
   * The fill's cut (#138, design note `docs/design/paint-mask.md` §5): a byte a triangle, 1 where
   * the committed mask at its middle is at least MASK_CUT. A point a triangle drawn and read back
   * now, a GPU sync: only at a picked fill, live or replayed.
   */
  readCut(): Uint8Array {
    const cut = this.mini?.cut;
    if (!cut) return new Uint8Array(0);
    this.draw(cut.target, this.cutScene, true);
    const { width, height } = cut.target;
    const bytes = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(cut.target, 0, 0, width, height, bytes);
    const out = new Uint8Array(cut.triangles);
    for (let t = 0; t < out.length; t++) out[t] = bytes[t * 4]! > 127 ? 1 : 0;
    return out;
  }

  /**
   * The paint a lift composites toward (#137): the keyframe before step `index`, which it takes
   * away where that step is the top layer. Holds until the next `commit` or `cancel`.
   */
  lift(beneath: Keyframe, index: number): void {
    this.beneath = beneath;
    this.compositeUniforms.uBeneath.value = beneath.paint.texture;
    this.compositeUniforms.uLifted.value.set(...stampBytes(index));
  }

  /**
   * Step `index` is final: the texels it changed take its stamp (a lift's: the stamp beneath where
   * it took the step away fully, #137), and `live` is the paint now.
   */
  commit(index: number, tool: ToolId): void {
    // A step onto the mask (#138) changes no paint: no stamp, the mask committed.
    if (ontoMask(toolPass(tool))) {
      this.commitMask();
      return;
    }
    const lift = toolPass(tool).composite === 'lift';
    const beneath = this.beneath;
    // A lift with nothing beneath composited nothing: no stamp changes.
    if (!lift || beneath) {
      const uniforms = this.stampMaterial.uniforms;
      uniforms.uLift!.value = lift;
      uniforms.uBeneath!.value = beneath?.paint.texture ?? this.paint.texture;
      // Never the stamp map itself: it is the target, and a sampler on it would be a feedback loop.
      uniforms.uBeneathStamp!.value = beneath?.stamp.texture ?? this.paint.texture;
      const [low, high] = stampBytes(index);
      (uniforms.uValue!.value as THREE.Vector2).set(low / 255, high / 255);
      this.quad.material = this.stampMaterial;
      this.draw(this.stamp, this.quadScene, false);
    }
    this.forgetBeneath();
    this.renderer.copyTextureToTexture(this.live.texture, this.paint.texture);
  }

  /** A step onto the mask is final (#138): `maskLive` is the mask now. */
  commitMask(): void {
    this.renderer.copyTextureToTexture(this.maskLive.texture, this.mask.texture);
  }

  /** The lift is over: no keyframe stays bound, as it may be dropped. */
  private forgetBeneath(): void {
    this.beneath = null;
    this.compositeUniforms.uBeneath.value = this.paint.texture;
  }

  /** The stamp's two bytes at a texel (#137): drawn into a 1 × 1 target and read back now, a GPU sync. */
  readStamp(x: number, y: number): [number, number] {
    (this.probeMaterial.uniforms.uTexel!.value as THREE.Vector2).set(x, y);
    this.quad.material = this.probeMaterial;
    this.draw(this.probe, this.quadScene, false);
    const bytes = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.probe, 0, 0, 1, 1, bytes);
    return [bytes[0]!, bytes[1]!];
  }

  /** The stroke is dropped: `live` shows the paint again, `maskLive` the mask (#138). */
  cancel(): void {
    this.forgetBeneath();
    this.renderer.copyTextureToTexture(this.paint.texture, this.live.texture);
    this.renderer.copyTextureToTexture(this.mask.texture, this.maskLive.texture);
  }

  /** A keyframe (§8): a copy of the paint as it is, of its stamp map (#137) and of the mask (#138). */
  snapshot(): Keyframe {
    const keyframe = { paint: textureTarget('srgb'), stamp: stampTarget(), mask: maskTarget() };
    this.renderer.initRenderTarget(keyframe.paint);
    this.renderer.initRenderTarget(keyframe.stamp);
    this.renderer.initRenderTarget(keyframe.mask);
    this.renderer.copyTextureToTexture(this.paint.texture, keyframe.paint.texture);
    this.renderer.copyTextureToTexture(this.stamp.texture, keyframe.stamp.texture);
    this.renderer.copyTextureToTexture(this.mask.texture, keyframe.mask.texture);
    return keyframe;
  }

  /** Back to a keyframe: the paint, its stamp map, the mask, `live` and `maskLive` are its bytes again. */
  restore(keyframe: Keyframe): void {
    this.renderer.copyTextureToTexture(keyframe.paint.texture, this.paint.texture);
    this.renderer.copyTextureToTexture(keyframe.stamp.texture, this.stamp.texture);
    this.renderer.copyTextureToTexture(keyframe.mask.texture, this.mask.texture);
    this.cancel();
  }

  /** The committed mask's bytes (#138): PAINT_SIZE square, a byte a texel, row 0 at v = 0. */
  async readMask(): Promise<Uint8Array> {
    const target = textureTarget('rgba');
    const rgba = new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4);
    try {
      this.quad.material = this.maskOutMaterial;
      this.draw(target, this.quadScene, true);
      await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, PAINT_SIZE, PAINT_SIZE, rgba);
    } finally {
      target.dispose();
    }
    const bytes = new Uint8Array(PAINT_SIZE * PAINT_SIZE);
    for (let texel = 0; texel < bytes.length; texel++) bytes[texel] = rgba[texel * 4]!;
    return bytes;
  }

  /** The committed paint's bytes: PAINT_SIZE square, sRGB, straight alpha, row 0 at v = 0. */
  async readPaint(): Promise<Uint8Array> {
    const bytes = new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4);
    await this.renderer.readRenderTargetPixelsAsync(
      this.paint,
      0,
      0,
      PAINT_SIZE,
      PAINT_SIZE,
      bytes,
    );
    return bytes;
  }

  /** One texel of the committed paint: sRGB, straight alpha (#135). */
  async readTexel(x: number, y: number): Promise<[number, number, number, number]> {
    const bytes = new Uint8Array(4);
    await this.renderer.readRenderTargetPixelsAsync(this.paint, x, y, 1, 1, bytes);
    return [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];
  }

  /**
   * What the masks read at every texel, at its owner (§6): the cavity, the occlusion and the
   * normal, for tests that check a brush against `toolMask`. Two quad passes and two read-backs;
   * not used while painting.
   */
  async readSurface(): Promise<PaintSurface> {
    const count = PAINT_SIZE * PAINT_SIZE;
    const surface: PaintSurface = {
      cavity: new Float32Array(count),
      occlusion: new Float32Array(count),
      normal: new Float32Array(count * 3),
      owned: new Uint8Array(count),
    };
    if (!this.mini || !this.owner) return surface;
    const target = textureTarget('rgba');
    const material = raw(QUAD_VERTEX, SURFACE_FRAGMENT, {
      uOwner: { value: this.owner },
      uAtlas: { value: this.atlas.texture },
      uDetail: { value: this.mini.detail },
      uPart: { value: 0 },
    });
    const bytes = new Uint8Array(count * 4);
    try {
      this.quad.material = material;
      for (const part of [0, 1]) {
        material.uniforms.uPart!.value = part;
        this.draw(target, this.quadScene, true);
        await this.renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          PAINT_SIZE,
          PAINT_SIZE,
          bytes,
        );
        for (let texel = 0; texel < count; texel++) {
          const k = texel * 4;
          if (part === 0) {
            surface.cavity[texel] = (bytes[k]! / 255) * 2 - 1;
            surface.occlusion[texel] = bytes[k + 1]! / 255;
            surface.owned[texel] = bytes[k + 2]! > 127 ? 1 : 0;
          } else
            for (let axis = 0; axis < 3; axis++)
              surface.normal[texel * 3 + axis] = (bytes[k + axis]! / 255) * 2 - 1;
        }
      }
    } finally {
      target.dispose();
      material.dispose();
    }
    return surface;
  }

  /**
   * Compiles and runs every pass's program once without changing the paint (no dabs, nothing
   * covered), so the first stroke does not wait for them: after `open`, from the view's camera.
   */
  warm(camera: StrokeCamera, tools: readonly ToolId[]): void {
    this.beginStroke(camera);
    const mini = this.mini;
    if (!mini) return;
    this.dabUniforms.uDabCount.value = 0;
    for (const blend of ['max', 'add'] as const) {
      mini.triangles.material = this.dabMaterials[blend];
      mini.edges.material = this.dabMaterials[blend];
      this.draw(this.stroke, this.textureScene, blend === 'add' ? 'stencil' : false);
    }
    mini.triangles.material = this.atlasMaterial;
    mini.edges.material = this.atlasMaterial;
    this.measureReference();
    // Nothing covered: no tool changes a texel, whatever its opacity.
    for (const tool of tools) this.composite(tool, [0, 0, 0], DEFAULT_BRUSH);
    // The mask's whole changes and its cut (#138), into `maskLive` and the cut's target: dropped.
    this.changeMask('invert');
    this.draw(mini.cut.target, this.cutScene, true);
    this.cancel();
    // The stamp pass with `live` equal to the paint changes no stamp; the probe reads nothing back.
    this.stampMaterial.uniforms.uLift!.value = false;
    this.stampMaterial.uniforms.uBeneath!.value = this.paint.texture;
    this.stampMaterial.uniforms.uBeneathStamp!.value = this.paint.texture;
    for (const material of [this.stampMaterial, this.probeMaterial]) {
      this.quad.material = material;
      this.draw(material === this.probeMaterial ? this.probe : this.stamp, this.quadScene, false);
    }
  }

  /** Releases what belongs to the mini; the targets stay for the next. */
  close(): void {
    const mini = this.mini;
    if (!mini) return;
    this.textureScene.remove(mini.triangles, mini.edges);
    this.depthScene.remove(mini.depth);
    this.cutScene.remove(mini.cut.points);
    mini.cut.points.geometry.dispose();
    mini.cut.target.dispose();
    releaseShared(mini.geometry);
    this.owner?.dispose();
    this.owner = null;
    this.compositeUniforms.uOwner.value = null;
    this.maskUniforms.uOwner.value = null;
    this.compositeUniforms.uDetail.value = null;
    this.referenceMaterial.uniforms.uDetail!.value = null;
    this.mini = null;
  }

  dispose(): void {
    this.close();
    for (const target of [
      this.paint,
      this.live,
      this.stamp,
      this.mask,
      this.maskLive,
      this.probe,
      this.stroke,
      this.atlas,
      this.depth,
      ...this.reference.map((level) => level.target),
    ])
      target?.dispose();
    this.depth?.depthTexture?.dispose();
    for (const material of [
      this.atlasMaterial,
      this.depthMaterial,
      this.dabMaterials.max,
      this.dabMaterials.add,
      this.regionMaterial,
      this.referenceMaterial,
      this.highestMaterial,
      this.copyMaterial,
      this.stampMaterial,
      this.probeMaterial,
      this.maskMaterials.mask,
      this.maskMaterials.unmask,
      this.maskChangeMaterial,
      this.cutMaterial,
      this.maskOutMaterial,
      ...this.compositeMaterials.values(),
    ])
      material.dispose();
    this.quad.geometry.dispose();
  }

  /**
   * Renders `scene` into `target`, leaving the renderer as it was: cleared to transparent black
   * first (`true`), or only its stencil (`'stencil'`: an adding dab draw, §5.3).
   */
  private draw(
    target: THREE.WebGLRenderTarget,
    scene: THREE.Scene | null,
    clear: boolean | 'stencil',
  ): void {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearColour = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    if (clear === 'stencil') renderer.clear(false, false, true);
    else if (clear) {
      renderer.setClearColor(BLACK, 0);
      renderer.clear(true, true, target.stencilBuffer);
    }
    if (scene) renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    renderer.autoClear = autoClear;
  }
}

/** The cut's points (#138) and the target they draw into: a texel a triangle. */
interface CutPoints {
  points: THREE.Points;
  target: THREE.WebGLRenderTarget;
  triangles: number;
}

/**
 * The cut's points (#138): one a triangle, at a pixel of its own of a target `⌈√T⌉` texels on a
 * side, with the texture coordinates of its middle.
 */
function cutPoints(mesh: IndexedMesh, material: THREE.RawShaderMaterial): CutPoints {
  const triangles = mesh.indices.length / 3;
  const side = Math.max(1, Math.ceil(Math.sqrt(triangles)));
  const positions = new Float32Array(triangles * 3);
  const uvs = new Float32Array(triangles * 2);
  const meshUvs = mesh.uvs!;
  for (let t = 0; t < triangles; t++) {
    positions[t * 3] = (((t % side) + 0.5) / side) * 2 - 1;
    positions[t * 3 + 1] = ((Math.floor(t / side) + 0.5) / side) * 2 - 1;
    for (let axis = 0; axis < 2; axis++) {
      let sum = 0;
      for (let corner = 0; corner < 3; corner++)
        sum += meshUvs[mesh.indices[t * 3 + corner]! * 2 + axis]!;
      uvs[t * 2 + axis] = sum / 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const target = new THREE.WebGLRenderTarget(side, side, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  return { points, target, triangles };
}

/** The owner map as a texture: x in R and G, y in B and A (low byte first); A 255 for a texel with no owner. */
function ownerTexture(owner: Int32Array): THREE.DataTexture {
  const bytes = new Uint8Array(owner.length * 4);
  for (let texel = 0; texel < owner.length; texel++) {
    const from = owner[texel]!;
    if (from === NO_OWNER) {
      bytes[texel * 4 + 3] = 255;
      continue;
    }
    const x = from % PAINT_SIZE;
    const y = (from - x) / PAINT_SIZE;
    bytes[texel * 4] = x & 255;
    bytes[texel * 4 + 1] = x >> 8;
    bytes[texel * 4 + 2] = y & 255;
    bytes[texel * 4 + 3] = y >> 8;
  }
  const texture = new THREE.DataTexture(bytes, PAINT_SIZE, PAINT_SIZE);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
