import * as THREE from 'three';
import type { Vec3 } from '../pipeline/base';
import {
  DAB_SPACING,
  DEFAULT_BRUSH,
  DEFAULT_PAINT_COLOUR,
  isFillTool,
  isGroupTool,
  MAX_GROUPS,
  MOUSE_PRESSURE,
  PAINT_SIZE,
  TOOL_IDS,
  spaceDabs,
  unitDirection,
  type BrushSettings,
  type DabHit,
  type FillToolId,
  type GroupOrigin,
  type MaskChange,
  type PaintGroups,
  type PaintMask,
  type PaintRegions,
  type FillSeed,
  type PaintFill,
  type PaintStep,
  type PaintStroke,
  type StepGroups,
  type ToolId,
} from '../pipeline/brush';
import { TriangleBvh, type SurfaceHit } from '../pipeline/bvh';
import {
  fillRegion as floodRegion,
  triangleAdjacency,
  type TriangleAdjacency,
} from '../pipeline/fill';
import { DEFAULT_LOOK, parseHexColour, type Look } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Albedo } from '../pipeline/paint';
import {
  createBakedMaterial,
  createDetailTexture,
  createLookUniforms,
  disposeBakedMaterial,
  updateLookUniforms,
} from '../three/baked-material';
import { ownCopy } from '../three/compressed-texture';
import {
  GROUP_COLOURS,
  GROUP_STROKE_TINT_STRENGTH,
  GROUP_TINT_STRENGTH,
  MASK_TINT,
  MASK_TINT_STRENGTH,
} from '../three/scene-colours';
import { PAINT_COPY, type PaintCopy } from './copy';
import { createGroupedGeometry, writeGroups } from './geometry';
import {
  BRUSH_DEPTH_MM,
  BRUSH_DEPTH_SOFT_MM,
  DABS_PER_PASS,
  DEPTH_BIAS_MM,
  FACING_MIN_COS,
  GROUP_COVER,
  MASK_CUT,
  PAINT_DILATION_RINGS,
  PaintPasses,
  disposeKeyframe,
  stampedStep,
  type Keyframe,
  type PaintSurface,
} from './passes';
import { KEYFRAME_EVERY, PaintHistory, UNDO_STEPS } from './history';
import { PaintScene } from './scene';
import { toolPass } from './tools';

export {
  BRUSH_DEPTH_MM,
  BRUSH_DEPTH_SOFT_MM,
  DABS_PER_PASS,
  DEPTH_BIAS_MM,
  FACING_MIN_COS,
  GROUP_COVER,
  MASK_CUT,
  PAINT_DILATION_RINGS,
  KEYFRAME_EVERY,
  UNDO_STEPS,
  MASK_TINT,
  MASK_TINT_STRENGTH,
  GROUP_COLOURS,
  GROUP_TINT_STRENGTH,
};

/** The mask's tint is shown when a view is mounted (#138). _(proposal)_ */
export const MASK_SHOWN = true;
/** The groups' tint is shown when a view is mounted (#139). _(proposal)_ */
export const GROUP_TINT_SHOWN = false;

/** The brush's diameter on the surface, in mm, at least and at most. _(proposal)_ */
export const BRUSH_MIN_MM = 0.5;
export const BRUSH_MAX_MM = 16;
/** The cursor ring is never drawn smaller than this, in CSS pixels. _(proposal)_ */
export const CURSOR_MIN_PX = 4;
/** A lift stroke's first point is a hit on the surface: its texel is found within this, in mm (#137). */
const LIFT_REACH_MM = 0.01;
/** A frame longer than this, in ms, is counted as slow: 30 frames a second. _(proposal)_ */
export const FRAME_BUDGET_MS = 33;

/** What the pipette picks (#135): the pixel as shown, light and shading included, or the paint as painted. */
export type PickMode = 'shown' | 'painted';
/** The pipette's mode when none is given: as shown (PM decision on #135, 2026-10-13). */
export const PICK_MODE: PickMode = 'shown';

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
  /** The mask to continue from (#138), PAINT_SIZE square, a byte a texel, as `mask()` gave it; left out or null: nothing masked. */
  mask?: PaintMask | null;
  /**
   * The groups to continue with (#139), as `groups()` gave them, or `groupsOf(...)`; left out or
   * null: the whole mini is group 0.
   */
  groups?: PaintGroups | null;
}

export interface PaintPerf {
  /** Frames drawn during the last stroke, the median and the worst frame time in ms, by `performance.now()` around the frame. */
  frames: number;
  medianMs: number;
  worstMs: number;
  /** Frames over FRAME_BUDGET_MS. */
  slow: number;
}

/**
 * What a lift stroke found under its start (#137, design note `docs/design/lift-eraser.md` §7): the
 * step it takes away, as an index into `history()`, or why it takes nothing: no step of this
 * session changed the paint there (bare, or the paint the view was opened with), or the step that
 * did is older than undo reaches. A refused lift stroke draws nothing and leaves no step.
 */
