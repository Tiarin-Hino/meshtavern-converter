/**
 * Pure STL inspection helpers. No DOM, no three.js: everything in src/pipeline
 * must run in a Web Worker and be unit-testable in Node.
 */

export type StlFormat = 'binary' | 'ascii';

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface StlInfo {
  format: StlFormat;
  triangleCount: number;
  /** Axis-aligned bounds in the file's own units. Null for ASCII files and empty meshes. */
  bounds: Bounds | null;
}

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;

/** Binary STL size is fully determined by its triangle count; ASCII files never match it. */
export function detectStlFormat(buffer: ArrayBuffer): StlFormat {
  if (buffer.byteLength < HEADER_BYTES + COUNT_BYTES) return 'ascii';
  const count = new DataView(buffer).getUint32(HEADER_BYTES, true);
  const expected = HEADER_BYTES + COUNT_BYTES + count * TRIANGLE_BYTES;
  return expected === buffer.byteLength ? 'binary' : 'ascii';
}

export function inspectStl(buffer: ArrayBuffer): StlInfo {
  if (detectStlFormat(buffer) === 'ascii') {
    const text = new TextDecoder().decode(buffer);
    return {
      format: 'ascii',
      triangleCount: text.match(/facet normal/g)?.length ?? 0,
      bounds: null,
    };
  }

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(HEADER_BYTES, true);
  if (triangleCount === 0) return { format: 'binary', triangleCount, bounds: null };

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangleCount; t++) {
    // Each record: normal (12 bytes), three vertices (36 bytes), attribute (2 bytes).
    const vertices = HEADER_BYTES + COUNT_BYTES + t * TRIANGLE_BYTES + 12;
    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = view.getFloat32(vertices + v * 12 + axis * 4, true);
        if (value < min[axis]!) min[axis] = value;
        if (value > max[axis]!) max[axis] = value;
      }
    }
  }
  return { format: 'binary', triangleCount, bounds: { min, max } };
}

/** Builds a binary STL from flat triangle vertex data (9 numbers per triangle). Used by tests and the demo mesh. */
export function encodeBinaryStl(vertices: ArrayLike<number>): ArrayBuffer {
  if (vertices.length % 9 !== 0) throw new Error('Expected 9 numbers per triangle');
  const triangleCount = vertices.length / 9;
  const buffer = new ArrayBuffer(HEADER_BYTES + COUNT_BYTES + triangleCount * TRIANGLE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(HEADER_BYTES, triangleCount, true);
  for (let t = 0; t < triangleCount; t++) {
    const offset = HEADER_BYTES + COUNT_BYTES + t * TRIANGLE_BYTES + 12;
    for (let i = 0; i < 9; i++) view.setFloat32(offset + i * 4, vertices[t * 9 + i]!, true);
  }
  return buffer;
}
