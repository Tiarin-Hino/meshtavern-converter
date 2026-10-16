import type { Vec3 } from './base';
import {
  AIR_DIR_EDGE,
  AIR_DIR_SOFTNESS,
  DRY_REFERENCE_MIN,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
  FLAT_CAVITY,
  INK_FLAT,
  WASH_FLAT,
  WASH_LIFT,
  WASH_OCCLUSION,
} from './look';

/**
 * The painting engine's data (issue #127, design note `docs/design/painting-engine.md` §4): what a
 * stroke and a fill are, as plain numbers a consumer can keep, and the parts of the engine that
 * need no GPU: spacing dabs along a stroke, the owner map that fills the gutter, the tools' masks.
 * No DOM, no three.js: the view (`src/lib/painting/`) draws with these, and Node tests them.
 */

/** The paint's side in texels, whatever the detail texture's size (#127). _(proposal)_ */
export const PAINT_SIZE = 1024;

/**
 * The tools, in the order a panel offers them. `wash` … `airbrush` are the hobby brushes of #128;
 * `lift` takes a step away again where it is the top layer, showing the paint beneath it (#137);
 * `mask`, `unmask` and `mask-fill` change the mask that protects the surface from every other
 * tool (#138, design note `docs/design/paint-mask.md`).
 */
