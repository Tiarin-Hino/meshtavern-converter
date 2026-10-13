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
  type StrokeCamera,
  type ToolId,
} from '../pipeline/brush';
import { CAVITY_GAIN } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Albedo } from '../pipeline/paint';
import { dabGain, strokeOpacity, toolPass } from './tools';

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
 *
 * `paint`, `live` and the keyframes are sRGB targets (SRGB8_ALPHA8): the GPU decodes on sampling,
 * encodes on writing, and the material samples `live` as it samples an sRGB `DataTexture`. Copies
 * between them are byte copies (`copyTextureToTexture`, a `copyTexSubImage2D`).
 */

/** A texel's depth may lie this far behind what the stroke's camera saw there, in mm, and still be painted. _(proposal)_ */
export const DEPTH_BIAS_MM = 0.25;
/** A texel is painted only where its surface faces the stroke's camera at least this much: about 81°. _(proposal)_ */
export const FACING_MIN_COS = 0.15;
/** Rings of gutter texels around every island that take the island's paint (§5.4). _(proposal)_ */
export const PAINT_DILATION_RINGS = 2;
/** Dabs per draw of the dab pass; more take further draws. _(proposal)_ */
export const DABS_PER_PASS = 64;
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
    float d = distance( vPosition, uDabs[ i ].xyz );
    float dab = 1.0 - smoothstep( uHardness * uRadius, uRadius, d );
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
  const apply =
    pass.composite === 'erase'
      ? /* glsl */ `fragColor = vec4( paint.rgb, paint.a * ( 1.0 - alpha ) );`
      : /* glsl */ `float outA = alpha + paint.a * ( 1.0 - alpha );
    vec3 rgb = outA > 0.0 ? ( uColour * alpha + paint.rgb * paint.a * ( 1.0 - alpha ) ) / outA : uColour;
    fragColor = vec4( rgb, outA );`;
  return /* glsl */ `${PRECISION}
uniform sampler2D uPaint;
uniform sampler2D uStroke;
uniform sampler2D uOwner;
uniform sampler2D uAtlas;
uniform sampler2D uDetail;
uniform vec3 uColour;
uniform float uOpacity;
uniform float uPressure;
uniform vec4 uDirection;
out vec4 fragColor;

float mtMask( float cavity, float occlusion, vec3 normal ) {
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
  // The full-size level, named: after the return above the implicit derivatives a mip level
  // comes from are undefined, and the surface a texel reads would follow which of its neighbours
  // the stroke covered (#128: a second airbrush pass found other normals than the first).
  vec4 detail = textureLod( uDetail, ( vec2( from ) + 0.5 ) / ${PAINT_SIZE.toFixed(1)}, 0.0 );
  float cavity = clamp( ( detail.a - 0.5 ) * ${CAVITY_GAIN.toFixed(1)}, -1.0, 1.0 );
  vec3 normal = detail.rgb * 2.0 - 1.0;
  float occlusion = texelFetch( uAtlas, from, 0 ).g;
  float alpha = uOpacity * coverage * mtMask( cavity, occlusion, normal );
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

const textureTarget = (format: 'srgb' | 'rgba' | 'red'): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(PAINT_SIZE, PAINT_SIZE, {
    depthBuffer: false,
    generateMipmaps: false,
    format: format === 'red' ? THREE.RedFormat : THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: format === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    minFilter: format === 'srgb' ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: format === 'srgb' ? THREE.LinearFilter : THREE.NearestFilter,
  });
  return target;
};

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
  private readonly copyMaterial = raw(QUAD_VERTEX, COPY_FRAGMENT, { uSource: { value: null } });
  private readonly compositeMaterials = new Map<ToolId, THREE.RawShaderMaterial>();
  private readonly compositeUniforms = {
    uPaint: { value: this.paint.texture as THREE.Texture },
    uStroke: { value: this.stroke.texture as THREE.Texture },
    uOwner: { value: null as THREE.Texture | null },
    uAtlas: { value: this.atlas.texture as THREE.Texture },
    uDetail: { value: null as THREE.Texture | null },
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

  /**
   * Prepares the passes for a mini (§5.1): the atlas maps, the owner map read back from them, the
   * paint (bare when null) in `paint` and `live`. `geometry` is the display's
   * (`createBakedGeometry`), shared; `detail` the view's own copy of the detail texture.
   */
  async open(
    geometry: THREE.BufferGeometry,
    mesh: IndexedMesh,
    detail: THREE.Texture,
    paint: Albedo | null,
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
    const mini = { triangles, edges: lines, depth, geometry: edges, detail };
    this.mini = mini;
    this.compositeUniforms.uDetail.value = detail;

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
    const mask = new Uint8Array(PAINT_SIZE * PAINT_SIZE);
    for (let texel = 0; texel < mask.length; texel++) {
      const level = texels[texel * 4]!;
      mask[texel] = level > 191 ? ISLAND_TEXEL : level > 63 ? BORDER_TEXEL : GUTTER_TEXEL;
    }
    this.owner = ownerTexture(ownerMap(mask, PAINT_SIZE, PAINT_DILATION_RINGS));
    this.compositeUniforms.uOwner.value = this.owner;

    // The paint: a byte copy into `paint`, then into `live`.
    this.renderer.initRenderTarget(this.paint);
    this.renderer.initRenderTarget(this.live);
    const bytes = paint?.data ?? new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4);
    const upload = new THREE.DataTexture(bytes, PAINT_SIZE, PAINT_SIZE);
    this.renderer.copyTextureToTexture(upload, this.paint.texture);
    upload.dispose();
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
   * into the stroke layer, `DABS_PER_PASS` a draw.
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
    for (let first = from; first < count; first += DABS_PER_PASS) {
      const n = Math.min(DABS_PER_PASS, count - first);
      for (let k = 0; k < n * 4; k++) packed[k] = dabs[first * 4 + k]!;
      this.dabUniforms.uDabCount.value = n;
      this.draw(this.stroke, this.textureScene, pass.blend === 'add' ? 'stencil' : false);
    }
    mini.triangles.material = this.atlasMaterial;
    mini.edges.material = this.atlasMaterial;
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

  /** The stroke is final: `live` is the paint now. */
  commit(): void {
    this.renderer.copyTextureToTexture(this.live.texture, this.paint.texture);
  }

  /** The stroke is dropped: `live` shows the paint again. */
  cancel(): void {
    this.renderer.copyTextureToTexture(this.paint.texture, this.live.texture);
  }

  /** A keyframe (§8): a copy of the paint as it is. */
  snapshot(): THREE.WebGLRenderTarget {
    const keyframe = textureTarget('srgb');
    this.renderer.initRenderTarget(keyframe);
    this.renderer.copyTextureToTexture(this.paint.texture, keyframe.texture);
    return keyframe;
  }

  /** Back to a keyframe: the paint and `live` are its bytes again. */
  restore(keyframe: THREE.WebGLRenderTarget): void {
    this.renderer.copyTextureToTexture(keyframe.texture, this.paint.texture);
    this.cancel();
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
    // Nothing covered: no tool changes a texel, whatever its opacity.
    for (const tool of tools) this.composite(tool, [0, 0, 0], DEFAULT_BRUSH);
    this.cancel();
  }

  /** Releases what belongs to the mini; the targets stay for the next. */
  close(): void {
    const mini = this.mini;
    if (!mini) return;
    this.textureScene.remove(mini.triangles, mini.edges);
    this.depthScene.remove(mini.depth);
    releaseShared(mini.geometry);
    this.owner?.dispose();
    this.owner = null;
    this.compositeUniforms.uOwner.value = null;
    this.compositeUniforms.uDetail.value = null;
    this.mini = null;
  }

  dispose(): void {
    this.close();
    for (const target of [this.paint, this.live, this.stroke, this.atlas, this.depth])
      target?.dispose();
    this.depth?.depthTexture?.dispose();
    for (const material of [
      this.atlasMaterial,
      this.depthMaterial,
      this.dabMaterials.max,
      this.dabMaterials.add,
      this.regionMaterial,
      this.copyMaterial,
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
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, target.stencilBuffer);
    }
    if (scene) renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    renderer.autoClear = autoClear;
  }
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
