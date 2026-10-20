import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_LOOK,
  fingerprintSources,
  matchSources,
  PAINT_ENGINE_VERSION,
  readPaintFile,
  writePaintFile,
  type EngineRun,
  type PaintStep,
  type UpChoices,
} from '../src/lib';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';

/**
 * The paint file (#165) through the team's Paint tool under ?dev: a painting of every kind of step
 * on the generated figure, saved as a paint file and opened again, gives the same bytes (paint
 * and mask) on the same engine and device; and the recorded painting of the regression net
 * (`src/regression/painting.mtpaint`) replays to the colours it had, at points on the surface, from
 * release to release. `PAINTING_RECORD=1` records both again (after a deliberate change, as
 * `npm run baseline:update` does for the pipeline's figures; explain it in the PR).
 */

const RECORDED = 'src/regression/painting.mtpaint';
const REPLAYED = 'src/regression/painting-replay.json';
/** A channel of a replayed sample may differ from the recorded one by this much (of 255). _(PM decision 2026-10-20, #186)_ */
const REPLAY_TOLERANCE = 8;
/** At most this share of the samples may differ by more: texels at a stroke's edge, on another GPU. _(PM decision 2026-10-20, #186)_ */
const REPLAY_OUTLIERS = 0.02;

const figureStl = (): ArrayBuffer => encodeBinaryStl(generateFigure(true));

test.describe.configure({ timeout: 300_000 });

/** Converts the generated figure on its base on the normal path (baked, compressed), without the questions. */
async function convertFigure(page: Page): Promise<void> {
  await page.goto('/?dev&ask=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', {
    name: 'figure.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(figureStl()),
  });
  await page.waitForFunction(
    () => window.__mt.state.stats !== null && !window.__mt.state.busy,
    undefined,
    { timeout: 180_000 },
  );
  expect(await page.evaluate(() => window.__mt.state.baked)).not.toBeNull();
}

interface Painted {
  steps: PaintStep[];
  engines: EngineRun[];
  choices: UpChoices;
  paint: string;
  mask: string;
  groups: string;
}

/**
 * Paints a step of every kind on the open figure: the flat brush, the four hobby brushes, the
 * eraser, a lift, the base filled, the figure masked and painted over, the mask cleared, a mask
 * stroke inverted and painted through, a group made and hidden with a stroke behind it. What it
 * gives back is what a paint file holds and the SHA-256 of what it made.
 */
async function paintEveryKind(page: Page): Promise<Painted> {
  return page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
    view.setCamera(0, 5, 1.6);
    await frame();
    const at = (x: number, y: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, y, 6]))!.point;
    const line = (y: number): [number, number, number][] => [at(-3, y), at(0, y + 1), at(3, y)];
    const brush = { sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null };
    const tool = (id: Parameters<typeof view.setTool>[0], colour: string, changes = {}): void => {
      view.setTool(id);
      view.setBrush({ ...brush, ...changes });
      view.setColour(colour);
    };
    tool('flat', '#b03030');
    await view.stroke(line(12));
    tool('wash', '#202020', { sizeMm: 3, opacity: 0.8 });
    await view.stroke(line(14));
    tool('ink', '#402010');
    await view.stroke(line(16));
    tool('dry', '#e0e0e0', { opacity: 0.6 });
    await view.stroke(line(18));
    tool('airbrush', '#3060c0', { sizeMm: 4, opacity: 0.5, direction: [0, 1, 0] });
    await view.stroke(line(20));
    tool('eraser', '#000000', { sizeMm: 1 });
    await view.stroke([at(-1, 12.5), at(1, 12.5)]);
    tool('lift', '#000000', { sizeMm: 1.5 });
    await view.stroke([at(0, 15), at(1, 15)]);
    tool('fill', '#806040', { opacity: 0.9 });
    await view.fillRegion('base');
    await view.maskRegion('figure');
    tool('flat', '#00ff00', { sizeMm: 6 });
    await view.stroke(line(13));
    await view.clearMask();
    tool('mask', '#000000', { sizeMm: 3 });
    await view.stroke(line(22));
    await view.invertMask();
    tool('flat', '#ffcc00', { sizeMm: 8 });
    await view.stroke(line(21));
    await view.clearMask();
    tool('group', '#000000', { sizeMm: 4 });
    view.setGroupTarget('new');
    await view.stroke(line(17));
    const made = view.state.groups.list.length - 1;
    view.setGroupShown(made, false);
    tool('flat', '#8040a0', { sizeMm: 3 });
    await view.stroke(line(17));
    view.showAllGroups();
    const sha = async (bytes: Uint8Array): Promise<string> =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    return {
      steps: view.history(),
      engines: view.engines(),
      choices: window.__mt.state.stats!.choices,
      paint: await sha((await view.paint()).data),
      mask: await sha((await view.mask()).data),
      groups: JSON.stringify({ of: Array.from(view.groups().of), made: view.groups().made }),
    };
  });
}

