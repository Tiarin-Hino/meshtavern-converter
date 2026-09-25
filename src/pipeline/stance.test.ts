import { describe, expect, it } from 'vitest';
import type { Vec3 } from './base';
import { angleDeg, apply, fromAxisAngle, normalise } from './rotation';
import {
  candidateDirections,
  CANDIDATE_CELLS,
  planeBasis,
  polygonMargin,
  restingFacet,
  restingPoints,
  sampleVertices,
  stanceFeatures,
} from './stance';

/** Deterministic numbers in 0..1 (a linear congruential generator), for scattered points. */
function numbers(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Three feet on z = 0 and a cloud of points 1–10 mm above them. */
function tripod(): Vec3[] {
  const next = numbers(7);
  const points: Vec3[] = [
    [0, 0, 0],
    [12, 0, 0],
    [6, 10, 0],
  ];
  for (let k = 0; k < 300; k++) points.push([1 + next() * 10, 1 + next() * 8, 1 + next() * 9]);
  return points;
}

const flat = (points: Vec3[]): Float64Array => new Float64Array(points.flat());
const turned = (points: Vec3[], axis: Vec3, deg: number): Vec3[] =>
  points.map((p) => apply(fromAxisAngle(axis, deg), p));

describe('restingFacet', () => {
  it('finds a level tripod level, dropped from a slant', () => {
    const facet = restingFacet(flat(tripod()), normalise([0.2, -0.1, -1]));
    expect(angleDeg(facet.up, [0, 0, 1])).toBeLessThan(1e-9);
    expect([...facet.corners].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('gives the tilt of a tripod tilted by 10°', () => {
    const tilted = turned(tripod(), [1, 0, 0], 10);
    const facet = restingFacet(flat(tilted), [0, 0, -1]);
    expect(angleDeg(facet.up, [0, 0, 1])).toBeCloseTo(10, 9);
    expect(angleDeg(facet.up, apply(fromAxisAngle([1, 0, 0], 10), [0, 0, 1]))).toBeLessThan(1e-6);
  });

  it('takes the farthest point on a flat pad, so the edge is long', () => {
    const points: Vec3[] = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) points.push([i, j, 0]);
    points.push([5, 5, 8], [3, 4, 6]);
    const pad = flat(points);
    // Dropped straight down, every pad point ties at slope 0: the farthest, the far corner, wins.
    const facet = restingFacet(pad, [0, 0, -1]);
    expect(facet.up).toEqual([0, 0, 1]);
    const [p0, p1] = facet.corners;
    const length = Math.hypot(pad[p1 * 3]! - pad[p0 * 3]!, pad[p1 * 3 + 1]! - pad[p0 * 3 + 1]!);
    expect(length).toBeCloseTo(Math.SQRT2 * 10, 9);
  });

  it('points into the mini from whichever side it is dropped', () => {
    const points = flat(tripod());
    for (const down of candidateDirections(2)) {
      const { up } = restingFacet(points, down);
      // Every point lies on or above the plane through the lowest one.
      let low = Infinity;
      for (let i = 0; i < points.length; i += 3)
        low = Math.min(low, points[i]! * up[0] + points[i + 1]! * up[1] + points[i + 2]! * up[2]);
      const [p0] = restingFacet(points, down).corners;
      const h0 =
        points[p0 * 3]! * up[0] + points[p0 * 3 + 1]! * up[1] + points[p0 * 3 + 2]! * up[2];
      expect(h0 - low).toBeLessThan(0.05);
    }
  });

  it('copes with a single point and with points on a line', () => {
    expect(restingFacet(new Float64Array([1, 2, 3]), [0, 0, -1]).up).toEqual([0, 0, 1]);
    const line = restingFacet(new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), [0, 0, -1]);
    expect(line.corners[2]).toBe(-1);
  });
});

describe('candidateDirections', () => {
  it('spreads 216 unit directions over the whole sphere', () => {
    const directions = candidateDirections();
    expect(directions).toHaveLength(6 * CANDIDATE_CELLS ** 2);
    for (const d of directions) expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    for (const axis of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ] as Vec3[]) {
      const nearest = Math.min(...directions.map((d) => angleDeg(d, axis)));
      expect(nearest).toBeLessThan(15);
    }
  });
});

describe('sampleVertices', () => {
  it('keeps every k-th vertex, at most the number asked for', () => {
    const positions = new Float32Array(Array.from({ length: 30 }, (_, i) => i));
    expect(Array.from(sampleVertices(positions, 4))).toEqual([
      0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29,
    ]);
    expect(sampleVertices(positions, 100)).toHaveLength(30);
  });
});

describe('restingPoints', () => {
  it('lists the points within the band above the lowest', () => {
    const points = flat([
      [0, 0, 0],
      [1, 0, 0.4],
      [2, 0, 10],
      [3, 0, 0.6],
    ]);
    expect(restingPoints(points, [0, 0, 1], 0.05)).toEqual([0, 1]);
  });
});

describe('polygonMargin', () => {
  const square = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
  it('is the distance to the nearest edge inside', () => {
    expect(polygonMargin(square, [0, 1, 2, 3], [5, 5])).toBeCloseTo(5, 12);
    expect(polygonMargin(square, [0, 1, 2, 3], [1, 5])).toBeCloseTo(1, 12);
    // Clockwise works too.
    expect(polygonMargin(square, [3, 2, 1, 0], [1, 5])).toBeCloseTo(1, 12);
  });

  it('is negative outside', () => {
    expect(polygonMargin(square, [0, 1, 2, 3], [12, 5])).toBeCloseTo(-2, 12);
  });

  it('is minus the distance for a support that is only a line', () => {
    expect(polygonMargin(square, [0, 1], [5, 3])).toBeCloseTo(-3, 12);
  });
});

describe('stanceFeatures', () => {
  /** Four feet at the corners of a 20 mm square and a body above them. */
  const table = (): Vec3[] => {
    const points: Vec3[] = [];
    for (const [x, y] of [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ])
      for (let z = 0; z <= 10; z += 1) points.push([x!, y!, z]);
    for (let i = 0; i <= 20; i += 2) for (let j = 0; j <= 20; j += 2) points.push([i, j, 14]);
    return points;
  };

  it('gives four corner feet the whole square as support', () => {
    const features = stanceFeatures(flat(table()), [0, 0, 1], [10, 10, 12], 20);
    expect(features.support).toBeCloseTo(1, 9);
    expect(features.margin).toBeCloseTo(10, 9);
    // The centroid is 10 mm from every edge and 12 mm above the floor.
    expect(features.tipping).toBeCloseTo(10 / 12, 9);
  });

  it('sees the volume above the middle and the height share', () => {
    const features = stanceFeatures(flat(table()), [0, 0, 1], [10, 10, 12], 20);
    expect(features.aboveMiddle).toBeCloseTo(5 / 14, 9);
    expect(features.heightShare).toBeCloseTo(14 / 20, 9);
    expect(features.convention).toBeGreaterThan(0);
  });

  it('sees a point support and a centroid outside it on the tipped-over table', () => {
    // Lying on the edge of one foot: up is +x, the support is the foot's column.
    const features = stanceFeatures(flat(table()), [-1, 0, 0], [10, 10, 12], 20);
    expect(features.convention).toBe(0);
    expect(features.aboveMiddle).toBeCloseTo(0, 9);
  });

  it('builds a right-handed basis in the plane', () => {
    const n = normalise([0.3, 0.5, 0.8]);
    const [u, v] = planeBasis(n);
    expect(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]).toBeCloseTo(0, 12);
    expect(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]).toBeCloseTo(0, 12);
    expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0, 12);
  });
});
