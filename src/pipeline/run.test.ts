import { describe, expect, it, vi } from 'vitest';
import { KTX2_ZSTANDARD, readKtx2Header } from './compress';
import { generateBumpySheet } from './generate';
import { BAKE_STEPS, runPipeline, STEPS, type Progress } from './run';
import { encodeBinaryStl } from './stl';

// One test makes the encoder fail once; every other call is the real one.
vi.mock('./compress', async (importOriginal) => {
  const original = await importOriginal<typeof import('./compress')>();
  return { ...original, compressDetail: vi.fn(original.compressDetail) };
});
const { compressDetail } = await import('./compress');

const sheet = (): ArrayBuffer => encodeBinaryStl(generateBumpySheet(40));
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
});
