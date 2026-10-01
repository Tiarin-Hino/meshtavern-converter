import { describe, expect, it } from 'vitest';
import { TriangleBvh, type SurfaceHit } from './bvh';
import { generateRecessBase } from '../../regression/shapes';
import { generateBumpySheet } from './generate';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';

const sheet: IndexedMesh = weldVertices(generateBumpySheet(40)).mesh;
sheet.normals = computeVertexNormals(sheet);
const bvh = new TriangleBvh(sheet);
const newHit = (): SurfaceHit => ({ triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity });

/** The point a hit describes, from its triangle and weights. */
function pointOf(mesh: IndexedMesh, hit: SurfaceHit): [number, number, number] {
  const corners = [0, 1, 2].map((corner) => mesh.indices[hit.triangle * 3 + corner]! * 3);
  return [0, 1, 2].map(
    (axis) =>
      mesh.positions[corners[0]! + axis]! * hit.u +
      mesh.positions[corners[1]! + axis]! * hit.v +
      mesh.positions[corners[2]! + axis]! * hit.w,
  ) as [number, number, number];
}

/** Reference answer: every triangle, sampled densely. Slow and approximate, but obviously right. */
function bruteForceDistanceSquared(mesh: IndexedMesh, p: number[]): number {
  let best = Infinity;
  const steps = 24;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) => mesh.indices[t + corner]! * 3);
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const v = i / steps;
        const w = j / steps;
        const u = 1 - v - w;
        let d = 0;
        for (let axis = 0; axis < 3; axis++) {
          const q =
            mesh.positions[a! + axis]! * u +
            mesh.positions[b! + axis]! * v +
            mesh.positions[c! + axis]! * w;
          d += (q - p[axis]!) ** 2;
        }
        if (d < best) best = d;
      }
    }
  }
  return best;
}

describe('TriangleBvh.closest', () => {
  it('matches a brute-force search for points around the surface', () => {
    const hit = newHit();
    // A deterministic scatter of points above, below and beside the 50 mm sheet.
    for (let k = 0; k < 40; k++) {
      const p = [((k * 37) % 61) - 5, ((k * 53) % 59) - 4, ((k * 17) % 13) - 3];
      bvh.closest(hit, p[0]!, p[1]!, p[2]!, Infinity);
      expect(hit.triangle).toBeGreaterThanOrEqual(0);
      const reference = bruteForceDistanceSquared(sheet, p);
      // The reference only samples the triangles, so it can be slightly further, never nearer.
      expect(hit.distanceSquared).toBeLessThanOrEqual(reference + 1e-9);
      expect(Math.sqrt(hit.distanceSquared)).toBeGreaterThan(Math.sqrt(reference) - 0.06);
    }
  });

  it('returns weights that reproduce the closest point', () => {
    const hit = bvh.closest(newHit(), 20.3, 31.7, 9, Infinity);
    expect(hit.u + hit.v + hit.w).toBeCloseTo(1, 6);
    expect(Math.min(hit.u, hit.v, hit.w)).toBeGreaterThanOrEqual(-1e-9);
    const q = pointOf(sheet, hit);
    const d = (q[0] - 20.3) ** 2 + (q[1] - 31.7) ** 2 + (q[2] - 9) ** 2;
    expect(d).toBeCloseTo(hit.distanceSquared, 6);
  });

  it('finds a point on the surface at distance zero', () => {
    const v = 500 * 3;
    const hit = bvh.closest(
      newHit(),
      sheet.positions[v]!,
      sheet.positions[v + 1]!,
      sheet.positions[v + 2]!,
      Infinity,
    );
    expect(hit.distanceSquared).toBeCloseTo(0, 10);
  });

  it('respects the distance limit', () => {
    expect(bvh.closest(newHit(), 25, 25, 100, 4).triangle).toBe(-1);
    expect(bvh.closest(newHit(), 25, 25, 100, 100 * 100).triangle).toBeGreaterThanOrEqual(0);
  });

  it('ignores surface that faces the other way', () => {
    // The sheet faces +z. Asked for surface facing -z, there is none.
    const away = { nx: 0, ny: 0, nz: -1, minAgreement: 0.2 };
    const towards = { nx: 0, ny: 0, nz: 1, minAgreement: 0.2 };
    expect(bvh.closest(newHit(), 25, 25, 4, Infinity, away).triangle).toBe(-1);
    expect(bvh.closest(newHit(), 25, 25, 4, Infinity, towards).triangle).toBeGreaterThanOrEqual(0);
  });

  it('gives the same answer with a hint, right or wrong', () => {
    const plain = { ...bvh.closest(newHit(), 12.1, 40.2, 6, Infinity) };
    const goodHint = { ...bvh.closest(newHit(), 12.1, 40.2, 6, Infinity, null, plain.triangle) };
    const badHint = { ...bvh.closest(newHit(), 12.1, 40.2, 6, Infinity, null, 0) };
    expect(goodHint.distanceSquared).toBeCloseTo(plain.distanceSquared, 10);
    expect(badHint.distanceSquared).toBeCloseTo(plain.distanceSquared, 10);
  });

  it('handles an empty mesh', () => {
    const empty = new TriangleBvh({ positions: new Float32Array(0), indices: new Uint32Array(0) });
    expect(empty.closest(newHit(), 0, 0, 0, Infinity).triangle).toBe(-1);
  });
});

