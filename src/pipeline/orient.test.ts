import { describe, expect, it } from 'vitest';
import { generateFigure, toYUp } from '../regression/shapes';
import type { Vec3 } from './base';
import { generatePlainBase } from './base';
import { generateBumpySheet } from './generate';
import { weldVertices, type IndexedMesh } from './mesh';
import {
  coverageFor,
  detectUpAxis,
  LEVEL_TOLERANCE_DEG,
  orientAndPlace,
  quarterTurnAxis,
  resolveOrientation,
  UP_AXES,
  type Orientation,
  type UpAxis,
} from './orient';
import { angleDeg, apply, AXIS_ROTATION, fromAxisAngle, multiply, type Rotation } from './rotation';

// Z-up box corner points: 20 mm wide (x 10..30), 10 mm deep (y 0..10), 32 mm tall (z 5..37).
const zUp: IndexedMesh = {
  positions: new Float32Array([10, 0, 5, 30, 0, 5, 30, 10, 5, 10, 10, 37]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((value, i) => {
    min[i % 3] = Math.min(min[i % 3]!, value);
    max[i % 3] = Math.max(max[i % 3]!, value);
  });
  return { min, max };
}

/** Inverse of the rotations in orient.ts: scene (x, y, z) back to a file where `up` is up. */
const FROM_Y_UP: Record<UpAxis, (x: number, y: number, z: number) => number[]> = {
  '+y': (x, y, z) => [x, y, z],
  '-y': (x, y, z) => [-x, -y, z],
  '+z': (x, y, z) => [x, -z, y],
  '-z': (x, y, z) => [x, z, -y],
  '+x': (x, y, z) => [y, -x, z],
  '-x': (x, y, z) => [-y, x, z],
};

function turned(soupYUp: number[], up: UpAxis): IndexedMesh {
  const soup = new Float32Array(soupYUp.length);
  for (let i = 0; i < soupYUp.length; i += 3) {
    soup.set(FROM_Y_UP[up](soupYUp[i]!, soupYUp[i + 1]!, soupYUp[i + 2]!), i);
  }
  return weldVertices(soup).mesh;
}

/** Outward-facing box as a triangle soup. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const soup: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    soup.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom, faces -y
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // top, faces +y
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // faces -z
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // faces +z
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // faces -x
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // faces +x
  return soup;
}

/** A 24 × 24 × 3 mm base with a thin pillar on it, 43 mm tall in total. */
const pillarOnBase = (up: UpAxis): IndexedMesh =>
  turned([...box(-12, 0, -12, 12, 3, 12), ...box(-2, 3, -2, 2, 43, 2)], up);

/** A leaning spike, 43 mm tall and 4 mm deep, with no flat underside: like a figure on bare feet. */
const spikeWithoutBase = (up: UpAxis): IndexedMesh =>
  turned(
    [-2, 0, -2, 2, 1, -2, 0, 43, 2, 2, 1, -2, 2, 0.5, 2, 0, 43, 2, -2, 0, -2, 0, 43, 2, 2, 0.5, 2],
    up,
  );

/** Positive for outward-facing triangles; mirroring a mesh flips the sign. */
function signedVolume({ positions: p, indices }: IndexedMesh): number {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    volume +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return volume / 6;
}

describe('orientAndPlace', () => {
  it('converts Z-up to Y-up and reports the size in mm', () => {
    expect(orientAndPlace(zUp, '+z', 0).sizeMm).toEqual([20, 32, 10]);
  });

  it('stands the mesh on y = 0 and centres it on the origin', () => {
    const { min, max } = bounds(orientAndPlace(zUp, '+z', 0).mesh.positions);
    expect(min).toEqual([-10, 0, -5]);
    expect(max).toEqual([10, 32, 5]);
  });

  it('rotates rather than mirrors: +y in the file becomes -z', () => {
    const placed = orientAndPlace(zUp, '+z', 0).mesh.positions;
    // Vertex 0 has the smallest file y, so it must have the largest scene z.
    expect(placed[2]).toBe(5);
  });

  it('leaves the axes alone for a Y-up source', () => {
    expect(orientAndPlace(zUp, '+y', 0).sizeMm).toEqual([20, 10, 32]);
  });

  it.each(UP_AXES)('stands a %s mini upright without mirroring it', (up) => {
    const mesh = pillarOnBase(up);
    const placed = orientAndPlace(mesh, up, coverageFor(detectUpAxis(mesh), up));
    expect(placed.sizeMm).toEqual([24, 43, 24]);
    expect(signedVolume(placed.mesh)).toBeGreaterThan(0);
    // The wide base is at the bottom: the vertices on the floor span the full 24 mm.
    const { positions } = placed.mesh;
    const onFloor = positions.filter((_, i) => i % 3 === 0 && positions[i + 1] === 0);
    expect(Math.max(...onFloor) - Math.min(...onFloor)).toBe(24);
  });

  it('does not modify its input', () => {
    const before = Array.from(zUp.positions);
    orientAndPlace(zUp, '+z', 0);
    expect(Array.from(zUp.positions)).toEqual(before);
  });

  it('handles an empty mesh', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(orientAndPlace(empty, '+z', 0).sizeMm).toEqual([0, 0, 0]);
  });
});

