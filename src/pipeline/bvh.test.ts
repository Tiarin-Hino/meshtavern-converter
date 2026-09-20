import { describe, expect, it } from 'vitest';
import { TriangleBvh, type SurfaceHit } from './bvh';
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
