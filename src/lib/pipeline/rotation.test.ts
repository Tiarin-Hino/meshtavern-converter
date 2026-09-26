import { describe, expect, it } from 'vitest';
import type { Vec3 } from './base';
import { TO_Y_UP, UP_AXES } from './orient';
import {
  angleDeg,
  apply,
  AXIS_ROTATION,
  fileUp,
  fromAxisAngle,
  fromTo,
  invert,
  multiply,
  nearestUpAxis,
  normalise,
  toMatrix,
  turnAngleDeg,
} from './rotation';

const SAMPLES: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [3, -7, 11.5],
  [-0.25, 42, -9],
];

function determinant(m: number[]): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

const expectClose = (actual: Vec3, expected: Vec3, digits = 12): void =>
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));

describe('AXIS_ROTATION', () => {
  it.each(UP_AXES)('turns points as TO_Y_UP does for %s', (up) => {
    for (const [x, y, z] of SAMPLES) {
      expectClose(apply(AXIS_ROTATION[up], [x, y, z]), TO_Y_UP[up](x, y, z));
    }
  });

  it.each(UP_AXES)('is a proper rotation for %s: determinant +1, never a mirror', (up) => {
    expect(determinant(toMatrix(AXIS_ROTATION[up]))).toBeCloseTo(1, 12);
  });

  it.each(UP_AXES)('names %s as its own up axis', (up) => {
    expect(nearestUpAxis(AXIS_ROTATION[up])).toBe(up);
  });
});

describe('fromTo', () => {
  it('turns perpendicular directions into each other', () => {
    expectClose(apply(fromTo([1, 0, 0], [0, 1, 0]), [1, 0, 0]), [0, 1, 0]);
    expectClose(apply(fromTo([0, 0, 1], [0, 1, 0]), [0, 0, 1]), [0, 1, 0]);
  });

  it('is the identity for the same direction and nearly so for nearly the same one', () => {
    expect(fromTo([0, 1, 0], [0, 1, 0])).toEqual([0, 0, 0, 1]);
    const nearly = normalise([1e-7, 1, 0]);
    expectClose(apply(fromTo(nearly, [0, 1, 0]), nearly), [0, 1, 0]);
  });

  it('turns opposite directions by half a turn', () => {
    for (const a of [[0, 1, 0] as Vec3, [1, 0, 0] as Vec3, normalise([1, 2, 3])]) {
      const b: Vec3 = [-a[0], -a[1], -a[2]];
      expectClose(apply(fromTo(a, b), a), b);
    }
  });

  it('keeps the determinant at +1 for any pair', () => {
    const q = fromTo(normalise([0.3, 0.9, -0.1]), [0, 1, 0]);
    expect(determinant(toMatrix(q))).toBeCloseTo(1, 12);
  });
});

describe('multiply and invert', () => {
  it('applies the right-hand rotation first', () => {
    const quarterZ = fromAxisAngle([0, 0, 1], 90);
    const quarterX = fromAxisAngle([1, 0, 0], 90);
    // x → y (about z), then y → z (about x).
    expectClose(apply(multiply(quarterX, quarterZ), [1, 0, 0]), [0, 0, 1]);
  });

  it('undoes a rotation', () => {
    const q = fromAxisAngle(normalise([1, 2, 3]), 37);
    expectClose(apply(multiply(invert(q), q), [3, -7, 11.5]), [3, -7, 11.5]);
  });
});

describe('nearestUpAxis', () => {
  it('names the axis a 10° tilt started from', () => {
    for (const up of UP_AXES) {
      const tilted = multiply(fromAxisAngle([0, 0, 1], 10), AXIS_ROTATION[up]);
      expect(nearestUpAxis(tilted)).toBe(up);
      expect(angleDeg(fileUp(tilted), fileUp(AXIS_ROTATION[up]))).toBeCloseTo(10, 9);
    }
  });
});

describe('angleDeg', () => {
  it('measures right angles and parallel directions', () => {
    expect(angleDeg([1, 0, 0], [0, 2, 0])).toBeCloseTo(90, 12);
    expect(angleDeg([0, 3, 0], [0, 1, 0])).toBe(0);
    expect(angleDeg([0, 1, 0], [0, -1, 0])).toBeCloseTo(180, 12);
  });
});

describe('turnAngleDeg', () => {
  it('measures how far a rotation turns, whichever sign the quaternion has', () => {
    const q = fromAxisAngle(normalise([1, 2, 3]), 30);
    expect(turnAngleDeg(q)).toBeCloseTo(30, 9);
    expect(turnAngleDeg([0 - q[0], 0 - q[1], 0 - q[2], 0 - q[3]])).toBeCloseTo(30, 9);
    expect(turnAngleDeg([0, 0, 0, 1])).toBe(0);
  });
});
