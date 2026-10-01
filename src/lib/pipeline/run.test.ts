import { describe, expect, it, vi } from 'vitest';
import { KTX2_ZSTANDARD, readKtx2Header } from './compress';
import { generateBumpySheet } from './generate';
import type {
  Answer,
  AskUp,
  MeetAction,
  MeetAnswer,
  MeetQuestion,
  Question,
  UpAnswer,
  UpQuestion,
} from './ask';
import type { Vec3 } from './base';
import type { Meeting, PartJoint } from './marks';
import type { OrientationOptions } from './orient';
import { BAKE_STEPS, runPipeline, STEPS, type ConversionResult, type Progress } from './run';
import { AXIS_ROTATION, fromAxisAngle, multiply, type Rotation } from './rotation';
import { PLAIN_BASE_HEIGHT_MM } from './base';
import { encodeBinaryStl } from './stl';
import {
  generateFigure,
  generatePegFigure,
  generatePuddleFigure,
  generatePuddleFigureParts,
  generateQuadruped,
  generateRecessBase,
  generateSwarm,
  generateWingedFigure,
  movedSoup,
  RECESS_BASE,
  WINGED_FIGURE,
} from '../../regression/shapes';
import { estimateConversionBytes } from './memory';

/** The steps of a single file: `place` runs for a figure with its base file only. */
const ONE_FILE_STEPS = STEPS.filter((step) => step !== 'place' && step !== 'assemble');
/** A figure with its base file: every step but the assemble step of a figure in parts (#93). */
const PAIR_STEPS = STEPS.filter((step) => step !== 'assemble');

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

    const steps = [...ONE_FILE_STEPS, ...BAKE_STEPS];
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
    expect(stats.timings.map((timing) => timing.step)).toEqual([...ONE_FILE_STEPS]);
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
    expect(STEPS.indexOf('place')).toBe(STEPS.indexOf('orient') + 1);
    expect(STEPS.indexOf('size')).toBe(STEPS.indexOf('place') + 1);
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
      orientation: { up: '+z', setDown: true },
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

describe('runPipeline with a base file (#70)', () => {
  const figure = (): ArrayBuffer => encodeBinaryStl(generatePuddleFigure(12));
  const base = (): ArrayBuffer => encodeBinaryStl(generateRecessBase());

  it('sets the figure in the recess and merges the two before reducing', async () => {
    const result = await runPipeline(figure(), { bake: 0, secondStl: base() });
    const { pair, stats, sizing, mesh } = result;
    expect(stats.timings.map((t) => t.step)).toEqual([...PAIR_STEPS]);
    expect(pair).not.toBeNull();
    expect(stats.pair).toBe(pair);
    expect(pair!.pairing).toMatchObject({
      baseFile: 1,
      method: 'guessed',
      warnings: ['figure-has-its-own-base'],
    });
    expect(pair!.placement!.spot.kind).toBe('recess');
    expect(pair!.placement!.offsetMm).toEqual([0, 0, 3]);
    // Measured from the base file: 32 mm round, not the puddle.
    expect(sizing.base).toMatchObject({ shape: 'round', diameterMm: 32 });
    expect(sizing).toMatchObject({ size: 'medium', plainBase: null });
    // The figure first: its triangles use its vertices only.
    const figureTriangles = mesh.indices.subarray(0, pair!.figureTriangles * 3);
    expect(figureTriangles.reduce((a, b) => Math.max(a, b), 0)).toBeLessThan(pair!.figureVertices);
    expect(stats.triangles).toBeGreaterThan(pair!.figureTriangles);
    // Stands on y = 0, 3 mm of rim under the puddle and the figure's own height above it.
    expect(stats.sizeMm[0]).toBeCloseTo(32, 3);
    expect(stats.sizeMm[1]).toBeGreaterThan(30.9 + 3 - 0.01);
    expect(stats.orientation.up).toBe('+z');
  }, 60_000);

  it('finds the base in either order, and swaps when asked', async () => {
    const reversed = await runPipeline(base(), { bake: 0, secondStl: figure() });
    expect(reversed.pair!.pairing.baseFile).toBe(0);
    expect(reversed.pair!.placement!.offsetMm).toEqual([0, 0, 3]);
    const swapped = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      pairing: { swap: true },
    });
    expect(swapped.pair!.pairing).toMatchObject({ baseFile: 0, method: 'manual' });
    expect(swapped.sizing.base?.diameterMm).toBeCloseTo(12, 3);
  }, 60_000);

  it('passes the user’s placement through', async () => {
    const moved = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      placement: { moveMm: [1, 0], liftMm: 0.5 },
    });
    expect(moved.pair!.placement!.method).toBe('manual');
    expect(moved.pair!.placement!.offsetMm[0]).toBe(1);
  }, 60_000);

  it('refuses two figures, and a pair too large for the device', async () => {
    const figures = runPipeline(encodeBinaryStl(generateFigure(false)), {
      bake: 0,
      secondStl: encodeBinaryStl(generatePegFigure(2)),
    });
    await expect(figures).rejects.toMatchObject({ name: 'ConversionProblem', code: 'not-a-pair' });
    const small = await runPipeline(figure(), { bake: 0, secondStl: base() }).then(() => 0);
    expect(small).toBe(0);
    // Each file fits the budget alone; the two together do not.
    const budget = estimateConversionBytes(figure().byteLength, 'binary') + 1;
    await expect(
      runPipeline(figure(), { bake: 0, secondStl: figure(), memoryBudgetBytes: budget }),
    ).rejects.toMatchObject({ code: 'too-large' });
  }, 60_000);

  it('stands the base as the user chose: turned over, or turned freely (#92)', async () => {
    const detected = await runPipeline(figure(), { bake: 0, secondStl: base() });
    expect(detected.pair!.baseOrientation).toMatchObject({ up: '+z', method: 'base' });
    expect(detected.choices).toEqual({ orientation: {}, baseOrientation: {}, pairing: {} });
    const unchanged = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      baseOrientation: {},
    });
    expectSameMini(unchanged, detected);

    // Upside down, the flat underside is the top the figure stands on, 4 mm up.
    const over = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      baseOrientation: { up: '-z' },
    });
    expect(over.pair!.baseOrientation).toMatchObject({ up: '-z', method: 'manual' });
    expect(over.pair!.pairing.files[1]).toMatchObject({ up: '-z', upMethod: 'manual' });
    expect(over.pair!.placement!.spot.kind).toBe('flat');
    expect(over.pair!.placement!.offsetMm[2]).toBeCloseTo(4, 3);
    expect(over.sizing.base).toMatchObject({ shape: 'round' });
    expect(over.sizing.base!.diameterMm).toBeCloseTo(32, 0);

    const rotation = multiply(fromAxisAngle([1, 0, 0], 5), AXIS_ROTATION['+z']);
    const tilted = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      baseOrientation: { rotation },
    });
    expect(tilted.pair!.baseOrientation!.rotation).toBe(rotation);
    expect(tilted.choices.baseOrientation).toEqual({ rotation });
  }, 60_000);

  it('keeps a registered pair where the files put it, standing the way its base does', async () => {
    // The figure raised onto the recess floor in its own file: the two files share one frame.
    const soup = generatePuddleFigure(12);
    for (let i = 2; i < soup.length; i += 3) soup[i] = soup[i]! + 3;
    const registered = await runPipeline(encodeBinaryStl(soup), { bake: 0, secondStl: base() });
    expect(registered.pair!.placement!.spot.kind).toBe('registered');
    expect(registered.pair!.placement!.offsetMm).toEqual([0, 0, 3]);
    expect(registered.orientation).toBe(registered.stats.orientation);
    expect(registered.orientation).toMatchObject({ up: '+z', method: 'base' });
    // The user's axis for the figure is final: no registration test.
    const chosen = await runPipeline(encodeBinaryStl(soup), {
      bake: 0,
      secondStl: base(),
      orientation: { up: '+z' },
    });
    expect(chosen.pair!.placement!.spot.kind).not.toBe('registered');
  }, 60_000);
});

