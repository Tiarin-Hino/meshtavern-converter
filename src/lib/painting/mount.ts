import * as THREE from 'three';
import type { Vec3 } from '../pipeline/base';
import {
  DAB_SPACING,
  DEFAULT_BRUSH,
  MOUSE_PRESSURE,
  PAINT_SIZE,
  spaceDabs,
  type BrushSettings,
  type DabHit,
  type PaintRegions,
  type PaintStep,
  type PaintStroke,
  type ToolId,
} from '../pipeline/brush';
import { TriangleBvh } from '../pipeline/bvh';
import { triangleAdjacency, type TriangleAdjacency } from '../pipeline/fill';
import { DEFAULT_LOOK, parseHexColour, type Look } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Albedo } from '../pipeline/paint';
import {
  createBakedGeometry,
  createBakedMaterial,
  createDetailTexture,
  createLookUniforms,
  disposeBakedMaterial,
  updateLookUniforms,
} from '../three/baked-material';
import { ownCopy } from '../three/compressed-texture';
import { PAINT_COPY, type PaintCopy } from './copy';
import {
  DABS_PER_PASS,
  DEPTH_BIAS_MM,
  FACING_MIN_COS,
  PAINT_DILATION_RINGS,
  PaintPasses,
} from './passes';
import { PaintScene } from './scene';
import { BUILT_TOOLS, toolPass } from './tools';

export { DABS_PER_PASS, DEPTH_BIAS_MM, FACING_MIN_COS, PAINT_DILATION_RINGS };

/** The brush's diameter on the surface, in mm, at least and at most. _(proposal)_ */
export const BRUSH_MIN_MM = 0.5;
export const BRUSH_MAX_MM = 16;
/** A keyframe of the paint after every this many steps (§8). _(proposal)_ */
export const KEYFRAME_EVERY = 10;
/** Steps that can be undone, at least (§8). _(proposal)_ */
export const UNDO_STEPS = 50;
/** The cursor ring is never drawn smaller than this, in CSS pixels. _(proposal)_ */
export const CURSOR_MIN_PX = 4;
/** A frame longer than this, in ms, is counted as slow: 30 frames a second. _(proposal)_ */
export const FRAME_BUDGET_MS = 33;
/** The colour a view starts with. */
const DEFAULT_COLOUR = '#b03030';

export interface PaintingOptions {
  /** The view's canvas fills this element: give it a size. */
  scene: HTMLElement;
  /** Words to replace, field by field (§10.2). */
  copy?: Partial<PaintCopy>;
  /** Called after every change the view shows: a tool or setting changed, a step landed, undo, the perf counter at a stroke's end. */
  onChange?: (state: PaintingState) => void;
}

/** A baked mini as the consumer has it after `convert`, or later from what it stored. */
export interface MiniToPaint {
  /** The table level with texture coordinates, normals, cavity and occlusion: `result.baked.mesh`. */
  mesh: IndexedMesh;
  /** Its detail texture, transcoded (`transcodeDetail`) or uncompressed (`createDetailTexture`). Not disposed by the view. */
  texture: THREE.Texture;
  /** The look to draw with. DEFAULT_LOOK. */
  look?: Look;
  /** The paint to continue from, PAINT_SIZE square; left out or null: bare. */
  paint?: Albedo | null;
  /** The ready regions of the fill (§7.2): `regionsOf(...)`, kept by the consumer or made again. Left out: no ready regions. */
  regions?: PaintRegions | null;
}

export interface PaintPerf {
  /** Frames drawn during the last stroke, the median and the worst frame time in ms, by `performance.now()` around the frame. */
  frames: number;
  medianMs: number;
  worstMs: number;
  /** Frames over FRAME_BUDGET_MS. */
  slow: number;
}

