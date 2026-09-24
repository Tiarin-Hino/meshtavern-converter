import type { Units } from './size';

/** Millimetres per unit of the file. */
export const UNIT_FACTORS: Record<Units, number> = { mm: 1, in: 25.4, m: 1000 };

/** A mini at least this tall in file units is taken to be in millimetres. _(proposal)_ */
export const MIN_MM_HEIGHT = 8;
/** Below the mm range, at least this tall is taken to be inches; anything smaller, metres. _(proposal)_ */
export const MIN_INCH_HEIGHT = 0.3;

/**
 * Guesses the file's units from the mini's height after orientation, in file units. Print
 * files are nearly always millimetres; a mini of 0.3 to 8 units is an inch file (7.6 to 203 mm)
 * and a smaller one a metre file. A terrain piece over 8 inches tall saved in inches reads
 * as mm: the known miss, shown on the page and correctable.
 */
export function guessUnits(heightInFileUnits: number): Units {
  if (heightInFileUnits >= MIN_MM_HEIGHT) return 'mm';
  if (heightInFileUnits >= MIN_INCH_HEIGHT) return 'in';
  return 'm';
}