/** A deterministic stream of numbers in [0, 1): the same 200 rays and balls on every machine. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Every triangle tested against the ray (Möller–Trumbore, both sides): the reference for `raycast`. */
function bruteRaycast(
  mesh: IndexedMesh,
  origin: [number, number, number],
  d: [number, number, number],
): { triangle: number; t: number } | null {
  let best: { triangle: number; t: number } | null = null;
  const p = mesh.positions;
  const sub = (i: number, j: number): number[] =>
    [0, 1, 2].map((k) => p[i * 3 + k]! - p[j * 3 + k]!);
  const crossOf = (a: number[], b: number[]): number[] => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dotOf = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t * 3 + k]!) as [number, number, number];
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const h = crossOf(d, e2);
    const det = dotOf(e1, h);
    if (det === 0) continue;
    const s = [0, 1, 2].map((k) => origin[k]! - p[a * 3 + k]!);
    const u = dotOf(s, h) / det;
    const q = crossOf(s, e1);
    const v = dotOf(d, q) / det;
    const at = dotOf(e2, q) / det;
    if (u < 0 || v < 0 || u + v > 1 || at < 0) continue;
    if (!best || at < best.t) best = { triangle: t, t: at };
  }
  return best;
}

describe('TriangleBvh.raycast and within', { timeout: 30_000 }, () => {
  const recess = weldVertices(generateRecessBase()).mesh;
  const meshes: [string, IndexedMesh][] = [
    ['bumpy sheet', weldVertices(generateBumpySheet(12)).mesh],
    ['recess base', recess],
  ];

  for (const [name, mesh] of meshes) {
    const tree = new TriangleBvh(mesh);
    const box = [0, 1, 2].map((axis) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = axis; i < mesh.positions.length; i += 3) {
        lo = Math.min(lo, mesh.positions[i]!);
        hi = Math.max(hi, mesh.positions[i]!);
      }
      return [lo, hi] as const;
    });

    it(`hits the nearest triangle a ray meets on the ${name}, as brute force does`, () => {
      const random = seeded(7);
      // Every ray against every triangle by brute force: 80 rays keep it quick.
      const rays = 80;
      let hits = 0;
      for (let k = 0; k < rays; k++) {
        const target = box.map(([lo, hi]) => lo + (hi - lo) * random()) as [number, number, number];
        const origin = box.map(([lo, hi]) => lo - 20 + (hi - lo + 40) * random()) as [
          number,
          number,
          number,
        ];
        const direction: [number, number, number] = [
          target[0] - origin[0],
          target[1] - origin[1],
          target[2] - origin[2],
        ];
        const hit = tree.raycast(origin, direction);
        const reference = bruteRaycast(mesh, origin, direction);
        if (!reference) {
          expect(hit).toBeNull();
          continue;
        }
        hits++;
        expect(hit).not.toBeNull();
        expect(hit!.t).toBeCloseTo(reference.t, 9);
      }
      expect(hits).toBeGreaterThan(rays / 4);
    });

    it(`finds every triangle whose centroid is within a ball on the ${name}`, () => {
      const random = seeded(11);
      for (let k = 0; k < 200; k++) {
        const centre = box.map(([lo, hi]) => lo + (hi - lo) * random()) as [number, number, number];
        const radius = 0.5 + 6 * random();
        const found: number[] = [];
        tree.within(centre[0], centre[1], centre[2], radius, (t) => found.push(t));
        const expected: number[] = [];
        for (let t = 0; t < mesh.indices.length / 3; t++) {
          let d2 = 0;
          for (let axis = 0; axis < 3; axis++) {
            const g =
              (mesh.positions[mesh.indices[t * 3]! * 3 + axis]! +
                mesh.positions[mesh.indices[t * 3 + 1]! * 3 + axis]! +
                mesh.positions[mesh.indices[t * 3 + 2]! * 3 + axis]!) /
              3;
            d2 += (g - centre[axis]!) ** 2;
          }
          if (d2 <= radius * radius) expected.push(t);
        }
        expect(found.sort((a, b) => a - b)).toEqual(expected);
      }
    });
  }

  it('misses with a ray that points away, or runs beside the mesh', () => {
    const tree = new TriangleBvh(recess);
    expect(tree.raycast([0, 0, 50], [0, 0, 1])).toBeNull();
    expect(tree.raycast([100, 0, 2], [0, 1, 0])).toBeNull();
    // Straight down onto the recess floor, 3 mm above the 4 mm base: the floor at z = 3.
    const hit = tree.raycast([0, 0, 50], [0, 0, -1]);
    expect(hit!.t).toBeCloseTo(47, 5);
  });

  it('answers nothing on a mesh without triangles', () => {
    const empty = new TriangleBvh({ positions: new Float32Array(0), indices: new Uint32Array(0) });
    expect(empty.raycast([0, 0, 0], [0, 0, 1])).toBeNull();
    const found: number[] = [];
    empty.within(0, 0, 0, 10, (t) => found.push(t));
    expect(found).toEqual([]);
  });
});
