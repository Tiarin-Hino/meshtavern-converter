/**
 * Marks where two parts meet (issue #93, design note docs/design/marks-where-parts-meet.md §3.1):
 * a point a person tapped on the full-detail mesh of one file, resolved to the surface there and
 * its normal. Two marks, a spot on the part in place and a contact on the part that goes there,
 * fix five of six degrees of freedom; the sixth is the turn about the spot's normal.
 *
 * Deterministic: only + - * / and sqrt on the geometry, so a mark resolves to the same bits on
 * every machine. The turn about the normal uses trigonometry, like every turn a person asks for.
 */
import type { Vec3 } from './base';
import type { IndexedMesh } from './mesh';
import { quarterTurnAxis, TO_Y_UP } from './orient';
import { apply, dot, fromAxisAngle, fromTo, multiply, normalise, type Rotation } from './rotation';

/** A point a person tapped on the full-detail mesh of one file, in that file's coordinates. */
export interface MarkPick {
  /** Which of the files given: 0 the first. */
  file: number;
  point: Vec3;
}

/** A mark as resolved: the surface point and the normal around it, in the frame stated where it is used. */
export interface Mark {
  point: Vec3;
  normal: Vec3;
}

/** Where two parts meet: a spot on the part already in place, a contact on the part that goes there. */
export interface Meeting {
  spot: MarkPick;
  contact: MarkPick;
  /** Along the spot's normal, positive away from its surface; 0 puts the two points together. */
  liftMm?: number;
  /** About the spot's normal, degrees, counter-clockwise seen from the spot's outside. */
  turnDeg?: number;
}

/** A part placed against another by a meeting: the tree of a figure's parts. */
export interface PartJoint extends Meeting {
  /** The part placed: a figure part that is not the body. */
  part: number;
  /** The part it is placed against: the body or a part already placed; `spot.file === onto`, `contact.file === part`. */
  onto: number;
}

/**
 * The normal of a mark is the area-weighted mean of the triangles whose centroid lies within
 * this distance of the point, file units... _(proposal)_
 */
export const MARK_NORMAL_RADIUS_MM = 1;
/**
 * ...and whose normal is within this angle of the nearest triangle's: the other wall of a thin
 * recess and the rim of a hole stay out. _(proposal)_
 */
export const MARK_NORMAL_CONE_DEG = 60;
/**
 * One answer at a meet question, resolved in the worker, on the largest corpus pair
 * (development PC, Node): a pass over the marked file's triangles and the figure's vertices.
 * `scripts/measure-place.mjs` measures it. _(proposal)_
 */
export const MARK_RESOLVE_BUDGET_MS = 300;

const CONE_COS = Math.cos((MARK_NORMAL_CONE_DEG * Math.PI) / 180);

/**
 * The squared distance from p to triangle a b c: to its closest point (Ericson, Real-Time
 * Collision Detection §5.1.5), in scalars so the pass over millions of triangles allocates nothing.
 */
function triangleDistance2(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number;
  let qy: number;
  let qz: number;
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax;
    qy = ay;
    qz = az;
  } else if (d3 >= 0 && d4 <= d3) {
    qx = bx;
    qy = by;
    qz = bz;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    qx = ax + v * abx;
    qy = ay + v * aby;
    qz = az + v * abz;
  } else if (d6 >= 0 && d5 <= d6) {
    qx = cx;
    qy = cy;
    qz = cz;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    qx = ax + w * acx;
    qy = ay + w * acy;
    qz = az + w * acz;
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    qx = bx + w * (cx - bx);
    qy = by + w * (cy - by);
    qz = bz + w * (cz - bz);
  } else {
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    qx = ax + abx * v + acx * w;
    qy = ay + aby * v + acy * w;
    qz = az + abz * v + acz * w;
  }
  const ex = qx - px;
  const ey = qy - py;
  const ez = qz - pz;
  return ex * ex + ey * ey + ez * ez;
}

const corner = (positions: Float32Array, index: number): Vec3 => [
  positions[index * 3]!,
  positions[index * 3 + 1]!,
  positions[index * 3 + 2]!,
];

