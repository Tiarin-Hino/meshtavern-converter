import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_LOOK,
  PAINT_SOURCE_MESSAGES,
  fingerprintSources,
  matchSources,
  PAINT_ENGINE_VERSION,
  readPaintFile,
  writePaintFile,
  type EngineRun,
  type PaintStep,
} from '../src/lib';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';
import { COPY, describePaintFileWaiting, paintSaved } from '../src/page/page-state';
import { paintEveryKind, type Painted } from './painting-steps';
import { painting } from './states';

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
// The paint file on the page (#167, design note docs/design/painter-on-the-page.md §7): Save and
// Open in the painter's footer, a drop with the STL files, a paint file alone, the refusals.

const hero = (soup = generateFigure(true)) => ({
  name: 'hero.stl',
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});
const asPaintFile = (bytes: Buffer, name = 'hero.mtpaint') => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: bytes,
});

/** The SHA-256 of the open painter's paint. */
const paintSha = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const data = (await window.__mt.painting.view().paint()).data;
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  });

/** A stroke of the flat brush across the figure at height `y`, in `colour`. */
const strokeAcross = (page: Page, y: number, colour: string): Promise<void> =>
  page.evaluate(
    async ([y, colour]) => {
      const view = window.__mt.painting.view();
      view.setCamera(0, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const at = (x: number): [number, number, number] =>
        view.texelAt(...view.screenOf([x, y, 6]))!.point;
      view.setTool('flat');
      view.setBrush({ sizeMm: 2, opacity: 1, hardness: 0.8 });
      view.setColour(colour);
      await view.stroke([at(-3), at(0), at(3)]);
    },
    [y, colour] as [number, string],
  );

/** Paints two strokes on the generated figure and saves them through the footer's button. */
async function savedPainting(page: Page): Promise<{ bytes: Buffer; paint: string }> {
  await page.goto('/?ask=off&bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await painting(page);
  await strokeAcross(page, 12, '#b03030');
  await strokeAcross(page, 16, '#3060c0');
  const paint = await paintSha(page);
  const download = page.waitForEvent('download');
  await page.locator('#paint-file-save').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('hero.mtpaint');
  return { bytes: readFileSync((await saved.path())!), paint };
}

test('Save paint file writes what the hook gives, and a drop with the STL replays it without a question', async ({
  page,
}) => {
  const { bytes, paint } = await savedPainting(page);
  await expect(page.locator('#status')).toHaveText(paintSaved('hero.mtpaint'));
  const hooked = await page.evaluate(async () => [...(await window.__mt.savePaintFile())]);
  expect(Buffer.from(hooked).equals(bytes)).toBe(true);
  const file = await readPaintFile(bytes);
  expect(file.steps).toHaveLength(2);
  expect(file.sources).toEqual([
    expect.objectContaining({ role: 'figure', bytes: hero().buffer.length }),
  ]);

  // The questions are on, and none is asked: the file's choices convert the mini.
  await page.goto('/?bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', [asPaintFile(bytes), hero()]);
  await page.waitForFunction(
    () => window.__mt.state.page === 'painting' && window.__mt.state.painting?.steps === 2,
    undefined,
    { timeout: 180_000 },
  );
  expect(await page.evaluate(() => window.__mt.state.questionMs)).toBeNull();
  expect(await paintSha(page)).toBe(paint);
  await expect(page.locator('#status')).toHaveText(COPY.paintingKept);
});

test('a paint file for other files is refused in one sentence, a waiting one takes the next drop', async ({
  page,
}) => {
  const { bytes, paint } = await savedPainting(page);
  await page.goto('/?ask=off&bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  // Dropped with another figure: the error card names the figure as different.
  await page.setInputFiles('#file', [asPaintFile(bytes), hero(generateFigure(false))]);
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('#status')).toHaveText(PAINT_SOURCE_MESSAGES.different.figure);

  // Alone, it waits for its files; a wrong drop is refused and it still waits.
  await page.setInputFiles('#file', asPaintFile(bytes));
  await page.waitForFunction(() => window.__mt.state.page === 'empty');
  await expect(page.locator('#status')).toHaveText(describePaintFileWaiting([{ role: 'figure' }]));
  await expect(page.locator('#paint-file-forget')).toBeVisible();
  await page.setInputFiles('#file', hero(generateFigure(false)));
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  expect(await page.evaluate(() => window.__mt.state.paintFile.pending)).not.toBeNull();
  await page.setInputFiles('#file', hero());
  await page.waitForFunction(
    () => window.__mt.state.page === 'painting' && window.__mt.state.painting?.steps === 2,
    undefined,
    { timeout: 180_000 },
  );
  expect(await paintSha(page)).toBe(paint);
  expect(await page.evaluate(() => window.__mt.state.paintFile.pending)).toBeNull();

  // Two paint files are one too many.
  await page.locator('#paint-done').click();
  await page.setInputFiles('#file', [
    asPaintFile(bytes),
    asPaintFile(bytes, 'other.mtpaint'),
    hero(),
  ]);
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('#status')).toHaveText(COPY.onePaintFile);
});

test('Open over unsaved steps asks first, and a reconversion of the mini does too', async ({
  page,
}) => {
  const { bytes, paint } = await savedPainting(page);
  // A third stroke: unsaved. Open paint file in the footer asks before replacing it.
  await strokeAcross(page, 20, '#20a040');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paint-file-open').click();
  await (await chooser).setFiles(asPaintFile(bytes));
  await page.waitForFunction(() => window.__mt.state.confirm !== null);
  expect(await page.evaluate(() => window.__mt.state.confirm)).toBe(COPY.replacePainting);
  await expect(page.locator('#confirm')).toBeVisible();
  await page.locator('#confirm-yes').click();
  await page.waitForFunction(() => window.__mt.state.painting?.steps === 2);
  expect(await paintSha(page)).toBe(paint);

  // Another stroke, then Adjust converts again: asked, and no (Escape) keeps the painting.
  await strokeAcross(page, 20, '#20a040');
  await page.locator('#paint-done').click();
  const size = await page.evaluate(() => window.__mt.state.stats!.sizing.size);
  const sizing = page.evaluate(() => window.__mt.setSizing({ size: 'huge' }));
  await page.waitForFunction(() => window.__mt.state.confirm !== null);
  expect(await page.evaluate(() => window.__mt.state.confirm)).toBe(COPY.paintingLost);
  await page.keyboard.press('Escape');
  await sizing;
  expect(await page.evaluate(() => window.__mt.state.painting!.steps)).toBe(3);
  expect(await page.evaluate(() => window.__mt.state.stats!.sizing.size)).toBe(size);
});

test('a paint file without a stroke keeps the choices: saved from the done panel, opened from the empty state, no question', async ({
  page,
}) => {
  // The empty state says a paint file is welcome and offers to open one first.
  await page.goto('/?bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await expect(page.locator('#paint-file-hint')).toHaveText(COPY.paintFileHint);
  await expect(page.locator('#paint-file-open-empty')).toBeVisible();

  // Converted without the questions (the detection's choices), the hero is saved from the done
  // panel before any stroke; the file then suppresses the question on the next drop.
  await page.goto('/?ask=off&bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', hero());
  await page.waitForFunction(() => window.__mt.state.page === 'done', undefined, {
    timeout: 180_000,
  });
  await expect(page.locator('#paint-file-save-done')).toBeVisible();
  await expect(page.locator('#paint-file-keeps')).toHaveText(COPY.paintFileKeeps);
  const download = page.waitForEvent('download');
  await page.locator('#paint-file-save-done').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('hero.mtpaint');
  await expect(page.locator('#status')).toHaveText(paintSaved('hero.mtpaint'));
  const bytes = readFileSync((await saved.path())!);
  const file = await readPaintFile(bytes);
  expect(file.steps).toHaveLength(0);
  expect(file.sources).toEqual([expect.objectContaining({ role: 'figure' })]);
  expect(await page.evaluate(() => window.__mt.state.painting?.open ?? false)).toBe(false);

  // Opened first through the empty state's button, it waits; the hero then converts without a
  // question and stays in the done panel: there is no painting to open.
  await page.goto('/?bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paint-file-open-empty').click();
  await (await chooser).setFiles(asPaintFile(bytes));
  await expect(page.locator('#status')).toHaveText(describePaintFileWaiting([{ role: 'figure' }]));
  await expect(page.locator('#paint-file-hint')).toBeHidden();
  await page.setInputFiles('#file', hero());
  await page.waitForFunction(() => window.__mt.state.page === 'done', undefined, {
    timeout: 180_000,
  });
  expect(await page.evaluate(() => window.__mt.state.questionMs)).toBeNull();
  expect(await page.evaluate(() => window.__mt.state.painter)).toBe(false);
  expect(await page.evaluate(() => window.__mt.state.paintFile.pending)).toBeNull();

  // In the painter, Save is enabled before the first stroke too.
  await page.locator('#paint-open').click();
  // The page is in the painting state before the view has opened: wait for the view too.
  await page.waitForFunction(
    () => window.__mt.state.page === 'painting' && window.__mt.state.painting?.open === true,
  );
  await expect(page.locator('#paint-file-save')).toBeEnabled();

  // A painting, saved and closed with Done: the choices-only file opened on it replaces nothing,
  // asks nothing and enters no painter.
  await strokeAcross(page, 12, '#b03030');
  await page.evaluate(() => window.__mt.savePaintFile());
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  await page.evaluate((file) => window.__mt.openPaintFile(new Uint8Array(file).buffer), [...bytes]);
  expect(await page.evaluate(() => window.__mt.state.page)).toBe('done');
  expect(await page.evaluate(() => window.__mt.state.confirm)).toBeNull();
  expect(await page.evaluate(() => window.__mt.state.painting!.steps)).toBe(1);
});
