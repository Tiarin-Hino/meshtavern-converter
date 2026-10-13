import * as THREE from 'three';
import {
  BORDER_TEXEL,
  GUTTER_TEXEL,
  ISLAND_TEXEL,
  NO_OWNER,
  ownerMap,
  PAINT_SIZE,
  type BrushSettings,
  type StrokeCamera,
  type ToolId,
} from '../pipeline/brush';
import { CAVITY_GAIN } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Albedo } from '../pipeline/paint';
import { toolPass } from './tools';

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
 * - `stroke` (every frame): each texel's coverage by the frame's dabs, its largest so far.
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

const DAB_FRAGMENT = /* glsl */ `${PRECISION}
uniform sampler2D uDepth;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform vec2 uNearFar;
uniform vec4 uDabs[ ${DABS_PER_PASS} ];
uniform int uDabCount;
uniform float uRadius;
uniform float uHardness;
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
    coverage = max( coverage, 1.0 - smoothstep( uHardness * uRadius, uRadius, d ) );
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
  vec4 detail = texture( uDetail, ( vec2( from ) + 0.5 ) / ${PAINT_SIZE.toFixed(1)} );
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
  private readonly stroke = textureTarget('red');
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
  };
  private readonly dabMaterials = {
    max: raw(TEXTURE_SPACE_VERTEX, DAB_FRAGMENT, this.dabUniforms, 'max'),
    add: raw(TEXTURE_SPACE_VERTEX, DAB_FRAGMENT, this.dabUniforms, 'add'),
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
    const material = this.dabMaterials[toolPass(tool).blend];
    this.dabUniforms.uRadius.value = brush.sizeMm / 2;
    this.dabUniforms.uHardness.value = Math.min(HARDEST, Math.max(0, brush.hardness));
    mini.triangles.material = material;
    mini.edges.material = material;
    const packed = this.dabUniforms.uDabs.value;
    for (let first = from; first < count; first += DABS_PER_PASS) {
      const n = Math.min(DABS_PER_PASS, count - first);
      for (let k = 0; k < n * 4; k++) packed[k] = dabs[first * 4 + k]!;
      this.dabUniforms.uDabCount.value = n;
      this.draw(this.stroke, this.textureScene, false);
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
  composite(tool: ToolId, colour: readonly [number, number, number], opacity: number): void {
    let material = this.compositeMaterials.get(tool);
    if (!material) {
      material = raw(QUAD_VERTEX, compositeFragment(tool), this.compositeUniforms);
      this.compositeMaterials.set(tool, material);
    }
    this.compositeUniforms.uColour.value.set(...colour);
    this.compositeUniforms.uOpacity.value = Math.max(0, Math.min(1, opacity));
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
   * Compiles and runs every pass's program once without changing the paint (no dabs, nothing
   * covered), so the first stroke does not wait for them: after `open`, from the view's camera.
   */
  warm(camera: StrokeCamera, tools: readonly ToolId[]): void {
    this.beginStroke(camera);
    const mini = this.mini;
    if (!mini) return;
    this.dabUniforms.uDabCount.value = 0;
    mini.triangles.material = this.dabMaterials.max;
    mini.edges.material = this.dabMaterials.max;
    this.draw(this.stroke, this.textureScene, false);
    mini.triangles.material = this.atlasMaterial;
    mini.edges.material = this.atlasMaterial;
    for (const tool of tools) this.composite(tool, [0, 0, 0], 0);
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

  /** Renders `scene` into `target` (clearing it to transparent black first when asked), leaving the renderer as it was. */
  private draw(target: THREE.WebGLRenderTarget, scene: THREE.Scene | null, clear: boolean): void {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearColour = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    if (clear) {
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
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