export const TOOL_IDS = [
  'flat',
  'fill',
  'eraser',
  'lift',
  'wash',
  'ink',
  'dry',
  'airbrush',
  'mask',
  'unmask',
  'mask-fill',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** The tools that change the mask, not the paint (#138): a brush that lays mask, an eraser that takes it away, a fill. */
export const MASK_TOOL_IDS = ['mask', 'unmask', 'mask-fill'] as const;
export type MaskToolId = (typeof MASK_TOOL_IDS)[number];
/** The tools a tap fills with (#138): the paint's fill and the mask's. */
export const FILL_TOOL_IDS = ['fill', 'mask-fill'] as const;
export type FillToolId = (typeof FILL_TOOL_IDS)[number];

/** True for a tool that changes the mask (#138). */
export const isMaskTool = (tool: ToolId): tool is MaskToolId =>
  (MASK_TOOL_IDS as readonly ToolId[]).includes(tool);
/** True for a tool a tap fills with (#138). */
export const isFillTool = (tool: ToolId): tool is FillToolId =>
  (FILL_TOOL_IDS as readonly ToolId[]).includes(tool);

/** Every slider there is; each tool reads the ones it has (§6). The consumer shows only those. */
export interface BrushSettings {
  /** The brush's diameter on the surface, in mm. */
  sizeMm: number;
  /** 0 soft … 1 hard: where the dab's falloff begins, as a share of its radius. */
  hardness: number;
  /** 0–1: the stroke's opacity (flat, eraser, fill), strength (wash), flow (ink, airbrush), or the dry brush's pressure. */
  opacity: number;
  /** The fill's tolerance, 0 strict … 1 loose, scaling both bounds (§7.1). */
  tolerance: number;
  /** The airbrush's direction mask: a unit vector in mesh space it sprays from, or null for none (#128). */
  direction: Vec3 | null;
}

/** The colour a painting view starts with: paint, not the theme's (#143 moved it here from the view). _(proposal)_ */
export const DEFAULT_PAINT_COLOUR = '#b03030';

/** The tint the mask is shown with over the surface (#138): the blue of liquid mask. _(proposal)_ */
export const MASK_TINT = '#3a78d8';
/** How much of the tint a fully masked texel shows over the mini. _(proposal)_ */
export const MASK_TINT_STRENGTH = 0.45;

/** _(proposal)_ */
export const DEFAULT_BRUSH: BrushSettings = {
  sizeMm: 2,
  hardness: 0.8,
  opacity: 1,
  tolerance: 0.5,
  direction: null,
};

/** Dabs along a stroke are at most this far apart, as a share of the brush's diameter. _(proposal)_ */
export const DAB_SPACING = 0.25;

/** The camera a stroke was painted from: what decides which texels it reached (§5.2). */
export interface StrokeCamera {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  near: number;
  far: number;
  /** The drawing buffer's size in device pixels: the depth map's size. */
  viewport: [number, number];
}

export interface PaintStroke {
  kind: 'stroke';
  /** A paint tool, or the mask's brush and eraser (`mask`, `unmask`, #138). */
  tool: Exclude<ToolId, FillToolId>;
  /** sRGB hex, as the look's base; never used by a mask stroke. */
  colour: string;
  brush: BrushSettings;
  camera: StrokeCamera;
  /** Four numbers a dab: x, y, z on the surface in mesh mm, and the pointer's pressure (0.5 for a mouse). */
  dabs: number[];
  /**
   * A `lift` stroke's step to take away (#137, design note `docs/design/lift-eraser.md`): its index
   * in the history, oldest first, as `history()` gives it. On no other stroke.
   */
  lifts?: number;
}

/** Where a fill starts: a triangle under the finger, or a ready region (§7.2). */
export type FillSeed =
  { kind: 'picked'; triangle: number; point: Vec3 } | { kind: 'base' } | { kind: 'figure' };

export interface PaintFill {
  kind: 'fill';
  /** The paint's fill, or the mask's (`mask-fill`, #138). */
  tool: FillToolId;
  colour: string;
  /** `opacity` and `tolerance` are read; the region is found again from the seed on replay. */
  brush: BrushSettings;
  seed: FillSeed;
}

/**
 * The fill's ready regions (§7.2): one byte per triangle of the table level, 1 for the base, 0 for
 * the figure, and how the base was found (`regionsOf` in regions.ts).
 */
export interface PaintRegions {
  base: Uint8Array;
  method: 'pair' | 'plain' | 'disc';
}

/** The mask changed whole (#138): cleared, or inverted ("paint only the face"). */
export interface MaskChange {
  kind: 'mask';
  change: 'clear' | 'invert';
}

/** One step of the history: what undo takes back and redo puts again. */
export type PaintStep = PaintStroke | PaintFill | MaskChange;

/**
 * The mask as pixels (#138): PAINT_SIZE square over the unwrap as the paint, one byte a texel,
 * 0 open … 255 fully masked, row 0 at v = 0. Kept by the consumer beside the paint, so painting
 * continues later with the same mask.
 */
export interface PaintMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** How many colours `recentColours` gives by default: a row of swatches beside a colour picker (#136). _(proposal)_ */
export const RECENT_COLOURS_MAX = 12;

/**
 * The colours used in a history, newest first, each once (#136): what a panel offers as swatches
 * to pick a colour from earlier again. Built from the steps alone, so a consumer that kept them
 * shows the same list after reopening a mini. Eraser and lift strokes are left out: their colour
 * is never shown (PM decision on #136, 2026-10-13; the lift since #137), and so are the mask's
 * steps (#138). Colours are compared and given in lower case, so
 * `#B03030` and `#b03030` are one swatch.
 */
export function recentColours(steps: readonly PaintStep[], max = RECENT_COLOURS_MAX): string[] {
  const colours: string[] = [];
  const seen = new Set<string>();
  for (let k = steps.length - 1; k >= 0 && colours.length < max; k--) {
    const step = steps[k]!;
    if (step.kind === 'mask' || step.tool === 'eraser' || step.tool === 'lift') continue;
    if (isMaskTool(step.tool)) continue;
    const colour = step.colour.toLowerCase();
    if (seen.has(colour)) continue;
    seen.add(colour);
    colours.push(colour);
  }
  return colours;
}

/** The pressure recorded for a pointer that reports none (a mouse). */
export const MOUSE_PRESSURE = 0.5;

/** A point on the surface where a pointer sample hit the mesh, or null where it missed (a lift). */
export type DabHit = { point: Vec3; pressure: number } | null;

/**
 * The dabs of a stroke, four numbers each (x, y, z, pressure), from the pointer's hits on the
 * surface (§4): the first hit of a run is a dab, and along the straight line to each next hit a
 * dab is laid every `spacingMm`, the hit itself last when the remainder is shorter, so two
 * consecutive dabs are never further apart than the spacing. A miss (null) lifts the brush:
 * nothing is laid across it, and the next hit starts a new run. Pressure is interpolated.
 *
 * `from` continues a stroke already under way: the hits are the new samples, `from` the last
 * dab laid (its four numbers), so a stroke spaced in pieces lays the dabs it would whole.
 *
 * `even` lays the dabs exactly `spacingMm` apart instead (#128): along the line from the last
 * dab to each hit, as many whole spacings as fit, and nothing while the hit is nearer than one;
 * the hit itself is a dab only when it falls on a spacing. A tool whose dabs add up (the
 * airbrush) needs that: with a dab at every hit, how much it sprays would follow how often the
 * pointer reports, not how far it went. A stroke may end short of its last hit by less than a
 * spacing.
 */
export function spaceDabs(
  hits: readonly DabHit[],
  spacingMm: number,
  from: readonly number[] | null = null,
  even = false,
): number[] {
  if (!(spacingMm > 0)) throw new RangeError('The dab spacing must be positive');
  const dabs: number[] = [];
  let last: number[] | null = from ? [...from] : null;
  for (const hit of hits) {
    if (!hit) {
      last = null;
      continue;
    }
    const [x, y, z] = hit.point;
    if (!last) {
      dabs.push(x, y, z, hit.pressure);
      last = [x, y, z, hit.pressure];
      continue;
    }
    const [lx, ly, lz, lp] = last as [number, number, number, number];
    const length = Math.hypot(x - lx, y - ly, z - lz);
    if (length === 0) continue;
    if (even) {
      const whole = Math.floor(length / spacingMm);
      for (let k = 1; k <= whole; k++) {
        const t = (k * spacingMm) / length;
        last = [
          lx + (x - lx) * t,
          ly + (y - ly) * t,
          lz + (z - lz) * t,
          lp + (hit.pressure - lp) * t,
        ];
        dabs.push(...last);
      }
      continue;
    }
    const steps = Math.ceil(length / spacingMm);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      dabs.push(
        lx + (x - lx) * t,
        ly + (y - ly) * t,
        lz + (z - lz) * t,
        lp + (hit.pressure - lp) * t,
      );
    }
    last = [x, y, z, hit.pressure];
  }
  return dabs;
}

/** What the atlas says of a texel (§5.1): in an island, crossed by an island's border, or the gutter. */
export const ISLAND_TEXEL = 2;
export const BORDER_TEXEL = 1;
export const GUTTER_TEXEL = 0;
/** An owner map's entry for a texel no island's paint reaches. */
export const NO_OWNER = -1;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The owner map (§5.1, §5.4): for every texel of a `size` square atlas the texel it takes its
 * paint from. A texel of an island (`ISLAND_TEXEL`) or crossed by an island's border
 * (`BORDER_TEXEL`) owns itself. A gutter texel next to one (ring 1) takes that neighbour, a texel
 * inside an island before a border texel; a gutter texel of ring k > 1 takes the owner of a
 * neighbour of ring k − 1, so every owner is an island's own texel, never a gutter texel. Texels
 * beyond `rings` own nothing (`NO_OWNER`). Neighbours are the four sides, tried in a fixed order.
 */
export function ownerMap(mask: Uint8Array, size: number, rings: number): Int32Array {
  if (mask.length !== size * size) throw new RangeError(`A ${size}² mask is ${size * size} texels`);
  const owner = new Int32Array(size * size).fill(NO_OWNER);
  for (let texel = 0; texel < owner.length; texel++)
    if (mask[texel] !== GUTTER_TEXEL) owner[texel] = texel;
  let ring: number[] = [];
  // Ring 1: the islands' own texels first, then their borders.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const texel = y * size + x;
      if (owner[texel] !== NO_OWNER) continue;
      let border = NO_OWNER;
      let inside = NO_OWNER;
      for (const [dx, dy] of NEIGHBOURS) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
        const from = sy * size + sx;
        if (mask[from] === ISLAND_TEXEL) {
          inside = from;
          break;
        }
        if (mask[from] === BORDER_TEXEL && border === NO_OWNER) border = from;
      }
      const chosen = inside !== NO_OWNER ? inside : border;
      if (chosen !== NO_OWNER) ring.push(texel, chosen);
    }
  }
  for (let k = 0; k < ring.length; k += 2) owner[ring[k]!] = ring[k + 1]!;
  // Rings 2 … : a neighbour of the ring before, its owner taken.
  const previous = new Uint8Array(size * size);
  for (let pass = 1; pass < rings && ring.length > 0; pass++) {
    previous.fill(0);
    for (let k = 0; k < ring.length; k += 2) previous[ring[k]!] = 1;
    const next: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const texel = y * size + x;
        if (owner[texel] !== NO_OWNER) continue;
        for (const [dx, dy] of NEIGHBOURS) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          const from = sy * size + sx;
          if (!previous[from]) continue;
          next.push(texel, owner[from]!);
          break;
        }
      }
    }
    for (let k = 0; k < next.length; k += 2) owner[next[k]!] = next[k + 1]!;
    ring = next;
  }
  return owner;
}

