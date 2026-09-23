/**
 * Files that are not clean (#43). Each case ends either in a whole mini or in a
 * `ConversionProblem` with a message for the user, never in another kind of error.
 * Every mesh is generated: no real minis in the repo.
 */
import { describe, expect, it } from 'vitest';
import { addBlob, generateFigure } from '../regression/shapes';
import { generateBumpySheet } from './generate';
import { estimateConversionBytes } from './memory';
import { ConversionProblem, PROBLEM_MESSAGES, type ProblemCode } from './problems';
import { runPipeline, STEPS, type ConversionResult, type Progress } from './run';
import { encodeAsciiStl, encodeBinaryStl } from './stl';

type Vec3 = [number, number, number];
const BAKE = 256;
const ascii = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** A closed box, two triangles per face, facing outwards. */
function box(soup: number[], [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3): void {
  const c = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  // Corner indices of each face, counter-clockwise seen from outside.
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  for (const [a, b, d, e] of faces)
    soup.push(...c(a!), ...c(b!), ...c(d!), ...c(a!), ...c(d!), ...c(e!));
}

/** A mini converts, baked, with every level and the look on each. */
function expectWholeMini({ lods, baked, stats }: ConversionResult): void {
  expect(lods).toHaveLength(3);
  for (const lod of lods) {
    expect(lod.triangles).toBeGreaterThan(0);
    expect(lod.mesh.cavity?.length).toBe(lod.mesh.positions.length / 3);
    expect(Array.from(lod.mesh.positions).every(Number.isFinite)).toBe(true);
  }
  expect(stats.bakeSkipped).toBeNull();
  expect(baked?.ktx2).not.toBeNull();
  expect(stats.sizeMm.every((size) => Number.isFinite(size) && size > 0)).toBe(true);
}

async function refusal(
  stl: ArrayBuffer,
  options = {},
): Promise<{ code: ProblemCode; steps: string[] }> {
  const steps: string[] = [];
  try {
    await runPipeline(stl, {
      bake: BAKE,
      onProgress: (p: Progress) => steps.push(p.step),
      ...options,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ConversionProblem);
    const problem = error as ConversionProblem;
    expect(problem.message).toBe(PROBLEM_MESSAGES[problem.code]);
    return { code: problem.code, steps };
  }
  throw new Error('expected the file to be refused');
}

describe('files that are not clean', () => {
  it('converts an ASCII STL like a binary one', async () => {
    const soup = generateFigure(true);
    const fromAscii = await runPipeline(ascii(encodeAsciiStl(soup)), { bake: BAKE });
    const fromBinary = await runPipeline(encodeBinaryStl(soup), { bake: 0 });
    expectWholeMini(fromAscii);
    expect(fromAscii.stats.format).toBe('ascii');
    expect(fromAscii.stats.triangles).toBe(fromBinary.stats.triangles);
    // ASCII keeps 7 digits, a little less than a float: the levels differ by a few triangles.
    fromAscii.stats.lods.forEach((lod, i) =>
      expect(lod.triangles / fromBinary.stats.lods[i]!.triangles).toBeCloseTo(1, 1),
    );
  }, 120_000);

  it('drops triangles without area and repeated triangles, and says how many', async () => {
    const clean = Array.from(generateFigure(true));
    const soup = [...clean];
    for (let t = 0; t < 300; t++) {
      const at = t * 9 * 97;
      soup.push(...clean.slice(at, at + 9)); // a repeat
      soup.push(
        ...clean.slice(at, at + 3),
        ...clean.slice(at, at + 3),
        ...clean.slice(at + 3, at + 6),
      ); // two corners in one
      const [x, y, z] = clean.slice(at, at + 3) as Vec3;
      soup.push(x, y, z, x + 1, y, z, x + 2, y, z); // corners on one line
    }
    const result = await runPipeline(encodeBinaryStl(soup), { bake: BAKE });
    expectWholeMini(result);
    expect(result.stats.duplicateTriangles).toBe(300);
    expect(result.stats.degenerateTriangles).toBe(600);
    expect(result.stats.triangles).toBe(clean.length / 9);
  }, 120_000);

  it('converts a mesh with non-manifold edges: boxes sharing an edge, fins, a lone triangle', async () => {
    const soup: number[] = [];
    box(soup, [0, 0, 0], [10, 10, 20]);
    box(soup, [10, 10, 0], [20, 20, 20]); // shares the edge x = y = 10 with the first box
    box(soup, [0, 10, 0], [10, 20, 5]); // touches both along a face and an edge
    soup.push(0, 0, 20, 10, 0, 20, 5, -8, 30); // a fin on the first box's top edge
    soup.push(0, 0, 20, 10, 0, 20, 5, 8, 35); // and another on the same edge
    soup.push(30, 30, 0, 32, 30, 0, 31, 32, 4); // a lone triangle
    const result = await runPipeline(encodeBinaryStl(soup), { bake: BAKE });
    expectWholeMini(result);
    expect(result.stats.triangles).toBe(soup.length / 9);
  }, 120_000);

  it('converts several parts that do not touch', async () => {
    const soup: number[] = [];
    for (let k = 0; k < 6; k++)
      addBlob(soup, [(k % 3) * 20, Math.floor(k / 3) * 20, 5], [4, 4, 5], 12, 0.1);
    const result = await runPipeline(encodeBinaryStl(soup), { bake: BAKE });
    expectWholeMini(result);
    expect(result.stats.sizeMm[0]).toBeCloseTo(48, 0);
  }, 120_000);

  it('drops triangles with NaN or infinite coordinates, and says how many', async () => {
    const soup = generateBumpySheet(40);
    for (let t = 0; t < 50; t++) soup[t * 9 * 61 + (t % 9)] = t % 2 ? NaN : Infinity;
    const result = await runPipeline(encodeBinaryStl(soup), { bake: BAKE });
    expectWholeMini(result);
    expect(result.stats.invalidTriangles).toBe(50);
    expect(result.stats.sourceTriangles).toBe(soup.length / 9);
    expect(result.stats.sizeMm[0]).toBeCloseTo(50, 0);
  }, 120_000);

  it('refuses a file in which no triangle is usable', async () => {
    const soup = generateBumpySheet(4).fill(NaN);
    expect((await refusal(encodeBinaryStl(soup))).code).toBe('no-surface');
    const flat = new Float32Array(90).fill(1);
    expect((await refusal(encodeBinaryStl(flat))).code).toBe('no-surface');
  });

  it('refuses an empty file, a cut-off file and a file that is not an STL, before any step', async () => {
    const whole = encodeBinaryStl(generateBumpySheet(20));
    const text = encodeAsciiStl(generateBumpySheet(4));
    const cases: [ArrayBuffer, ProblemCode][] = [
      [new ArrayBuffer(0), 'empty'],
      [encodeBinaryStl([]), 'empty'],
      [whole.slice(0, whole.byteLength - 20), 'truncated'],
      [ascii(text.slice(0, text.length / 2)), 'truncated'],
      [ascii('<html><body>Not found</body></html>'), 'not-stl'],
    ];
    for (const [stl, expected] of cases) {
      const { code, steps } = await refusal(stl);
      expect(code).toBe(expected);
      expect(steps.filter((step) => step !== 'read')).toEqual([]);
    }
  });

  it('refuses a file too large for the memory it may use, before reading it', async () => {
    const stl = encodeBinaryStl(generateBumpySheet(20));
    const needed = estimateConversionBytes(stl.byteLength, 'binary');
    const { code, steps } = await refusal(stl, { memoryBudgetBytes: needed - 1 });
    expect(code).toBe('too-large');
    expect(steps).toEqual([]);
    const fits = await runPipeline(stl, { bake: 0, memoryBudgetBytes: needed });
    expect(fits.stats.timings.map((t) => t.step)).toEqual([...STEPS]);
  });
});
