import { beforeAll, describe, expect, it } from 'vitest';
import { generateFigure } from '../../regression/shapes';
import type { FillSeed } from './brush';
import { fillRegion, triangleAdjacency, type TriangleAdjacency } from './fill';
import type { IndexedMesh } from './mesh';
import { runPipeline } from './run';
import { encodeBinaryStl } from './stl';

/** The generated figure's base: a 25 mm disc, 3 mm high. */
const BASE_TOP_MM = 3;
/** How far above the base's top a triangle of the top may lie: float noise of the simplified level. */
const BAND_MM = 0.05;

let table: IndexedMesh;
let adjacency: TriangleAdjacency;

beforeAll(async () => {
  const result = await runPipeline(encodeBinaryStl(generateFigure(true)), {
    bake: 256,
    compress: null,
  });
  table = result.baked!.mesh;
  adjacency = triangleAdjacency(table);
}, 120_000);

/** Centroid and face normal's y of triangle t. */
function centroid(t: number): [number, number, number] {
  const c = [0, 0, 0];
  for (let corner = 0; corner < 3; corner++)
    for (let axis = 0; axis < 3; axis++)
      c[axis]! += table.positions[table.indices[t * 3 + corner]! * 3 + axis]! / 3;
  return c as [number, number, number];
}
const upness = (t: number): number => adjacency.faceNormals[t * 3 + 1]!;

/** The triangle whose centroid is closest to `point` and whose face passes `facing`. */
function nearest(point: [number, number, number], facing: (t: number) => boolean): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let t = 0; t < table.indices.length / 3; t++) {
    if (!facing(t)) continue;
    const [x, y, z] = centroid(t);
    const distance = Math.hypot(x - point[0], y - point[1], z - point[2]);
    if (distance < bestDistance) {
      best = t;
      bestDistance = distance;
    }
  }
  return best;
}

/** A triangle of the disc: all of it at or below the base's top, away from the body's foot buried in it (within 2.1 mm of the middle). */
function ofDisc(t: number): boolean {
  const [x, , z] = centroid(t);
  for (let corner = 0; corner < 3; corner++)
    if (table.positions[table.indices[t * 3 + corner]! * 3 + 1]! > BASE_TOP_MM + BAND_MM)
      return false;
  return Math.hypot(x, z) > 3;
}

