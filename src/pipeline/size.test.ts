import { describe, expect, it } from 'vitest';
import {
  CREATURE_SIZES,
  footprintMm,
  GRID_SQUARE_MM,
  sizeLabel,
  sizingWarnings,
  suggestSize,
} from './size';

describe('suggestSize', () => {
  it.each([
    [20, 'small'],
    [24, 'small'],
    [26, 'medium'],
    [32, 'medium'],
    [33, 'medium'], // within the 5 % tolerance of one square
    [34, 'large'],
    [50, 'large'],
    [67, 'large'],
    [68, 'huge'],
    [96, 'huge'],
    [128, 'gargantuan'],
    [135, 'gargantuan'],
    [400, 'gargantuan'],
  ] as const)('%d mm suggests %s', (mm, size) => {
    expect(suggestSize(mm)).toBe(size);
  });

  it('never suggests Tiny', () => {
    for (let mm = 0; mm <= 200; mm += 0.5) expect(suggestSize(mm)).not.toBe('tiny');
  });
});

describe('footprintMm', () => {
  it('is the squares times the 32 mm grid', () => {
    expect(GRID_SQUARE_MM).toBe(32);
    expect(CREATURE_SIZES.map(footprintMm)).toEqual([32, 32, 32, 64, 96, 128]);
  });
});

describe('sizingWarnings', () => {
  it('says nothing when the base fits', () => {
    expect(sizingWarnings('medium', 25, 25)).toEqual([]);
    expect(sizingWarnings('medium', 33, 33)).toEqual([]);
    expect(sizingWarnings('large', 50, 50)).toEqual([]);
  });

  it('warns when the base is larger than the chosen footprint', () => {
    expect(sizingWarnings('medium', 50, 50)).toEqual([
      { kind: 'base-exceeds-footprint', baseMm: 50, footprintMm: 32 },
    ]);
  });

  it('does not warn about the footprint for a mini without a base', () => {
    expect(sizingWarnings('medium', null, 60)).toEqual([]);
  });

  it('warns when the measurement does not fit even Gargantuan', () => {
    expect(sizingWarnings('gargantuan', 135, 135)).toEqual([
      { kind: 'base-exceeds-footprint', baseMm: 135, footprintMm: 128 },
      { kind: 'larger-than-gargantuan', baseMm: 135 },
    ]);
    expect(sizingWarnings('gargantuan', null, 250)).toEqual([
      { kind: 'larger-than-gargantuan', baseMm: 250 },
    ]);
  });
});

describe('sizeLabel', () => {
  it('shows the footprint in squares next to the name', () => {
    expect(sizeLabel('medium')).toBe('Medium (1×1)');
    expect(sizeLabel('gargantuan')).toBe('Gargantuan (4×4)');
  });
});
