import { generatePlainBase, PLAIN_BASE_HEIGHT_MM, standOnBase } from './base';
import type { IndexedMesh } from './mesh';
import type { PlacedMesh } from './orient';
import { guessUnits, UNIT_FACTORS } from './units';

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

/**
 * Within one square, a base narrower than this suggests Small, a wider one Medium. PM
 * decision on PR #74, 2026-09-24 (was 26 mm): humanoids on 20 mm bases are Medium, often
 * just printed small; a 15 mm base stays Small.
 */
export const SMALL_BELOW_MM = 18;

/**
 * A Medium mini on a base narrower than this is offered a scale up to it (never scaled
 * without the user's click). PM decision on PR #74, 2026-09-24: 25 mm, because scaled to a
 * 32 mm base the small humanoids of the corpus stand taller than any bought one.
 */
export const MEDIUM_MIN_BASE_MM = 25;

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

/**
 * The size suggested for a mini without a base. Its own width says little: a spread weapon
 * or wings make it too large, a mini lying on its side (#72) anything. PM decision on PR #74,
 * 2026-09-23: suggest Medium and let the user pick.
 */
export const NO_BASE_SIZE: CreatureSize = 'medium';

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
  | { kind: 'larger-than-gargantuan'; baseMm: number }
  /** A Medium mini on a small base, probably printed small; the page offers to scale it up to `targetMm`. */
  | { kind: 'base-small-for-size'; baseMm: number; targetMm: number };

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
  /** What the suggestion was made from: the measured base, or `NO_BASE_SIZE` for a mini without one. */
  suggestedFrom: 'base' | 'default';
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
 * The creature size whose footprint is the smallest that `mm`, a base diameter, fits into. Tiny is never suggested, only chosen.
 * Anything larger than four squares is Gargantuan; `sizingWarnings` says so.
 */
export function suggestSize(mm: number): CreatureSize {
  if (fits(mm, 1)) return mm < SMALL_BELOW_MM ? 'small' : 'medium';
  if (fits(mm, 2)) return 'large';
  if (fits(mm, 3)) return 'huge';
  return 'gargantuan';
}

/**
 * The warnings for a sizing: a measured base larger than the chosen footprint, a Medium
 * mini on a base under `MEDIUM_MIN_BASE_MM`, and a measurement (base or figure) that does
 * not fit even Gargantuan.
 */
export function sizingWarnings(
  size: CreatureSize,
  baseMm: number | null,
  measuredMm: number,
): SizingWarning[] {
  const warnings: SizingWarning[] = [];
  if (baseMm !== null && !fits(baseMm, SIZES[size].squares))
    warnings.push({ kind: 'base-exceeds-footprint', baseMm, footprintMm: footprintMm(size) });
  if (baseMm !== null && size === 'medium' && baseMm < MEDIUM_MIN_BASE_MM)
    warnings.push({ kind: 'base-small-for-size', baseMm, targetMm: MEDIUM_MIN_BASE_MM });
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

/** What the user chose about size; everything left out is guessed or suggested. */
export interface SizingOptions {
  /** Overrides the units guess. */
  units?: Units;
  /** Overrides the size suggestion. */
  size?: CreatureSize;
  /** Scale so the (measured or plain) base has this diameter in mm. */
  scaleToBaseMm?: number;
  /** Add a plain round base when none is found. Default false. */
  plainBase?: boolean;
}

export interface SizedMini {
  /** The input mesh, or a new one when it was scaled. */
  mesh: IndexedMesh;
  /** Width, height and depth in scene mm. */
  sizeMm: [number, number, number];
  sizing: Sizing;
}

/**
 * The size step: turns file units into mm, suggests or takes the creature size, adds a
 * plain base when asked and there is none, and works out the warnings. Only the options
 * scale anything; with none, a mm file keeps its measured size. `scaleToBaseMm` replaces
 * the units: it sets the base (or, without one, the figure's wider side) to that diameter
 * in mm, and a plain base added with it gets that diameter. The input is left untouched.
 */
/** `placed` is what `orientAndPlace` returns, still in file units. */
export function sizeMini(placed: PlacedMesh, options: SizingOptions = {}): SizedMini {
  const units = options.units ?? guessUnits(placed.sizeMm[1]);
  const unitScale = UNIT_FACTORS[units];

  // Scaling to a base diameter measures the base, or the figure's wider side without one.
  const measuredInFile = placed.base?.diameterMm ?? Math.max(placed.sizeMm[0], placed.sizeMm[2]);
  const target = options.scaleToBaseMm;
  if (target !== undefined && !(target > 0 && Number.isFinite(target)))
    throw new RangeError(`Cannot scale to a base of ${target} mm`);
  const scale = target !== undefined && measuredInFile > 0 ? target / measuredInFile : unitScale;

  const baseMm = placed.base ? placed.base.diameterMm * scale : null;
  const measuredMm = measuredInFile * scale;
  const size = options.size ?? (baseMm === null ? NO_BASE_SIZE : suggestSize(baseMm));

  let mesh = scale === 1 ? placed.mesh : scaled(placed.mesh, scale);
  const sizeMm: [number, number, number] = [
    placed.sizeMm[0] * scale,
    placed.sizeMm[1] * scale,
    placed.sizeMm[2] * scale,
  ];
  let plainBase: Sizing['plainBase'] = null;
  if (options.plainBase && !placed.base) {
    plainBase = {
      diameterMm: target ?? SIZES[size].plainBaseMm,
      heightMm: PLAIN_BASE_HEIGHT_MM,
    };
    mesh = standOnBase(mesh, generatePlainBase(plainBase.diameterMm), plainBase.heightMm);
    sizeMm[0] = Math.max(sizeMm[0], plainBase.diameterMm);
    sizeMm[1] += plainBase.heightMm;
    sizeMm[2] = Math.max(sizeMm[2], plainBase.diameterMm);
  }
  const base: BaseMeasurement | null = placed.base && {
    ...placed.base,
    diameterMm: placed.base.diameterMm * scale,
    footprintMm: [placed.base.footprintMm[0] * scale, placed.base.footprintMm[1] * scale],
  };

  return {
    mesh,
    sizeMm,
    sizing: {
      units,
      unitsMethod: options.units ? 'manual' : 'guessed',
      scale,
      base,
      plainBase,
      size,
      sizeMethod: options.size ? 'manual' : 'suggested',
      footprintSquares: SIZES[size].squares,
      baseDiameterMm: baseMm ?? plainBase?.diameterMm ?? SIZES[size].plainBaseMm,
      suggestedFrom: placed.base ? 'base' : 'default',
      warnings: sizingWarnings(size, baseMm, measuredMm),
    },
  };
}

/** A copy of the mesh scaled about the origin, which keeps it on y = 0 and centred. */
function scaled(mesh: IndexedMesh, factor: number): IndexedMesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = mesh.positions[i]! * factor;
  return { ...mesh, positions };
}
