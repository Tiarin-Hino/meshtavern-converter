import { describe, expect, it } from 'vitest';
import { weldVertices, type IndexedMesh } from './mesh';
import { detectUpAxis, orientAndPlace, UP_AXES, type UpAxis } from './orient';

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
    expect(orientAndPlace(zUp).sizeMm).toEqual([20, 32, 10]);
  });

  it('stands the mesh on y = 0 and centres it on the origin', () => {
    const { min, max } = bounds(orientAndPlace(zUp).mesh.positions);
    expect(min).toEqual([-10, 0, -5]);
    expect(max).toEqual([10, 32, 5]);
  });

  it('rotates rather than mirrors: +y in the file becomes -z', () => {
    const placed = orientAndPlace(zUp).mesh.positions;
    // Vertex 0 has the smallest file y, so it must have the largest scene z.
    expect(placed[2]).toBe(5);
  });

  it('leaves the axes alone for a Y-up source', () => {
    expect(orientAndPlace(zUp, '+y').sizeMm).toEqual([20, 10, 32]);
  });

  it.each(UP_AXES)('stands a %s mini upright without mirroring it', (up) => {
    const placed = orientAndPlace(pillarOnBase(up), up);
    expect(placed.sizeMm).toEqual([24, 43, 24]);
    expect(signedVolume(placed.mesh)).toBeGreaterThan(0);
    // The wide base is at the bottom: the vertices on the floor span the full 24 mm.
    const { positions } = placed.mesh;
    const onFloor = positions.filter((_, i) => i % 3 === 0 && positions[i + 1] === 0);
    expect(Math.max(...onFloor) - Math.min(...onFloor)).toBe(24);
  });

  it('does not modify its input', () => {
    const before = Array.from(zUp.positions);
    orientAndPlace(zUp);
    expect(Array.from(zUp.positions)).toEqual(before);
  });

  it('handles an empty mesh', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(orientAndPlace(empty).sizeMm).toEqual([0, 0, 0]);
  });
});

describe('detectUpAxis', () => {
  it.each(UP_AXES)('finds the base of a %s mini', (up) => {
    const detection = detectUpAxis(pillarOnBase(up));
    expect(detection).toMatchObject({ up, method: 'base' });
    expect(detection.coverage).toBeCloseTo(1, 1);
  });

  it('guesses the taller of Y-up and Z-up for a mini without a base', () => {
    expect(detectUpAxis(spikeWithoutBase('+y'))).toMatchObject({ up: '+y', method: 'tallest' });
    expect(detectUpAxis(spikeWithoutBase('+z'))).toMatchObject({ up: '+z', method: 'tallest' });
  });

  it('falls back to Z-up for an empty mesh', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(detectUpAxis(empty)).toMatchObject({ up: '+z', method: 'tallest' });
  });
});
