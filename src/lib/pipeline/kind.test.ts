import { describe, expect, it } from 'vitest';
import { addRoundBase, measureBase, pushOutward, type Vec3 } from './base';
import { baseTopShare, guessKind, outlineAreaMm2, TOP_SHARE } from './kind';
import { weldVertices, type IndexedMesh } from './mesh';
import type { BaseMeasurement } from './size';

// Generated shapes only, built with + - * / and sqrt: the same bits on every machine.

/** A Z-up soup turned Y-up the way orient.ts turns a +z file, welded. */
function yUp(soup: number[]): IndexedMesh {
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    out[i] = soup[i]!;
    out[i + 1] = soup[i + 2]!;
    out[i + 2] = 0 - soup[i + 1]!;
  }
  return weldVertices(out).mesh;
}

/** A closed box, Z-up, from its two corners. */
function addBox(soup: number[], [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3): void {
  const inside: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const c = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  for (const [a, b, d, e] of [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ] as const) {
    pushOutward(soup, c(a), c(b), c(d), inside);
    pushOutward(soup, c(a), c(d), c(e), inside);
  }
}

/**
 * A square plate `side` mm wide and `height` high, Z-up, its top a grid of 1 mm cells, with the
 * cells under `hole` (a square of that even side, centred) left out: where something stands on it.
 */
function addPlate(soup: number[], side: number, height: number, hole: number): void {
  const half = side / 2;
  const inside: Vec3 = [0, 0, height / 2];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = i - half;
      const y = j - half;
      const covered = Math.abs(x + 0.5) < hole / 2 && Math.abs(y + 0.5) < hole / 2;
      for (const z of covered ? [0] : [0, height]) {
        pushOutward(soup, [x, y, z], [x + 1, y, z], [x + 1, y + 1, z], inside);
        pushOutward(soup, [x, y, z], [x + 1, y + 1, z], [x, y + 1, z], inside);
      }
    }
  }
  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k]!;
    const [bx, by] = corners[(k + 1) % 4]!;
    pushOutward(soup, [ax, ay, 0], [bx, by, 0], [bx, by, height], inside);
    pushOutward(soup, [ax, ay, 0], [bx, by, height], [ax, ay, height], inside);
  }
}

/** The base as the size step measures it: every test shape has a flat underside. */
const baseOf = (mesh: IndexedMesh): BaseMeasurement => measureBase(mesh, 1)!.base;

const columnOnDisc = (): IndexedMesh => {
  const soup: number[] = [];
  addRoundBase(soup, [0, 0], 32, 3, 16);
  addBox(soup, [-3, -3, 3], [3, 3, 30]);
  return yUp(soup);
};

const pairWithBaseFile = { pairing: { baseFile: 1 } };

