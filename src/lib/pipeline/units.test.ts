import { describe, expect, it } from 'vitest';
import { guessUnits, MIN_INCH_HEIGHT, MIN_MM_HEIGHT, UNIT_FACTORS } from './units';

describe('guessUnits', () => {
  it.each([
    [32, 'mm'],
    [250, 'mm'],
    [MIN_MM_HEIGHT, 'mm'],
    [7.99, 'in'],
    [1.26, 'in'], // a 32 mm mini saved in inches
    [MIN_INCH_HEIGHT, 'in'],
    [0.29, 'm'],
    [0.032, 'm'], // a 32 mm mini saved in metres
  ] as const)('a mini %d units tall is in %s', (height, units) => {
    expect(guessUnits(height)).toBe(units);
  });

  it('brings the guessed heights back to a mini-sized height in mm', () => {
    for (const height of [0.032, 1.26, 32]) {
      const mm = height * UNIT_FACTORS[guessUnits(height)];
      expect(mm).toBeGreaterThan(30);
      expect(mm).toBeLessThan(34);
    }
  });
});