/**
 * An `askUp` that answers from a list, in order, and keeps every question it was asked: the up
 * questions in `questions`, the meet questions in `meets`, all of them in `all`. A meet question
 * that meets an up answer, or no answer left, is confirmed as shown: the tests of #92 need not
 * answer the meeting's two stops.
 */
function answering(
  ...answers: Answer[]
): AskUp & { questions: UpQuestion[]; meets: MeetQuestion[]; all: Question[] } {
  const questions: UpQuestion[] = [];
  const meets: MeetQuestion[] = [];
  const all: Question[] = [];
  const ask = (question: Question): Promise<Answer> => {
    all.push(question);
    if (question.kind === 'up') questions.push(question);
    else meets.push(question);
    if (question.kind === 'meet' && answers[0]?.kind !== 'meet') return Promise.resolve(asShown());
    const answer = answers.shift();
    if (!answer) return Promise.reject(new Error(`no answer left for question ${all.length}`));
    return Promise.resolve(answer);
  };
  return Object.assign(ask, { questions, meets, all });
}

const confirm = (orientation: OrientationOptions = {}): UpAnswer => ({
  kind: 'up',
  orientation,
  confirm: true,
});
const tryOut = (orientation: OrientationOptions = {}): UpAnswer => ({
  kind: 'up',
  orientation,
  confirm: false,
});
/** An action at a meet question. */
const meet = (action: MeetAction): MeetAnswer => ({ kind: 'meet', action });
/** A meet question confirmed as shown: at the pairs stop, put together; at the final view, go on. */
const asShown = (): MeetAnswer => meet({ do: 'confirm' });

/** The bytes of a typed array, to compare two meshes bit for bit. */
const bits = (array: Float32Array | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function expectSameMini(a: ConversionResult, b: ConversionResult): void {
  expect(bits(a.mesh.positions)).toEqual(bits(b.mesh.positions));
  expect(bits(a.mesh.indices)).toEqual(bits(b.mesh.indices));
  expect(a.lods.length).toBe(b.lods.length);
  a.lods.forEach((lod, k) => {
    expect(bits(lod.mesh.positions)).toEqual(bits(b.lods[k]!.mesh.positions));
    expect(bits(lod.mesh.indices)).toEqual(bits(b.lods[k]!.mesh.indices));
  });
  expect(a.orientation).toEqual(b.orientation);
  expect(a.pair).toEqual(b.pair);
}

/** The generated figure without a base, stored lying: its up is +x, and the detection takes +z. */
function lyingFigure(): ArrayBuffer {
  const soup = generateFigure(false);
  const lying = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    lying[i] = soup[i + 2]!;
    lying[i + 1] = soup[i + 1]!;
    lying[i + 2] = 0 - soup[i]!;
  }
  return encodeBinaryStl(lying);
}

