/**
 * Pure STL reading. No DOM, no three.js: everything in src/lib/pipeline must run in a Web
 * Worker and be unit-testable in Node. Files that cannot become a mini are refused with
 * a `ConversionProblem`, never read half-way into a broken one.
 */
import { ConversionProblem } from './problems';

export type StlFormat = 'binary' | 'ascii';

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;
const FIRST_TRIANGLE = HEADER_BYTES + COUNT_BYTES;

/** How much of the start of a file `sniffStl` looks at: enough for a hundred binary triangles. */
export const SNIFF_BYTES = 8 * 1024;
/**
 * A binary file whose size does not match its triangle count is still taken for a
 * (truncated or padded) STL when its first triangles look like coordinates: finite and
 * within this many mm. Random bytes, images and archives almost never pass.
 */
const PLAUSIBLE_COORDINATE_MM = 1e6;
/** Share of sampled triangles that must look like coordinates. */
const PLAUSIBLE_SHARE = 0.9;

const isSpace = (byte: number): boolean =>
  byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c;

/** Text, as far as `head` shows: no control bytes besides white space. Binary STL data always has some. */
function isText(head: Uint8Array): boolean {
  for (const byte of head) if (byte < 0x20 && !isSpace(byte)) return false;
  return true;
}

function startsWithSolid(head: Uint8Array): boolean {
  let i = 0;
  while (i < head.length && isSpace(head[i]!)) i++;
  const word = String.fromCharCode(...head.subarray(i, i + 5));
  return word.toLowerCase() === 'solid';
}

/** Whether the complete binary triangles in `head` look like a mesh rather than random bytes. */
function plausibleTriangles(head: Uint8Array, triangleCount: number): boolean {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const sampled = Math.min(
    triangleCount,
    Math.floor((head.byteLength - FIRST_TRIANGLE) / TRIANGLE_BYTES),
  );
  if (sampled < 1) return false;
  let plausible = 0;
  for (let t = 0; t < sampled; t++) {
    const vertices = FIRST_TRIANGLE + t * TRIANGLE_BYTES + 12;
    let ok = true;
    for (let i = 0; i < 9 && ok; i++) {
      const value = view.getFloat32(vertices + i * 4, true);
      ok = Number.isFinite(value) && Math.abs(value) < PLAUSIBLE_COORDINATE_MM;
    }
    if (ok) plausible++;
  }
  return plausible >= sampled * PLAUSIBLE_SHARE;
}

/**
 * Decides from the start of a file and its size how to read it, or refuses it: empty,
 * not an STL, or a binary STL that ends before its last triangle. Needs only the first
 * `SNIFF_BYTES`, so the page can check a file before reading all of it.
 */
export function sniffStl(head: Uint8Array, byteLength: number): StlFormat {
  if (byteLength === 0) throw new ConversionProblem('empty');
  head = head.subarray(0, SNIFF_BYTES);

  let triangleCount = -1;
  if (byteLength >= FIRST_TRIANGLE && head.byteLength >= FIRST_TRIANGLE) {
    triangleCount = new DataView(head.buffer, head.byteOffset).getUint32(HEADER_BYTES, true);
    // Binary STL size is fully determined by its triangle count; ASCII files never match it.
    if (FIRST_TRIANGLE + triangleCount * TRIANGLE_BYTES === byteLength) {
      if (triangleCount === 0) throw new ConversionProblem('empty');
      return 'binary';
    }
  }
  if (isText(head)) {
    if (startsWithSolid(head)) return 'ascii';
    if (byteLength === head.byteLength && head.every(isSpace)) throw new ConversionProblem('empty');
    throw new ConversionProblem('not-stl', 'text that does not start with "solid"');
  }
  if (triangleCount > 0 && plausibleTriangles(head, triangleCount)) {
    const expected = FIRST_TRIANGLE + triangleCount * TRIANGLE_BYTES;
    if (byteLength < expected) {
      throw new ConversionProblem(
        'truncated',
        `${byteLength} bytes, ${triangleCount} triangles need ${expected}`,
      );
    }
    // Some exporters leave bytes after the last triangle; they are ignored.
    return 'binary';
  }
  throw new ConversionProblem('not-stl', 'neither ASCII STL nor binary triangles');
}

/** Reads an STL into a triangle soup: 9 numbers per triangle, in the file's own axes and units. */
export function readStlTriangles(buffer: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buffer);
  return sniffStl(bytes, bytes.byteLength) === 'ascii'
    ? readAsciiTriangles(bytes)
    : readBinaryTriangles(buffer);
}

function readBinaryTriangles(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(HEADER_BYTES, true);
  const soup = new Float32Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) {
    const vertices = FIRST_TRIANGLE + t * TRIANGLE_BYTES + 12;
    for (let i = 0; i < 9; i++) soup[t * 9 + i] = view.getFloat32(vertices + i * 4, true);
  }
  return soup;
}

const VERTEX = [0x76, 0x65, 0x72, 0x74, 0x65, 0x78]; // "vertex"
const ENDSOLID = [0x65, 0x6e, 0x64, 0x73, 0x6f, 0x6c, 0x69, 0x64]; // "endsolid"

const POWERS_OF_TEN = Array.from({ length: 64 }, (_, i) => 10 ** i);

/**
 * Parses a decimal number such as "-1.25e+01" straight from bytes, which is several times
 * faster than making a string of each one. Anything unusual ("nan", "inf", very long
 * digit runs) is left to `Number`.
 */
