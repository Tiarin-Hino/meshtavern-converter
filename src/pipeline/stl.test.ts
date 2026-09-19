import { describe, expect, it } from 'vitest';
import { detectStlFormat, encodeBinaryStl, inspectStl, readStlTriangles } from './stl';

const TWO_TRIANGLES = [0, 0, 0, 10, 0, 0, 0, 5, 0, 0, 0, 0, 0, 5, 0, -2, 0, 32];

describe('inspectStl', () => {
  it('reads triangle count and bounds from a binary STL', () => {
    const info = inspectStl(encodeBinaryStl(TWO_TRIANGLES));
    expect(info).toEqual({
      format: 'binary',
      triangleCount: 2,
      bounds: { min: [-2, 0, 0], max: [10, 5, 32] },
    });
  });

  it('returns null bounds for an empty binary STL', () => {
    expect(inspectStl(encodeBinaryStl([]))).toEqual({
      format: 'binary',
      triangleCount: 0,
      bounds: null,
    });
  });

  it('counts facets in an ASCII STL', () => {
    const ascii = [
      'solid mini',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1 0 0',
      'vertex 0 1 0',
      'endloop',
      'endfacet',
      'endsolid mini',
    ].join('\n');
    const buffer = new TextEncoder().encode(ascii).buffer as ArrayBuffer;
    expect(detectStlFormat(buffer)).toBe('ascii');
    expect(inspectStl(buffer).triangleCount).toBe(1);
  });

  it('treats a binary file whose header starts with "solid" as binary', () => {
    const buffer = encodeBinaryStl(TWO_TRIANGLES);
    new Uint8Array(buffer).set(new TextEncoder().encode('solid exported'), 0);
    expect(detectStlFormat(buffer)).toBe('binary');
  });
});

describe('encodeBinaryStl', () => {
  it('rejects incomplete triangles', () => {
    expect(() => encodeBinaryStl([0, 0, 0])).toThrow();
  });
});

describe('readStlTriangles', () => {
  it('round-trips a binary STL', () => {
    expect(Array.from(readStlTriangles(encodeBinaryStl(TWO_TRIANGLES)))).toEqual(TWO_TRIANGLES);
  });

  it('reads vertices from an ASCII STL, including exponents', () => {
    const ascii =
      'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1.5e1 0 0\nvertex 0 -2 0\nendloop\nendfacet\nendsolid a';
    const soup = readStlTriangles(new TextEncoder().encode(ascii).buffer as ArrayBuffer);
    expect(Array.from(soup)).toEqual([0, 0, 0, 15, 0, 0, 0, -2, 0]);
  });
});