export interface PaintingState {
  open: boolean;
  tool: ToolId;
  brush: BrushSettings;
  colour: string;
  navigating: boolean;
  /** Steps applied and steps undone (redo-able). */
  steps: number;
  undone: number;
  /** Which ready regions the mini has: both, or none. */
  regions: ('base' | 'figure')[];
  /** True while a stroke is on the canvas and not yet committed. */
  painting: boolean;
  /** The frame counter of the last stroke (§11.3). */
  perf: PaintPerf;
}

export interface PaintingView {
  readonly state: PaintingState;
  open(mini: MiniToPaint): Promise<void>;
  close(): void;
  setTool(tool: ToolId): void;
  setBrush(changes: Partial<BrushSettings>): void;
  setColour(hex: string): void;
  setLook(look: Look): void;
  /** One finger or the left button orbit instead of painting, until switched off (§9). */
  setNavigating(on: boolean): void;
  /** Fills a ready region (§7.2); a tap with the fill tool fills the region under it. */
  fillRegion(region: 'base' | 'figure'): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The paint as pixels: PAINT_SIZE square, sRGB, straight alpha, row 0 at v = 0. Resolves after the GPU read. */
  paint(): Promise<Albedo>;
  /** The steps applied so far, oldest first, as data the consumer may keep (§4). Undone steps are not in it. */
  history(): PaintStep[];
  /** For tests and scripts: a stroke given as points on the surface. */
  stroke(points: Vec3[], pressure?: number[]): Promise<void>;
  /** For tests and scripts: a stroke given as a path on the canvas (CSS px), a point a frame, as a pointer would. */
  strokeAt(path: [number, number][]): Promise<void>;
  /** The texel under a canvas point, or null off the mini: what a pixel test asserts on. */
  texelAt(x: number, y: number): { texel: [number, number]; point: Vec3; triangle: number } | null;
  /** Where a point of the mini is on the canvas, CSS px: what a test strokes along. */
  screenOf(point: Vec3): [number, number];
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void;
  setWireframe(on: boolean): void;
  dispose(): void;
}

/** The elements a view is mounted in: one view per element. */
const mounted = new WeakSet<HTMLElement>();

/**
 * Mounts the painting view into `options.scene` (issue #127, design note
 * `docs/design/painting-engine.md` §3): a canvas of its own and a brush cursor, nothing else. Every
 * panel is the consumer's, wired to the view's methods.
 */
export function mountPainting(options: PaintingOptions): PaintingView {
  return new Painting(options);
}

const NO_PERF: PaintPerf = { frames: 0, medianMs: 0, worstMs: 0, slow: 0 };

/** A mini open for painting: what the view holds until `close`. */
interface Opened {
  mesh: IndexedMesh;
  bvh: TriangleBvh;
  adjacency: TriangleAdjacency;
  regions: PaintRegions | null;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  shown: THREE.Mesh;
  uniforms: ReturnType<typeof createLookUniforms>;
}

/** The stroke on the canvas, not yet committed. */
interface LiveStroke {
  step: PaintStroke;
  /** Dabs already drawn into the stroke layer. */
  drawn: number;
  /** The last dab laid, for spacing the next samples; null after a miss. */
  last: number[] | null;
  /** Frame times from the first dab on (§11.3). */
  frames: number[];
}

class Painting implements PaintingView {
  private readonly host: HTMLElement;
  private readonly scene: PaintScene;
  private readonly passes: PaintPasses;
  private readonly copy: PaintCopy;
  private readonly onChange: ((state: PaintingState) => void) | null;
  private readonly cursor: HTMLDivElement;
  private opened: Opened | null = null;
  private live: LiveStroke | null = null;
  private steps: PaintStep[] = [];
  private tool: ToolId = 'flat';
  private brush: BrushSettings = { ...DEFAULT_BRUSH };
  private colour = DEFAULT_COLOUR;
  private perf: PaintPerf = NO_PERF;
  private current: PaintingState;