function parseNumber(bytes: Uint8Array, start: number, end: number): number {
  let i = start;
  let negative = false;
  if (bytes[i] === 0x2d || bytes[i] === 0x2b) negative = bytes[i++] === 0x2d;
  let mantissa = 0;
  let digits = 0;
  let scale = 0;
  let seenDigit = false;
  for (; i < end; i++) {
    const d = bytes[i]! - 0x30;
    if (d < 0 || d > 9) break;
    mantissa = mantissa * 10 + d;
    digits++;
    seenDigit = true;
  }
  if (i < end && bytes[i] === 0x2e) {
    for (i++; i < end; i++) {
      const d = bytes[i]! - 0x30;
      if (d < 0 || d > 9) break;
      mantissa = mantissa * 10 + d;
      digits++;
      scale--;
      seenDigit = true;
    }
  }
  if (seenDigit && i < end && (bytes[i]! | 0x20) === 0x65) {
    i++;
    let negativeExponent = false;
    if (bytes[i] === 0x2d || bytes[i] === 0x2b) negativeExponent = bytes[i++] === 0x2d;
    let exponent = 0;
    const exponentStart = i;
    for (; i < end; i++) {
      const d = bytes[i]! - 0x30;
      if (d < 0 || d > 9) break;
      exponent = exponent * 10 + d;
    }
    if (i === exponentStart) i = -1; // "1e" is not a number: let Number decide.
    scale += negativeExponent ? -exponent : exponent;
  }
  if (i !== end || !seenDigit || digits > 15 || Math.abs(scale) >= POWERS_OF_TEN.length) {
    return Number(String.fromCharCode(...bytes.subarray(start, end)));
  }
  const value = scale < 0 ? mantissa / POWERS_OF_TEN[-scale]! : mantissa * POWERS_OF_TEN[scale]!;
  return negative ? -value : value;
}

function wordIs(bytes: Uint8Array, start: number, end: number, word: number[]): boolean {
  if (end - start !== word.length) return false;
  // `| 0x20` lower-cases ASCII letters, so "VERTEX" counts too.
  for (let i = 0; i < word.length; i++) if ((bytes[start + i]! | 0x20) !== word[i]) return false;
  return true;
}

/**
 * Reads the vertices of an ASCII STL straight from its bytes. Decoding a file of hundreds
 * of megabytes into one string and matching it with a regular expression needs several
 * times its size in memory; this needs only the output. A file whose last facet or
 * closing `endsolid` is missing was cut off, and is refused.
 */
function readAsciiTriangles(bytes: Uint8Array): Float32Array {
  // A vertex line takes at least 13 bytes ("vertex 0 0 0\n"). Exporters write far more
  // per vertex, so a quarter of that bound is plenty; the array doubles if it is not.
  let soup = new Float32Array(Math.max(9, Math.ceil(bytes.byteLength / 13 / 4) * 3));
  let values = 0;
  let pending = 0; // Coordinates still expected after a "vertex".
  let endsolidAfterLastVertex = false;
  const length = bytes.byteLength;

  let i = 0;
  while (i < length) {
    while (i < length && isSpace(bytes[i]!)) i++;
    const start = i;
    while (i < length && !isSpace(bytes[i]!)) i++;
    if (start === i) break;

    if (pending > 0) {
      if (values === soup.length) {
        const grown = new Float32Array(soup.length * 2);
        grown.set(soup);
        soup = grown;
      }
      soup[values++] = parseNumber(bytes, start, i);
      pending--;
    } else if (wordIs(bytes, start, i, VERTEX)) {
      pending = 3;
      endsolidAfterLastVertex = false;
    } else if (wordIs(bytes, start, i, ENDSOLID)) {
      endsolidAfterLastVertex = true;
    }
  }

  if (pending > 0 || values % 9 !== 0 || (values > 0 && !endsolidAfterLastVertex)) {
    throw new ConversionProblem('truncated', `ASCII STL ends after ${values / 3} vertices`);
  }
  if (values === 0) throw new ConversionProblem('empty', 'ASCII STL without vertices');
  return soup.slice(0, values);
}

/** Builds a binary STL from flat triangle vertex data (9 numbers per triangle). Used by tests and the demo mesh. */
export function encodeBinaryStl(vertices: ArrayLike<number>): ArrayBuffer {
  if (vertices.length % 9 !== 0) throw new Error('Expected 9 numbers per triangle');
  const triangleCount = vertices.length / 9;
  const buffer = new ArrayBuffer(FIRST_TRIANGLE + triangleCount * TRIANGLE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(HEADER_BYTES, triangleCount, true);
  for (let t = 0; t < triangleCount; t++) {
    const offset = FIRST_TRIANGLE + t * TRIANGLE_BYTES + 12;
    for (let i = 0; i < 9; i++) view.setFloat32(offset + i * 4, vertices[t * 9 + i]!, true);
  }
  return buffer;
}

/** Writes flat triangle vertex data as an ASCII STL, the way many exporters do. Used by tests. */
export function encodeAsciiStl(vertices: ArrayLike<number>, name = 'mini'): string {
  if (vertices.length % 9 !== 0) throw new Error('Expected 9 numbers per triangle');
  const lines = [`solid ${name}`];
  for (let t = 0; t < vertices.length; t += 9) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let v = 0; v < 9; v += 3) {
      const [x, y, z] = [vertices[t + v]!, vertices[t + v + 1]!, vertices[t + v + 2]!];
      lines.push(`      vertex ${x.toExponential(6)} ${y.toExponential(6)} ${z.toExponential(6)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`, '');
  return lines.join('\n');
}