describe('guessKind', () => {
  it('reads a column on a 32 mm disc as a character standing on a base', () => {
    const mesh = columnOnDisc();
    const base = baseOf(mesh);
    expect(base.shape).toBe('round');
    const guess = guessKind(mesh, base, null);
    expect(guess).toMatchObject({ kind: 'character', method: 'guessed', reason: 'base-top' });
    expect(guess.topShare).toBeGreaterThan(0.9);
    expect(guess.topShare).toBeLessThanOrEqual(1);
  });

  it('reads a bare disc as a character: a base with nothing on it yet', () => {
    const soup: number[] = [];
    addRoundBase(soup, [0, 0], 32, 3, 16);
    const mesh = yUp(soup);
    expect(guessKind(mesh, baseOf(mesh), null)).toMatchObject({
      kind: 'character',
      reason: 'base-top',
    });
  });

  it('reads a plate mostly covered by a crate as a prop', () => {
    const soup: number[] = [];
    // 26 × 26 of a 32 × 32 plate covered: 66 % of it.
    addPlate(soup, 32, 3, 26);
    addBox(soup, [-13, -13, 3], [13, 13, 23]);
    const mesh = yUp(soup);
    const guess = guessKind(mesh, baseOf(mesh), null);
    expect(guess).toMatchObject({ kind: 'prop', method: 'guessed', reason: 'solid' });
    expect(guess.topShare).toBeCloseTo(1 - (26 * 26) / (32 * 32), 2);
  });

  it('reads a plate with a small column on it as a character', () => {
    const soup: number[] = [];
    addPlate(soup, 32, 3, 6);
    addBox(soup, [-3, -3, 3], [3, 3, 30]);
    const mesh = yUp(soup);
    const guess = guessKind(mesh, baseOf(mesh), null);
    expect(guess).toMatchObject({ kind: 'character', reason: 'base-top' });
    expect(guess.topShare).toBeCloseTo(1 - 36 / (32 * 32), 2);
  });

  it('reads a long wall as a prop: its top is far above the floor', () => {
    const soup: number[] = [];
    addBox(soup, [-50, -15, 0], [50, 15, 36]);
    const mesh = yUp(soup);
    expect(guessKind(mesh, baseOf(mesh), null)).toEqual({
      kind: 'prop',
      method: 'guessed',
      reason: 'solid',
      topShare: 0,
    });
  });

  it('calls a mini without a base a character, without a pass', () => {
    const soup: number[] = [];
    addBox(soup, [-3, -3, 0], [3, 3, 30]);
    expect(guessKind(yUp(soup), null, null)).toEqual({
      kind: 'character',
      method: 'guessed',
      reason: 'no-base',
      topShare: null,
    });
  });

  it('calls a figure with a base file a character', () => {
    const mesh = columnOnDisc();
    expect(guessKind(mesh, baseOf(mesh), pairWithBaseFile)).toEqual({
      kind: 'character',
      method: 'guessed',
      reason: 'base-file',
      topShare: null,
    });
    // Parts without a base file are guessed from the mesh like one file.
    expect(guessKind(mesh, baseOf(mesh), { pairing: { baseFile: null } })).toMatchObject({
      reason: 'base-top',
    });
  });

  it('takes the chosen kind, and still measures the share when there is a base', () => {
    const mesh = columnOnDisc();
    const base = baseOf(mesh);
    const chosen = guessKind(mesh, base, null, 'prop');
    expect(chosen).toMatchObject({ kind: 'prop', method: 'manual', reason: 'manual' });
    expect(chosen.topShare).toBe(guessKind(mesh, base, null).topShare);
    expect(guessKind(mesh, null, null, 'character')).toEqual({
      kind: 'character',
      method: 'manual',
      reason: 'manual',
      topShare: null,
    });
  });
});

describe('baseTopShare', () => {
  it('measures from the lowest point, so a mesh above y = 0 reads the same', () => {
    const mesh = columnOnDisc();
    const base = baseOf(mesh);
    const lifted = { ...mesh, positions: mesh.positions.map((v, i) => (i % 3 === 1 ? v + 5 : v)) };
    expect(baseTopShare(lifted, base)).toBeCloseTo(baseTopShare(mesh, base), 6);
  });

  it('counts a top tilted within 30° and leaves out a steeper one', () => {
    // A 10 × 10 ramp from y = 0: tilted 26.6° (rise 5) counts its projected area, 45° does not.
    const ramp = (rise: number): IndexedMesh => ({
      positions: new Float32Array([0, 0, 0, 10, rise, 0, 10, rise, -10, 0, 0, -10]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const base: BaseMeasurement = {
      shape: 'other',
      diameterMm: 10,
      footprintMm: [10, 10],
      coverage: 1,
    };
    expect(baseTopShare(ramp(5), base)).toBeCloseTo(1, 6);
    expect(baseTopShare(ramp(10), base)).toBe(0);
  });

  it('takes the circle for a round base and the box for any other', () => {
    expect(
      outlineAreaMm2({ shape: 'round', diameterMm: 2, footprintMm: [2, 2], coverage: 1 }),
    ).toBe(Math.PI);
    expect(
      outlineAreaMm2({ shape: 'other', diameterMm: 4, footprintMm: [4, 3], coverage: 1 }),
    ).toBe(12);
  });

  it('keeps the threshold at half the base', () => {
    expect(TOP_SHARE).toBe(0.5);
  });
});