  constructor(options: PaintingOptions) {
    const host = options.scene;
    if (mounted.has(host)) throw new Error('A painting view is already mounted in this element');
    mounted.add(host);
    this.host = host;
    this.copy = { ...PAINT_COPY, ...options.copy } as PaintCopy;
    this.onChange = options.onChange ?? null;
    host.classList.add('mt-painting');
    this.scene = new PaintScene(host);
    this.passes = new PaintPasses(this.scene.renderer);
    this.cursor = document.createElement('div');
    this.cursor.className = 'mt-painting-cursor';
    this.cursor.hidden = true;
    host.append(this.cursor);
    this.scene.onFrame = () => this.drawLive();
    this.scene.onFrameTimed = (ms) => this.live?.frames.push(ms);
    this.current = this.snapshot();
  }

  get state(): PaintingState {
    return this.current;
  }

  private snapshot(): PaintingState {
    return {
      open: this.opened !== null,
      tool: this.tool,
      brush: { ...this.brush },
      colour: this.colour,
      navigating: this.scene.isNavigating,
      steps: this.steps.length,
      undone: 0,
      regions: this.opened?.regions ? ['base', 'figure'] : [],
      painting: this.live !== null,
      perf: this.perf,
    };
  }

  /** A fresh state for the consumer. */
  private emit(): void {
    this.current = this.snapshot();
    this.onChange?.(this.current);
  }

  open(mini: MiniToPaint): Promise<void> {
    const { mesh, paint, regions } = mini;
    if (!mesh.uvs || !mesh.normals) throw new RangeError(this.copy.cannotPaint);
    if (
      paint &&
      (paint.width !== PAINT_SIZE ||
        paint.height !== PAINT_SIZE ||
        paint.data.length !== PAINT_SIZE * PAINT_SIZE * 4)
    )
      throw new RangeError(`A paint is ${PAINT_SIZE} × ${PAINT_SIZE} texels, four bytes each`);
    if (regions && regions.base.length !== mesh.indices.length / 3)
      throw new RangeError('The regions are not this mesh’s: one byte per triangle');
    const texture = ownTexture(mini.texture);
    if (!texture) throw new RangeError(this.copy.cannotPaint);
    return this.opening(mini, texture);
  }

  private async opening(mini: MiniToPaint, texture: THREE.Texture): Promise<void> {
    this.close();
    const { mesh } = mini;
    const geometry = createBakedGeometry(mesh);
    const uniforms = createLookUniforms(mini.look ?? DEFAULT_LOOK);
    await this.passes.open(geometry, mesh, texture, mini.paint ?? null);
    const material = createBakedMaterial(texture, uniforms, { map: this.passes.liveTexture });
    const shown = new THREE.Mesh(geometry, material);
    const box = new THREE.Box3().setFromArray(mesh.positions);
    const size = box.getSize(new THREE.Vector3());
    this.opened = {
      mesh,
      bvh: new TriangleBvh(mesh),
      adjacency: triangleAdjacency(mesh),
      regions: mini.regions ?? null,
      geometry,
      material,
      shown,
      uniforms,
    };
    this.steps = [];
    this.perf = NO_PERF;
    this.scene.show(shown, [size.x, size.y, size.z]);
    this.passes.warm(this.scene.strokeCamera(), BUILT_TOOLS);
    await this.scene.nextFrame();
    this.emit();
  }

  close(): void {
    const opened = this.opened;
    if (!opened) return;
    this.live = null;
    this.scene.clear();
    this.passes.close();
    disposeBakedMaterial(opened.material);
    opened.geometry.dispose();
    this.opened = null;
    this.steps = [];
    this.cursor.hidden = true;
    this.scene.controls.enabled = true;
    this.emit();
  }

  setTool(tool: ToolId): void {
    toolPass(tool);
    this.commitLive();
    this.tool = tool;
    this.emit();
  }

  setBrush(changes: Partial<BrushSettings>): void {
    const next = { ...this.brush, ...changes };
    const unit = (value: number): number => Math.max(0, Math.min(1, value));
    this.brush = {
      sizeMm: Math.max(BRUSH_MIN_MM, Math.min(BRUSH_MAX_MM, next.sizeMm)),
      hardness: unit(next.hardness),
      opacity: unit(next.opacity),
      tolerance: unit(next.tolerance),
      direction: next.direction ? [...next.direction] : null,
    };
    this.emit();
  }

