import { describe, expect, it } from 'vitest';
import type { IndexedMesh } from './mesh';
import { orientAndPlace } from './orient';

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
    expect(orientAndPlace(zUp, 'y').sizeMm).toEqual([20, 10, 32]);
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
