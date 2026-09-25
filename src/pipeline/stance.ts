/**
 * How a mini without a base stands (issue #72, design note docs/design/figure-stands-upright.md).
 *
 * A stance is a plane the mini can rest on, which is always a facet of its convex hull.
 * Rather than building the hull, the mini is set down from many directions and each time
 * lands on one facet (`restingFacet`). Each stance is then described by the signs a
 * resting creature shows (`stanceFeatures`): a wide cluster of lowest points, the volume
 * above the middle, the centre of mass inside the support.
 *
 * Deterministic: no random numbers, and only + - * / and sqrt in anything that decides
 * a direction, so every machine finds the same stance.
 */
import { convexHull, polygonArea2, type Vec3 } from './base';
import { cross, dot, normalise } from './rotation';

/** At most this many vertices are looked at when searching the stances. _(proposal)_ */
export const SAMPLE_VERTICES = 20_000;
/** Each face of the cube of directions is cut into this many cells a side: 6 × 6² = 216 directions about 14° apart. _(proposal)_ */
export const CANDIDATE_CELLS = 6;
/**
 * Two slopes this close count as equal when a facet is gift-wrapped; the farther point
 * wins, so a flat pad gives a long edge. A slope is the tangent of the tilt, so this is
 * about 0.06° for small tilts. _(proposal)_
 */
export const SLOPE_EPS = 1e-3;
/** Stances whose up directions lie within this angle are the same stance. _(proposal)_ */
export const MERGE_ANGLE_DEG = 2;
/** Points within this share of the height above the resting plane rest on it. _(proposal)_ */
export const SUPPORT_BAND = 0.05;
/** Score bonus when up is near the file's +z; half of it near +y. Only breaks ties. _(proposal)_ */
export const CONVENTION_BONUS = 0.05;
/** How near to +z or +y up must be for the convention bonus. _(proposal)_ */
export const CONVENTION_CONE_DEG = 15;

/** Every k-th vertex, k chosen so that at most `max` remain: a fair thinning of an even surface. */
export function sampleVertices(positions: Float32Array, max = SAMPLE_VERTICES): Float64Array {
  const vertices = positions.length / 3;
  const stride = Math.max(1, Math.ceil(vertices / max));
  const sample = new Float64Array(Math.ceil(vertices / stride) * 3);
  for (let v = 0, o = 0; v < vertices; v += stride, o += 3) {
    sample[o] = positions[v * 3]!;
    sample[o + 1] = positions[v * 3 + 1]!;
    sample[o + 2] = positions[v * 3 + 2]!;
  }
  return sample;
}

/**
 * Directions spread over the sphere: the centres of the cells of a cube's faces, pushed
 * onto the sphere (the same trick as `addBlob` in src/regression/shapes.ts).
 */
export function candidateDirections(cells = CANDIDATE_CELLS): Vec3[] {
  const directions: Vec3[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-1, 1]) {
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const cube: Vec3 = [0, 0, 0];
          cube[axis] = side;
          cube[(axis + 1) % 3] = -1 + (2 * i + 1) / cells;
          cube[(axis + 2) % 3] = -1 + (2 * j + 1) / cells;
          directions.push(normalise(cube));
        }
      }
    }
  }
  return directions;
}

export interface Facet {
  /** Unit normal of the resting plane, pointing into the mini: the up direction of this stance. */
  up: Vec3;
  /** The three points (indices into the point list) the plane touches; -1 where fewer exist. */
  corners: [number, number, number];
}

/**
 * The plane a mini lands on when dropped along `down` and allowed to settle on one facet:
 * the hull facet next to the lowest point whose normal is closest to straight up. Found by
 * gift-wrapping: p0 is the lowest point; the plane through p0 is tilted about a level axis
 * until it touches p1; then turned about the edge p0–p1 until it touches p2. Slopes within
 * `SLOPE_EPS` of the least go to the farthest point.
 *
 * @param points x, y, z per point.
 * @param down Unit direction the mini is dropped along.
 * @param scratch Two numbers per point, reused between calls to spare the allocation.
 */
