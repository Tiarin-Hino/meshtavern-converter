import { describe, expect, it } from 'vitest';
import type { PlacedMesh } from './orient';
import {
  CREATURE_SIZES,
  footprintMm,
  GRID_SQUARE_MM,
  sizeLabel,
  sizeMini,
  sizingWarnings,
  suggestSize,
} from './size';

describe('suggestSize', () => {
  it.each([
    [15, 'small'],
    [17.9, 'small'],
    [18, 'medium'],
    [20, 'medium'], // a humanoid on a 20 mm base: Medium, printed small
    [24, 'medium'],
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

  it('offers to scale a Medium mini on a base under 25 mm up to 25 mm', () => {
    expect(sizingWarnings('medium', 20, 20)).toEqual([
      { kind: 'base-small-for-size', baseMm: 20, targetMm: 25 },
    ]);
    expect(sizingWarnings('medium', 25, 25)).toEqual([]);
    // Only Medium: a Small or Tiny mini on a small base is as it should be.
    expect(sizingWarnings('small', 15, 15)).toEqual([]);
    expect(sizingWarnings('tiny', 20, 20)).toEqual([]);
    // Without a base there is nothing to scale up.
    expect(sizingWarnings('medium', null, 15)).toEqual([]);
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

/** A placed stand-in: two vertices spanning the size, with or without a measured base. */
function placedMini(sizeMm: [number, number, number], baseMm: number | null): PlacedMesh {
  const [w, h, d] = sizeMm;
  return {
    mesh: {
      positions: new Float32Array([-w / 2, 0, -d / 2, w / 2, h, d / 2]),
      indices: new Uint32Array(0),
    },
    sizeMm,
    base:
      baseMm === null
        ? null
        : {
            shape: 'round',
            diameterMm: baseMm,
            footprintMm: [baseMm, baseMm],
            coverage: 0.9,
            centre: [0, 0],
          },
  };
}

describe('sizeMini', () => {
  it('keeps a mm mini as it is and suggests from its base', () => {
    const placed = placedMini([30, 40, 30], 32);
    const { mesh, sizeMm, sizing } = sizeMini(placed);
    expect(mesh).toBe(placed.mesh);
    expect(sizeMm).toEqual([30, 40, 30]);
    expect(sizing).toMatchObject({
      units: 'mm',
      unitsMethod: 'guessed',
      scale: 1,
      size: 'medium',
      sizeMethod: 'suggested',
      footprintSquares: 1,
      baseDiameterMm: 32,
      suggestedFrom: 'base',
      warnings: [],
    });
    expect(sizing.base).not.toHaveProperty('centre');
  });

  it('suggests Medium for a mini without a base, whatever its width, and expects a 32 mm base', () => {
    for (const width of [15, 60, 120]) {
      const { sizing } = sizeMini(placedMini([width, 30, 45], null));
      expect(sizing).toMatchObject({
        size: 'medium',
        suggestedFrom: 'default',
        base: null,
        baseDiameterMm: 32,
        warnings: [],
      });
    }
  });

  it('still warns when a mini without a base is too large for any size', () => {
    const { sizing } = sizeMini(placedMini([250, 300, 200], null));
    expect(sizing.size).toBe('medium');
    expect(sizing.warnings).toEqual([{ kind: 'larger-than-gargantuan', baseMm: 250 }]);
  });

  it('scales a file in metres to mm, base and all', () => {
    const { mesh, sizeMm, sizing } = sizeMini(placedMini([0.025, 0.035, 0.025], 0.025));
    expect(sizing).toMatchObject({ units: 'm', scale: 1000, size: 'medium', warnings: [] });
    expect(sizing.baseDiameterMm).toBeCloseTo(25, 4);
    expect(sizeMm[1]).toBeCloseTo(35, 4);
    expect(mesh.positions[4]).toBeCloseTo(35, 4);
  });

  it('takes the units and the size the user chose', () => {
    const { sizing } = sizeMini(placedMini([30, 40, 30], 50), { units: 'mm', size: 'medium' });
    expect(sizing).toMatchObject({ unitsMethod: 'manual', size: 'medium', sizeMethod: 'manual' });
    expect(sizing.warnings).toEqual([
      { kind: 'base-exceeds-footprint', baseMm: 50, footprintMm: 32 },
    ]);
  });

  it('leaves its input untouched when it scales', () => {
    const placed = placedMini([1, 1.5, 1], 1);
    const before = Array.from(placed.mesh.positions);
    sizeMini(placed);
    expect(Array.from(placed.mesh.positions)).toEqual(before);
  });

  it('scales to the base diameter the user entered', () => {
    const { sizeMm, sizing, mesh } = sizeMini(placedMini([30, 40, 30], 25), { scaleToBaseMm: 32 });
    expect(sizing.scale).toBeCloseTo(1.28, 9);
    expect(sizing.baseDiameterMm).toBeCloseTo(32, 9);
    expect(sizing.base!.footprintMm[0]).toBeCloseTo(32, 9);
    expect(sizing).toMatchObject({ size: 'medium', units: 'mm' });
    expect(sizeMm[1]).toBeCloseTo(40 * 1.28, 9);
    expect(mesh.positions[4]).toBeCloseTo(40 * 1.28, 4);
  });

  it('scales a base that does not fit its footprint to fit it, and the warning goes', () => {
    const tooLarge = sizeMini(placedMini([50, 40, 50], 50), { size: 'medium' });
    expect(tooLarge.sizing.warnings.map((w) => w.kind)).toEqual(['base-exceeds-footprint']);
    const fitted = sizeMini(placedMini([50, 40, 50], 50), { size: 'medium', scaleToBaseMm: 32 });
    expect(fitted.sizing.warnings).toEqual([]);
    expect(fitted.sizing.scale).toBeCloseTo(0.64, 9);
  });

  it('scales a mini without a base by its wider side, and gives a plain base that diameter', () => {
    const { sizing } = sizeMini(placedMini([20, 40, 16], null), {
      scaleToBaseMm: 32,
      plainBase: true,
    });
    expect(sizing.scale).toBeCloseTo(1.6, 9);
    expect(sizing).toMatchObject({
      plainBase: { diameterMm: 32 },
      baseDiameterMm: 32,
      size: 'medium',
    });
  });

  it('refuses a base diameter that is not a positive number', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => sizeMini(placedMini([30, 40, 30], 25), { scaleToBaseMm: bad })).toThrow(
        RangeError,
      );
  });
});