describe('detectUpAxis', () => {
  it.each(UP_AXES)('finds the base of a %s mini', (up) => {
    const { orientation } = detectUpAxis(pillarOnBase(up));
    expect(orientation).toMatchObject({ up, method: 'base', tiltDeg: 0, setDownDeg: 0 });
    expect(orientation.rotation).toBe(AXIS_ROTATION[up]);
    expect(orientation.confidence).toBeCloseTo(1, 1);
  });

  it('guesses the taller of Y-up and Z-up for a mini without a base', () => {
    for (const up of ['+y', '+z'] as const) {
      expect(detectUpAxis(spikeWithoutBase(up)).orientation).toMatchObject({
        up,
        method: 'tallest',
        rotation: AXIS_ROTATION[up],
        tiltDeg: 0,
      });
    }
  });

  it('falls back to Z-up for an empty mesh', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(detectUpAxis(empty).orientation).toMatchObject({ up: '+z', method: 'tallest' });
  });
});

describe('detectUpAxis: the one pass', () => {
  it('reports the coverage of every axis, the base only for the one it stands on', () => {
    const detection = detectUpAxis(pillarOnBase('+z'));
    expect(coverageFor(detection, '+z')).toBeCloseTo(1, 1);
    expect(coverageFor(detection, '-z')).toBeLessThan(0.1);
    expect(detection.coverageByAxis).toHaveLength(6);
  });

  it('finds the volume and centroid of a closed disc', () => {
    // A 32 mm plain base, Y-up, centred on the origin, 3 mm high.
    const { scan } = detectUpAxis(generatePlainBase(32));
    expect(scan.volume / (Math.PI * 16 * 16 * 3)).toBeCloseTo(1, 2);
    expect(scan.centroid[0]).toBeCloseTo(0, 6);
    expect(scan.centroid[1]).toBeCloseTo(1.5, 6);
    expect(scan.centroid[2]).toBeCloseTo(0, 6);
  });

  it('puts the centroid of a figure on a base above the base and under the head', () => {
    const { scan } = detectUpAxis(weldVertices(generateFigure(true)).mesh);
    expect(scan.volume).toBeGreaterThan(0);
    // The base is 3 mm high; the body blob's centre sits at 14 mm, the head at 28 mm.
    expect(scan.centroid[2]).toBeGreaterThan(8);
    expect(scan.centroid[2]).toBeLessThan(16);
    expect(Math.abs(scan.centroid[0])).toBeLessThan(1);
  });

  it('falls back to the surface centroid for an open sheet', () => {
    const sheet = weldVertices(generateBumpySheet(20)).mesh;
    const { scan } = detectUpAxis(sheet);
    expect(scan.volume).toBe(0);
    for (let axis = 0; axis < 3; axis++) {
      expect(scan.centroid[axis]).toBeGreaterThanOrEqual(scan.min[axis]!);
      expect(scan.centroid[axis]).toBeLessThanOrEqual(scan.max[axis]!);
    }
  });

  it('gives an empty mesh a zero volume', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(detectUpAxis(empty).scan.volume).toBe(0);
  });
});

/**
 * A table as a file would store it, Z-up or Y-up, tilted about its long axis: a 30 × 12 mm
 * top on four 2 mm legs with flat pads, 14 mm tall. The pads cover too little to be a base.
 */
function table(up: '+z' | '+y', tiltDeg: number): IndexedMesh {
  const zUp = [...box(-15, 10, -6, 15, 14, 6)];
  for (const x of [-14, 12]) for (const z of [-5, 3]) zUp.push(...box(x, 0, z, x + 2, 10, z + 2));
  // box() builds Y-up boxes; turn them Z-up, then tilt about x.
  const turn = fromAxisAngle([1, 0, 0], tiltDeg);
  const soup = new Float32Array(zUp.length);
  for (let i = 0; i < zUp.length; i += 3) {
    const zUpPoint: Vec3 = [zUp[i]!, 0 - zUp[i + 2]!, zUp[i + 1]!];
    soup.set(apply(turn, zUpPoint), i);
  }
  return weldVertices(up === '+y' ? toYUp(soup) : soup).mesh;
}

