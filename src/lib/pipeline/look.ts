import type { IndexedMesh } from './mesh';

/**
 * The "primed and washed" look: a base coat, darkened where a wash would pool (buried
 * areas and creases) and lightened where a drybrush would catch (edges). Pure maths on the
 * measurements from shade.ts, so the viewer and the GLB export produce the same colours.
 */
export interface Look {
  enabled: boolean;
  /** Base coat as an sRGB hex colour, for example "#9aa0a8". */
  base: string;
  /** 0–1: how much buried areas darken. */
  occlusion: number;
  /** 0–1: how much creases darken. */
  wash: number;
  /** 0–1: how much edges lighten. */
  edges: number;
}

export const DEFAULT_LOOK: Look = {
  enabled: true,
  base: '#9aa0a8',
  occlusion: 0.75,
  wash: 0.6,
  edges: 0.45,
};

/**
 * Starting points for the look (issue #45): a name and a value for each of the controls,
 * nothing the controls cannot reach. The first one is `DEFAULT_LOOK`.
 */
export const LOOK_PRESET_IDS = ['primer', 'bone', 'black-drybrush', 'steel', 'bronze'] as const;
export type LookPresetId = (typeof LOOK_PRESET_IDS)[number];

export interface LookPreset {
  id: LookPresetId;
  /** The name the user reads. */
  label: string;
  look: Look;
}

export const LOOK_PRESETS: readonly LookPreset[] = [
  { id: 'primer', label: 'Grey primer', look: DEFAULT_LOOK },
  {
    id: 'bone',
    label: 'Bone',
    look: { enabled: true, base: '#d8cdb0', occlusion: 0.8, wash: 0.75, edges: 0.3 },
  },
  {
    id: 'black-drybrush',
    label: 'Black, drybrushed',
    look: { enabled: true, base: '#1c1c20', occlusion: 0.5, wash: 0.3, edges: 0.9 },
  },
  {
    id: 'steel',
    label: 'Steel',
    look: { enabled: true, base: '#565e68', occlusion: 0.85, wash: 0.8, edges: 0.9 },
  },
  {
    id: 'bronze',
    label: 'Bronze',
    look: { enabled: true, base: '#7a4f24', occlusion: 0.85, wash: 0.75, edges: 0.7 },
  },
];

/**
 * The preset a look is, or null when a control was moved away from every one of them.
 * Read from the values, so it cannot disagree with them.
 */
export function presetOf(look: Look): LookPresetId | null {
  const match = LOOK_PRESETS.find(
    ({ look: preset }) =>
      look.enabled === preset.enabled &&
      look.base.trim().toLowerCase() === preset.base &&
      look.occlusion === preset.occlusion &&
      look.wash === preset.wash &&
      look.edges === preset.edges,
  );
  return match?.id ?? null;
}

/** Raw cavity values are small (a 20° fold is about 0.17); this brings them to a usable range. */
export const CAVITY_GAIN = 4;
/** The wash never goes fully black and the drybrush never fully white. */
export const DARKEST = 0.12;
export const HIGHLIGHT = 0.85;

// The hobby brushes of the painting engine (issue #128, design note
// `docs/design/painting-engine.md` §6): how much of a brush's colour a texel takes, read from the
// same cavity (decoded with CAVITY_GAIN, −1 crease … +1 edge) and occlusion as the look above.
// `toolMask` in brush.ts and the GLSL in `src/lib/painting/tools.ts` use them. All _(proposals)_.

/** The wash on a flat, open surface: a faint, even tint. */
export const WASH_FLAT = 0.15;
/** How much a buried place (low occlusion) pools the wash, beside the crease. */
export const WASH_OCCLUSION = 0.5;
/** How much of the wash a raised edge sheds, at cavity +1. */
export const WASH_LIFT = 0.8;
/** The ink's stain on a flat surface; the creases take all of it. */
export const INK_FLAT = 0.5;
/**
 * The dry brush catches where a texel's height above flat is above this share of its stroke's
 * reference's, times (1 − pressure): at full pressure every raised texel (#133, design note
 * `docs/design/dry-brush-crests.md`).
 */
export const DRY_THRESHOLD = 0.5;
/** Over this share of the reference's height above the threshold the dry brush goes from nothing to all. */
export const DRY_SOFTNESS = 0.2;
/**
 * The smallest height above flat (`FLAT_CAVITY`) the dry brush's reference counts as, about
 * thirteen of the detail texture's steps. Low detail and the gentle curve of a smooth surface
 * measure alike (a few steps up); a lower floor catches more of the one and blotches more of the
 * other. PM's choice, 2026-10-15, from 0.1, 0.2 and 0.3 painted side by side.
 */
