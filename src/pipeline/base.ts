import { weldVertices, type IndexedMesh } from './mesh';
import type { BaseMeasurement } from './size';

/** A face counts as part of the underside when its normal is within 10° of straight down. */
export const FLAT_ANGLE_COS = Math.cos((10 * Math.PI) / 180);
/** ...and when it lies within this share of the mesh's height from the lowest point. */
export const RESTING_BAND = 0.02;
/**
 * The underside must cover at least this share of the footprint to count as a base.
 * Feet and cloak hems touch the ground with far less.
 */
export const MIN_BASE_COVERAGE = 0.15;

/** A base is round when its width and depth differ by at most this share of the larger. _(proposal)_ */
export const ROUND_ASPECT = 0.1;
/**
 * ...and when the area inside its outline is within this share of the circle's area on
 * the mean of width and depth, either way. A square of the same width has 127 % of the
 * circle's area, an octagon 90 %. _(proposal)_
 */
export const ROUND_FILL = 0.85;

/** A base as measured, with where its centre is in the mesh's x and z. */
export interface MeasuredBase extends BaseMeasurement {
  centre: [number, number];
}

/** Area of the convex hull of points given as x, z pairs (Andrew's monotone chain). */
export function convexHullArea(xz: Float64Array): number {
  const count = xz.length / 2;
  if (count < 3) return 0;
  const order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => xz[a * 2]! - xz[b * 2]! || xz[a * 2 + 1]! - xz[b * 2 + 1]!);
  const cross = (o: number, a: number, b: number): number =>
    (xz[a * 2]! - xz[o * 2]!) * (xz[b * 2 + 1]! - xz[o * 2 + 1]!) -
    (xz[a * 2 + 1]! - xz[o * 2 + 1]!) * (xz[b * 2]! - xz[o * 2]!);
  const hull: number[] = [];
  for (const pass of [order, [...order].reverse()]) {
    const start = hull.length;
    for (const point of pass) {
      while (
        hull.length >= start + 2 &&
        cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0
      )
        hull.pop();
      hull.push(point);
    }
    hull.pop();
  }
  let twice = 0;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k]!;
    const b = hull[(k + 1) % hull.length]!;
    twice += xz[a * 2]! * xz[b * 2 + 1]! - xz[b * 2]! * xz[a * 2 + 1]!;
  }
  return Math.abs(twice) / 2;
}

/**
 * Measures the base of a mesh that stands Y-up on y = 0 (after `orientAndPlace`). A base
 * is there when the faces pointing straight down on the lowest plane cover at least
 * `MIN_BASE_COVERAGE` of the footprint, the test the up detection uses. Its footprint is
 * the x/z extent of the vertices within `RESTING_BAND` of the floor. Null without a base.
 */
export function measureBase({ positions, indices }: IndexedMesh): MeasuredBase | null {
  if (positions.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i]!;
    if (value < min[i % 3]!) min[i % 3] = value;
    if (value > max[i % 3]!) max[i % 3] = value;
  }
  const floor = min[1]!;
  const band = (max[1]! - floor) * RESTING_BAND;

  let resting = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const doubleArea = Math.hypot(nx, ny, nz);
    if (doubleArea === 0 || ny / doubleArea > -FLAT_ANGLE_COS) continue;
    const centre = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3;
    if (centre - floor <= band) resting += doubleArea / 2;
  }
  const footprintArea = (max[0]! - min[0]!) * (max[2]! - min[2]!);
  const coverage = footprintArea > 0 ? resting / footprintArea : 0;
  if (coverage < MIN_BASE_COVERAGE) return null;

  let count = 0;
  for (let i = 1; i < positions.length; i += 3) if (positions[i]! - floor <= band) count++;
  const xz = new Float64Array(count * 2);
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0, o = 0; i < positions.length; i += 3) {
    if (positions[i + 1]! - floor > band) continue;
    const x = positions[i]!;
    const z = positions[i + 2]!;
    xz[o++] = x;
    xz[o++] = z;
    if (x < lo[0]!) lo[0] = x;
    if (x > hi[0]!) hi[0] = x;
    if (z < lo[1]!) lo[1] = z;
    if (z > hi[1]!) hi[1] = z;
  }
  const width = hi[0]! - lo[0]!;
  const depth = hi[1]! - lo[1]!;
  const longer = Math.max(width, depth);
  const mean = (width + depth) / 2;
  const fill = convexHullArea(xz) / ((Math.PI * mean * mean) / 4);
  const round =
    longer > 0 &&
    longer - Math.min(width, depth) <= longer * ROUND_ASPECT &&
    fill >= ROUND_FILL &&
    fill <= 1 / ROUND_FILL;

  return {
    shape: round ? 'round' : 'other',
    diameterMm: round ? mean : longer,
    footprintMm: [width, depth],
    coverage,
    centre: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2],
  };
}

export type Vec3 = [number, number, number];