/** A triangle's normal times twice its area, from its winding. */
function areaNormal(positions: Float32Array, indices: Uint32Array, t: number): Vec3 {
  const a = indices[t * 3]! * 3;
  const b = indices[t * 3 + 1]! * 3;
  const c = indices[t * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uy = positions[b + 1]! - positions[a + 1]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vy = positions[c + 1]! - positions[a + 1]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * The triangle nearest to a point, by the distance to its closest point, and triangles whose
 * centroid lies within `radius`: brute force, without a search tree. A pass over the vertices
 * first gives the distance to the nearest vertex, which no nearest triangle can exceed; the pass
 * over the triangles then skips every triangle whose bounding box is further than that, or
 * than the best so far, without the exact test. Ties go to the lower index, so a point on a
 * shared edge gets the first of its two triangles. -1 for a mesh without triangles.
 */
export function nearestTriangle(
  { positions, indices }: IndexedMesh,
  point: Vec3,
  radius = 0,
): { triangle: number; distance: number; near: number[] } {
  const [px, py, pz] = point;
  let best = -1;
  let bestD2 = Infinity;
  const near: number[] = [];
  const r2 = radius * radius;
  const count = indices.length / 3;
  // No triangle is nearer than its nearest corner: the nearest vertex bounds the search.
  let limit = Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    const dx = positions[v]! - px;
    const dy = positions[v + 1]! - py;
    const dz = positions[v + 2]! - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < limit) limit = d2;
  }
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const ax = positions[a]!;
    const bx = positions[b]!;
    const cx = positions[c]!;
    // The distance to the triangle's box is a lower bound of the distance to the triangle, and
    // of the distance to its centroid.
    const minX = ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx;
    const maxX = ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx;
    const dx = minX > px ? minX - px : px > maxX ? px - maxX : 0;
    const dx2 = dx * dx;
    if (dx2 > limit && dx2 > r2) continue;
    const ay = positions[a + 1]!;
    const by = positions[b + 1]!;
    const cy = positions[c + 1]!;
    const minY = ay < by ? (ay < cy ? ay : cy) : by < cy ? by : cy;
    const maxY = ay > by ? (ay > cy ? ay : cy) : by > cy ? by : cy;
    const dy = minY > py ? minY - py : py > maxY ? py - maxY : 0;
    const az = positions[a + 2]!;
    const bz = positions[b + 2]!;
    const cz = positions[c + 2]!;
    const minZ = az < bz ? (az < cz ? az : cz) : bz < cz ? bz : cz;
    const maxZ = az > bz ? (az > cz ? az : cz) : bz > cz ? bz : cz;
    const dz = minZ > pz ? minZ - pz : pz > maxZ ? pz - maxZ : 0;
    const box2 = dx2 + dy * dy + dz * dz;
    if (radius > 0 && box2 <= r2) {
      const gx = (ax + bx + cx) / 3 - px;
      const gy = (ay + by + cy) / 3 - py;
      const gz = (az + bz + cz) / 3 - pz;
      if (gx * gx + gy * gy + gz * gz <= r2) near.push(t);
    }
    if (box2 > limit || box2 >= bestD2) continue;
    const d2 = triangleDistance2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = t;
    }
  }
  return { triangle: best, distance: Math.sqrt(bestD2), near };
}

/**
 * A mark on a mesh (design note §3.1): the point kept as picked, never snapped, and the normal
 * of the surface around it: the area-weighted mean of the normals of the triangles whose
 * centroid lies within `MARK_NORMAL_RADIUS_MM` of the point and whose normal is within
 * `MARK_NORMAL_CONE_DEG` of the nearest triangle's, the nearest triangle always among them.
 * Null for a mesh without triangles.
 */
export function resolveMark(mesh: IndexedMesh, point: Vec3): Mark | null {
  const { triangle, near } = nearestTriangle(mesh, point, MARK_NORMAL_RADIUS_MM);
  if (triangle < 0) return null;
  const { positions, indices } = mesh;
  const own = normalise(areaNormal(positions, indices, triangle));
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const add = (t: number): void => {
    const n = areaNormal(positions, indices, t);
    sx += n[0];
    sy += n[1];
    sz += n[2];
  };
  add(triangle);
  for (const t of near) {
    if (t === triangle) continue;
    const n = areaNormal(positions, indices, t);
    const length = Math.sqrt(dot(n, n));
    if (length > 0 && dot(n, own) >= CONE_COS * length) add(t);
  }
  const normal = normalise([sx, sy, sz]);
  return { point: [point[0], point[1], point[2]], normal: dot(normal, normal) > 0 ? normal : own };
}

/** The vertices of a triangle, for tests and the page's pins. */
export const triangleCorners = (mesh: IndexedMesh, t: number): [Vec3, Vec3, Vec3] => [
  corner(mesh.positions, mesh.indices[t * 3]!),
  corner(mesh.positions, mesh.indices[t * 3 + 1]!),
  corner(mesh.positions, mesh.indices[t * 3 + 2]!),
];

/**
 * A direction or a point turned by a rotation; a quarter turn swaps and negates exactly, as
 * `orientAndPlace` turns the mesh, so a mark on an axis-aligned face keeps an exact normal.
 */
export function turnVector(rotation: Rotation, v: Vec3): Vec3 {
  const axis = quarterTurnAxis(rotation);
  return axis ? TO_Y_UP[axis](v[0], v[1], v[2]) : apply(rotation, v);
}

/**
 * The rotation that sets a contact against a spot (design note §4.2, §4.3): the smallest turn
 * taking the contact's normal to the opposite of the spot's, then `turnDeg` about the spot's
 * normal. Exactly the identity when the normals are exactly opposite and there is no turn.
 */
export function meetingRotation(nContact: Vec3, nSpot: Vec3, turnDeg = 0): Rotation {
  const aligned = fromTo(nContact, [0 - nSpot[0], 0 - nSpot[1], 0 - nSpot[2]]);
  if (turnDeg === 0) return aligned;
  return multiply(fromAxisAngle(nSpot, turnDeg), aligned);
}
