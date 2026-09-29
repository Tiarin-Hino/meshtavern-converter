import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { PROBLEM_MESSAGES } from '../src/lib';
import { generateFigure, generatePuddleFigure, generateRecessBase } from '../src/regression/shapes';

/**
 * A figure with its base file (#70): two files in, the Base section, the placement preview
 * and its corrections. The screenshots are for the PM's look at the seated figure.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const stl = (soup: Float32Array): Buffer => Buffer.from(encodeBinaryStl(soup));
const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: stl(soup),
});

async function open(page: Page, search = '?bake=off'): Promise<void> {
  await page.goto(`/${search}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
}

/** Picks the generated figure on its puddle together with the generated recess base. */
async function loadPair(page: Page): Promise<void> {
  await page.setInputFiles('#file', [
    file('figure.stl', generatePuddleFigure(12)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  // The result lands before the conversion counts as finished (the page waits two frames to show
  // it); the next action must not start while the page is still busy, or it is ignored.
  await page.waitForFunction(
    () => window.__mt.state.stats?.pair != null && !window.__mt.state.busy,
  );
}

test('sets the generated figure in its recess, and moves it only when applied', async ({
  page,
}, testInfo) => {
  // The normal path bakes and compresses, which is slow on CI runners.
  test.setTimeout(240_000);
  await open(page, '');
  await loadPair(page);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#heading')).toHaveText('figure + recess-base');
  await expect(page.locator('#placement')).toHaveText('Set in the 13 mm recess');
  await expect(page.locator('#pair-files')).toHaveText(
    'Base: recess-base.stl · Figure: figure.stl',
  );
  await expect(page.locator('#mini-size')).toHaveText(
    '34 mm tall · Medium, 1 square · 32 mm round base from its own file',
  );
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.pair!.placement.spot.kind).toBe('recess');
  expect(stats.sizing.base?.diameterMm).toBeCloseTo(32, 3);
  expect(stats.timings.map((t) => t.step)).toContain('place');

  // The figure seated in the recess, from the side at table level.
  await page.evaluate(() => window.__mt.setCamera(20, 18, 1));
  await page.waitForTimeout(500);
  await shoot(page, testInfo, 'pair-seated');

  // A move is a preview: nothing converts until Apply.
  await page.evaluate(() => window.__mt.setCamera(0, 12, 1));
  const conversions = await page.evaluate(() => window.__mt.state.progressLog.length);
  await page.evaluate(() => window.__mt.movePlacement(2, 0));
  await expect(page.locator('#placement-pending')).toHaveText('Moved 2 mm — not applied yet');
  await expect(page.locator('#placement-apply')).toBeEnabled();
  expect(await page.evaluate(() => window.__mt.state.progressLog.length)).toBe(conversions);
  expect(await page.evaluate(() => window.__mt.state.pair)).toEqual({
    moveMm: [2, 0],
    liftMm: 0,
    turnDeg: 0,
  });
  await page.locator('#pair').scrollIntoViewIfNeeded();
  await shoot(page, testInfo, 'pair-pending-move');

  await page.evaluate(() => window.__mt.applyPlacement());
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  const moved = await page.evaluate(() => window.__mt.state.stats!.pair!.placement);
  expect(moved.method).toBe('manual');
  expect(moved.offsetMm[0]).toBeCloseTo(stats.pair!.placement.offsetMm[0] + 2, 6);
  await expect(page.locator('#placement')).toHaveText('Set in the 13 mm recess · moved by hand');
  await expect(page.locator('#placement-pending')).toBeHidden();
});

test('swaps figure and base, and removes the base', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await loadPair(page);
  await page.evaluate(() => window.__mt.swapPair());
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  const swapped = await page.evaluate(() => window.__mt.state.stats!.pair!.pairing);
  expect(swapped).toMatchObject({ baseFile: 0, method: 'manual' });
  expect(swapped.warnings).toHaveLength(1);
  await expect(page.locator('#heading')).toHaveText('recess-base + figure');
  await expect(page.locator('#pair-warning')).toBeVisible();

  await page.evaluate(() => window.__mt.removeBase());
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  expect(await page.evaluate(() => window.__mt.state.stats!.pair)).toBeNull();
  await expect(page.locator('#add-base')).toBeVisible();
  await expect(page.locator('#swap-pair')).toBeHidden();
});

test('takes two files picked at once as a pair, and refuses a third', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', [
    file('hero.stl', generatePuddleFigure(12)),
    file('hero-base.stl', generateRecessBase()),
  ]);
  await page.waitForFunction(() => window.__mt.state.stats?.pair != null);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#heading')).toHaveText('hero + hero-base');
  await expect(page.locator('#placement')).toHaveText('Set in the 13 mm recess');

  await page.setInputFiles('#file', [
    file('a.stl', generatePuddleFigure(12)),
    file('b.stl', generateRecessBase()),
    file('c.stl', generateRecessBase()),
  ]);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toHaveText(
    'Drop one figure file, or a figure and its base.',
  );
});

test('adds a base to the mini on screen, and refuses two figures', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', file('hero.stl', generatePuddleFigure(12)));
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  expect(await page.evaluate(() => window.__mt.state.stats!.pair)).toBeNull();
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await page.setInputFiles('#base-file', file('hero-base.stl', generateRecessBase()));
  await page.waitForFunction(() => window.__mt.state.stats?.pair != null);
  await expect(page.locator('#heading')).toHaveText('hero + hero-base');

  await page.setInputFiles('#file', [
    file('one.stl', generateFigure(false)),
    file('two.stl', generateFigure(false)),
  ]);
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  expect(await page.evaluate(() => window.__mt.state.errorCode)).toBe('not-a-pair');
  await expect(page.locator('#status')).toHaveText(PROBLEM_MESSAGES['not-a-pair']);
});
