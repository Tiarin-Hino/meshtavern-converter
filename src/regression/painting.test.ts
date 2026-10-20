import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchSources, PAINT_ENGINE_VERSION, readPaintFile, TOOL_IDS } from '../lib';
import { encodeBinaryStl } from '../lib/dev';
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