export type LiftOutcome = { lifted: number } | { refused: 'nothing-painted' | 'too-long-ago' };

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
  /** What the last lift stroke since `open` found under its start (#137); null before the first. */
  lift: LiftOutcome | null;
  /** The mask's tint is drawn over the masked surface (#138). */
  maskShown: boolean;
  /** The groups (#139): each one's origin and triangles now, which are hidden, which apart, and the group tools' target. */
  groups: GroupsState;
  /** Every group but 0 is drawn in its colour (#139). */
  groupTint: boolean;
}

/** The groups as the view shows them (#139, design note `docs/design/paint-groups.md` §6.3). */
export interface GroupsState {
  /** Groups 0 … n − 1: how each was made and how many triangles it has now. */
  list: { origin: GroupOrigin; triangles: number }[];
  /** The groups not drawn, ascending. */
  hidden: number[];
  /** The groups pulled apart and their offsets in mm: none until pulling apart is built (#139's follow-up). */
  apart: { group: number; offset: Vec3 }[];
  /** The group the group tools add to; `list.length` for a new one. */
  target: number;
}

export interface PaintingView {
  readonly state: PaintingState;
  /** Opens one open after another; resolves without opening when `close`, `dispose` or a later `open` came first. */
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
  /** Masks a ready region (#138): a mask fill of it, one step; a tap with `mask-fill` masks the region under it. */
  maskRegion(region: 'base' | 'figure'): Promise<void>;
  /** Clears the mask (#138): one step. */
  clearMask(): Promise<void>;
  /** Inverts the mask, masked texels open and open ones masked (#138): one step. */
  invertMask(): Promise<void>;
  /** The mask as pixels (#138): PAINT_SIZE square, a byte a texel, 0 open … 255 masked, row 0 at v = 0. Never part of `paint()`. */
  mask(): Promise<PaintMask>;
  /** Draws the mask's tint over the masked surface, or not (#138): no step. */
  setMaskShown(on: boolean): void;
  /** The groups as data (#139): the map and how each group was made. Synchronous: the map is CPU data. */
  groups(): PaintGroups;
  /** Draws group `group` or not (#139); a hidden group takes no paint, and what lies behind it can be painted. Not a step. */
  setGroupShown(group: number, shown: boolean): void;
  /** Draws every group again (#139). Not a step. */
  showAllGroups(): void;
  /** The group the group tools add to (#139); `'new'` makes a new one at the next group step. */
  setGroupTarget(group: number | 'new'): void;
  /** Draws every group but 0 in its colour, or not (#139). Not a step. */
  setGroupTint(on: boolean): void;
  /** A paint fill of a group's triangles (#139): one `fill` step with a `group` seed. */
  fillGroup(group: number): Promise<void>;
  /** A group's triangles masked or unmasked (#139): one `mask-fill` or `unmask-fill` step with a `group` seed. */
  maskGroup(group: number, masked: boolean): Promise<void>;
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
  /**
   * The pipette (#135): the colour under a canvas point (CSS px) as sRGB hex, `#rrggbb`, for
   * `setColour`; null off the mini. `shown` (the default, PICK_MODE) is the pixel on screen after
   * the next frame, the look's light and shading included; `painted` the paint's own colour in the
   * texel under the point, whatever its alpha, and null where the mini is bare there.
   */
  colourAt(x: number, y: number, mode?: PickMode): Promise<string | null>;
  /** The texel under a canvas point, or null off the mini: what a pixel test asserts on. */
  texelAt(x: number, y: number): { texel: [number, number]; point: Vec3; triangle: number } | null;
  /** Where a point of the mini is on the canvas, CSS px: what a test strokes along. */
  screenOf(point: Vec3): [number, number];
  /** For tests: what the tools' masks read at every texel (cavity, occlusion, normal), as the composite reads it (#128). */
  surface(): Promise<PaintSurface>;
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
  /** The group map (#139), the live truth, and how each group was made. */
  groups: PaintGroups;
  bvh: TriangleBvh;
  adjacency: TriangleAdjacency;
  regions: PaintRegions | null;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  uniforms: ReturnType<typeof createLookUniforms>;
}

/** A keyframe of the view (#139): the passes' targets and the groups as they were. */
interface ViewKeyframe extends Keyframe {
  groups: Uint8Array;
  made: GroupOrigin[];
}

/** The groups' colours (#139), linear, for the material's uniform. */
const groupColours = (): THREE.Vector3[] =>
  GROUP_COLOURS.map((hex) => {
    const { r, g, b } = new THREE.Color(hex);
    return new THREE.Vector3(r, g, b);
  });

/** The tint's uniform (#138): the mask's colour, linear, and its strength, 0 while hidden. */
const tintOf = (shown: boolean): THREE.Vector4 => {
  const { r, g, b } = new THREE.Color(MASK_TINT);
  return new THREE.Vector4(r, g, b, shown ? MASK_TINT_STRENGTH : 0);
};

