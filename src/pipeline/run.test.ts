import { describe, expect, it, vi } from 'vitest';
import { KTX2_ZSTANDARD, readKtx2Header } from './compress';
import { generateBumpySheet } from './generate';
import { BAKE_STEPS, runPipeline, STEPS, type Progress } from './run';
import { PLAIN_BASE_HEIGHT_MM } from './base';
import { encodeBinaryStl } from './stl';
import { generateFigure, generateSwarm } from '../regression/shapes';

// One test makes the encoder fail once; every other call is the real one.
vi.mock('./compress', async (importOriginal) => {
  const original = await importOriginal<typeof import('./compress')>();
  return { ...original, compressDetail: vi.fn(original.compressDetail) };
});
const { compressDetail } = await import('./compress');

const sheet = (): ArrayBuffer => encodeBinaryStl(generateBumpySheet(40));

/** Outward-facing box as a Z-up triangle soup. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const soup: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    soup.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  return soup;
}

/**
 * A Z-up table, 30 × 12 × 14 mm on four legs with flat pads, stored tilted about x by the
 * 3-4-5 turn (cos 0.8, sin 0.6, about 36.9°).
 */
function tiltedTable(): ArrayBuffer {
  const soup = box(-15, -6, 10, 15, 6, 14);
  for (const x of [-14, 12]) for (const y of [-5, 3]) soup.push(...box(x, y, 0, x + 2, y + 2, 10));
  const tilted = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    tilted[i] = soup[i]!;
    tilted[i + 1] = 0.8 * soup[i + 1]! - 0.6 * soup[i + 2]!;
    tilted[i + 2] = 0.6 * soup[i + 1]! + 0.8 * soup[i + 2]!;
  }
  return encodeBinaryStl(tilted);
}
const BAKE = 256;