export function restingFacet(
  points: Float64Array,
  down: Vec3,
  scratch: Float64Array = new Float64Array((points.length / 3) * 2),
): Facet {
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
  const x0 = points[p0 * 3]!;
  const y0 = points[p0 * 3 + 1]!;
  const z0 = points[p0 * 3 + 2]!;

  // p1: the least slope rising from p0, rise over level distance.
  for (let i = 0; i < count; i++) {
    const dx = points[i * 3]! - x0;
    const dy = points[i * 3 + 1]! - y0;
    const dz = points[i * 3 + 2]! - z0;
    const rise = dx * up0[0] + dy * up0[1] + dz * up0[2];
    const level2 = dx * dx + dy * dy + dz * dz - rise * rise;
    const level = level2 > 0 ? Math.sqrt(level2) : 0;
    scratch[i * 2] = level > 0 ? rise / level : Infinity;
    scratch[i * 2 + 1] = level;
  }
  scratch[p0 * 2] = Infinity;
  const p1 = leastSlope(scratch, count);
  if (p1 < 0) return { up: up0, corners: [p0, -1, -1] };

  const edge: Vec3 = [points[p1 * 3]! - x0, points[p1 * 3 + 1]! - y0, points[p1 * 3 + 2]! - z0];
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
  const across = cross(up1, normalise(edge));
  for (let i = 0; i < count; i++) {
    const dx = points[i * 3]! - x0;
    const dy = points[i * 3 + 1]! - y0;
    const dz = points[i * 3 + 2]! - z0;
    const side = Math.abs(dx * across[0] + dy * across[1] + dz * across[2]);
    const height = dx * up1[0] + dy * up1[1] + dz * up1[2];
    scratch[i * 2] = side > 0 ? height / side : Infinity;
    scratch[i * 2 + 1] = side;
  }
  scratch[p0 * 2] = Infinity;
  scratch[p1 * 2] = Infinity;
  const p2 = leastSlope(scratch, count);
  if (p2 < 0) return { up: up1, corners: [p0, p1, -1] };

  const third: Vec3 = [points[p2 * 3]! - x0, points[p2 * 3 + 1]! - y0, points[p2 * 3 + 2]! - z0];
  let up2 = normalise(cross(edge, third));
  if (dot(up2, up1) < 0) up2 = [0 - up2[0], 0 - up2[1], 0 - up2[2]];
  return { up: up2, corners: [p0, p1, p2] };
}

/**
 * The point with the least slope; among slopes within `SLOPE_EPS` of the least, the
 * farthest. Two passes, so that near-ties cannot drift. -1 when every slope is infinite
 * (all points on a vertical line, or on the edge).
 *
 * @param slopes Slope, then distance, per point.
 */
function leastSlope(slopes: Float64Array, count: number): number {
  let least = Infinity;
  for (let i = 0; i < count; i++) if (slopes[i * 2]! < least) least = slopes[i * 2]!;
  if (least === Infinity) return -1;
  let best = -1;
  let farthest = -1;
  for (let i = 0; i < count; i++) {
    if (slopes[i * 2]! <= least + SLOPE_EPS && slopes[i * 2 + 1]! > farthest) {
      farthest = slopes[i * 2 + 1]!;
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
 * How far a point lies inside a convex polygon: the distance to its nearest edge, negative
 * outside. A polygon of fewer than three corners, or no area, has no inside: the result is
 * minus the distance to its points and edges.
 *
 * @param xy x, y pairs.
 * @param polygon Indices into `xy`, counter-clockwise or clockwise.
 */
export function polygonMargin(
  xy: Float64Array,
  polygon: readonly number[],
  point: [number, number],
): number {
  const [px, py] = point;
  const area2 = polygonArea2(xy, polygon);
  if (polygon.length < 3 || area2 === 0) {
    let nearest = Infinity;
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k]!;
      const b = polygon[(k + 1) % polygon.length]!;
      nearest = Math.min(nearest, segmentDistance(xy, a, b, px, py));
    }
    return polygon.length === 0 ? -Infinity : 0 - nearest;
  }
  const turn = area2 > 0 ? 1 : -1;
  let margin = Infinity;
  for (let k = 0; k < polygon.length; k++) {
    const a = polygon[k]!;
    const b = polygon[(k + 1) % polygon.length]!;
    const ex = xy[b * 2]! - xy[a * 2]!;
    const ey = xy[b * 2 + 1]! - xy[a * 2 + 1]!;
    const length = Math.sqrt(ex * ex + ey * ey);
    if (length === 0) continue;
    // Positive on the inner side of the edge.
    const inside = (turn * (ex * (py - xy[a * 2 + 1]!) - ey * (px - xy[a * 2]!))) / length;
    if (inside < margin) margin = inside;
  }
  return margin;
}

function segmentDistance(xy: Float64Array, a: number, b: number, px: number, py: number): number {
  const ax = xy[a * 2]!;
  const ay = xy[a * 2 + 1]!;
  const ex = xy[b * 2]! - ax;
  const ey = xy[b * 2 + 1]! - ay;
  const length2 = ex * ex + ey * ey;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / length2)) : 0;
  const dx = px - (ax + t * ex);
  const dy = py - (ay + t * ey);
  return Math.sqrt(dx * dx + dy * dy);
}

