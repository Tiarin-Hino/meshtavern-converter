import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { dropInvalidTriangles, WELD_TOLERANCE_MM, weldVertices } from './mesh';

// Two triangles sharing the edge (0,0,0)-(1,1,0).
const QUAD = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);

describe('weldVertices', () => {
  it('merges repeated vertices into an indexed mesh', () => {
    const { mesh, degenerateTriangles } = weldVertices(QUAD);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(degenerateTriangles).toBe(0);
  });

  it('merges vertices that differ by less than the tolerance and keeps the first one', () => {
    const soup = QUAD.slice();
    soup[9] = WELD_TOLERANCE_MM / 10; // second copy of the origin, nudged in x
    const { mesh } = weldVertices(soup);
    expect(mesh.positions.length / 3).toBe(4);
    expect(mesh.positions[0]).toBe(0);
  });

  it('keeps vertices apart when they differ by more than the tolerance', () => {
    const soup = QUAD.slice();
    soup[9] = WELD_TOLERANCE_MM * 10;
    expect(weldVertices(soup).mesh.positions.length / 3).toBe(5);
  });

  it('drops degenerate triangles and counts them', () => {
    const soup = new Float32Array([...QUAD, 5, 5, 5, 5, 5, 5, 6, 6, 6]);
    const { mesh, degenerateTriangles } = weldVertices(soup);
    expect(degenerateTriangles).toBe(1);
    expect(mesh.indices.length).toBe(6);
  });

  it('drops triangles without area whose corners lie on one line', () => {
    const soup = new Float32Array([...QUAD, 0, 0, 0, 1, 0, 0, 3, 0, 0]);
    const { mesh, degenerateTriangles } = weldVertices(soup);
    expect(degenerateTriangles).toBe(1);
    expect(mesh.indices.length).toBe(6);
  });

  it('drops repeated triangles, whatever the order of their corners, and counts them', () => {
    const first = Array.from(QUAD.subarray(0, 9));
    const rotated = [...first.slice(3), ...first.slice(0, 3)];
    const flipped = [...first.slice(0, 3), ...first.slice(6, 9), ...first.slice(3, 6)];
    const soup = new Float32Array([...QUAD, ...first, ...rotated, ...flipped]);
    const { mesh, duplicateTriangles, degenerateTriangles } = weldVertices(soup);
    expect(duplicateTriangles).toBe(3);
    expect(degenerateTriangles).toBe(0);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('keeps triangles that share two corners with another', () => {
    // Three triangles on one edge: not manifold, but each is its own surface.
    const fin = [0, 0, 0, 1, 0, 0, 0, 0, 1];
    const { mesh, duplicateTriangles } = weldVertices(new Float32Array([...QUAD, ...fin]));
    expect(duplicateTriangles).toBe(0);
    expect(mesh.indices.length).toBe(9);
  });

  it('preserves triangle winding', () => {
    const { mesh } = weldVertices(QUAD);
    const [a, b, c] = [0, 1, 2].map((k) =>
      Array.from(mesh.positions.slice(mesh.indices[k]! * 3, mesh.indices[k]! * 3 + 3)),
    );
    const normalZ = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!);
    expect(normalZ).toBeGreaterThan(0);
  });

  it('handles an empty soup', () => {
    const { mesh } = weldVertices(new Float32Array(0));
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it('rejects incomplete triangles and a non-positive tolerance', () => {
    expect(() => weldVertices(new Float32Array(3))).toThrow();
    expect(() => weldVertices(QUAD, 0)).toThrow();
  });

  it('reduces a generated sheet to its grid vertices', () => {
    const { mesh, degenerateTriangles } = weldVertices(generateBumpySheet(20));
    expect(mesh.positions.length / 3).toBe(21 * 21);
    expect(mesh.indices.length / 3).toBe(20 * 20 * 2);
    expect(degenerateTriangles).toBe(0);
  });
});

describe('dropInvalidTriangles', () => {
  it('drops triangles with a coordinate that is NaN or infinite, and counts them', () => {
    const soup = new Float32Array([
      ...QUAD,
      NaN,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      Infinity,
      0,
      0,
      1,
      0,
    ]);
    const { soup: valid, invalidTriangles } = dropInvalidTriangles(soup);
    expect(invalidTriangles).toBe(2);
    expect(Array.from(valid)).toEqual(Array.from(QUAD));
  });

  it('hands back the soup itself when every triangle is valid', () => {
    expect(dropInvalidTriangles(QUAD).soup).toBe(QUAD);
  });
});