describe('runPipeline', () => {
  it('bakes and compresses as timed steps with progress, and keeps only the KTX2 file', async () => {
    const progress: Progress[] = [];
    const { baked, stats } = await runPipeline(sheet(), {
      bake: BAKE,
      onProgress: (p) => progress.push(p),
    });

    const steps = [...STEPS, ...BAKE_STEPS];
    expect(stats.timings.map((timing) => timing.step)).toEqual(steps);
    expect(progress.filter((p) => p.stepPercent === undefined).map((p) => p.step)).toEqual(steps);
    expect(progress.some((p) => p.step === 'unwrap' && p.stepPercent !== undefined)).toBe(true);
    const percents = progress.map((p) => p.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(stats.totalMs).toBeCloseTo(stats.timings.reduce((sum, t) => sum + t.ms, 0));

    expect(stats.bakeSkipped).toBeNull();
    expect(baked?.detail).toBeNull();
    expect(baked && 'detail' in baked.maps).toBe(false);
    expect(readKtx2Header(baked!.ktx2!)).toMatchObject({
      width: BAKE,
      supercompression: KTX2_ZSTANDARD,
    });
  }, 120_000);

  it('bakes without being asked to, at the size the policy picks', async () => {
    // A 50 mm sheet has 2,500 mm² and more: 0.1 mm texels at half coverage need 1024 px.
    const { baked } = await runPipeline(sheet());
    expect(baked?.maps.resolution).toBe(1024);
    expect(baked?.ktx2).not.toBeNull();
  }, 120_000);

  it('falls back to the per-vertex look when a baking step fails', async () => {
    vi.mocked(compressDetail).mockRejectedValueOnce(new Error('encoder did not load'));
    const { baked, lods, stats } = await runPipeline(sheet(), { bake: BAKE });

    expect(baked).toBeUndefined();
    expect(stats.bakeSkipped).toEqual({
      reason: 'failed',
      step: 'compress',
      message: 'encoder did not load',
    });
    // The mini itself is whole: every level, with the per-vertex data the look needs.
    expect(lods).toHaveLength(3);
    for (const lod of lods) expect(lod.mesh.cavity?.length).toBe(lod.mesh.positions.length / 3);
  }, 120_000);

  it('ends in the memory message when baking runs out of memory, instead of falling back', async () => {
    vi.mocked(compressDetail).mockRejectedValueOnce(
      new RangeError('Array buffer allocation failed'),
    );
    await expect(runPipeline(sheet(), { bake: BAKE })).rejects.toMatchObject({
      name: 'ConversionProblem',
      code: 'out-of-memory',
      detail: 'Array buffer allocation failed',
    });
  }, 120_000);

  it('falls back to the per-vertex look when the device cannot hold the texture', async () => {
    const { baked, stats } = await runPipeline(sheet(), { maxTextureSize: 512 });
    expect(baked).toBeUndefined();
    expect(stats.bakeSkipped).toEqual({ reason: 'device', resolution: 1024, maxTextureSize: 512 });
    expect(stats.timings.map((timing) => timing.step)).toEqual([...STEPS]);
  });

  it('development: baking can be switched off, and so can compression', async () => {
    const plain = await runPipeline(sheet(), { bake: 0 });
    expect(plain.baked).toBeUndefined();
    expect(plain.stats.bakeSkipped).toBeNull();

    const raw = await runPipeline(sheet(), { bake: BAKE, compress: null });
    expect(raw.baked?.ktx2).toBeNull();
    expect(raw.baked?.detail?.length).toBe(BAKE * BAKE * 4);
    expect(raw.stats.timings.map((timing) => timing.step)).not.toContain('compress');
  }, 120_000);

  it('sizes the mini between orient and simplify: units, base and the suggested size', async () => {
    const { sizing, stats } = await runPipeline(encodeBinaryStl(generateFigure(true)), { bake: 0 });
    expect(STEPS.indexOf('size')).toBe(STEPS.indexOf('orient') + 1);
    expect(STEPS.indexOf('simplify')).toBe(STEPS.indexOf('size') + 1);
    expect(sizing).toMatchObject({
      units: 'mm',
      unitsMethod: 'guessed',
      scale: 1,
      size: 'medium',
      sizeMethod: 'suggested',
      footprintSquares: 1,
      suggestedFrom: 'base',
      plainBase: null,
      warnings: [],
    });
    expect(sizing.base).toMatchObject({ shape: 'round' });
    expect(sizing.baseDiameterMm).toBeCloseTo(25, 0);
    expect(stats.sizing).toBe(sizing);
  }, 60_000);

  it('records the orientation: a quarter turn for a mini on a base', async () => {
    const { orientation, stats } = await runPipeline(encodeBinaryStl(generateFigure(true)), {
      bake: 0,
    });
    expect(orientation).toMatchObject({ up: '+z', method: 'base', tiltDeg: 0, setDownDeg: 0 });
    expect(stats.orientation).toBe(orientation);
    expect(stats).toMatchObject({ up: '+z', upMethod: 'base' });
  }, 60_000);

  it('sets a tilted mini down when the user picks its axis, and puts a plain base under it', async () => {
    const { orientation, stats, mesh } = await runPipeline(tiltedTable(), {
      bake: 0,
      orientation: { up: '+z' },
      sizing: { plainBase: true },
    });
    expect(orientation).toMatchObject({ up: '+z', method: 'manual' });
    // The 3-4-5 turn: acos(0.8) = 36.87°.
    expect(orientation.tiltDeg).toBeCloseTo(36.87, 1);
    expect(stats.sizing.plainBase).not.toBeNull();
    // The plain base stands on y = 0, and the four pads (16 corners) rest level on its top.
    let floor = Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) floor = Math.min(floor, mesh.positions[i]!);
    expect(floor).toBe(0);
    let onBase = 0;
    for (let i = 1; i < mesh.positions.length; i += 3)
      if (Math.abs(mesh.positions[i]! - PLAIN_BASE_HEIGHT_MM) < 1e-3) onBase++;
    expect(onBase).toBeGreaterThanOrEqual(16);
  }, 60_000);

  it('reads a file in inches as inches and brings it to mm', async () => {
    const inches = generateFigure(true).map((value) => value / 25.4);
    const { sizing, stats, lods } = await runPipeline(encodeBinaryStl(inches), { bake: 0 });
    expect(sizing).toMatchObject({ units: 'in', scale: 25.4, size: 'medium' });
    expect(sizing.baseDiameterMm).toBeCloseTo(25, 0);
    expect(stats.sizeMm[0]).toBeCloseTo(25, 0);
    // The levels are made from the mesh in mm: their error budgets are in mm.
    expect(lods[0]!.mesh.positions.some((value) => value > 12)).toBe(true);
  }, 60_000);

  it('adds a plain base under a figure without one when asked', async () => {
    const stl = encodeBinaryStl(generateFigure(false));
    const bare = await runPipeline(stl, { bake: 0 });
    const { sizing, stats, mesh } = await runPipeline(stl, {
      bake: 0,
      sizing: { plainBase: true },
    });
    expect(bare.sizing).toMatchObject({ base: null, plainBase: null, size: 'medium' });
    expect(sizing).toMatchObject({
      base: null,
      plainBase: { diameterMm: 32, heightMm: 3 },
      size: 'medium',
      baseDiameterMm: 32,
    });
    expect(stats.triangles).toBeGreaterThan(bare.stats.triangles);
    expect(stats.sizeMm[1]).toBeCloseTo(bare.stats.sizeMm[1] + 3, 4);
    expect(stats.sizeMm[0]).toBeCloseTo(32, 4);
    // Stands on y = 0, on the base.
    let minY = Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) minY = Math.min(minY, mesh.positions[i]!);
    expect(minY).toBe(0);
  }, 60_000);

  it('makes the plain base follow the chosen size', async () => {
    const { sizing } = await runPipeline(encodeBinaryStl(generateFigure(false)), {
      bake: 0,
      sizing: { plainBase: true, size: 'large' },
    });
    expect(sizing).toMatchObject({ plainBase: { diameterMm: 50 }, baseDiameterMm: 50 });
  }, 60_000);

  it('adds no plain base to a mini that has one', async () => {
    const { sizing } = await runPipeline(encodeBinaryStl(generateFigure(true)), {
      bake: 0,
      sizing: { plainBase: true },
    });
    expect(sizing).toMatchObject({ plainBase: null, base: { shape: 'round' } });
  }, 60_000);

  it('scales a 25 mm base to 32 mm when asked, and nothing else changes size', async () => {
    const stl = encodeBinaryStl(generateFigure(true));
    const kept = await runPipeline(stl, { bake: 0 });
    const scaledUp = await runPipeline(stl, { bake: 0, sizing: { scaleToBaseMm: 32 } });
    const factor = 32 / kept.sizing.baseDiameterMm;
    expect(scaledUp.sizing.scale).toBeCloseTo(factor, 6);
    expect(factor).toBeCloseTo(1.28, 1);
    for (let axis = 0; axis < 3; axis++)
      expect(scaledUp.stats.sizeMm[axis]).toBeCloseTo(kept.stats.sizeMm[axis]! * factor, 3);
    expect(scaledUp.sizing).toMatchObject({ size: 'medium', baseDiameterMm: 32, warnings: [] });
  }, 60_000);

  it('warns when the chosen size is smaller than the base, and does not rescale', async () => {
    const { sizing, stats } = await runPipeline(encodeBinaryStl(generateSwarm()), {
      bake: 0,
      sizing: { size: 'medium' },
    });
    expect(sizing.scale).toBe(1);
    expect(stats.sizeMm[0]).toBeCloseTo(50, 0);
    expect(sizing.warnings).toEqual([
      { kind: 'base-exceeds-footprint', baseMm: sizing.baseDiameterMm, footprintMm: 32 },
    ]);
  }, 60_000);
});