export const DRY_REFERENCE_MIN = 0.2;
/** The dry brush's opacity: its slider is the pressure, not the opacity. */
export const DRY_OPACITY = 0.9;
/** The airbrush's dab: soft from its centre out. */
export const AIR_HARDNESS = 0;
/** What one airbrush dab adds to the stroke at full flow and full coverage: a spray that builds up. */
export const AIR_FLOW_GAIN = 0.15;
/** The airbrush's direction mask: nothing where the normal's dot with the direction is at or below this … */
export const AIR_DIR_EDGE = 0;
/** … all of it this far above. */
export const AIR_DIR_SOFTNESS = 0.3;

const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

export function parseHexColour(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a hex colour: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) =>
    srgbToLinear(channel / 255),
  ) as [number, number, number];
}

/**
 * The coat under the look at one point (issue #125): the base coat, or the paint where there is
 * some. `paint` is linear RGB and alpha, 0–1: alpha 1 replaces the base coat, 0 leaves it, and
 * in between (a texel at a painted area's edge, filtered) mixes the two by alpha.
 */
export function paintedBase(
  base: readonly number[],
  paint: readonly number[] | null = null,
): [number, number, number] {
  const alpha = paint ? paint[3]! : 0;
  return [0, 1, 2].map(
    (channel) => base[channel]! + (paint ? paint[channel]! - base[channel]! : 0) * alpha,
  ) as [number, number, number];
}

/**
 * One surface point: linear RGB for the given occlusion (0..1) and raw cavity (about -0.25..0.25).
 * With `paint` (linear RGB and alpha, see `paintedBase`) the paint is the coat the wash and the
 * edges work on: the look is the same, only the colour under it changes.
 */
export function pointColour(
  base: readonly number[],
  look: Look,
  occlusion: number,
  rawCavity: number,
  paint: readonly number[] | null = null,
): [number, number, number] {
  const coat = paintedBase(base, paint);
  const cavity = Math.max(-1, Math.min(1, rawCavity * CAVITY_GAIN));
  let shadow = (1 - look.occlusion * (1 - occlusion)) * (1 - look.wash * Math.max(0, -cavity));
  shadow = DARKEST + (1 - DARKEST) * shadow;
  const highlight = look.edges * Math.max(0, cavity) * HIGHLIGHT;
  return [0, 1, 2].map((channel) => {
    const shaded = coat[channel]! * shadow;
    return shaded + (1 - shaded) * highlight;
  }) as [number, number, number];
}

/** sRGB bytes (a paint texture's texels) as linear 0–1, alpha as it is: what the GPU samples from an sRGB texture. */
export function paintFromBytes(
  rgba: ArrayLike<number>,
  offset = 0,
): [number, number, number, number] {
  return [
    srgbToLinear(rgba[offset]! / 255),
    srgbToLinear(rgba[offset + 1]! / 255),
    srgbToLinear(rgba[offset + 2]! / 255),
    rgba[offset + 3]! / 255,
  ];
}

/**
 * Linear RGB per vertex, 0–1, three numbers each. Meshes without shading data, and a
 * disabled look, get the flat coat. `paint` is a colour per vertex, RGBA bytes with the colour in
 * sRGB (`paintAtVertices` in paint.ts): where its alpha is above zero it is the coat instead of
 * the base coat, under the same look (`pointColour`).
 */
export function vertexColours(
  mesh: IndexedMesh,
  look: Look,
  paint: Uint8Array | null = null,
): Float32Array {
  const vertexCount = mesh.positions.length / 3;
  if (paint && paint.length !== vertexCount * 4)
    throw new RangeError(`A paint per vertex is ${vertexCount * 4} bytes, not ${paint.length}`);
  const colours = new Float32Array(vertexCount * 3);
  const base = parseHexColour(look.base);
  const shaded = look.enabled && mesh.occlusion && mesh.cavity;
  for (let v = 0; v < vertexCount; v++) {
    const painted = paint && paint[v * 4 + 3]! > 0 ? paintFromBytes(paint, v * 4) : null;
    colours.set(
      shaded
        ? pointColour(base, look, mesh.occlusion![v]!, mesh.cavity![v]!, painted)
        : painted
          ? paintedBase(base, painted)
          : base,
      v * 3,
    );
  }
  return colours;
}

/** Raw cavity values are stored in a byte as (cavity + 0.5) * 255, keeping precision where the values are. */
export const cavityToByte = (cavity: number): number =>
  Math.round((Math.max(-0.5, Math.min(0.5, cavity)) + 0.5) * 255);

/**
 * The cavity a flat surface decodes to from the detail texture, as the material and the painting
 * engine decode it (× CAVITY_GAIN): zero is stored as the byte above the middle, half a step
 * above 0. The dry brush measures a texel's height from here (#133).
 */
export const FLAT_CAVITY = (cavityToByte(0) / 255 - 0.5) * CAVITY_GAIN;