/** The stroke on the canvas, not yet committed. */
interface LiveStroke {
  step: PaintStroke;
  /** Dabs already drawn into the stroke layer. */
  drawn: number;
  /** The last dab laid, for spacing the next samples; null after a miss. */
  last: number[] | null;
  /** A lift stroke that found nothing to take away (#137): it draws nothing and leaves no step. */
  refused: boolean;
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
  /** The steps and the keyframes (§8): made at `open`. */
  private timeline: PaintHistory | null = null;
  private readonly keyframes = new Map<number, ViewKeyframe>();
  private lift: LiftOutcome | null = null;
  /** The mask's tint (#138), shared by every mini this view opens. */
  private readonly tint = { value: tintOf(MASK_SHOWN) };
  private maskShown = MASK_SHOWN;
  /** The groups not drawn (#139): view state, not steps. */
  private readonly hidden = new Set<number>();
  /** The group tools' target (#139). */
  private target: number | 'new' = 'new';
  private groupTint = GROUP_TINT_SHOWN;
  /** The groups' tint and colours, and the group stroke's (#139), shared by every mini this view opens. */
  private readonly groupTintUniform = {
    value: new THREE.Vector4(GROUP_TINT_SHOWN ? GROUP_TINT_STRENGTH : 0, 0, 0, 0),
  };
  private readonly groupColours = { value: groupColours() };
  private readonly strokeTint = { value: new THREE.Vector4(0, 0, 0, 0) };
  private tool: ToolId = 'flat';
  private brush: BrushSettings = { ...DEFAULT_BRUSH };
  private colour = DEFAULT_PAINT_COLOUR;
  private perf: PaintPerf = NO_PERF;
  private current: PaintingState;
  /** The pointers down on the canvas, and the one painting the stroke on it. */
  private readonly pointers = new Set<number>();
  private strokePointer: number | null = null;
  /** Counts opens and closes: an open that is no longer the latest drops what it made. */
  private generation = 0;
  /** The opens in order, so that two never share the passes. */
  private queue: Promise<void> = Promise.resolve();

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
    this.wireCanvas();
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
      steps: this.timeline?.applied ?? 0,
      undone: this.timeline?.undone ?? 0,
      regions: this.opened?.regions ? ['base', 'figure'] : [],
      painting: this.live !== null,
      perf: this.perf,
      lift: this.lift,
      maskShown: this.maskShown,
      groups: this.groupsState(),
      groupTint: this.groupTint,
    };
  }

  /** The groups as the state shows them (#139). */
  private groupsState(): GroupsState {
    const groups = this.opened?.groups;
    const list = (groups?.made ?? [{ by: 'body' as const }]).map((origin) => ({
      origin: { ...origin },
      triangles: 0,
    }));
    if (groups) for (const group of groups.of) list[group]!.triangles++;
    return {
      list,
      hidden: [...this.hidden].sort((a, b) => a - b),
      apart: [],
      target: this.targetGroup(),
    };
  }

  /** The group the group tools add to now: the target, or a new one. */
  private targetGroup(): number {
    const count = this.opened?.groups.made.length ?? 1;
    return this.target === 'new' || this.target >= count ? count : this.target;
  }

  /** A fresh state for the consumer. */
  private emit(): void {
    this.current = this.snapshot();
    this.onChange?.(this.current);
  }

  open(mini: MiniToPaint): Promise<void> {
    const { mesh, paint, regions, mask, groups } = mini;
    if (!mesh.uvs || !mesh.normals) throw new RangeError(this.copy.cannotPaint);
    if (
      paint &&
      (paint.width !== PAINT_SIZE ||
        paint.height !== PAINT_SIZE ||
        paint.data.length !== PAINT_SIZE * PAINT_SIZE * 4)
    )
      throw new RangeError(`A paint is ${PAINT_SIZE} × ${PAINT_SIZE} texels, four bytes each`);
    if (
      mask &&
      (mask.width !== PAINT_SIZE ||
        mask.height !== PAINT_SIZE ||
        mask.data.length !== PAINT_SIZE * PAINT_SIZE)
    )
      throw new RangeError(`A mask is ${PAINT_SIZE} × ${PAINT_SIZE} texels, a byte each`);
    if (regions && regions.base.length !== mesh.indices.length / 3)
      throw new RangeError('The regions are not this mesh’s: one byte per triangle');
    if (groups) checkGroups(groups, mesh.indices.length / 3);
    const texture = ownTexture(mini.texture);
    if (!texture) throw new RangeError(this.copy.cannotPaint);
    const generation = ++this.generation;
    const opening = this.queue.then(() => this.opening(mini, texture, generation));
    this.queue = opening.catch(() => undefined);
    return opening;
  }

  private async opening(
    mini: MiniToPaint,
    texture: THREE.Texture,
    generation: number,
  ): Promise<void> {
    const abandoned = (): boolean => generation !== this.generation;
    if (abandoned()) {
      texture.dispose();
      return;
    }
    this.release();
    const { mesh } = mini;
    // The view's own copy of the groups (#139): the consumer's are never changed.
    const groups: PaintGroups = mini.groups
      ? { of: mini.groups.of.slice(), made: mini.groups.made.map((origin) => ({ ...origin })) }
      : { of: new Uint8Array(mesh.indices.length / 3), made: [{ by: 'body' }] };
    this.hidden.clear();
    this.target = 'new';
    this.writeGroupUniform(null);
    const geometry = createGroupedGeometry(mesh, groups.of);
    const uniforms = createLookUniforms(mini.look ?? DEFAULT_LOOK);
    const drop = (): void => {
      this.passes.close();
      geometry.dispose();
      texture.dispose();
    };
    try {
      await this.passes.open(geometry, mesh, texture, mini.paint ?? null, mini.mask ?? null);
    } catch (error) {
      drop();
      if (abandoned()) return;
      throw error;
    }
    // Closed, disposed or opened again while the GPU read the atlas back.
    if (abandoned()) {
      drop();
      return;
    }
    const material = createBakedMaterial(texture, uniforms, {
      map: this.passes.liveTexture,
      tint: { map: this.passes.maskTexture, uniform: this.tint },
      groups: {
        uniform: this.passes.groupUniform,
        colours: this.groupColours,
        tint: this.groupTintUniform,
        stroke: this.passes.strokeTexture,
        strokeTint: this.strokeTint,
      },
    });
    const shown = new THREE.Mesh(geometry, material);
    const box = new THREE.Box3().setFromArray(mesh.positions);
    const size = box.getSize(new THREE.Vector3());
    this.opened = {
      mesh,
      groups,
      bvh: new TriangleBvh(mesh),
      adjacency: triangleAdjacency(mesh),
      regions: mini.regions ?? null,
      geometry,
      material,
      uniforms,
    };
    this.timeline = new PaintHistory({
      snapshot: (at) =>
        this.keyframes.set(at, {
          ...this.passes.snapshot(),
          groups: groups.of.slice(),
          made: groups.made.map((origin) => ({ ...origin })),
        }),
      restore: (at) => this.restoreKeyframe(this.keyframes.get(at)!),
      apply: (step, index) => this.replay(step, index),
      drop: (at) => {
        const keyframe = this.keyframes.get(at);
        if (keyframe) disposeKeyframe(keyframe);
        this.keyframes.delete(at);
      },
    });
    this.perf = NO_PERF;
    this.lift = null;
    this.scene.show(shown, [size.x, size.y, size.z]);
    this.passes.warm(this.scene.strokeCamera(), TOOL_IDS);
    await this.scene.nextFrame();
    this.emit();
  }

  close(): void {
    this.generation++;
    this.release();
  }

  /** Releases the mini that is open, if any. */
  private release(): void {
    const opened = this.opened;
    if (!opened) return;
    this.live = null;
    this.scene.clear();
    this.passes.close();
    disposeBakedMaterial(opened.material);
    opened.geometry.dispose();
    this.opened = null;
    this.timeline?.dispose();
    this.timeline = null;
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
      direction: unitDirection(next.direction),
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

  fillRegion(region: 'base' | 'figure'): Promise<void> {
    if (!this.opened?.regions)
      return Promise.reject(new RangeError('This mini has no ready regions to fill'));
    return this.fill({ kind: region }, 'fill');
  }

  maskRegion(region: 'base' | 'figure'): Promise<void> {
    if (!this.opened?.regions)
      return Promise.reject(new RangeError('This mini has no ready regions to mask'));
    return this.fill({ kind: region }, 'mask-fill');
  }

  clearMask(): Promise<void> {
    return this.changeMask('clear');
  }

  invertMask(): Promise<void> {
    return this.changeMask('invert');
  }

  async mask(): Promise<PaintMask> {
    this.commitLive();
    const data = await this.passes.readMask();
    return { width: PAINT_SIZE, height: PAINT_SIZE, data };
  }

  setMaskShown(on: boolean): void {
    this.maskShown = on;
    this.tint.value.w = on ? MASK_TINT_STRENGTH : 0;
    this.emit();
  }

  groups(): PaintGroups {
    this.commitLive();
    const groups = this.opened?.groups;
    if (!groups) return { of: new Uint8Array(0), made: [{ by: 'body' }] };
    return { of: groups.of.slice(), made: groups.made.map((origin) => ({ ...origin })) };
  }

  setGroupShown(group: number, shown: boolean): void {
    this.commitLive();
    this.checkGroup(group);
    if (shown) this.hidden.delete(group);
    else this.hidden.add(group);
    this.writeGroupUniform(null);
    this.emit();
  }

  showAllGroups(): void {
    this.commitLive();
    this.hidden.clear();
    this.writeGroupUniform(null);
    this.emit();
  }

  setGroupTarget(group: number | 'new'): void {
    this.commitLive();
    if (group !== 'new') this.checkGroup(group);
    this.target = group;
    this.emit();
  }

  setGroupTint(on: boolean): void {
    this.groupTint = on;
    this.groupTintUniform.value.x = on ? GROUP_TINT_STRENGTH : 0;
    this.emit();
  }

  fillGroup(group: number): Promise<void> {
    this.commitLive();
    this.checkGroup(group);
    return this.fill({ kind: 'group', group }, 'fill');
  }

  maskGroup(group: number, masked: boolean): Promise<void> {
    this.commitLive();
    this.checkGroup(group);
    return this.fill({ kind: 'group', group }, masked ? 'mask-fill' : 'unmask-fill');
  }

  /**
   * The triangles `covered` names (a byte a triangle) or lists go into group `into` (#139): a new
   * group `{ by: 'hand' }` when it is the next one. Nothing when none is covered. True when the
   * map changed.
   */
  private moveInto(covered: Uint8Array | Uint32Array, into: number, list: boolean): boolean {
    const groups = this.opened!.groups;
    if (!(Number.isInteger(into) && into >= 0 && into <= groups.made.length && into < MAX_GROUPS))
      throw new RangeError(`There is no group ${into} to add to`);
    const triangles: number[] = [];
    if (list) for (const t of covered) triangles.push(t);
    else for (let t = 0; t < covered.length; t++) if (covered[t]) triangles.push(t);
    if (triangles.length === 0) return false;
    const created = into === groups.made.length;
    if (created) groups.made.push({ by: 'hand' });
    let changed = created;
    for (const t of triangles) {
      if (groups.of[t] === into) continue;
      groups.of[t] = into;
      changed = true;
    }
    if (changed) writeGroups(this.opened!.geometry, groups.of);
    return changed;
  }

  /** The group stroke's tint (#139): its coverage in the target's colour while it is on the canvas, or none. */
  private tintStroke(into: number | null): void {
    if (into === null) {
      this.strokeTint.value.set(0, 0, 0, 0);
      return;
    }
    const { r, g, b } = new THREE.Color(GROUP_COLOURS[into % GROUP_COLOURS.length]);
    this.strokeTint.value.set(r, g, b, GROUP_STROKE_TINT_STRENGTH);
  }

  /** A group the mini has (#139); a consumer's number that is not one is refused. */
  private checkGroup(group: number): void {
    const count = this.opened?.groups.made.length ?? 1;
    if (!Number.isInteger(group) || group < 0 || group >= count)
      throw new RangeError(`There is no group ${group}`);
  }

  /**
   * `uGroups` from the view's groups (null), or from a step's record (#139): every group shown and
   * at zero but the record's hidden ones.
   */
  private writeGroupUniform(record: StepGroups | null | undefined): void {
    const hidden = record === null ? this.hidden : new Set(record?.hidden ?? []);
    const values = this.passes.groupUniform.value;
    for (let group = 0; group < MAX_GROUPS; group++)
      values[group]!.set(0, 0, 0, hidden.has(group) ? 1 : 0);
  }

  /** What a step records of the groups (#139): the hidden ones, when any is. */
  private stepGroups(): StepGroups | undefined {
    if (this.hidden.size === 0) return undefined;
    return { hidden: [...this.hidden].sort((a, b) => a - b), apart: [] };
  }

  /**
   * After an undo that took away a group a step had made (#139): it is no longer hidden, so the
   * state and the next step's record name only groups the mini has. Not in `restoreKeyframe`:
   * undo restores an older keyframe and replays steps that may make the group again.
   */
  private forgetGoneGroups(): void {
    const count = this.opened?.groups.made.length ?? 1;
    let gone = false;
    for (const group of [...this.hidden])
      if (group >= count) {
        this.hidden.delete(group);
        gone = true;
      }
    if (gone) this.writeGroupUniform(null);
  }

  /** Back to a keyframe: its targets, and the groups as they were then (#139). */
  private restoreKeyframe(keyframe: ViewKeyframe): void {
    this.passes.restore(keyframe);
    const opened = this.opened;
    if (!opened) return;
    opened.groups.of.set(keyframe.groups);
    opened.groups.made = keyframe.made.map((origin) => ({ ...origin }));
    writeGroups(opened.geometry, opened.groups.of);
  }

  /** A fill (§7), of the paint or of the mask (#138): one step, its region found from its seed, applied as a replay would. */
  private async fill(seed: FillSeed, tool: FillToolId): Promise<void> {
    this.commitLive();
    if (!this.opened || !this.timeline) return;
    const groups = this.stepGroups();
    const step: PaintFill = {
      kind: 'fill',
      tool,
      colour: this.colour,
      brush: { ...this.brush },
      seed,
      ...(isGroupTool(tool) ? { into: this.targetGroup() } : {}),
      ...(groups ? { groups } : {}),
    };
    // A new group past the last there may be makes nothing (#139).
    if (step.into === MAX_GROUPS) return;
    await this.apply(step);
  }

  /** The mask cleared or inverted (#138): one step. */
  private async changeMask(change: MaskChange['change']): Promise<void> {
    this.commitLive();
    if (!this.opened || !this.timeline) return;
    await this.apply({ kind: 'mask', change });
  }

  /** A step that is not a stroke, applied as its replay and pushed. */
  private async apply(step: PaintFill | MaskChange): Promise<void> {
    this.replay(step, this.timeline!.applied);
    this.timeline!.push(step);
    this.emit();
    await this.scene.nextFrame();
  }

  async undo(): Promise<void> {
    this.commitLive();
    if (this.timeline?.undo() == null) return;
    this.forgetGoneGroups();
    this.emit();
    await this.scene.nextFrame();
  }

  async redo(): Promise<void> {
    this.commitLive();
    if (!this.timeline?.redo()) return;
    this.emit();
    await this.scene.nextFrame();
  }

  async paint(): Promise<Albedo> {
    this.commitLive();
    const data = await this.passes.readPaint();
    return { width: PAINT_SIZE, height: PAINT_SIZE, data };
  }

  history(): PaintStep[] {
    return (this.timeline?.record() ?? []).map((step) => structuredClone(step));
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

  async colourAt(x: number, y: number, mode: PickMode = PICK_MODE): Promise<string | null> {
    this.commitLive();
    const under = this.texelAt(x, y);
    if (!under) return null;
    if (mode === 'shown') {
      const pixel = await this.scene.pixelAt(x, y);
      return pixel && hexOf(pixel);
    }
    const [r, g, b, alpha] = await this.passes.readTexel(...under.texel);
    return alpha === 0 ? null : hexOf([r, g, b]);
  }

  texelAt(x: number, y: number): { texel: [number, number]; point: Vec3; triangle: number } | null {
    const hit = this.hitAt(x, y);
    if (!hit || !this.opened) return null;
    const texel = texelOf(this.opened.mesh, hit.triangle, hit.point);
    return { texel, point: hit.point, triangle: hit.triangle };
  }

  screenOf(point: Vec3): [number, number] {
    return this.scene.screenOf(point);
  }

  surface(): Promise<PaintSurface> {
    this.commitLive();
    return this.passes.readSurface();
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
    // A hidden group is not there to hit (#139): the ray finds what lies behind it.
    const { of } = this.opened.groups;
    const hidden = this.hidden;
    const hit = this.opened.bvh.raycast(
      origin,
      direction,
      hidden.size === 0 ? undefined : (t) => !hidden.has(of[t]!),
    );
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

  /**
   * A stroke starts at its first hit (§9): its camera recorded, its depth map rendered. The
   * controls stop while a mouse or a pen paints; a finger's stroke leaves them on, so a second
   * finger can take over the pinch the moment it cancels the stroke (one finger alone does not
   * orbit).
   */
  private beginLive(first: NonNullable<DabHit>, touch = false): void {
    if (!this.opened) return;
    const tool = this.tool;
    if (isFillTool(tool)) throw new RangeError('A fill tool fills; it does not stroke');
    // A lift finds its step before anything is drawn: making its keyframe may replay steps.
    const lift = tool === 'lift' ? this.findLift(first.point) : null;
    const lifted = lift && 'lifted' in lift ? lift.lifted : null;
    const camera = this.scene.strokeCamera();
    this.passes.beginStroke(camera);
    if (lifted !== null) this.passes.lift(this.keyframes.get(lifted)!, lifted);
    this.scene.controls.enabled = touch;
    const groups = this.stepGroups();
    // The group brush (#139): its target recorded; a new group past the last there may be is refused.
    const into = isGroupTool(tool) ? this.targetGroup() : null;
    this.tintStroke(into);
    this.live = {
      step: {
        kind: 'stroke',
        tool,
        colour: this.colour,
        brush: { ...this.brush },
        camera,
        dabs: [],
        ...(lifted !== null ? { lifts: lifted } : {}),
        ...(into !== null ? { into } : {}),
        ...(groups ? { groups } : {}),
      },
      drawn: 0,
      last: null,
      refused: (lift !== null && lifted === null) || into === MAX_GROUPS,
      frames: [],
    };
    this.extendLive([first]);
    this.emit();
  }

  /**
   * The step a lift stroke starting at `point` takes away (#137, design note
   * `docs/design/lift-eraser.md` §2): the newest step that changed the texel there, by the stamp
   * map, with a keyframe of the paint before it pinned in the history. Or why there is none.
   */
  private findLift(point: Vec3): LiftOutcome {
    const opened = this.opened!;
    const timeline = this.timeline!;
    const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: 0 };
    opened.bvh.closest(hit, point[0], point[1], point[2], LIFT_REACH_MM ** 2);
    const stamp =
      hit.triangle < 0 ? null : this.passes.readStamp(...texelOf(opened.mesh, hit.triangle, point));
    const index = stamp ? stampedStep(stamp, timeline.applied) : null;
    if (index === null) this.lift = { refused: 'nothing-painted' };
    else if (!timeline.pin(index)) this.lift = { refused: 'too-long-ago' };
    else this.lift = { lifted: index };
    return this.lift;
  }

  /** More pointer samples: dabs spaced along them; a miss lifts the brush. */
  private extendLive(hits: readonly DabHit[]): void {
    const live = this.live;
    if (!live) return;
    const spacing = DAB_SPACING * live.step.brush.sizeMm;
    // A tool whose dabs add up lays them evenly, so that it sprays by distance, not by samples.
    const even = toolPass(live.step.tool).blend === 'add';
    for (const hit of hits) {
      if (!hit) {
        live.last = null;
        continue;
      }
      const dabs = spaceDabs([hit], spacing, live.last, even);
      for (const value of dabs) live.step.dabs.push(value);
      live.last = live.step.dabs.slice(-4);
    }
  }

  /** The dabs laid since the last frame into the stroke layer, and the stroke onto the paint. */
  private drawLive(): void {
    const live = this.live;
    if (!live || live.refused) return;
    const count = live.step.dabs.length / 4;
    if (live.drawn >= count) return;
    const { step } = live;
    this.passes.drawDabs(step.dabs, live.drawn, step.brush, step.tool);
    this.passes.composite(step.tool, parseHexColour(step.colour), step.brush);
    live.drawn = count;
  }

  /** The stroke on the canvas, if any, becomes a step. */
  private commitLive(): void {
    const live = this.live;
    if (!live) return;
    this.drawLive();
    this.live = null;
    this.scene.controls.enabled = true;
    this.tintStroke(null);
    const group = isGroupTool(live.step.tool);
    // A group stroke (#139) is a step where it covered a triangle: those go into its target.
    const moved =
      group && live.step.dabs.length > 0 && !live.refused && this.timeline
        ? this.moveInto(this.passes.readCover(), live.step.into!, false)
        : false;
    if (live.step.dabs.length === 0 || live.refused || !this.timeline || (group && !moved)) {
      this.passes.cancel();
      // A lift that leaves no step leaves no keyframe pinned for it.
      this.timeline?.prune();
    } else {
      this.passes.commit(this.timeline.applied, live.step.tool);
      this.timeline.push(live.step);
    }
    this.perf = perfOf(live.frames);
    this.emit();
  }

  /**
   * A step applied again, exactly as the first time (§8): a stroke renders its depth map from its
   * own camera at its own viewport and draws all its dabs (a lift toward the keyframe the history
   * keeps for it, #137); a picked fill floods up to the mask as it is now (#138); the result is
   * committed as step `index`.
   */
  private replay(step: PaintStep, index: number): void {
    const opened = this.opened;
    if (!opened) return;
    if (step.kind === 'mask') {
      this.passes.changeMask(step.change);
      this.passes.commitMask();
      return;
    }
    // The groups hidden when the step was made (#139), whatever is hidden now; put back after.
    this.writeGroupUniform(step.groups);
    try {
      this.replayDrawn(step, index, opened);
    } finally {
      this.writeGroupUniform(null);
    }
  }

  /** A stroke or a fill replayed, with `uGroups` as its record says. */
  private replayDrawn(step: PaintStroke | PaintFill, index: number, opened: Opened): void {
    if (step.kind === 'stroke') {
      this.passes.beginStroke(step.camera);
      const beneath = step.lifts === undefined ? undefined : this.keyframes.get(step.lifts);
      if (beneath) this.passes.lift(beneath, step.lifts!);
      this.passes.drawDabs(step.dabs, 0, step.brush, step.tool);
      // The group brush (#139): what its dabs cover at the triangles' middles, read as live.
      if (isGroupTool(step.tool)) {
        this.moveInto(this.passes.readCover(), step.into!, false);
        this.passes.commit(index, step.tool);
        return;
      }
    } else {
      const { seed } = step;
      const picked = seed.kind === 'picked';
      const group = isGroupTool(step.tool);
      const triangles = floodRegion(opened.mesh, seed, {
        tolerance: step.brush.tolerance,
        regions: opened.regions,
        adjacency: opened.adjacency,
        cut: picked ? this.passes.readCut() : null,
        groupOf: opened.groups.of,
        hidden: picked ? hiddenTriangles(opened.groups.of, step.groups) : null,
        // The group fill (#139): all that is connected within the group it starts in.
        ...(group && picked ? { folds: false, within: opened.groups.of[seed.triangle] } : {}),
      });
      if (group) {
        this.moveInto(triangles, step.into!, true);
        return;
      }
      this.passes.clearStroke();
      this.passes.drawRegion(triangles);
    }
    this.passes.composite(step.tool, parseHexColour(step.colour), step.brush);
    this.passes.commit(index, step.tool);
  }

  /** The stroke on the canvas is dropped (a second finger arrived, the pointer was cancelled): no step. */
  private cancelLive(): void {
    if (!this.live) return;
    this.live = null;
    this.strokePointer = null;
    this.scene.controls.enabled = true;
    this.tintStroke(null);
    this.passes.cancel();
    this.timeline?.prune();
    this.emit();
  }

  /**
   * The pointer rules (§9): the left button, a pen's tip and one finger paint (with the fill tool
   * they fill what they hit); the right button and two fingers orbit, the middle button pans (the
   * scene's controls). A second finger during a finger's stroke cancels it. Navigating, nothing
   * paints. A pen's samples between frames come from `getCoalescedEvents`.
   */
  private wireCanvas(): void {
    const canvas = this.scene.canvas;
    const at = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const sample = (event: PointerEvent): DabHit => {
      const hit = this.hitAt(...at(event));
      return hit ? { point: hit.point, pressure: pressureOf(event) } : null;
    };
    // Before the controls' own listener, so a cancelled stroke gives the pinch back at once.
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        this.pointers.add(event.pointerId);
        if (this.pointers.size > 1) {
          if (this.strokePointer !== null) this.cancelLive();
          return;
        }
        if (!this.opened || this.scene.isNavigating || event.button !== 0) return;
        const hit = this.hitAt(...at(event));
        if (!hit) return;
        if (isFillTool(this.tool)) {
          void this.fillAt(this.tool, hit.triangle, hit.point);
          return;
        }
        this.commitLive();
        this.strokePointer = event.pointerId;
        // The stroke goes on, and ends, though the pointer leaves the canvas.
        canvas.setPointerCapture?.(event.pointerId);
        this.beginLive(
          { point: hit.point, pressure: pressureOf(event) },
          event.pointerType === 'touch',
        );
      },
      { capture: true },
    );
    canvas.addEventListener('pointermove', (event) => {
      this.moveCursor(event, at(event));
      if (!this.live || event.pointerId !== this.strokePointer) return;
      const events = event.getCoalescedEvents?.() ?? [];
      this.extendLive((events.length > 0 ? events : [event]).map(sample));
    });
    const release = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId);
      if (event.pointerId !== this.strokePointer) return;
      this.strokePointer = null;
      if (event.type === 'pointerup') this.commitLive();
      else this.cancelLive();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => {
      this.cursor.hidden = true;
    });
  }

  /** The cursor ring (§9): the brush's size at the surface under the pointer; not on touch, off the mini or with the fill tool. */
  private moveCursor(event: PointerEvent, [x, y]: [number, number]): void {
    const hit = event.pointerType === 'touch' || isFillTool(this.tool) ? null : this.hitAt(x, y);
    this.cursor.hidden = hit === null;
    if (!hit) return;
    const size = Math.max(CURSOR_MIN_PX, this.brush.sizeMm * this.scene.pixelsPerMm(hit.point));
    const style = this.cursor.style;
    style.left = `${x}px`;
    style.top = `${y}px`;
    style.width = `${size}px`;
    style.height = `${size}px`;
  }

  /** A tap with a fill tool (§9): the region the flood finds from the triangle under it. */
  private fillAt(tool: FillToolId, triangle: number, point: Vec3): Promise<void> {
    return this.fill({ kind: 'picked', triangle, point }, tool);
  }
}