describe('runPipeline asking which way is up (#92)', () => {
  const upright = (): ArrayBuffer => encodeBinaryStl(generateFigure(true));

  it('without a callback asks nothing; confirming the proposal at once gives the same bits', async () => {
    const plain = await runPipeline(upright(), { bake: 0 });
    expect(plain.stats.asked).toEqual([]);
    expect(plain.choices).toEqual({ orientation: {} });
    expect(plain.stats.choices).toBe(plain.choices);

    const ask = answering(confirm());
    const asked = await runPipeline(upright(), { bake: 0, askUp: ask });
    expectSameMini(asked, plain);
    expect(ask.questions).toHaveLength(1);
    const [question] = ask.questions;
    expect(question).toMatchObject({ role: 'mini', file: 0, reason: 'base', warnings: [] });
    expect(question!.orientation).toEqual(plain.orientation);
    expect(question!.base).toMatchObject({ shape: 'round' });
    expect(question!.meshes.map((m) => m.file)).toEqual([0]);
    expect(question!.meshes[0]!.mesh.indices.length).toBe(plain.stats.triangles * 3);
    // The box of the turned file, standing on the grid: 25 mm across, as tall as the mini.
    expect(question!.box.max[0] - question!.box.min[0]).toBeCloseTo(25, 0);
    expect(question!.box.max[1] - question!.box.min[1]).toBeCloseTo(plain.stats.sizeMm[1], 4);
    expect(asked.stats.asked).toEqual([{ role: 'mini', tries: 0, waitedMs: expect.any(Number) }]);
    expect(asked.stats.timings.map((t) => t.step)).toEqual([...ONE_FILE_STEPS]);
  }, 60_000);

  it('shows an axis tried at the question and converts once with it', async () => {
    const ask = answering(tryOut({ up: '+x' }), confirm({ up: '+x' }));
    const progress: Progress[] = [];
    const result = await runPipeline(lyingFigure(), {
      bake: 0,
      askUp: ask,
      onProgress: (p) => progress.push(p),
    });
    const [first, second] = ask.questions;
    expect(first).toMatchObject({
      reason: 'tallest',
      orientation: { up: '+z', method: 'tallest' },
    });
    expect(first!.meshes).toHaveLength(1);
    expect(second).toMatchObject({ reason: 'chosen', orientation: { up: '+x', method: 'manual' } });
    expect(second!.meshes).toHaveLength(0);
    // Standing on +x: about 30 mm tall.
    expect(result.orientation).toMatchObject({ up: '+x', method: 'manual' });
    expect(result.stats.sizeMm[1]).toBeGreaterThan(29);
    expect(result.choices).toEqual({ orientation: { up: '+x' } });
    expect(result.stats.asked).toEqual([{ role: 'mini', tries: 1, waitedMs: expect.any(Number) }]);
    // One entry per step, and each step announced once.
    expect(result.stats.timings.map((t) => t.step)).toEqual([...ONE_FILE_STEPS]);
    expect(progress.map((p) => p.step)).toEqual([...ONE_FILE_STEPS]);
  }, 60_000);

  it('keeps a rotation to the bit, and reports setting down', async () => {
    // Not one of the six ways: a quarter turn about x and a little more.
    const rotation: Rotation = [-0.7, 0.1, 0.05, 0.7];
    const turned = await runPipeline(lyingFigure(), {
      bake: 0,
      askUp: answering(confirm({ rotation })),
    });
    expect(turned.orientation.method).toBe('manual');
    expect(turned.orientation.rotation.every((value, i) => Object.is(value, rotation[i]))).toBe(
      true,
    );
    expect(turned.choices.orientation.rotation).toBe(rotation);

    const setDown = { up: '+z', setDown: true } as const;
    const ask = answering(tryOut(setDown), confirm(setDown));
    const result = await runPipeline(tiltedTable(), { bake: 0, askUp: ask });
    // The 3-4-5 turn: the table rests 36.87° off its axis.
    expect(ask.questions[1]!.orientation.setDownDeg).toBeGreaterThan(30);
    expect(result.orientation.setDownDeg).toBe(ask.questions[1]!.orientation.setDownDeg);
  }, 60_000);

  it('asks with the axis a conversion came with, and Reset brings the detection back', async () => {
    const ask = answering(tryOut({}), confirm({}));
    const result = await runPipeline(upright(), {
      bake: 0,
      orientation: { up: '+y' },
      askUp: ask,
    });
    expect(ask.questions[0]).toMatchObject({ reason: 'chosen', orientation: { up: '+y' } });
    expect(ask.questions[1]).toMatchObject({ reason: 'base', orientation: { up: '+z' } });
    expect(result.orientation).toMatchObject({ up: '+z', method: 'base' });
    expect(result.choices).toEqual({ orientation: {} });
  }, 60_000);

  it('asks nothing when the file is not to be asked about', async () => {
    const ask = answering();
    const result = await runPipeline(upright(), { bake: 0, askUp: ask, ask: { up: false } });
    expect(ask.questions).toHaveLength(0);
    expect(result.stats.asked).toEqual([]);
  }, 60_000);

  it('sends a copy: detaching it changes nothing, and the choices convert the same mini again', async () => {
    const ask: AskUp = (question) => {
      // What a worker does when it posts the question: the buffers go to the page.
      const { mesh } = question.meshes[0]!;
      structuredClone(mesh, { transfer: [mesh.positions.buffer, mesh.indices.buffer] });
      expect(mesh.positions.length).toBe(0);
      return Promise.resolve(confirm({ up: '+x' }));
    };
    const result = await runPipeline(lyingFigure(), { bake: 0, askUp: ask });
    expect(result.orientation.up).toBe('+x');
    const again = await runPipeline(lyingFigure(), { bake: 0, ...result.choices });
    expectSameMini(again, result);
  }, 60_000);

  it('ends with the error of a rejecting callback, and a person’s wait is in no step', async () => {
    const refusing: AskUp = () => Promise.reject(new Error('the page went away'));
    await expect(runPipeline(upright(), { bake: 0, askUp: refusing })).rejects.toThrow(
      'the page went away',
    );

    const WAIT_MS = 500;
    const slow: AskUp = () =>
      new Promise((resolve) => setTimeout(() => resolve(confirm()), WAIT_MS));
    const { stats } = await runPipeline(upright(), { bake: 0, askUp: slow });
    expect(stats.asked[0]!.waitedMs).toBeGreaterThanOrEqual(WAIT_MS - 5);
    expect(stats.timings.find((t) => t.step === 'orient')!.ms).toBeLessThan(WAIT_MS);
    expect(stats.totalMs).toBeCloseTo(stats.timings.reduce((sum, t) => sum + t.ms, 0));
  }, 60_000);
});