  setColour(hex: string): void {
    parseHexColour(hex);
    this.colour = hex.trim().toLowerCase();
    this.emit();
  }

  setLook(look: Look): void {
    if (this.opened) updateLookUniforms(this.opened.uniforms, look);
    this.emit();
  }

  setNavigating(on: boolean): void {
    this.scene.setNavigating(on);
    this.emit();
  }

  fillRegion(): Promise<void> {
    return Promise.reject(new Error('The fill is built in a later step'));
  }

  undo(): Promise<void> {
    return Promise.reject(new Error('Undo is built in a later step'));
  }

  redo(): Promise<void> {
    return Promise.reject(new Error('Redo is built in a later step'));
  }

  async paint(): Promise<Albedo> {
    this.commitLive();
    const data = await this.passes.readPaint();
    return { width: PAINT_SIZE, height: PAINT_SIZE, data };
  }

  history(): PaintStep[] {
    return this.steps.map((step) => structuredClone(step));
  }

  async stroke(points: Vec3[], pressure?: number[]): Promise<void> {
    this.commitLive();
    const hits = points.map((point, k) => ({ point, pressure: pressure?.[k] ?? MOUSE_PRESSURE }));
    if (hits.length === 0) return;
    this.beginLive(hits[0]!);
    this.extendLive(hits.slice(1));
    this.commitLive();
    await this.scene.nextFrame();
  }

  async strokeAt(path: [number, number][]): Promise<void> {
    this.commitLive();
    for (const [x, y] of path) {
      const hit = this.hitAt(x, y);
      const sample: DabHit = hit ? { point: hit.point, pressure: MOUSE_PRESSURE } : null;
      if (!this.live) {
        if (sample) this.beginLive(sample);
      } else this.extendLive([sample]);
      await this.scene.nextFrame();
    }
    this.commitLive();
    await this.scene.nextFrame();
  }

  texelAt(x: number, y: number): { texel: [number, number]; point: Vec3; triangle: number } | null {
    const hit = this.hitAt(x, y);
    if (!hit || !this.opened) return null;
    const [u, v] = uvAt(this.opened.mesh, hit.triangle, hit.point);
    const texel: [number, number] = [
      Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(u * PAINT_SIZE))),
      Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(v * PAINT_SIZE))),
    ];
    return { texel, point: hit.point, triangle: hit.triangle };
  }

  screenOf(point: Vec3): [number, number] {
    return this.scene.screenOf(point);
  }

  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void {
    this.scene.setCamera(azimuthDeg, elevationDeg, zoom);
  }

  setWireframe(on: boolean): void {
    if (this.opened) this.opened.material.wireframe = on;
  }

  dispose(): void {
    this.close();
    this.passes.dispose();
    this.scene.dispose();
    this.cursor.remove();
    this.host.classList.remove('mt-painting');
    mounted.delete(this.host);
  }

  /** The surface under a canvas point: the triangle and the point on it, in the mini's coordinates. */
  private hitAt(x: number, y: number): { triangle: number; point: Vec3 } | null {
    if (!this.opened) return null;
    const { origin, direction } = this.scene.rayAt(x, y);
    const hit = this.opened.bvh.raycast(origin, direction);
    if (!hit) return null;
    return {
      triangle: hit.triangle,
      point: [
        origin[0] + direction[0] * hit.t,
        origin[1] + direction[1] * hit.t,
        origin[2] + direction[2] * hit.t,
      ],
    };
  }

  /** A stroke starts at its first hit (§9): its camera frozen, its depth map rendered. */
  private beginLive(first: NonNullable<DabHit>): void {
    if (!this.opened) return;
    const tool = this.tool;
    if (tool === 'fill') throw new RangeError('The fill tool fills; it does not stroke');
    const camera = this.scene.strokeCamera();
    this.passes.beginStroke(camera);
    this.scene.controls.enabled = false;
    this.live = {
      step: {
        kind: 'stroke',
        tool,
        colour: this.colour,
        brush: { ...this.brush },
        camera,
        dabs: [],
      },
      drawn: 0,
      last: null,
      frames: [],
    };
    this.extendLive([first]);
    this.emit();
  }

  /** More pointer samples: dabs spaced along them; a miss lifts the brush. */
  private extendLive(hits: readonly DabHit[]): void {
    const live = this.live;
    if (!live) return;
    const spacing = DAB_SPACING * live.step.brush.sizeMm;
    for (const hit of hits) {
      if (!hit) {
        live.last = null;
        continue;
      }
      const dabs = spaceDabs([hit], spacing, live.last);
      for (const value of dabs) live.step.dabs.push(value);
      live.last = live.step.dabs.slice(-4);
    }
  }

  /** The dabs laid since the last frame into the stroke layer, and the stroke onto the paint. */
  private drawLive(): void {
    const live = this.live;
    if (!live) return;
    const count = live.step.dabs.length / 4;
    if (live.drawn >= count) return;
    const { step } = live;
    this.passes.drawDabs(step.dabs, live.drawn, step.brush, step.tool);
    this.passes.composite(step.tool, parseHexColour(step.colour), step.brush.opacity);
    live.drawn = count;
  }

  /** The stroke on the canvas, if any, becomes a step. */
  private commitLive(): void {
    const live = this.live;
    if (!live) return;
    this.drawLive();
    this.live = null;
    this.scene.controls.enabled = true;
    if (live.step.dabs.length === 0) this.passes.cancel();
    else {
      this.passes.commit();
      this.steps.push(live.step);
    }
    this.perf = perfOf(live.frames);
    this.emit();
  }
}

