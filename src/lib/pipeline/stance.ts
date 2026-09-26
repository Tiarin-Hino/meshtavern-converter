/**
 * How a mini rests on its lowest points (issue #72, design note docs/design/figure-stands-upright.md).
 *
 * A mini resting on a floor touches it with a facet of its convex hull. `restingFacet`
 * finds the facet it lands on when dropped from a direction, without building the hull;
 * `setDown` uses it to level a mini the user has turned. Story 10 (#70) finds the feet with
 * `restingPoints`.
 *
 * Deterministic: only + - * / and sqrt, so every machine finds the same facet.
 *
 * The design's stance score for minis without a base (sampling, 216 drop directions,
 * support, margin and the other features) was built and measured on the corpus, and did
 * not stand the minis up; it was taken out again (PR #79, commit dfd9c95 has it).
 */
import type { Vec3 } from './base';
import { cross, dot, normalise } from './rotation';

/**
 * Two slopes this close count as equal when a facet is gift-wrapped; the farther point
 * wins, so a flat pad gives a long edge. A slope is the tangent of the tilt, so this is
 * about 0.06° for small tilts. _(proposal)_
 */
export const SLOPE_EPS = 1e-3;

export interface Facet {
  /** Unit normal of the resting plane, pointing into the mini: the up direction of this stance. */
  up: Vec3;
  /** The three points (indices into the point list) the plane touches; -1 where fewer exist. */
  corners: [number, number, number];
}

/** x, y, z per point: a sample, or all vertices of a mesh. */
export type Points = Float32Array | Float64Array;

/**
 * The plane a mini lands on when dropped along `down` and allowed to settle on one facet:
 * the hull facet next to the lowest point whose normal is closest to straight up. Found by
 * gift-wrapping: p0 is the lowest point; the plane through p0 is tilted about a level axis
 * until it touches p1; then turned about the edge p0–p1 until it touches p2. Slopes within
 * `SLOPE_EPS` of the least go to the farthest point. Five passes over the points, no
 * allocation per point.
 *
 * @param down Unit direction the mini is dropped along.
 */
export function restingFacet(points: Points, down: Vec3): Facet {
  const count = points.length / 3;
  const up0: Vec3 = [0 - down[0], 0 - down[1], 0 - down[2]];
  let p0 = -1;
  let lowest = Infinity;
  for (let i = 0; i < count; i++) {
    const h = points[i * 3]! * up0[0] + points[i * 3 + 1]! * up0[1] + points[i * 3 + 2]! * up0[2];
    if (h < lowest) {
      lowest = h;
      p0 = i;
    }
  }
  if (p0 < 0) return { up: up0, corners: [-1, -1, -1] };
  const origin: Vec3 = [points[p0 * 3]!, points[p0 * 3 + 1]!, points[p0 * 3 + 2]!];

  // p1: the least slope rising from p0, rise over level distance.
  const p1 = leastSlope(points, origin, up0, null, [p0]);
  if (p1 === null) return { up: up0, corners: [p0, -1, -1] };

  const edge: Vec3 = [
    points[p1 * 3]! - origin[0],
    points[p1 * 3 + 1]! - origin[1],
    points[p1 * 3 + 2]! - origin[2],
  ];
  const rise = dot(edge, up0);
  const levelEdge: Vec3 = [
    edge[0] - rise * up0[0],
    edge[1] - rise * up0[1],
    edge[2] - rise * up0[2],
  ];
  // The plane holds the edge and the level axis at right angles to it.
  let up1 = normalise(cross(edge, cross(up0, levelEdge)));
  if (dot(up1, up0) < 0) up1 = [0 - up1[0], 0 - up1[1], 0 - up1[2]];

  // p2: the least turn about the edge, to either side.
  const p2 = leastSlope(points, origin, up1, cross(up1, normalise(edge)), [p0, p1]);
  if (p2 === null) return { up: up1, corners: [p0, p1, -1] };

  const third: Vec3 = [
    points[p2 * 3]! - origin[0],
    points[p2 * 3 + 1]! - origin[1],
    points[p2 * 3 + 2]! - origin[2],
  ];
  let up2 = normalise(cross(edge, third));
  if (dot(up2, up1) < 0) up2 = [0 - up2[0], 0 - up2[1], 0 - up2[2]];
  return { up: up2, corners: [p0, p1, p2] };
}

/**
 * The point with the least slope seen from `origin`: its height along `up` over its
 * distance across. Across is the level distance when `across` is null (tilting a plane
 * about a level axis), else the distance along `across` to either side (turning a plane
 * about an edge). Among slopes within `SLOPE_EPS` of the least, the farthest; two passes,
 * so that near-ties cannot drift. Null when no point has a distance across.
 */
function leastSlope(
  points: Points,
  origin: Vec3,
  up: Vec3,
  across: Vec3 | null,
  skip: readonly number[],
): number | null {
  const count = points.length / 3;
  const distance = new Float64Array(1);
  const slopeOf = (i: number): number => {
    const dx = points[i * 3]! - origin[0];
    const dy = points[i * 3 + 1]! - origin[1];
    const dz = points[i * 3 + 2]! - origin[2];
    const height = dx * up[0] + dy * up[1] + dz * up[2];
    let side: number;
    if (across) {
      side = Math.abs(dx * across[0] + dy * across[1] + dz * across[2]);
    } else {
      const level2 = dx * dx + dy * dy + dz * dz - height * height;
      side = level2 > 0 ? Math.sqrt(level2) : 0;
    }
    distance[0] = side;
    return side > 0 ? height / side : Infinity;
  };
  let least = Infinity;
  for (let i = 0; i < count; i++) {
    const slope = slopeOf(i);
    if (slope < least && !skip.includes(i)) least = slope;
  }
  if (least === Infinity) return null;
  let best = -1;
  let farthest = -1;
  for (let i = 0; i < count; i++) {
    const slope = slopeOf(i);
    if (slope <= least + SLOPE_EPS && distance[0]! > farthest && !skip.includes(i)) {
      farthest = distance[0]!;
      best = i;
    }
  }
  return best;
}

/**
 * The points that rest on the floor when up is `up`: within `band` (a share of the
 * height along `up`) of the lowest point. Indices into the point list. Story 10 (#70) finds
 * the feet with it.
 */
export function restingPoints(
  points: Float32Array | Float64Array,
  up: Vec3,
  band: number,
): number[] {
  const count = points.length / 3;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i++) {
    const h = points[i * 3]! * up[0] + points[i * 3 + 1]! * up[1] + points[i * 3 + 2]! * up[2];
    if (h < low) low = h;
    if (h > high) high = h;
  }
  const limit = low + (high - low) * band;
  const resting: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = points[i * 3]! * up[0] + points[i * 3 + 1]! * up[1] + points[i * 3 + 2]! * up[2];
    if (h <= limit) resting.push(i);
  }
  return resting;
}

/**
 * Sets a mini down on its lowest points: the resting facet of all vertices when dropped
 * along `down`. Its normal is the up direction that levels the resting plane.
 */
export function setDown(positions: Float32Array, down: Vec3): Vec3 {
  return restingFacet(positions, down).up;
}
