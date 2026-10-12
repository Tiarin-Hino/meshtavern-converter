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