/** The view's own GPU copy of a detail texture (§3.2): the consumer's is never disposed by the view. Null for a kind it cannot copy. */
function ownTexture(texture: THREE.Texture): THREE.Texture | null {
  if ((texture as THREE.CompressedTexture).isCompressedTexture)
    return ownCopy(texture as THREE.CompressedTexture);
  if ((texture as THREE.DataTexture).isDataTexture) {
    const { data, width } = (texture as THREE.DataTexture).image;
    if (!(data instanceof Uint8Array)) return null;
    return createDetailTexture(data, width);
  }
  return null;
}

/** The texture coordinates of a point on triangle t. */
function uvAt(mesh: IndexedMesh, t: number, point: Vec3): [number, number] {
  const { positions, indices } = mesh;
  const uvs = mesh.uvs!;
  const ia = indices[t * 3]!;
  const ib = indices[t * 3 + 1]!;
  const ic = indices[t * 3 + 2]!;
  const p = (vertex: number, axis: number): number => positions[vertex * 3 + axis]!;
  const v0 = [0, 1, 2].map((k) => p(ib, k) - p(ia, k));
  const v1 = [0, 1, 2].map((k) => p(ic, k) - p(ia, k));
  const v2 = [0, 1, 2].map((k) => point[k]! - p(ia, k));
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denominator = d00 * d11 - d01 * d01 || 1;
  const wb = (d11 * d20 - d01 * d21) / denominator;
  const wc = (d00 * d21 - d01 * d20) / denominator;
  const wa = 1 - wb - wc;
  return [
    uvs[ia * 2]! * wa + uvs[ib * 2]! * wb + uvs[ic * 2]! * wc,
    uvs[ia * 2 + 1]! * wa + uvs[ib * 2 + 1]! * wb + uvs[ic * 2 + 1]! * wc,
  ];
}

/** The counter's figures over a stroke's frames (§11.3). */
function perfOf(frames: number[]): PaintPerf {
  if (frames.length === 0) return NO_PERF;
  const sorted = [...frames].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return {
    frames: frames.length,
    medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    worstMs: sorted.at(-1)!,
    slow: frames.filter((ms) => ms > FRAME_BUDGET_MS).length,
  };
}