/** What a stance looks like, by the signs of a resting creature. See the design note, §4.3. */
export interface StanceFeatures {
  /** Up direction in file coordinates. */
  up: Vec3;
  /** Area of the support polygon (the hull of the resting points) over the footprint's bounding rectangle. */
  support: number;
  /** How far the centroid lies inside the support polygon, in file units; negative outside. */
  margin: number;
  /** Tangent of the tilt the mini survives before it falls, clamped to 0–1. */
  tipping: number;
  /** Centroid height above the middle of the height, as a share of the height: −0.5 to 0.5. */
  aboveMiddle: number;
  /** Height along `up` over the longest side of the file's bounding box, at most 1. */
  heightShare: number;
  /** `CONVENTION_BONUS` near +z, half of it near +y, else 0. */
  convention: number;
}

const CONVENTION_COS = Math.cos((CONVENTION_CONE_DEG * Math.PI) / 180);

/** Two unit vectors at right angles to `n` and to each other, from the axis least aligned with it. */
export function planeBasis(n: Vec3): [Vec3, Vec3] {
  const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = normalise(cross(n, axis));
  return [u, cross(n, u)];
}

/**
 * The features of the stance with up direction `up` (unit, file coordinates), measured on
 * the sampled points.
 *
 * @param centroid The mini's centroid (`MeshScan.centroid`).
 * @param longestSide The longest side of the file's bounding box.
 */
export function stanceFeatures(
  points: Float64Array,
  up: Vec3,
  centroid: Vec3,
  longestSide: number,
): StanceFeatures {
  const count = points.length / 3;
  const [u, v] = planeBasis(up);
  let low = Infinity;
  let high = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    const h = x * up[0] + y * up[1] + z * up[2];
    const pu = x * u[0] + y * u[1] + z * u[2];
    const pv = x * v[0] + y * v[1] + z * v[2];
    if (h < low) low = h;
    if (h > high) high = h;
    if (pu < minU) minU = pu;
    if (pu > maxU) maxU = pu;
    if (pv < minV) minV = pv;
    if (pv > maxV) maxV = pv;
  }
  const height = high - low;
  const resting = restingPoints(points, up, SUPPORT_BAND);
  const plane = new Float64Array(resting.length * 2);
  resting.forEach((i, k) => {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    plane[k * 2] = x * u[0] + y * u[1] + z * u[2];
    plane[k * 2 + 1] = x * v[0] + y * v[1] + z * v[2];
  });
  const hull = convexHull(plane);
  const footprint = (maxU - minU) * (maxV - minV);
  const support = footprint > 0 ? Math.abs(polygonArea2(plane, hull)) / 2 / footprint : 0;

  const centroidHeight = dot(centroid, up);
  const margin = polygonMargin(plane, hull, [dot(centroid, u), dot(centroid, v)]);
  const lever = centroidHeight - low;
  const tipping = lever > 0 ? Math.min(1, Math.max(0, margin / lever)) : margin > 0 ? 1 : 0;
  const aboveMiddle = height > 0 ? (centroidHeight - (low + high) / 2) / height : 0;
  const heightShare = longestSide > 0 ? Math.min(1, height / longestSide) : 0;
  const convention =
    up[2] >= CONVENTION_COS ? CONVENTION_BONUS : up[1] >= CONVENTION_COS ? CONVENTION_BONUS / 2 : 0;
  return { up, support, margin, tipping, aboveMiddle, heightShare, convention };
}