/** Appends a triangle, turned so that it faces away from `inside`. */
export function pushOutward(soup: number[], a: Vec3, b: Vec3, c: Vec3, inside: Vec3): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const facing =
    (uy * vz - uz * vy) * (a[0] - inside[0]) +
    (uz * vx - ux * vz) * (a[1] - inside[1]) +
    (ux * vy - uy * vx) * (a[2] - inside[2]);
  if (facing >= 0) soup.push(...a, ...b, ...c);
  else soup.push(...a, ...c, ...b);
}

/**
 * A round base standing on z = 0, as a Z-up triangle soup: flat underside, flat top,
 * straight wall. Only + - * / and sqrt, so it has the same bits on every machine (the
 * regression shapes in src/regression/shapes.ts use it).
 * 4 × cells² + 8 × cells triangles.
 */
export function addRoundBase(
  soup: number[],
  centre: [number, number],
  diameterMm: number,
  heightMm: number,
  cells: number,
): void {
  const radius = diameterMm / 2;
  // Squeezes the square grid into a disc: every ring of the grid becomes a circle.
  const onDisc = (i: number, j: number): [number, number] => {
    const u = -1 + (2 * i) / cells;
    const v = -1 + (2 * j) / cells;
    const ring = Math.max(Math.abs(u), Math.abs(v));
    if (ring === 0) return [centre[0], centre[1]];
    const scale = (ring * radius) / Math.sqrt(u * u + v * v);
    return [centre[0] + u * scale, centre[1] + v * scale];
  };
  const inside: Vec3 = [centre[0], centre[1], heightMm / 2];
  for (const z of [0, heightMm]) {
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const [ax, ay] = onDisc(i, j);
        const [bx, by] = onDisc(i + 1, j);
        const [cx, cy] = onDisc(i + 1, j + 1);
        const [dx, dy] = onDisc(i, j + 1);
        pushOutward(soup, [ax, ay, z], [bx, by, z], [cx, cy, z], inside);
        pushOutward(soup, [ax, ay, z], [cx, cy, z], [dx, dy, z], inside);
      }
    }
  }
  // The wall follows the outermost ring of the grid, once around.
  const rim: [number, number][] = [];
  for (let i = 0; i < cells; i++) rim.push(onDisc(i, 0));
  for (let j = 0; j < cells; j++) rim.push(onDisc(cells, j));
  for (let i = cells; i > 0; i--) rim.push(onDisc(i, cells));
  for (let j = cells; j > 0; j--) rim.push(onDisc(0, j));
  for (let k = 0; k < rim.length; k++) {
    const [ax, ay] = rim[k]!;
    const [bx, by] = rim[(k + 1) % rim.length]!;
    pushOutward(soup, [ax, ay, 0], [bx, by, 0], [bx, by, heightMm], inside);
    pushOutward(soup, [ax, ay, 0], [bx, by, heightMm], [ax, ay, heightMm], inside);
  }
}

/** Height of the plain base the converter adds. _(proposal)_ */
export const PLAIN_BASE_HEIGHT_MM = 3;
/** Rough length of one segment of the plain base's rim. */
const PLAIN_BASE_SEGMENT_MM = 1;

/**
 * A plain round base, Y-up, standing on y = 0 and centred on the origin: the base for a
 * mini that came without one. Its rim has segments of about `PLAIN_BASE_SEGMENT_MM`.
 */
export function generatePlainBase(
  diameterMm: number,
  heightMm: number = PLAIN_BASE_HEIGHT_MM,
): IndexedMesh {
  const cells = Math.max(2, Math.ceil((Math.PI * diameterMm) / (4 * PLAIN_BASE_SEGMENT_MM)));
  const soup: number[] = [];
  addRoundBase(soup, [0, 0], diameterMm, heightMm, cells);
  const yUp = new Float32Array(soup.length);
  // Z-up to Y-up as orient.ts turns a +z file: (x, y, z) → (x, z, -y).
  for (let i = 0; i < soup.length; i += 3) {
    yUp[i] = soup[i]!;
    yUp[i + 1] = soup[i + 2]!;
    yUp[i + 2] = 0 - soup[i + 1]!;
  }
  return weldVertices(yUp).mesh;
}

/** The mini with a base under it: the mini is lifted by the base's height, the base appended. */
export function standOnBase(mini: IndexedMesh, base: IndexedMesh, heightMm: number): IndexedMesh {
  const count = mini.positions.length;
  const positions = new Float32Array(count + base.positions.length);
  for (let i = 0; i < count; i += 3) {
    positions[i] = mini.positions[i]!;
    positions[i + 1] = mini.positions[i + 1]! + heightMm;
    positions[i + 2] = mini.positions[i + 2]!;
  }
  positions.set(base.positions, count);
  const indices = new Uint32Array(mini.indices.length + base.indices.length);
  indices.set(mini.indices);
  const offset = count / 3;
  for (let i = 0; i < base.indices.length; i++)
    indices[mini.indices.length + i] = base.indices[i]! + offset;
  return { positions, indices };
}