/** Opens the Paint tool on the converted mini with steps to replay; what it made, as `paintEveryKind` gives it. */
async function openWith(
  page: Page,
  steps: PaintStep[],
  engines: EngineRun[],
): Promise<Omit<Painted, 'steps' | 'engines' | 'choices'> & { open: [number, number] }> {
  return page.evaluate(
    async ({ steps, engines }) => {
      const painting = window.__mt.painting;
      painting.close();
      await painting.open(null, null, null, { steps, engines });
      const view = painting.view();
      const sha = async (bytes: Uint8Array): Promise<string> =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('');
      return {
        open: [view.state.steps, view.state.undone] as [number, number],
        paint: await sha((await view.paint()).data),
        mask: await sha((await view.mask()).data),
        groups: JSON.stringify({ of: Array.from(view.groups().of), made: view.groups().made }),
      };
    },
    { steps, engines },
  );
}

/** Points on the surface to compare a replay at: every dab of the steps' strokes, and rings on the base's top. */
function samplePoints(steps: PaintStep[]): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (const step of steps)
    if (step.kind === 'stroke')
      for (let k = 0; k < step.dabs.length; k += 4)
        points.push([step.dabs[k]!, step.dabs[k + 1]!, step.dabs[k + 2]!]);
  for (const r of [7, 9, 11])
    for (let k = -12; k < 12; k++) {
      // A circle without sin or cos (the rational one), so that every machine gets the same bits.
      const t = k / 4;
      points.push([(r * (1 - t * t)) / (1 + t * t), 3, (r * 2 * t) / (1 + t * t)]);
    }
  return points;
}

test('saves a painting of every kind of step as a paint file and opens it again to the same bytes', async ({
  page,
}) => {
  await convertFigure(page);
  const painted = await paintEveryKind(page);
  expect(painted.steps.length).toBe(17);
  expect(painted.engines).toEqual([{ engine: PAINT_ENGINE_VERSION, steps: painted.steps.length }]);
  // The lift took a step away, and a stroke was made with a group hidden.
  expect(painted.steps.some((step) => step.kind === 'stroke' && step.lifts !== undefined)).toBe(
    true,
  );
  expect(painted.steps.some((step) => step.kind !== 'mask' && step.groups !== undefined)).toBe(
    true,
  );

  const stl = figureStl();
  const bytes = await writePaintFile({
    sources: await fingerprintSources([stl], ['figure']),
    choices: painted.choices,
    look: DEFAULT_LOOK,
    steps: painted.steps,
    engines: painted.engines,
  });
  const file = await readPaintFile(bytes);
  expect(await matchSources(file, [figureStl()])).toHaveLength(1);

  const opened = await openWith(page, file.steps, file.engines);
  expect(opened.open).toEqual([painted.steps.length, 0]);
  expect(opened.paint).toBe(painted.paint);
  expect(opened.mask).toBe(painted.mask);
  expect(opened.groups).toBe(painted.groups);

  // Undo reaches back through every replayed step, to the bare mini, and redo comes back.
  const back = await page.evaluate(async (count) => {
    const view = window.__mt.painting.view();
    for (let k = 0; k < count; k++) await view.undo();
    const bare = (await view.paint()).data.every((value) => value === 0);
    const atStart = [view.state.steps, view.state.undone];
    for (let k = 0; k < count; k++) await view.redo();
    return { bare, atStart, history: view.history().length, engines: view.engines() };
  }, painted.steps.length);
  expect(back.bare).toBe(true);
  expect(back.atStart).toEqual([0, painted.steps.length]);
  expect(back.history).toBe(painted.steps.length);
  expect(back.engines).toEqual(painted.engines);
  const redone = await page.evaluate(async () => {
    const data = (await window.__mt.painting.view().paint()).data;
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  });
  expect(redone).toBe(painted.paint);
});