describe('runPipeline asking about a pair (#92)', () => {
  const figure = (): ArrayBuffer => encodeBinaryStl(generatePuddleFigure(12));
  const base = (): ArrayBuffer => encodeBinaryStl(generateRecessBase());
  const swap: UpAnswer = { kind: 'up', orientation: {}, confirm: false, swap: true };

  /** The puddle figure raised onto the recess floor in its own file: the two files share one frame. */
  function registeredFigure(): ArrayBuffer {
    const soup = generatePuddleFigure(12);
    for (let i = 2; i < soup.length; i += 3) soup[i] = soup[i]! + 3;
    return encodeBinaryStl(soup);
  }

  it('asks about the base, then the figure; confirming both converts as without asking', async () => {
    const plain = await runPipeline(figure(), { bake: 0, secondStl: base() });
    const ask = answering(confirm(), confirm());
    const asked = await runPipeline(figure(), { bake: 0, secondStl: base(), askUp: ask });
    expectSameMini(asked, plain);
    const [baseQuestion, figureQuestion] = ask.questions;
    expect(baseQuestion).toMatchObject({
      role: 'base',
      file: 1,
      reason: 'underside',
      orientation: { up: '+z', method: 'base' },
      warnings: ['figure-has-its-own-base'],
    });
    expect(baseQuestion!.base).toMatchObject({ shape: 'round' });
    expect(baseQuestion!.meshes[0]!.mesh.indices.length).toBe(generateRecessBase().length / 3);
    expect(figureQuestion).toMatchObject({ role: 'figure', file: 0, reason: 'base' });
    expect(figureQuestion!.meshes.map((m) => m.file)).toEqual([0]);
    expect(asked.stats.asked.map((a) => [a.role, a.tries])).toEqual([
      ['base', 0],
      ['figure', 0],
      ['meet', 0],
    ]);
    expect(asked.choices).toEqual({ orientation: {}, baseOrientation: {}, pairing: {} });
    expect(asked.pair!.pairing.method).toBe('guessed');
    expect(asked.stats.timings.map((t) => t.step)).toEqual([...PAIR_STEPS]);
  }, 60_000);

  it('shows a registered figure the way its base stands; a changed figure is not registered', async () => {
    const ask = answering(confirm(), confirm());
    const registered = await runPipeline(registeredFigure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    expect(ask.questions[1]).toMatchObject({ role: 'figure', reason: 'registered' });
    expect(ask.questions[1]!.orientation.rotation).toEqual(ask.questions[0]!.orientation.rotation);
    expect(registered.pair!.placement!.spot.kind).toBe('registered');

    const changed = await runPipeline(registeredFigure(), {
      bake: 0,
      secondStl: base(),
      askUp: answering(confirm(), confirm({ up: '+z' })),
    });
    expect(changed.pair!.placement!.spot.kind).not.toBe('registered');
    expect(changed.orientation).toMatchObject({ up: '+z', method: 'manual' });
  }, 60_000);

  it('tests the figure against the base as it was confirmed', async () => {
    // The base turned over: the files no longer meet where they did.
    const ask = answering(tryOut({ up: '-z' }), confirm({ up: '-z' }), confirm());
    const result = await runPipeline(registeredFigure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    expect(ask.questions[1]).toMatchObject({ role: 'base', reason: 'chosen' });
    expect(ask.questions[1]!.meshes).toHaveLength(0);
    expect(ask.questions[2]).toMatchObject({ role: 'figure', reason: 'base' });
    expect(result.pair!.placement!.spot.kind).toBe('flat');
    expect(result.pair!.baseOrientation).toMatchObject({ up: '-z', method: 'manual' });
    expect(result.choices).toEqual({
      orientation: {},
      baseOrientation: { up: '-z' },
      pairing: {},
    });
    expect(result.stats.asked.map((a) => [a.role, a.tries])).toEqual([
      ['base', 1],
      ['figure', 0],
      ['meet', 0],
    ]);
  }, 60_000);

  it('starts again with the other file as the base after a swap, at either question', async () => {
    const atBase = answering(swap, confirm(), confirm());
    const swappedAtBase = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: atBase,
    });
    expect(atBase.questions.map((q) => [q.role, q.file, q.meshes.length > 0])).toEqual([
      ['base', 1, true],
      ['base', 0, true],
      // The recess base's mesh went to the page with the first question.
      ['figure', 1, false],
    ]);
    expect(swappedAtBase.pair!.pairing).toMatchObject({ baseFile: 0, method: 'manual' });
    expect(swappedAtBase.choices.pairing).toEqual({ swap: true });

    const atFigure = answering(confirm(), swap, confirm(), confirm());
    const swappedAtFigure = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: atFigure,
    });
    expect(atFigure.questions.map((q) => [q.role, q.file])).toEqual([
      ['base', 1],
      ['figure', 0],
      ['base', 0],
      ['figure', 1],
    ]);
    expect(swappedAtFigure.choices.pairing).toEqual({ swap: true });
    expectSameMini(swappedAtFigure, swappedAtBase);
  }, 60_000);

  it('asks which file is the base when neither has a flat underside, and keeps the answer', async () => {
    const standing = (): ArrayBuffer => encodeBinaryStl(generateFigure(false));
    const low = (): ArrayBuffer => encodeBinaryStl(generateQuadruped());
    await expect(runPipeline(standing(), { bake: 0, secondStl: low() })).rejects.toMatchObject({
      code: 'not-a-pair',
    });

    const ask = answering(confirm(), confirm());
    const proposed = await runPipeline(standing(), { bake: 0, secondStl: low(), askUp: ask });
    expect(ask.questions[0]).toMatchObject({
      role: 'base',
      file: 1,
      reason: 'guess',
      warnings: ['no-flat-underside'],
    });
    expect(proposed.pair!.pairing).toMatchObject({
      baseFile: 1,
      method: 'manual',
      warnings: ['no-flat-underside'],
    });
    expect(proposed.choices.pairing).toEqual({ baseFile: 1 });
    const again = await runPipeline(standing(), { bake: 0, secondStl: low(), ...proposed.choices });
    expectSameMini(again, proposed);

    const swapped = await runPipeline(standing(), {
      bake: 0,
      secondStl: low(),
      askUp: answering(swap, confirm(), confirm()),
    });
    expect(swapped.pair!.pairing).toMatchObject({ baseFile: 0, method: 'manual' });
    expect(swapped.choices.pairing).toEqual({ baseFile: 0 });
  }, 60_000);
});
describe('runPipeline asking where the parts meet (#93)', () => {
  const figure = (): ArrayBuffer => encodeBinaryStl(generatePuddleFigure(12));
  const base = (): ArrayBuffer => encodeBinaryStl(generateRecessBase());
  const [bodySoup, armSoup] = generatePuddleFigureParts(12);
  const floor = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
  const WING_MOVE: Vec3 = [50, 0, 0];
  const moved = (p: Vec3): Vec3 => [p[0] + WING_MOVE[0], p[1] + WING_MOVE[1], p[2] + WING_MOVE[2]];
  /** Body, recess base and a wing exported 50 mm apart from where it belongs. */
  const kit = (): [ArrayBuffer, { secondStl: ArrayBuffer; moreStl: ArrayBuffer[] }] => {
    const { body, wing } = generateWingedFigure();
    return [
      encodeBinaryStl(body),
      {
        secondStl: base(),
        moreStl: [encodeBinaryStl(movedSoup(wing, WING_MOVE))],
      },
    ];
  };
  const tap = (file: number, point: Vec3, pair = 0): MeetAnswer =>
    meet({ do: 'tap', at: { file, point }, pair });

  it('proposes the pairs apart, then shows the placement, and converts as without asking', async () => {
    const plain = await runPipeline(figure(), { bake: 0, secondStl: base() });
    const ask = answering(confirm(), confirm());
    const asked = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    expectSameMini(asked, plain);
    const [baseQuestion, figureQuestion] = ask.questions;
    expect(baseQuestion!.shown.map((s) => s.file)).toEqual([1]);
    expect(figureQuestion!.shown.map((s) => s.file)).toEqual([0]);
    expect(baseQuestion!.roles).toEqual({ baseFile: 1, figureFiles: [0] });
    // Standing on the grid: the box's floor is y = 0.
    expect(figureQuestion!.box.min[1]).toBeCloseTo(0, 4);
    const [pairs, fitted] = ask.meets;
    expect(pairs).toMatchObject({
      kind: 'meet',
      about: 'base',
      stage: 'pairs',
      proposed: true,
      marks: null,
      placement: null,
      apart: null,
    });
    // Both meshes went with the up questions; none travels again.
    expect(pairs!.meshes).toEqual([]);
    // The figure stands beside its base, to its right.
    expect(pairs!.shown.map((s) => s.file)).toEqual([1, 0]);
    expect(pairs!.shown[1]!.translation[0]).toBeGreaterThan(pairs!.shown[0]!.translation[0] + 10);
    // The proposal: the puddle's underside on the recess floor, 3 mm up in the base's file.
    expect(pairs!.pairs).toHaveLength(1);
    const { on, of } = pairs!.pairs[0]!;
    expect(on!.file).toBe(1);
    expect(of!.file).toBe(0);
    expect(on!.centre[2]).toBeCloseTo(floor, 4);
    expect(on!.normal[2]).toBeCloseTo(1, 6);
    expect(of!.triangles.length).toBeGreaterThan(0);
    expect(fitted).toMatchObject({ stage: 'fitted', proposed: true });
    expect(fitted!.placement).toEqual(plain.pair!.placement);
    expect(asked.choices.placement).toBeUndefined();
    expect(asked.stats.asked.map((a) => [a.role, a.tries])).toEqual([
      ['base', 0],
      ['figure', 0],
      ['meet', 0],
    ]);
  }, 120_000);

  it('places the figure by the pairs tapped, nudged at the final view', async () => {
    const ask = answering(
      confirm(),
      confirm(),
      // The proposed pair dropped: the person marks from nothing.
      meet({ do: 'clear', pair: 0 }),
      tap(1, [3, 0, floor]),
      tap(0, [0, 0, 0]),
      meet({ do: 'fit' }),
      meet({ do: 'nudge', liftMm: 0.5 }),
      meet({ do: 'confirm' }),
    );
    const result = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    const stages = ask.meets.map((q) => [q.stage, q.proposed, q.placement?.method ?? null]);
    expect(stages).toEqual([
      ['pairs', true, null],
      ['pairs', false, null],
      ['pairs', false, null],
      ['pairs', false, null],
      ['fitted', false, 'marked'],
      ['fitted', false, 'marked'],
    ]);
    expect(ask.meets[1]!.pairs).toEqual([]);
    // One side marked after the first tap: the base's.
    expect(ask.meets[2]!.pairs.map(({ on, of }) => [on?.file, of])).toEqual([[1, null]]);
    expect(ask.meets[2]!.pairs[0]!.on!.normal[2]).toBe(1);
    const { placement } = result.pair!;
    expect(placement).toMatchObject({
      method: 'marked',
      spot: { kind: 'marked' },
    });
    expect(placement!.marks!.liftMm).toBe(0.5);
    expect(placement!.marks!.fit.kept).toBe('standing');
    const marks: Meeting = {
      pairs: [
        {
          on: { file: 1, strokes: [{ tap: [3, 0, floor] }] },
          of: { file: 0, strokes: [{ tap: [0, 0, 0] }] },
        },
      ],
      liftMm: 0.5,
    };
    expect(result.choices.placement).toEqual({ marks });
    expect(result.stats.asked.map((a) => [a.role, a.tries])).toEqual([
      ['base', 0],
      ['figure', 0],
      ['meet', 4],
    ]);
    // The choices convert the same mini again, asking nothing.
    const again = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      ...result.choices,
    });
    expectSameMini(again, result);
    // And a record set at once, fitted and confirmed, does too.
    const replayed = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: answering(
        confirm(),
        confirm(),
        meet({ do: 'set', marks }),
        meet({ do: 'fit' }),
        meet({ do: 'confirm' }),
      ),
    });
    expectSameMini(replayed, result);
  }, 120_000);

  it('finds what a ray from the camera hits, in the file it hits', async () => {
    const ask = answering(
      confirm(),
      confirm(),
      // Straight down onto the middle of the base: the recess floor.
      meet({
        do: 'pick',
        at: { ray: { origin: [0, 50, 0], direction: [0, -1, 0] } },
      }),
      meet({
        do: 'pick',
        at: { ray: { origin: [0, 50, 0], direction: [0, 1, 0] } },
      }),
    );
    await runPipeline(figure(), { bake: 0, secondStl: base(), askUp: ask });
    const [, hit, miss] = ask.meets;
    expect(hit!.picked!.file).toBe(1);
    // The base stands as its file does, turned Z-up to Y-up: the floor is z = 3 in its file.
    expect(hit!.picked!.point[2]).toBeCloseTo(floor, 4);
    expect(miss!.picked).toBeNull();
    expect(hit!.stage).toBe('pairs');
  }, 120_000);

  it('edits the proposal with a tap, and Undo goes straight back to it', async () => {
    const ask = answering(
      confirm(),
      confirm(),
      // A tap on the base on the proposed pair: the proposal becomes editable, the tap adds to it.
      tap(1, [-3, 0, floor]),
      meet({ do: 'undo' }),
      // Add a pair to the proposal.
      tap(1, [4, 0, floor], 1),
      tap(0, [4, 0, 0], 1),
      meet({ do: 'fit' }),
      meet({ do: 'confirm' }),
    );
    const result = await runPipeline(figure(), { bake: 0, secondStl: base(), askUp: ask });
    const [proposed, edited, undone, , added] = ask.meets;
    expect(proposed!.proposed).toBe(true);
    expect(edited).toMatchObject({ proposed: false });
    expect(edited!.pairs.map(({ on, of }) => [on?.file, of?.file])).toEqual([[1, 0]]);
    // The proposal as brush dabs, with the tap after them.
    const strokes = (edited!.marks as Meeting).pairs[0]!.on.strokes;
    expect(strokes.length).toBeGreaterThan(1);
    expect(strokes.at(-1)).toEqual({ tap: [-3, 0, floor] });
    expect(strokes.slice(0, -1).every((stroke) => 'brush' in stroke)).toBe(true);
    // The covered patch is at least the proposed one.
    expect(edited!.pairs[0]!.of!.areaMm2).toBeGreaterThanOrEqual(proposed!.pairs[0]!.of!.areaMm2);
    expect(undone).toMatchObject({ proposed: true, marks: null });
    expect(added!.pairs.map(({ on, of }) => [on?.file, of?.file])).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(result.pair!.placement!.method).toBe('marked');
    expect((result.choices.placement!.marks as Meeting).pairs).toHaveLength(2);
  }, 120_000);

  it('goes back to the pairs, and Start over brings the proposal and the automatic placement back', async () => {
    const ask = answering(
      confirm(),
      confirm(),
      meet({ do: 'clear', pair: 0 }),
      tap(1, [3, 0, floor]),
      tap(0, [0, 0, 0]),
      meet({ do: 'fit' }),
      meet({ do: 'back' }),
      meet({ do: 'clear' }),
      meet({ do: 'fit' }),
      meet({ do: 'confirm' }),
    );
    const result = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    const back = ask.meets[5]!;
    expect(back).toMatchObject({ stage: 'pairs', proposed: false });
    expect(back.pairs).toHaveLength(1);
    expect(ask.meets[6]).toMatchObject({
      stage: 'pairs',
      proposed: true,
      marks: null,
    });
    expect(ask.meets[7]!.placement!.method).toBe('detected');
    expect(result.pair!.placement!.method).toBe('detected');
    expect(result.choices.placement).toBeUndefined();
  }, 120_000);

  it('nudges the automatic placement and records the nudge, not marks', async () => {
    const ask = answering(
      confirm(),
      confirm(),
      meet({ do: 'fit' }),
      meet({ do: 'nudge', liftMm: 0.5, turnDeg: 15 }),
      meet({ do: 'confirm' }),
    );
    const result = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
    });
    const before = ask.meets[1]!.placement!;
    const after = result.pair!.placement!;
    expect(before.method).toBe('detected');
    expect(after.method).toBe('manual');
    expect(after.yawDeg - before.yawDeg).toBeCloseTo(15, 9);
    expect(ask.meets[2]!.placement).toEqual(after);
    expect(result.choices.placement).toEqual({ liftMm: 0.5, turnDeg: 15 });
  }, 120_000);

  it('asks only where they meet when that is all it is asked', async () => {
    const ask = answering();
    const result = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: ask,
      ask: { up: false, baseUp: false, parts: false, meet: true },
    });
    expect(ask.all.map((q) => (q.kind === 'meet' ? q.stage : q.kind))).toEqual(['pairs', 'fitted']);
    // Neither mesh went with an up question: both go with the first one.
    expect(ask.meets[0]!.meshes.map((m) => m.file).sort()).toEqual([0, 1]);
    expect(result.stats.asked.map((a) => a.role)).toEqual(['meet']);
  }, 120_000);

  it('asks about the parts first, then the base, then the figure as their union', async () => {
    const files = { bake: 0, secondStl: base(), moreStl: [encodeBinaryStl(armSoup)] };
    const plain = await runPipeline(encodeBinaryStl(bodySoup), files);
    const ask = answering(confirm(), confirm());
    const result = await runPipeline(encodeBinaryStl(bodySoup), {
      ...files,
      askUp: ask,
    });
    expectSameMini(result, plain);
    // A kit in place has no final view of its parts: it would be the picture just confirmed.
    expect(ask.all.map((q) => (q.kind === 'up' ? q.role : `${q.about} ${q.stage}`))).toEqual([
      'parts pairs',
      'base',
      'figure',
      'base pairs',
      'base fitted',
    ]);
    const parts = ask.meets[0]!;
    expect(parts.meshes.map((m) => m.file)).toEqual([0, 2]);
    expect(parts.shown.map((s) => s.file)).toEqual([0, 2]);
    expect(parts.parts.map((p) => p.source)).toEqual(['body', 'files']);
    // Pulled apart: the arm moved away from the body.
    expect(parts.apart!.shown.map((s) => s.file)).toEqual([0, 2]);
    expect(parts.apart!.shown[1]!.translation).not.toEqual(parts.shown[1]!.translation);
    // The arm is where its file puts it: a pair where it touches the body.
    expect(parts.proposed).toBe(true);
    expect(parts.pairs.length).toBeGreaterThan(0);
    expect(parts.pairs[0]!.on!.file).toBe(0);
    expect(parts.pairs[0]!.of!.file).toBe(2);
    const [baseQuestion, figureQuestion] = ask.questions;
    expect(baseQuestion!.meshes.map((m) => m.file)).toEqual([1]);
    expect(figureQuestion).toMatchObject({ role: 'figure', file: 0 });
    expect(figureQuestion!.shown.map((s) => s.file)).toEqual([0, 2]);
    expect(figureQuestion!.meshes).toEqual([]);
    expect(result.stats.asked.map((a) => a.role)).toEqual(['parts', 'base', 'figure', 'meet']);
    expect(result.pair!.parts.map((p) => p.file)).toEqual([0, 2]);
    expect(result.choices.parts).toBeUndefined();
  }, 120_000);

  it('puts a part that lies apart where its pairs say, and the choices convert it again', async () => {
    const [stl, files] = kit();
    const ask = answering(
      tap(0, WINGED_FIGURE.joint),
      tap(2, moved(WINGED_FIGURE.joint)),
      meet({ do: 'fit' }),
      meet({ do: 'confirm' }),
      confirm(),
      confirm(),
    );
    const result = await runPipeline(stl, { bake: 0, ...files, askUp: ask });
    const first = ask.meets[0]!;
    const fitted = ask.meets[3]!;
    // The wing lies 50 mm apart: nothing is proposed for it.
    expect(first.pairs).toEqual([]);
    expect(first.proposed).toBe(true);
    expect(first.parts[1]).toMatchObject({ file: 2, source: 'files' });
    expect(fitted).toMatchObject({
      about: 'parts',
      stage: 'fitted',
      apart: null,
    });
    expect(fitted.parts[1]).toMatchObject({ file: 2, source: 'marked' });
    // The wing moved 50 mm towards the body (the scene is centred on them both).
    const apart = (question: MeetQuestion): number =>
      question.shown[1]!.translation[0] - question.shown[0]!.translation[0];
    expect(apart(fitted) - apart(first)).toBeCloseTo(-50, 3);
    expect(result.pair!.parts[1]).toMatchObject({
      source: 'marked',
      joint: { onto: 0 },
    });
    const joint: PartJoint = {
      part: 2,
      onto: 0,
      pairs: [
        {
          on: { file: 0, strokes: [{ tap: WINGED_FIGURE.joint }] },
          of: { file: 2, strokes: [{ tap: moved(WINGED_FIGURE.joint) }] },
        },
      ],
    };
    expect(result.choices.parts).toEqual({ joints: [joint] });
    const again = await runPipeline(stl, {
      bake: 0,
      ...kit()[1],
      ...result.choices,
    });
    expectSameMini(again, result);
  }, 120_000);

  it('proposes nothing for parts laid out for print, and lays them in a row', async () => {
    const { body, wing } = generateWingedFigure();
    // Each part centred on the origin, on z = 0: as a print layout exports them.
    const plate = (soup: Float32Array, dx: number, dy: number, dz: number) =>
      encodeBinaryStl(movedSoup(soup, [dx, dy, dz]));
    const ask = answering();
    await runPipeline(plate(body, 0, 0, 0), {
      bake: 0,
      secondStl: plate(wing, -12.5, 0, -10.5),
      pairing: { baseFile: null },
      askUp: ask,
    }).catch(() => undefined);
    const parts = ask.meets[0]!;
    expect(parts).toMatchObject({ about: 'parts', stage: 'pairs', proposed: true, inPlace: false });
    expect(parts.pairs).toEqual([]);
    // Side by side: the wing to the right of the body.
    const [atBody, atWing] = parts.apart!.shown;
    expect(atWing!.translation[0]).toBeGreaterThan(atBody!.translation[0]);
    // Confirmed with nothing marked, the pile is shown before it converts: no silent placement.
    expect(ask.meets[1]).toMatchObject({ about: 'parts', stage: 'fitted' });
  }, 120_000);

  it('makes the files parts of one figure when no base is chosen, and asks nothing about a base', async () => {
    const noBase: UpAnswer = {
      kind: 'up',
      orientation: {},
      confirm: false,
      baseFile: null,
    };
    const ask = answering(noBase, confirm());
    const result = await runPipeline(encodeBinaryStl(bodySoup), {
      bake: 0,
      secondStl: base(),
      moreStl: [encodeBinaryStl(armSoup)],
      askUp: ask,
    });
    expect(ask.all.map((q) => (q.kind === 'up' ? q.role : q.about))).toEqual([
      'parts',
      'base',
      'parts',
      'mini',
    ]);
    // Without a base the recess base is a part, and the bulkiest: the body.
    expect(ask.meets[1]!.parts.map((p) => p.file)).toEqual([1, 0, 2]);
    expect(ask.meets[1]!.roles).toEqual({
      baseFile: null,
      figureFiles: [1, 0, 2],
    });
    expect(result.pair).toMatchObject({
      placement: null,
      baseOrientation: null,
    });
    expect(result.choices.pairing).toEqual({ baseFile: null });
    expect(result.stats.timings.map((t) => t.step)).not.toContain('place');
    // The parts confirmed before the roles changed stay in the record, as a confirmed base does (#92).
    expect(result.stats.asked.map((a) => a.role)).toEqual(['parts', 'parts', 'mini']);
  }, 120_000);
});