/** The table's true up direction in that file. */
function trueUp(up: '+z' | '+y', tiltDeg: number): Vec3 {
  const [x, y, z] = apply(fromAxisAngle([1, 0, 0], tiltDeg), [0, 0, 1]);
  return up === '+y' ? [x, z, 0 - y] : [x, y, z];
}

/** How far a result leaves the table from standing level, in degrees. */
const leftTilt = (orientation: Orientation, up: Vec3): number =>
  angleDeg(apply(orientation.rotation, up), [0, 1, 0]);
describe('resolveOrientation', () => {
  it.each([
    ['+z', 10],
    ['+z', 30],
    ['+y', 10],
    ['+y', 30],
  ] as const)('sets a %s table tilted by %d° down level on its pads', (up, tilt) => {
    const { orientation } = resolveOrientation(table(up, tilt), { up });
    expect(orientation.method).toBe('manual');
    expect(leftTilt(orientation, trueUp(up, tilt))).toBeLessThan(LEVEL_TOLERANCE_DEG);
    expect(orientation.tiltDeg).toBeGreaterThan(tilt - LEVEL_TOLERANCE_DEG);
    expect(orientation.setDownDeg).toBeCloseTo(orientation.tiltDeg, 6);
  });

  it('brings a mini turned 30° by hand back level and says by how much', () => {
    const turned = multiply(fromAxisAngle([1, 0, 0], 30), AXIS_ROTATION['+z']);
    const { orientation } = resolveOrientation(table('+z', 0), { rotation: turned });
    // It rests flat again, so it gets the plain quarter turn.
    expect(orientation).toMatchObject({ up: '+z', method: 'manual', tiltDeg: 0 });
    expect(orientation.rotation).toBe(AXIS_ROTATION['+z']);
    expect(Math.abs(orientation.setDownDeg - 30)).toBeLessThan(LEVEL_TOLERANCE_DEG);
  });

  it('keeps a rotation exactly when it is not to be set down', () => {
    const turned: Rotation = multiply(fromAxisAngle([1, 0, 0], 30), AXIS_ROTATION['+z']);
    const { orientation } = resolveOrientation(table('+z', 0), {
      rotation: turned,
      setDown: false,
    });
    expect(orientation).toMatchObject({ up: '+z', method: 'manual', setDownDeg: 0 });
    expect(orientation.rotation).toBe(turned);
    expect(orientation.tiltDeg).toBeCloseTo(30, 9);
  });

  it('does not move a mini that already rests flat: the same bits as the quarter turn', () => {
    const mesh = table('+z', 0);
    const { orientation } = resolveOrientation(mesh, { up: '+z' });
    expect(orientation).toMatchObject({ tiltDeg: 0, rotation: AXIS_ROTATION['+z'] });
    const placed = orientAndPlace(mesh, orientation.rotation, 0).mesh.positions;
    const quarter = orientAndPlace(mesh, '+z', 0).mesh.positions;
    expect(Buffer.from(placed.buffer).equals(Buffer.from(quarter.buffer))).toBe(true);
  });

  it('never levels a mini on a base, even when the user picks its axis', () => {
    const { orientation } = resolveOrientation(pillarOnBase('+x'), { up: '+x' });
    expect(orientation).toMatchObject({ up: '+x', method: 'manual', tiltDeg: 0, setDownDeg: 0 });
    expect(orientation.rotation).toBe(AXIS_ROTATION['+x']);
  });

  it('keeps the axis the user picked when asked not to set down', () => {
    const { orientation } = resolveOrientation(table('+z', 30), { up: '+z', setDown: false });
    expect(orientation).toMatchObject({ up: '+z', tiltDeg: 0, setDownDeg: 0 });
  });
});

describe('orientAndPlace with a rotation', () => {
  it('stands a levelled mini on y = 0 without mirroring it, with no base', () => {
    const mesh = table('+z', 30);
    const detection = resolveOrientation(mesh, { up: '+z' });
    const placed = orientAndPlace(mesh, detection.orientation.rotation, 1);
    const { min } = bounds(placed.mesh.positions);
    expect(min[1]).toBe(0);
    expect(signedVolume(placed.mesh)).toBeGreaterThan(0);
    expect(placed.base).toBeNull();
    // Levelled, it is as tall as the untilted table.
    const level = orientAndPlace(table('+z', 0), '+z', 0);
    expect(placed.sizeMm[1]).toBeCloseTo(level.sizeMm[1], 0);
  });

  it('recognises the quarter turns, whichever sign the quaternion has', () => {
    for (const up of UP_AXES) {
      const q = AXIS_ROTATION[up];
      expect(quarterTurnAxis(q)).toBe(up);
      expect(quarterTurnAxis([0 - q[0], 0 - q[1], 0 - q[2], 0 - q[3]])).toBe(up);
    }
    expect(quarterTurnAxis(fromAxisAngle([1, 0, 0], 10))).toBeNull();
  });
});
