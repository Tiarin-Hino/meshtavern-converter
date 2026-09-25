/**
 * Rotations as unit quaternions (issue #72). The orientation of a mini is one of these:
 * file coordinates → scene coordinates (Y-up), before the shift to the base centre.
 *
 * Everything that feeds a coordinate uses only + - * / and sqrt, so a rotation has the
 * same bits on every machine. `angleDeg` and `fromAxisAngle` use trigonometry: the first
 * only reports, the second only turns what a user or a test asked for.
 */
import type { Vec3 } from './base';
import type { UpAxis } from './orient';

/** A unit quaternion, x y z w, the glTF order. */
export type Rotation = [number, number, number, number];

export const IDENTITY: Rotation = [0, 0, 0, 1];

const HALF_SQRT2 = Math.sqrt(0.5);

/**
 * The quarter turns that take each file direction to scene +y, the same turns as
 * `TO_Y_UP` in orient.ts (which applies them exactly, by swapping and negating).
 */
export const AXIS_ROTATION: Readonly<Record<UpAxis, Rotation>> = {
  '+y': IDENTITY,
  // Half a turn about z: (x, y, z) → (-x, -y, z).
  '-y': [0, 0, 1, 0],
  // A quarter turn about x, backwards: (x, y, z) → (x, z, -y).
  '+z': [-HALF_SQRT2, 0, 0, HALF_SQRT2],
  // A quarter turn about x: (x, y, z) → (x, -z, y).
  '-z': [HALF_SQRT2, 0, 0, HALF_SQRT2],
  // A quarter turn about z: (x, y, z) → (-y, x, z).
  '+x': [0, 0, HALF_SQRT2, HALF_SQRT2],
  // A quarter turn about z, backwards: (x, y, z) → (y, -x, z).
  '-x': [0, 0, -HALF_SQRT2, HALF_SQRT2],
};

const UNIT_AXES: Readonly<Record<UpAxis, Vec3>> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

/** The unit vector of a file axis. */
export function axisVector(up: UpAxis): Vec3 {
  const [x, y, z] = UNIT_AXES[up];
  return [x, y, z];
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The vector scaled to length 1; the zero vector stays zero. */
export function normalise(v: Vec3): Vec3 {
  const length = Math.sqrt(dot(v, v));
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0];
}

function normaliseRotation(q: Rotation): Rotation {
  const length = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** `a · b`: the rotation that applies `b` first, then `a`. */
export function multiply(a: Rotation, b: Rotation): Rotation {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** The rotation that undoes `q`. */
export const invert = (q: Rotation): Rotation => [0 - q[0], 0 - q[1], 0 - q[2], q[3]];

/**
 * The smallest rotation that turns the direction `a` into `b` (both unit vectors). For
 * opposite directions, half a turn about an axis perpendicular to them.
 */
export function fromTo(a: Vec3, b: Vec3): Rotation {
  const w = 1 + dot(a, b);
  if (w < 1e-9) {
    // Opposite: any perpendicular axis does. Take the one least aligned with `a`.
    const helper: Vec3 =
      Math.abs(a[0]) <= Math.abs(a[1]) && Math.abs(a[0]) <= Math.abs(a[2])
        ? [1, 0, 0]
        : Math.abs(a[1]) <= Math.abs(a[2])
          ? [0, 1, 0]
          : [0, 0, 1];
    const [x, y, z] = normalise(cross(a, helper));
    return [x, y, z, 0];
  }
  const [x, y, z] = cross(a, b);
  return normaliseRotation([x, y, z, w]);
}

/** A turn by `deg` degrees about a unit `axis`, right-handed. */
export function fromAxisAngle(axis: Vec3, deg: number): Rotation {
  const half = (deg * Math.PI) / 360;
  const s = Math.sin(half);
  return normaliseRotation([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]);
}

/** The 3 × 3 matrix of a rotation, row by row. */
export function toMatrix([x, y, z, w]: Rotation): number[] {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),
    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),
    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy),
  ];
}

/** `v` turned by `q`. */
export function apply(q: Rotation, v: Vec3): Vec3 {
  const m = toMatrix(q);
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** The file axis closest to the direction `v`. Ties go to z, then y, the print conventions. */
export function nearestAxis(v: Vec3): UpAxis {
  const [x, y, z] = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  if (z >= x && z >= y) return v[2] >= 0 ? '+z' : '-z';
  if (y >= x) return v[1] >= 0 ? '+y' : '-y';
  return v[0] >= 0 ? '+x' : '-x';
}

/** The file direction a rotation turns to scene +y: the up direction in the file. */
export const fileUp = (q: Rotation): Vec3 => apply(invert(q), [0, 1, 0]);

/** The file axis nearest to what a rotation takes as up: the coarse, six-way step. */
export const nearestUpAxis = (q: Rotation): UpAxis => nearestAxis(fileUp(q));

/** How far a rotation turns, in degrees, 0–180. For reports only. */
export function turnAngleDeg(q: Rotation): number {
  return (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
}

/** The angle between two directions in degrees. For reports only. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const cos = dot(normalise(a), normalise(b));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}
