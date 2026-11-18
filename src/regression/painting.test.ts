import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  matchSources,
  PAINT_ENGINE_VERSION,
  readPaintFile,
  stepsOnSurface,
  TOOL_IDS,
  type IndexedMesh,
} from '../lib';
import { encodeBinaryStl, runPipeline } from '../lib/dev';
import { generateFigure } from './shapes';

/**
 * The recorded painting of the regression net (#165): a paint file of the generated figure on its
 * base with a step of every kind, made by `e2e/paint-file.spec.ts` (`PAINTING_RECORD=1`), whose
 * replay that spec compares with `painting-replay.json` in real Chrome. Here, in Node: this
 * converter still reads it, and it is still of the generated figure, bit for bit.
 */

const RECORDED = 'src/regression/painting.mtpaint';

describe('the recorded painting', () => {
  it('is a paint file this converter reads, of the generated figure as it is generated today', async () => {
    const file = await readPaintFile(readFileSync(RECORDED));
    expect(file.engines.every((run) => run.engine <= PAINT_ENGINE_VERSION)).toBe(true);
    expect(await matchSources(file, [encodeBinaryStl(generateFigure(true))])).toHaveLength(1);
  });

  it('holds a step of every kind the engine records', async () => {
    const file = await readPaintFile(readFileSync(RECORDED));
    const tools = new Set(file.steps.flatMap((step) => (step.kind === 'mask' ? [] : [step.tool])));
    for (const tool of [
      'flat',
      'wash',
      'ink',
      'dry',
      'airbrush',
      'eraser',
      'lift',
      'fill',
      'mask',
      'mask-fill',
      'group',
    ])
      expect(tools.has(tool as (typeof TOOL_IDS)[number]), tool).toBe(true);
    expect(file.steps.some((step) => step.kind === 'mask' && step.change === 'invert')).toBe(true);
    expect(file.steps.some((step) => step.kind === 'mask' && step.change === 'clear')).toBe(true);
    expect(
      file.steps.some((step) => step.kind !== 'mask' && (step.groups?.hidden.length ?? 0) > 0),
    ).toBe(true);
    const replay = JSON.parse(readFileSync('src/regression/painting-replay.json', 'utf8')) as {
      engine: number;
      points: number;
      samples: number[];
    };
    expect(replay.samples).toHaveLength(replay.points * 4);
  });
});

describe('stepsOnSurface (#197)', () => {
  /** The generated figure's table level, as the recorded painting was painted on it. */
  const tableLevel = async (): Promise<IndexedMesh> =>
    (await runPipeline(encodeBinaryStl(generateFigure(true)), { bake: 0 })).lods[1]!.mesh;

  /** `mesh` with every position moved by `move`. */
  const moved = (
    mesh: IndexedMesh,
    move: (p: [number, number, number]) => number[],
  ): IndexedMesh => {
    const positions = new Float32Array(mesh.positions.length);
    for (let v = 0; v < positions.length; v += 3)
      positions.set(move([mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!]), v);
    return { ...mesh, positions };
  };

  it('finds every point of the recorded painting on its own figure, and less than half on another conversion', async () => {
    const file = await readPaintFile(readFileSync(RECORDED));
    const table = await tableLevel();
    const own = stepsOnSurface(file.steps, table);
    expect(own.points).toBeGreaterThan(100);
    expect(own.near).toBe(own.points);

    // Another size: the figure scaled by 1.25 about its base's centre.
    const larger = stepsOnSurface(
      file.steps,
      moved(table, ([x, y, z]) => [x * 1.25, y * 1.25, z * 1.25]),
    );
    expect(larger.points).toBe(own.points);
    // 63 of 126 on the development PC: the figure is slender, and a quarter more of a thin arm's
    // radius is under PAINT_REACH_MM, so half its dabs stay near (#197, journal).
    expect(larger.near).toBeLessThanOrEqual(own.points / 2);

    // Another stance: the figure turned a quarter about x, laid on its back.
    const turned = stepsOnSurface(
      file.steps,
      moved(table, ([x, y, z]) => [x, -z, y]),
    );
    expect(turned.near).toBeLessThan(own.points / 2);
  }, 120_000);

  it('counts nothing for steps without points, and a dab drawn apart by its offset (#180)', async () => {
    const table = await tableLevel();
    const brush = { sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null };
    const none = stepsOnSurface(
      [
        { kind: 'mask', change: 'clear' },
        { kind: 'fill', tool: 'fill', colour: '#ffffff', brush, seed: { kind: 'group', group: 0 } },
      ],
      table,
    );
    expect(none).toEqual({ points: 0, near: 0 });
    // A vertex of the figure, and the same point drawn 40 mm up with its group apart.
    const [x, y, z] = [table.positions[0]!, table.positions[1]!, table.positions[2]!];
    const camera = (await readPaintFile(readFileSync(RECORDED))).steps.find(
      (step) => step.kind === 'stroke',
    )!;
    if (camera.kind !== 'stroke') throw new Error('no stroke');
    const apart = stepsOnSurface(
      [
        {
          ...camera,
          lifts: undefined,
          dabs: [x, y + 40, z, 1],
          groups: { hidden: [], apart: [{ group: 1, offset: [0, 40, 0] }] },
        },
        { ...camera, lifts: undefined, dabs: [x, y + 40, z, 1], groups: undefined },
      ],
      table,
    );
    expect(apart).toEqual({ points: 2, near: 1 });
  }, 120_000);
});
