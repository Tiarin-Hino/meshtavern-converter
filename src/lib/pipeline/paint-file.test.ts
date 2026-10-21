import { describe, expect, it } from 'vitest';
import { generateFigure, generatePuddleFigure, generateRecessBase } from '../../regression/shapes';
import { CONVERTER_VERSION } from '../version';
import type { Answer, AskUp, Question } from './ask';
import { DEFAULT_BRUSH, type PaintStep, type StrokeCamera } from './brush';
import { DEFAULT_LOOK } from './look';
import {
  convertOptionsOf,
  engineOf,
  fingerprintOf,
  fingerprintSources,
  matchSources,
  matchFingerprints,
  paintedOnOlderEngine,
  paintFileOf,
  PAINT_ENGINE_VERSION,
  PAINT_FILE_FORMAT,
  PAINT_FILE_GZIP_ABOVE,
  PAINT_FILE_VERSION,
  readPaintFile,
  sourceRoles,
  writePaintFile,
  type PaintFile,
  type SourceFingerprint,
} from './paint-file';
import { ConversionProblem, PAINT_SOURCE_MESSAGES, PROBLEM_MESSAGES } from './problems';
import { runPipeline } from './run';
import { encodeBinaryStl } from './stl';

const camera: StrokeCamera = {
  position: [0, 20, 80],
  target: [0, 15, 0],
  fovDeg: 40,
  near: 0.5,
  far: 2000,
  viewport: [800, 600],
};

/** One step of every kind and every optional field, with numbers JSON must keep to the bit. */
const STEPS: PaintStep[] = [
  {
    kind: 'stroke',
    tool: 'flat',
    colour: '#b03030',
    brush: { ...DEFAULT_BRUSH },
    camera,
    dabs: [0.1, 15.000000000000002, 6.1234567890123, 0.5, 1 / 3, 16, 6, 0.75],
  },
  {
    kind: 'stroke',
    tool: 'airbrush',
    colour: '#30b030',
    brush: { ...DEFAULT_BRUSH, direction: [0, 1, 0] },
    camera,
    dabs: [0, 14, 6, 0.5],
    groups: { hidden: [1], apart: [{ group: 2, offset: [3, 0, -1.5] }] },
  },
  {
    kind: 'stroke',
    tool: 'lift',
    colour: '#000000',
    brush: DEFAULT_BRUSH,
    camera,
    dabs: [0, 14, 6, 0.5],
    lifts: 0,
  },
  {
    kind: 'fill',
    tool: 'fill',
    colour: '#3030b0',
    brush: DEFAULT_BRUSH,
    seed: { kind: 'picked', triangle: 12, point: [1, 2, 3] },
  },
  {
    kind: 'fill',
    tool: 'mask-fill',
    colour: '#3030b0',
    brush: DEFAULT_BRUSH,
    seed: { kind: 'base' },
  },
  { kind: 'mask', change: 'invert' },
  {
    kind: 'fill',
    tool: 'group-fill',
    colour: '#3030b0',
    brush: DEFAULT_BRUSH,
    seed: { kind: 'group', group: 1 },
    into: 3,
  },
  {
    kind: 'stroke',
    tool: 'group',
    colour: '#3030b0',
    brush: DEFAULT_BRUSH,
    camera,
    dabs: [0, 14, 6, 0.5],
    into: 1,
  },
];

const SOURCES: SourceFingerprint[] = [
  { role: 'figure', bytes: 1284, sha256: 'a'.repeat(64) },
  { role: 'base', bytes: 884, sha256: 'b'.repeat(64) },
];

const contents = (steps = STEPS) => ({
  sources: SOURCES,
  choices: {
    orientation: { up: '+x' as const },
    pairing: { swap: true },
    sizing: { size: 'large' as const },
  },
  look: { ...DEFAULT_LOOK, base: '#445566' },
  steps,
});

/** The problem a promise is refused with. */
async function refusal(promise: Promise<unknown>): Promise<ConversionProblem> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConversionProblem) return error;
    throw error;
  }
  throw new Error('not refused');
}