test('refuses steps that are not the mini’s at open, and opens nothing', async ({ page }) => {
  await convertFigure(page);
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const triangles = painting.table()!.indices.length / 3;
    painting.close();
    const fill = {
      kind: 'fill' as const,
      tool: 'fill' as const,
      colour: '#ffffff',
      brush: { sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null },
      seed: {
        kind: 'picked' as const,
        triangle: triangles,
        point: [0, 0, 0] as [number, number, number],
      },
    };
    try {
      await painting.open(null, null, null, { steps: [fill] });
      return 'opened';
    } catch (error) {
      return error instanceof RangeError ? error.message : String(error);
    }
  });
  expect(outcome).toMatch(/not this mini’s/);
});

test('replays the recorded painting of the regression net to the colours it had', async ({
  page,
}) => {
  await convertFigure(page);
  const record = process.env.PAINTING_RECORD === '1' || !existsSync(RECORDED);
  if (record) {
    const painted = await paintEveryKind(page);
    const bytes = await writePaintFile({
      sources: await fingerprintSources([figureStl()], ['figure']),
      choices: painted.choices,
      look: DEFAULT_LOOK,
      steps: painted.steps,
      engines: painted.engines,
    });
    writeFileSync(RECORDED, bytes);
  }
  const file = await readPaintFile(readFileSync(RECORDED));
  // The recorded painting is of these files: the generated figure has not changed.
  expect(await matchSources(file, [figureStl()])).toHaveLength(1);
  await openWith(page, file.steps, file.engines);
  const points = samplePoints(file.steps);
  const samples = await page.evaluate((points) => window.__mt.painting.sample(points), points);
  expect(samples.length).toBe(points.length * 4);
  if (record || !existsSync(REPLAYED)) {
    writeFileSync(
      REPLAYED,
      `${JSON.stringify({ engine: PAINT_ENGINE_VERSION, points: points.length, samples })}\n`,
    );
    test.info().annotations.push({ type: 'recorded', description: `${RECORDED}, ${REPLAYED}` });
  }
  const expected = JSON.parse(readFileSync(REPLAYED, 'utf8')) as {
    points: number;
    samples: number[];
  };
  expect(expected.points).toBe(points.length);
  let outliers = 0;
  let worst = 0;
  for (let k = 0; k < points.length; k++) {
    let off = 0;
    for (let c = 0; c < 4; c++)
      off = Math.max(off, Math.abs(samples[k * 4 + c]! - expected.samples[k * 4 + c]!));
    worst = Math.max(worst, off);
    if (off > REPLAY_TOLERANCE) outliers++;
  }
  test.info().annotations.push({
    type: 'replay',
    description: `${points.length} points, ${outliers} beyond ${REPLAY_TOLERANCE}, worst ${worst}`,
  });
  // Painted points were painted: the samples are not all bare.
  expect(samples.filter((_, k) => k % 4 === 3 && samples[k]! > 0).length).toBeGreaterThan(
    points.length / 2,
  );
  expect(outliers / points.length).toBeLessThanOrEqual(REPLAY_OUTLIERS);
});