const saturate = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * How much of a tool's paint lands on a texel, 0–1 (§6): the CPU twin of the mask GLSL in
 * `src/lib/painting/tools.ts`, which `tools.test.ts` keeps in step. `cavity` is the detail
 * texture's, decoded as the material does (−1 crease … +1 edge), `occlusion` the vertex
 * occlusion (0 buried … 1 open), `normal` the detail texture's object-space normal (not
 * necessarily of unit length). The flat brush, the eraser, the lift, the fill and the mask's
 * tools (#138) cover every texel they reach; the hobby brushes of #128 read the surface, with their constants beside the look's:
 *
 * - `wash`: pools where the cavity is negative and the occlusion low, tints a flat open surface
 *   faintly (`WASH_FLAT`) and evenly, and is shed by a raised edge (`WASH_LIFT`).
 * - `ink`: stains everything it covers (`INK_FLAT`), the creases fully.
 * - `dry`: by the texel's height above flat (`FLAT_CAVITY`) as a share of `reference`'s, the
 *   highest cavity under the stroke's first dab (#133), never less than `DRY_REFERENCE_MIN`: only
 *   where that share is above `DRY_THRESHOLD × (1 − pressure)`, the pressure being the brush's
 *   `opacity`. The reference's own height takes all at any pressure when it stands at least the floor above
 *   flat; more pressure reaches further down from it; flat and creases take no alpha.
 * - `airbrush`: with a `direction`, only the surface whose normal faces it (above `AIR_DIR_EDGE`);
 *   without, everything.
 *
 * `reference` is read by the dry brush only; left out it is 1, a fully raised edge under the brush.
 */
export function toolMask(
  tool: ToolId,
  cavity: number,
  occlusion: number,
  normal: Vec3,
  brush: BrushSettings,
  reference = 1,
): number {
  switch (tool) {
    case 'flat':
    case 'eraser':
    case 'lift':
    case 'fill':
    case 'mask':
    case 'unmask':
    case 'mask-fill':
      return 1;
    case 'wash': {
      const pool = saturate(Math.max(-cavity, 0) + WASH_OCCLUSION * (1 - occlusion));
      return (WASH_FLAT + (1 - WASH_FLAT) * pool) * (1 - WASH_LIFT * Math.max(cavity, 0));
    }
    case 'ink':
      return INK_FLAT + (1 - INK_FLAT) * saturate(-cavity);
    case 'dry': {
      const scale = Math.max(reference - FLAT_CAVITY, DRY_REFERENCE_MIN);
      const threshold = DRY_THRESHOLD * (1 - brush.opacity);
      return smoothstep(threshold, threshold + DRY_SOFTNESS, (cavity - FLAT_CAVITY) / scale);
    }
    case 'airbrush': {
      const direction = brush.direction;
      if (!direction) return 1;
      const length = Math.max(Math.hypot(...normal), 1e-6);
      const facing =
        (normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2]) / length;
      return smoothstep(AIR_DIR_EDGE, AIR_DIR_EDGE + AIR_DIR_SOFTNESS, facing);
    }
  }
}

/** A direction for the airbrush's mask: of unit length, or null for none (a zero or broken vector, or none given). */
export function unitDirection(direction: Vec3 | null | undefined): Vec3 | null {
  if (!direction) return null;
  const length = Math.hypot(...direction);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}