describe('fillRegion', () => {
  it('matches edges across the unwrap’s seams', () => {
    // Every triangle of a closed shell has three neighbours, though the unwrap split its vertices.
    const triangles = table.indices.length / 3;
    let open = 0;
    for (let t = 0; t < triangles; t++)
      if (adjacency.start[t + 1]! - adjacency.start[t]! < 3) open++;
    expect(open / triangles).toBeLessThan(0.001);
  });

  it('keeps a fill on the base’s top off the figure', () => {
    const seed = nearest([9, BASE_TOP_MM, 0], (t) => upness(t) > 0.99);
    expect(centroid(seed)[1]).toBeCloseTo(BASE_TOP_MM, 1);
    for (const tolerance of [0, 0.5, 1]) {
      const region = fillRegion(
        table,
        { kind: 'picked', triangle: seed, point: centroid(seed) },
        {
          tolerance,
          adjacency,
        },
      );
      expect(region.length).toBeGreaterThan(20);
      for (const t of region) expect(centroid(t)[1]).toBeLessThanOrEqual(BASE_TOP_MM + BAND_MM);
    }
  });

  it('keeps a fill on the figure’s chest off the base, and grows with the tolerance', () => {
    // The body: an ellipsoid 4 mm deep in z, its middle 14 mm up.
    const seed = nearest([0, 14, 4], (t) => adjacency.faceNormals[t * 3 + 2]! > 0.5);
    let before = 0;
    for (const tolerance of [0, 0.5, 1]) {
      const region = fillRegion(
        table,
        { kind: 'picked', triangle: seed, point: centroid(seed) },
        {
          tolerance,
          adjacency,
        },
      );
      expect(region).toContain(seed);
      for (const t of region) expect(ofDisc(t)).toBe(false);
      expect(region.length).toBeGreaterThanOrEqual(before);
      before = region.length;
    }
  });

  it('stops at a fold sharper than its bound', () => {
    // Two squares folded along x = 0: the angle between their faces is 60°.
    const fold = (deg: number): IndexedMesh => {
      const rad = (deg * Math.PI) / 180;
      const [cx, cy] = [Math.cos(rad), Math.sin(rad)];
      return {
        positions: new Float32Array([0, 0, 0, 0, 0, 1, -1, 0, 0, -1, 0, 1, cx, cy, 0, cx, cy, 1]),
        indices: new Uint32Array([0, 1, 3, 0, 3, 2, 0, 4, 5, 0, 5, 1]),
      };
    };
    const seed: FillSeed = { kind: 'picked', triangle: 0, point: [0, 0, 0] };
    // 60° between the faces: past the bound at tolerance 0 (40°), within it at 1 (80°).
    expect([...fillRegion(fold(60), seed, { tolerance: 0 })]).toEqual([0, 1]);
    expect([...fillRegion(fold(60), seed, { tolerance: 1 })]).toEqual([0, 1, 2, 3]);
    // The same flat sheet with a crease in the cavity along the fold's corners.
    const flat = { ...fold(0), cavity: new Float32Array([-0.12, -0.12, 0, 0, 0, 0]) };
    expect([...fillRegion(flat, seed, { tolerance: 0 })]).toEqual([0, 1]);
    expect([...fillRegion(flat, seed, { tolerance: 1 })]).toEqual([0, 1, 2, 3]);
  });

  it('stops at triangles the mask cuts, and fills nothing from one (#138)', () => {
    // A strip of four squares along x: cut the second, and a fill from the first stays on it.
    const positions: number[] = [];
    for (let k = 0; k <= 4; k++) positions.push(k, 0, 0, k, 0, 1);
    const indices: number[] = [];
    for (let k = 0; k < 4; k++) {
      const [a, b, c, d] = [k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 3];
      indices.push(a, b, d, a, d, c);
    }
    const strip: IndexedMesh = {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    };
    const seed: FillSeed = { kind: 'picked', triangle: 0, point: [0.2, 0, 0.5] };
    expect(fillRegion(strip, seed, { tolerance: 0 }).length).toBe(8);
    const cut = new Uint8Array(8);
    cut[2] = cut[3] = 1;
    expect([...fillRegion(strip, seed, { tolerance: 0, cut })]).toEqual([0, 1]);
    expect([...fillRegion(strip, { ...seed, triangle: 6 }, { tolerance: 0, cut })]).toEqual([
      4, 5, 6, 7,
    ]);
    expect([...fillRegion(strip, { ...seed, triangle: 2 }, { tolerance: 0, cut })]).toEqual([]);
    expect(() => fillRegion(strip, seed, { tolerance: 0, cut: new Uint8Array(3) })).toThrow(
      RangeError,
    );
  });

  it('cuts the figure’s hand off at a masked band across its arm (#138)', () => {
    // The chest's fill at tolerance 1, then again with a band of triangles cut across the body
    // 12–13 mm up: what lies above the band on the far side is no longer reached.
    const seed = nearest([0, 14, 4], (t) => adjacency.faceNormals[t * 3 + 2]! > 0.5);
    const picked: FillSeed = { kind: 'picked', triangle: seed, point: centroid(seed) };
    const whole = fillRegion(table, picked, { tolerance: 1, adjacency });
    const cut = new Uint8Array(table.indices.length / 3);
    for (let t = 0; t < cut.length; t++) {
      const y = centroid(t)[1];
      if (y > 11 && y < 12.5) cut[t] = 1;
    }
    const cutRegion = fillRegion(table, picked, { tolerance: 1, adjacency, cut });
    expect(cutRegion.length).toBeLessThan(whole.length);
    expect(cutRegion.length).toBeGreaterThan(20);
    for (const t of cutRegion) {
      expect(cut[t]).toBe(0);
      expect(centroid(t)[1]).toBeGreaterThan(11);
    }
  });

  it('takes a ready region whole, and refuses one the mini does not have', () => {
    const base = new Uint8Array(table.indices.length / 3);
    for (let t = 0; t < base.length; t++) base[t] = ofDisc(t) ? 1 : 0;
    const regions = { base, method: 'disc' } as const;
    const onBase = fillRegion(table, { kind: 'base' }, { tolerance: 0, regions });
    const onFigure = fillRegion(table, { kind: 'figure' }, { tolerance: 0, regions });
    expect(onBase.length + onFigure.length).toBe(base.length);
    for (const t of onBase) expect(base[t]).toBe(1);
    expect(() => fillRegion(table, { kind: 'base' }, { tolerance: 0 })).toThrow(RangeError);
  });
});