/** A byte a triangle, 1 where its group is among a record's hidden ones (#139); null when none is. */
function hiddenTriangles(of: Uint8Array, record: StepGroups | undefined): Uint8Array | null {
  if (!record || record.hidden.length === 0) return null;
  const hidden = new Set(record.hidden);
  const out = new Uint8Array(of.length);
  for (let t = 0; t < of.length; t++) if (hidden.has(of[t]!)) out[t] = 1;
  return out;
}

/** Refuses groups that are not a mesh's of `triangles` (#139). */
function checkGroups(groups: PaintGroups, triangles: number): void {
  if (groups.of.length !== triangles)
    throw new RangeError('The groups are not this mesh’s: one byte per triangle');
  const count = groups.made.length;
  if (count < 1 || count > MAX_GROUPS)
    throw new RangeError(`A mini has 1 to ${MAX_GROUPS} groups, not ${count}`);
  for (const group of groups.of)
    if (group >= count) throw new RangeError(`The groups name a group ${group} they do not have`);
}

/** sRGB bytes as `#rrggbb`. */
function hexOf(rgb: readonly number[]): string {
  return `#${rgb.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** A pointer's pressure:a pen's or a finger's as it reports it; a mouse's MOUSE_PRESSURE. */
function pressureOf(event: PointerEvent): number {
  return event.pointerType === 'mouse' || !(event.pressure > 0) ? MOUSE_PRESSURE : event.pressure;
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

/** The texel under a point on triangle t. */
function texelOf(mesh: IndexedMesh, t: number, point: Vec3): [number, number] {
  const [u, v] = uvAt(mesh, t, point);
  return [
    Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(u * PAINT_SIZE))),
    Math.min(PAINT_SIZE - 1, Math.max(0, Math.floor(v * PAINT_SIZE))),
  ];
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
