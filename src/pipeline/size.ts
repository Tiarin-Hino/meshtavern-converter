/**
 * Creature sizes and their footprint on the grid (issue #44).
 *
 * The six size names (Tiny to Gargantuan) are the size categories of the System Reference
 * Document 5.1 by Wizards of the Coast LLC, licensed under CC-BY-4.0
 * (https://creativecommons.org/licenses/by/4.0/). The footprint in squares, the 32 mm grid
 * and the plain-base diameters are ours.
 */

/** One grid square in mini space. PM decision, 2026-09-23. The viewer imports it from here. */
export const GRID_SQUARE_MM = 32;

/** A base up to this share larger than its footprint still fits it, so a 33 mm base is 1×1. _(proposal)_ */
export const FOOTPRINT_TOLERANCE = 0.05;

/** Within one square, a base (or figure) narrower than this suggests Small, a wider one Medium. _(proposal)_ */
export const SMALL_BELOW_MM = 26;

export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type FootprintSquares = 1 | 2 | 3 | 4;

/** Footprint in squares and the diameter of the plain base the converter adds _(proposal)_. */
export const SIZES: Record<CreatureSize, { squares: FootprintSquares; plainBaseMm: number }> = {
  tiny: { squares: 1, plainBaseMm: 25 },
  small: { squares: 1, plainBaseMm: 25 },
  medium: { squares: 1, plainBaseMm: 32 },
  large: { squares: 2, plainBaseMm: 50 },
  huge: { squares: 3, plainBaseMm: 75 },
  gargantuan: { squares: 4, plainBaseMm: 100 },
};

export const CREATURE_SIZES = Object.keys(SIZES) as CreatureSize[];

export type Units = 'mm' | 'in' | 'm';

export interface BaseMeasurement {
  shape: 'round' | 'other';
  /** Round bases: the diameter. Other shapes: the longer side of the footprint. */
  diameterMm: number;
  /** Width and depth of the resting footprint, scene x and z. */
  footprintMm: [number, number];
  /** Resting area as a share of the footprint, as in the up detection. */
  coverage: number;
}

export type SizingWarning =
  /** The base is larger than the chosen footprint; the page offers to scale it to fit. */
  | { kind: 'base-exceeds-footprint'; baseMm: number; footprintMm: number }
  /** The base does not fit even Gargantuan; the mini is probably in the wrong units. */
  | { kind: 'larger-than-gargantuan'; baseMm: number };

export interface Sizing {
  units: Units;
  unitsMethod: 'guessed' | 'manual';
  /** Factor applied to the file's coordinates to get mm: units × any requested scale. 1 when nothing changed. */
  scale: number;
  /** The base the file came with; null when none was found. */
  base: BaseMeasurement | null;
  /** The plain round base the converter added; null when none. */
  plainBase: { diameterMm: number; heightMm: number } | null;
  size: CreatureSize;
  sizeMethod: 'suggested' | 'manual';
  footprintSquares: FootprintSquares;
  /** The base the table should draw or expect: measured, or the plain one, in mm. */
  baseDiameterMm: number;
  /** What the suggestion was made from: the measured base, or the figure's own extents. */
  suggestedFrom: 'base' | 'figure';
  warnings: SizingWarning[];
}

/** The side of a size's footprint in mm. */
export function footprintMm(size: CreatureSize): number {
  return SIZES[size].squares * GRID_SQUARE_MM;
}

/** Whether something `mm` across fits a footprint of `squares`, with the tolerance. */
const fits = (mm: number, squares: number): boolean =>
  mm <= squares * GRID_SQUARE_MM * (1 + FOOTPRINT_TOLERANCE);

/**
 * The creature size whose footprint is the smallest that `mm` (a base diameter, or the
 * figure's wider side when it has no base) fits into. Tiny is never suggested, only chosen.
 * Anything larger than four squares is Gargantuan; `sizingWarnings` says so.
 */
export function suggestSize(mm: number): CreatureSize {
  if (fits(mm, 1)) return mm < SMALL_BELOW_MM ? 'small' : 'medium';
  if (fits(mm, 2)) return 'large';
  if (fits(mm, 3)) return 'huge';
  return 'gargantuan';
}

/**
 * The warnings for a sizing: a measured base larger than the chosen footprint, and a
 * measurement (base or figure) that does not fit even Gargantuan.
 */
export function sizingWarnings(
  size: CreatureSize,
  baseMm: number | null,
  measuredMm: number,
): SizingWarning[] {
  const warnings: SizingWarning[] = [];
  if (baseMm !== null && !fits(baseMm, SIZES[size].squares))
    warnings.push({ kind: 'base-exceeds-footprint', baseMm, footprintMm: footprintMm(size) });
  if (!fits(measuredMm, SIZES.gargantuan.squares))
    warnings.push({ kind: 'larger-than-gargantuan', baseMm: measuredMm });
  return warnings;
}

const SIZE_NAMES: Record<CreatureSize, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};

/** "Medium (1×1)": the SRD name with the footprint in squares, so other systems fit. */
export function sizeLabel(size: CreatureSize): string {
  const squares = SIZES[size].squares;
  return `${SIZE_NAMES[size]} (${squares}×${squares})`;
}
