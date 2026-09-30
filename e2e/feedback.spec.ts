import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { generatePuddleFigure, generateRecessBase } from '../src/regression/shapes';
import { installFeedback, recordPath, reviewPair } from '../scripts/lib/feedback-session.mjs';

/**
 * The feedback mode (#70, design note §13): the page converts a pair, the keys give the verdict,
 * and the record holds what the page shows. Driven here with a generated pair.
 */

const overlayShown = (page: Page, key: string) =>
  page.waitForFunction(
    (k) => document.querySelector('#feedback-overlay')?.textContent?.includes(`· ${k}\n`),
    key,
  );

test('records a saved placement, a right one, a skip, and ends on Escape', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const figure = testInfo.outputPath('hero.stl');
  const base = testInfo.outputPath('hero-base.stl');
  writeFileSync(figure, Buffer.from(encodeBinaryStl(generatePuddleFigure(12))));
  writeFileSync(base, Buffer.from(encodeBinaryStl(generateRecessBase())));
  const outDir = testInfo.outputPath('feedback');
  const pair = (key: string) => ({ key, figure, base });

  await page.goto('/?dev&bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  const nextVerdict = await installFeedback(page);
  // The questions after the orient step (#92) are confirmed as detected, as an unattended run does.
  const session = {
    index: 1,
    total: 4,
    commit: 'test',
    outDir,
    browser,
    nextVerdict,
    up: 'detected' as const,
  };
  const read = (key: string) => JSON.parse(readFileSync(recordPath(outDir, key), 'utf8'));

  // S: the move being tried out is the record; Apply is not needed.
  const saved = reviewPair(page, pair('test/saved'), session);
  await overlayShown(page, 'test/saved');
  await expect(page.locator('#feedback-overlay')).toContainText('pair 1 of 4 · test/saved');
  await page.evaluate(() => window.__mt.movePlacement(2, 0));
  await page.keyboard.press('s');
  expect(await saved).toBe('placed');
  const placed = read('test/saved');
  expect(placed).toMatchObject({
    key: 'test/saved',
    verdict: 'placed',
    pairing: { baseFile: 1, method: 'guessed' },
    orientation: { up: '+z' },
    baseOrientation: { up: '+z', method: 'base' },
    choices: { orientation: {}, baseOrientation: {}, pairing: {} },
    detected: { spot: { kind: 'recess' } },
  });
  expect(placed.placed.moveMm).toEqual([2, 0]);
  expect(placed.placed.offsetMm[0]).toBeCloseTo(placed.detected.offsetMm[0] + 2, 5);
  expect(placed.placed.figureLowestMm).toBeCloseTo(3, 3);
  expect(placed.baseFootprintMm[0]).toBeCloseTo(32, 0);
  expect(existsSync(placed.sheet)).toBe(true);

  // R: the automatic placement, even with a preview left pending.
  const right = reviewPair(page, pair('test/right'), session);
  await overlayShown(page, 'test/right');
  await page.evaluate(() => window.__mt.liftPlacement(1));
  await page.keyboard.press('r');
  expect(await right).toBe('right');
  const kept = read('test/right');
  expect(kept.verdict).toBe('right');
  expect(kept.placed.moveMm).toEqual([0, 0]);
  expect(kept.placed.offsetMm).toEqual(kept.detected.offsetMm);

  // Marked where they meet (#93): the record keeps the marks, in the choices and as resolved.
  const meeting = {
    spot: { file: 1, point: [3, 0, 3] as [number, number, number] },
    contact: { file: 0, point: [0, 0, 0] as [number, number, number] },
    liftMm: 0.5,
  };
  const marked = reviewPair(
    page,
    { ...pair('test/marked'), choices: { placement: { marks: meeting } } },
    { ...session, up: 'index' as const },
  );
  await overlayShown(page, 'test/marked');
  await page.keyboard.press('s');
  expect(await marked).toBe('placed');
  const withMarks = read('test/marked');
  expect(withMarks.choices.placement).toEqual({ marks: meeting });
  expect(withMarks.marks).toMatchObject({ liftMm: 0.5, spot: { normal: [0, 1, 0] } });
  expect(withMarks.detected.method).toBe('marked');

  // K: skipped; Escape: the session ends and nothing is written.
  const skipped = reviewPair(page, pair('test/skipped'), session);
  await overlayShown(page, 'test/skipped');
  await page.keyboard.press('k');
  expect(await skipped).toBe('skipped');
  expect(read('test/skipped').verdict).toBe('skipped');
  const ended = reviewPair(page, pair('test/ended'), session);
  await overlayShown(page, 'test/ended');
  await page.keyboard.press('Escape');
  expect(await ended).toBe('end');
  expect(existsSync(recordPath(outDir, 'test/ended'))).toBe(false);
});
