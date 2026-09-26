import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { ConversionProblem, type ProblemCode } from './problems';
import { encodeAsciiStl, encodeBinaryStl, readStlTriangles, SNIFF_BYTES, sniffStl } from './stl';

const TWO_TRIANGLES = [0, 0, 0, 10, 0, 0, 0, 5, 0, 0, 0, 0, 0, 5, 0, -2, 0, 32];

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const sniff = (buffer: ArrayBuffer): string =>
  sniffStl(new Uint8Array(buffer).subarray(0, SNIFF_BYTES), buffer.byteLength);

/** The code of the problem `read` throws, or 'none'. */
function problemOf(read: () => unknown): ProblemCode | 'none' {
  try {
    read();
    return 'none';
  } catch (error) {
    if (error instanceof ConversionProblem) return error.code;
    throw error;
  }
}

describe('sniffStl', () => {
  it('tells binary from ASCII', () => {
    expect(sniff(encodeBinaryStl(TWO_TRIANGLES))).toBe('binary');
    expect(sniff(bytes(encodeAsciiStl(TWO_TRIANGLES)))).toBe('ascii');
  });

  it('treats a binary file whose header starts with "solid" as binary', () => {
    const buffer = encodeBinaryStl(TWO_TRIANGLES);
    new Uint8Array(buffer).set(new TextEncoder().encode('solid exported'), 0);
    expect(sniff(buffer)).toBe('binary');
  });

  it('refuses an empty file, and a binary STL without triangles', () => {
    expect(problemOf(() => sniff(new ArrayBuffer(0)))).toBe('empty');
    expect(problemOf(() => sniff(encodeBinaryStl([])))).toBe('empty');
    expect(problemOf(() => sniff(bytes('  \n')))).toBe('empty');
  });

  it('refuses files that are not STL: text, an image, random bytes, a tiny file', () => {
    const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'.repeat(20);
    expect(problemOf(() => sniff(bytes(obj)))).toBe('not-stl');
    const png = new Uint8Array(4000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let seed = 7;
    for (let i = 8; i < png.length; i++) png[i] = seed = (seed * 1103515245 + 12345) & 0xff;
    expect(problemOf(() => sniff(png.buffer))).toBe('not-stl');
    const random = new Uint8Array(100_000);
    for (let i = 0; i < random.length; i++) random[i] = (seed = (seed * 69069 + 1) >>> 0) >>> 24;
    expect(problemOf(() => sniff(random.buffer))).toBe('not-stl');
    expect(problemOf(() => sniff(new Uint8Array([1, 2, 3]).buffer))).toBe('not-stl');
  });

  it('refuses a binary STL that ends before its last triangle', () => {
    const whole = encodeBinaryStl(generateBumpySheet(20));
    expect(problemOf(() => sniff(whole.slice(0, whole.byteLength - 1)))).toBe('truncated');
    expect(problemOf(() => sniff(whole.slice(0, whole.byteLength / 3)))).toBe('truncated');
  });

  it('reads a binary STL with bytes after the last triangle', () => {
    const padded = new Uint8Array(encodeBinaryStl(TWO_TRIANGLES).byteLength + 10);
    padded.set(new Uint8Array(encodeBinaryStl(TWO_TRIANGLES)));
    expect(Array.from(readStlTriangles(padded.buffer))).toEqual(TWO_TRIANGLES);
  });
});

describe('readStlTriangles', () => {
  it('round-trips a binary STL', () => {
    expect(Array.from(readStlTriangles(encodeBinaryStl(TWO_TRIANGLES)))).toEqual(TWO_TRIANGLES);
  });

  it('reads an ASCII STL: exponents, capitals, tabs and Windows line ends', () => {
    const ascii =
      'solid a\r\nfacet normal 0 0 1\r\nouter loop\r\n\tVERTEX 0 0 0\r\n\tvertex 1.5e1 0 0\r\n' +
      '\tvertex 0 -2 0\r\nendloop\r\nendfacet\r\nendsolid a\r\n';
    expect(Array.from(readStlTriangles(bytes(ascii)))).toEqual([0, 0, 0, 15, 0, 0, 0, -2, 0]);
  });

  it('reads NaN coordinates as NaN, for the weld step to drop', () => {
    const ascii = encodeAsciiStl(TWO_TRIANGLES).replace('vertex 0.000000e+0 ', 'vertex nan ');
    const soup = readStlTriangles(bytes(ascii));
    expect(soup).toHaveLength(18);
    expect(soup.some(Number.isNaN)).toBe(true);
  });

  it('refuses an ASCII STL that was cut off, wherever the cut is', () => {
    const ascii = encodeAsciiStl(TWO_TRIANGLES);
    for (const end of ['endsolid', 'endfacet', 'vertex 0.0', 'outer loop']) {
      const cut = ascii.slice(0, ascii.lastIndexOf(end));
      expect(
        problemOf(() => readStlTriangles(bytes(cut))),
        end,
      ).toBe('truncated');
    }
  });

  it('refuses an ASCII STL without facets as empty', () => {
    expect(problemOf(() => readStlTriangles(bytes('solid nothing\nendsolid nothing\n')))).toBe(
      'empty',
    );
  });

  it('reads an ASCII STL of realistic size quickly and exactly', () => {
    // 500k triangles, 120 MB of text: an ordinary mini exported as ASCII.
    const sheet = generateBumpySheet(500);
    const text = encodeAsciiStl(sheet);
    const buffer = bytes(text);
    expect(buffer.byteLength).toBeGreaterThan(100e6);
    const start = performance.now();
    const soup = readStlTriangles(buffer);
    const ms = performance.now() - start;
    expect(soup).toHaveLength(sheet.length);
    for (let i = 0; i < sheet.length; i += 99_991) expect(soup[i]).toBeCloseTo(sheet[i]!, 4);
    console.info(
      `ASCII STL, ${(buffer.byteLength / 1e6).toFixed(0)} MB: read in ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