const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe('the paint file (#165)', () => {
  it('has the shape: format, versions, converter, engine runs, sources, choices, look and steps', async () => {
    const file = paintFileOf(contents());
    expect(file).toEqual({
      format: PAINT_FILE_FORMAT,
      version: PAINT_FILE_VERSION,
      converter: CONVERTER_VERSION,
      engines: [{ engine: PAINT_ENGINE_VERSION, steps: STEPS.length }],
      ...contents(),
    });
    const text = new TextDecoder().decode(await writePaintFile(file));
    // JSON with no geometry, no texture and no names in it.
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'version',
      'converter',
      'engines',
      'sources',
      'choices',
      'look',
      'steps',
    ]);
    expect(text).not.toMatch(/positions|indices|uvs|albedo|name/);
  });

  it('reads back what it writes, every step and number as it was', async () => {
    const written = await writePaintFile(contents());
    const read = await readPaintFile(written);
    expect(read).toEqual(paintFileOf(contents()));
    expect(read.steps[0]!.kind === 'stroke' && read.steps[0]!.dabs).toEqual(
      (STEPS[0] as { dabs: number[] }).dabs,
    );
    // An ArrayBuffer reads the same.
    expect(await readPaintFile(written.slice().buffer)).toEqual(read);
  });

  it('compresses with gzip above PAINT_FILE_GZIP_ABOVE, and reads either', async () => {
    const small = await writePaintFile(contents());
    expect(small[0]).toBe(0x7b); // '{': plain JSON
    // A long session: strokes of many dabs, over a MiB as JSON.
    const long: PaintStep[] = Array.from({ length: 120 }, (_, k) => ({
      kind: 'stroke',
      tool: 'flat',
      colour: '#b03030',
      brush: DEFAULT_BRUSH,
      camera,
      dabs: Array.from({ length: 2000 }, (_, d) => k + d / 7),
    }));
    const big = await writePaintFile(contents(long));
    expect(JSON.stringify(paintFileOf(contents(long))).length).toBeGreaterThan(
      PAINT_FILE_GZIP_ABOVE,
    );
    expect([big[0], big[1]]).toEqual([0x1f, 0x8b]);
    expect(big.length).toBeLessThan(PAINT_FILE_GZIP_ABOVE);
    expect(await readPaintFile(big)).toEqual(paintFileOf(contents(long)));
    // A lower threshold compresses a small one too.
    const packed = await writePaintFile(contents(), 10);
    expect(packed[0]).toBe(0x1f);
    expect(await readPaintFile(packed)).toEqual(await readPaintFile(small));
  });

  it('refuses what is not a paint file, and one from a newer converter', async () => {
    const good = paintFileOf(contents());
    for (const bytes of [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([0x1f, 0x8b, 0, 0]), // gzip that breaks off
      bytesOf({ hello: 'world' }),
      bytesOf([good]),
      bytesOf({ ...good, version: 0 }),
      bytesOf({ ...good, sources: [] }),
      bytesOf({ ...good, sources: [{ ...SOURCES[0], sha256: 'xyz' }] }),
      bytesOf({ ...good, sources: [SOURCES[1]] }), // no figure
      bytesOf({ ...good, engines: [{ engine: 1, steps: 2 }] }), // the runs miss steps
      bytesOf({ ...good, look: { base: '#000' } }),
      bytesOf({ ...good, steps: [{ kind: 'paint' }] }),
      bytesOf({ ...good, steps: [{ ...STEPS[0], dabs: [1, 2, 3] }] }),
      bytesOf({ ...good, steps: [{ ...STEPS[0], tool: 'fill' }] }),
      bytesOf({ ...good, steps: [{ ...STEPS[3], seed: { kind: 'picked' } }] }),
      // A lift takes away an earlier step, never itself or a later one.
      bytesOf({ ...good, engines: [{ engine: 1, steps: 1 }], steps: [STEPS[2]] }),
    ]) {
      const problem = await refusal(readPaintFile(bytes));
      expect(problem.code).toBe('not-a-paint-file');
      expect(problem.message).toBe(PROBLEM_MESSAGES['not-a-paint-file']);
    }
    expect(
      (await refusal(readPaintFile(bytesOf({ ...good, version: PAINT_FILE_VERSION + 1 })))).code,
    ).toBe('paint-file-newer');
    const newerEngine = {
      ...good,
      engines: [{ engine: PAINT_ENGINE_VERSION + 1, steps: STEPS.length }],
    };
    expect((await refusal(readPaintFile(bytesOf(newerEngine)))).code).toBe('paint-file-newer');
    // The writer checks as the reader does.
    await expect(writePaintFile({ ...contents(), sources: [] })).rejects.toThrow(ConversionProblem);
  });

  it('says when steps were painted on an older engine, and which engine painted each step', () => {
    const file = paintFileOf(contents());
    expect(paintedOnOlderEngine(file)).toBe(false);
    const runs = [
      { engine: 0, steps: 3 },
      { engine: PAINT_ENGINE_VERSION, steps: 5 },
    ];
    expect(paintedOnOlderEngine({ engines: runs })).toBe(true);
    expect(paintedOnOlderEngine({ engines: [{ engine: 0, steps: 0 }] })).toBe(false);
    expect([0, 2, 3, 7, 8, 100].map((k) => engineOf(runs, k))).toEqual([
      0,
      0,
      PAINT_ENGINE_VERSION,
      PAINT_ENGINE_VERSION,
      PAINT_ENGINE_VERSION,
      PAINT_ENGINE_VERSION,
    ]);
  });

  it('fingerprints a file by SHA-256 and size', async () => {
    const empty = await fingerprintOf(new ArrayBuffer(0), 'base');
    expect(empty).toEqual({
      role: 'base',
      bytes: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    const abc = await fingerprintOf(new TextEncoder().encode('abc'), 'figure');
    expect(abc.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(abc.bytes).toBe(3);
  });
});

describe('the paint file’s sources (#165)', () => {
  const figure = encodeBinaryStl(generatePuddleFigure(12));
  const base = encodeBinaryStl(generateRecessBase());
  const other = encodeBinaryStl(generateFigure(false));

  const named = async (...files: [ArrayBuffer, 'figure' | 'part' | 'base'][]): Promise<PaintFile> =>
    paintFileOf({
      ...contents([]),
      sources: await fingerprintSources(
        files.map(([stl]) => stl),
        files.map(([, role]) => role),
      ),
    });

  it('gives the files in the order the paint file names them, whatever order they come in', async () => {
    const file = await named([figure, 'figure'], [base, 'base']);
    expect(await matchSources(file, [base, figure])).toEqual([figure, base]);
    expect(await matchSources(file, [figure, base])).toEqual([figure, base]);
  });

  it('matches files fingerprinted elsewhere the same way, by index (#167)', async () => {
    const file = await named([figure, 'figure'], [base, 'base']);
    const given = await fingerprintSources([base, figure], ['base', 'figure']);
    expect(matchFingerprints(file, given)).toEqual([1, 0]);
    expect(() => matchFingerprints(file, given.slice(0, 1))).toThrow(
      PAINT_SOURCE_MESSAGES.missing.figure,
    );
  });

  it('refuses before anything converts, saying which file is missing, different or not the mini’s', async () => {
    const file = await named([figure, 'figure'], [base, 'base']);
    const missing = await refusal(matchSources(file, [figure]));
    expect(missing.code).toBe('paint-file-sources');
    expect(missing.message).toBe(PAINT_SOURCE_MESSAGES.missing.base);
    // A changed file in the base's place: different, not missing.
    const changed = base.slice(0);
    const flipped = new Uint8Array(changed);
    flipped[100] = flipped[100]! ^ 1;
    expect((await refusal(matchSources(file, [figure, changed]))).message).toBe(
      PAINT_SOURCE_MESSAGES.different.base,
    );
    expect((await refusal(matchSources(file, [other, base]))).message).toBe(
      PAINT_SOURCE_MESSAGES.different.figure,
    );
    // With both wrong, the figure is named first.
    expect((await refusal(matchSources(file, [other]))).message).toBe(
      PAINT_SOURCE_MESSAGES.different.figure,
    );
    expect((await refusal(matchSources(file, [figure, base, other]))).message).toBe(
      PAINT_SOURCE_MESSAGES.extra,
    );
    const parts = await named([figure, 'figure'], [other, 'part']);
    expect((await refusal(matchSources(parts, [figure]))).message).toBe(
      PAINT_SOURCE_MESSAGES.missing.part,
    );
    // The same file twice is matched once.
    const twice = await named([figure, 'figure'], [figure, 'part']);
    expect(await matchSources(twice, [figure, figure])).toHaveLength(2);
    expect((await refusal(matchSources(twice, [figure]))).message).toBe(
      PAINT_SOURCE_MESSAGES.missing.part,
    );
  });

  it('says every refusal in one sentence a hobbyist reads', () => {
    const sentences = [
      ...Object.values(PAINT_SOURCE_MESSAGES.missing),
      ...Object.values(PAINT_SOURCE_MESSAGES.different),
      PAINT_SOURCE_MESSAGES.extra,
    ];
    for (const sentence of sentences) {
      expect(sentence.match(/[.!?]/g)).toHaveLength(1);
      expect(sentence.endsWith('.')).toBe(true);
      expect(sentence).not.toMatch(/hash|sha|fingerprint|byte|buffer/i);
    }
  });

  it('takes the roles from the conversion: the figure, its base, its parts', () => {
    expect(sourceRoles(null)).toEqual(['figure']);
    const files = [{ bulk: 1 }, { bulk: 9 }, { bulk: 2 }] as never;
    expect(
      sourceRoles({ pairing: { baseFile: 2, method: 'guessed', warnings: [], files } }),
    ).toEqual(['part', 'figure', 'base']);
    expect(
      sourceRoles({ pairing: { baseFile: null, method: 'manual', warnings: [], files } }),
    ).toEqual(['part', 'figure', 'part']);
  });
});

/** An AskUp that answers each up question in turn and confirms every meet question as shown. */
function answering(...answers: Answer[]): AskUp {
  return (question: Question) => {
    if (question.kind === 'meet')
      return Promise.resolve({ kind: 'meet', action: { do: 'confirm' } });
    const answer = answers.shift();
    if (!answer) return Promise.reject(new Error('no answer left'));
    return Promise.resolve(answer);
  };
}

/** The bytes of a typed array, to compare two meshes bit for bit. */
const bits = (array: Float32Array | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

describe('the paint file’s choices (#165)', () => {
  it('convert the files again without a question, to the same mini', async () => {
    // A figure stored lying, stood up and sized by hand at its question.
    const soup = generateFigure(false);
    const lying = new Float32Array(soup.length);
    for (let i = 0; i < soup.length; i += 3) {
      lying[i] = soup[i + 2]!;
      lying[i + 1] = soup[i + 1]!;
      lying[i + 2] = 0 - soup[i]!;
    }
    const stl = (): ArrayBuffer => encodeBinaryStl(lying);
    const sizing = { size: 'large' as const, plainBase: true };
    const asked = await runPipeline(stl(), {
      bake: 0,
      sizing,
      askUp: answering({ kind: 'up', orientation: { up: '+x' }, confirm: true }),
    });
    const sources = await fingerprintSources([stl()], sourceRoles(asked.pair));
    const written = await writePaintFile({
      sources,
      choices: { ...asked.choices, sizing },
      look: DEFAULT_LOOK,
      steps: [],
    });
    const file = await readPaintFile(written);
    const [again] = await matchSources(file, [stl()]);
    const replayed = await runPipeline(again!, { bake: 0, ...convertOptionsOf(file) });
    expect(bits(replayed.mesh.positions)).toEqual(bits(asked.mesh.positions));
    expect(replayed.orientation).toEqual(asked.orientation);
    expect(replayed.sizing).toEqual(asked.sizing);
    expect(replayed.sizing.size).toBe('large');
  }, 60_000);

  it('convert a figure with its base again without a question, the base where it was', async () => {
    const figure = (): ArrayBuffer => encodeBinaryStl(generatePuddleFigure(12));
    const base = (): ArrayBuffer => encodeBinaryStl(generateRecessBase());
    const confirm: Answer = { kind: 'up', orientation: {}, confirm: true };
    const asked = await runPipeline(figure(), {
      bake: 0,
      secondStl: base(),
      askUp: answering(confirm, confirm),
    });
    const roles = sourceRoles(asked.pair, 2);
    expect(roles).toEqual(['figure', 'base']);
    const file = await readPaintFile(
      await writePaintFile({
        sources: await fingerprintSources([figure(), base()], roles),
        choices: asked.choices,
        look: DEFAULT_LOOK,
        steps: [],
      }),
    );
    const [first, second] = await matchSources(file, [base(), figure()]);
    const replayed = await runPipeline(first!, {
      bake: 0,
      secondStl: second!,
      ...convertOptionsOf(file),
    });
    expect(bits(replayed.mesh.positions)).toEqual(bits(asked.mesh.positions));
    expect(replayed.pair).toEqual(asked.pair);
  }, 60_000);
});
