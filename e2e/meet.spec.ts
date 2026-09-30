import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { COPY } from '../src/page/page-state';
import { generatePuddleFigure, generateRecessBase, RECESS_BASE } from '../src/regression/shapes';

/**
 * Where the figure meets its base (#93, design note docs/design/marks-where-parts-meet.md §6.3,
 * §10 step 7): shown before the conversion for every pair with the automatic placement's pins
 * (PM decision 2026-09-30), marked by tapping, raised and turned along the spot's normal. The
 * generated figure on its puddle and the recess base, picked through #file. The screenshots are
 * drawn in software on CI: they show what is on screen, not how it looks on a real GPU.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.waitForTimeout(300);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});

type Asked = NonNullable<Window['__mt']['state']['question']>;
type MeetAsked = Extract<Asked, { kind: 'meet' }>;

/** Waits until a question with a serial above `after` is on screen. */
async function question(page: Page, after = 0): Promise<Asked> {
  await page.waitForFunction(
    (s) => (window.__mt.state.question?.serial ?? 0) > s && window.__mt.state.page === 'asking',
    after,
  );
  return page.evaluate(() => window.__mt.state.question!);
}
const meet = (page: Page): Promise<MeetAsked> =>
  page.evaluate(() => window.__mt.state.question!) as Promise<MeetAsked>;

async function ended(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

/** The pair picked together; its base and figure confirmed as detected: the meet question is next. */
async function atMeeting(page: Page): Promise<MeetAsked> {
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', [
    file('figure.stl', generatePuddleFigure(12)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  const base = await question(page);
  expect(base).toMatchObject({ kind: 'up', role: 'base' });
  await page.evaluate(() => window.__mt.confirmUp());
  const figure = await question(page, base.serial);
  expect(figure).toMatchObject({ kind: 'up', role: 'figure' });
  await expect(page.locator('#ask-confirm')).toHaveText(COPY.confirmFigureUp);
  await page.evaluate(() => window.__mt.confirmUp());
  const asked = await question(page, figure.serial);
  expect(asked).toMatchObject({ kind: 'meet', about: 'base' });
  return asked as MeetAsked;
}

const FLOOR_MM = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
/** A point on the recess floor, 3 mm off centre, in the base's file (Z-up); the puddle's sole centre in the figure's. */
const SPOT: [number, number, number] = [3, 0, FLOOR_MM];
const SOLE: [number, number, number] = [0, 0, 0];

test('shows the automatic placement, then places the figure where it is marked', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const proposed = await atMeeting(page);
  // The proposal: the automatic placement, with its pins; nothing to raise before a mark.
  expect(proposed.placement!.method).toBe('detected');
  expect(proposed.proposed).toHaveLength(1);
  expect(proposed.marks).toEqual([]);
  await expect(page.locator('#meet-question')).toHaveText(COPY.askMeet);
  await expect(page.locator('#meet-hint')).toHaveText('Set in the 13 mm recess');
  await expect(page.locator('#meet-adjust')).toBeHidden();
  await expect(page.locator('#heading')).toHaveText('figure.stl + recess-base.stl');
  await shoot(page, testInfo, 'meet-proposed');

  // The spot: one pin, the figure laid beside the base for the contact.
  await page.evaluate((spot) => window.__mt.mark(1, spot, [0, 0, 1]), SPOT);
  expect(await page.evaluate(() => window.__mt.state.marking.spot?.file)).toBe(1);
  await expect(page.locator('#meet-hint')).toHaveText('Now tap the contact on the figure.');
  await shoot(page, testInfo, 'meet-apart-one-pin');
  // The figure seen from below the grid: a sole is marked from underneath.
  await page.evaluate(() => window.__mt.setCamera(20, -35, 1));
  await shoot(page, testInfo, 'meet-from-below');
  await page.evaluate(() => window.__mt.setCamera(34, 22, 1));

  // The contact: the meeting goes to the worker and comes back placed.
  await page.evaluate((sole) => window.__mt.mark(0, sole, [0, 0, -1]), SOLE);
  const marked = await meet(page);
  expect(marked.placement!.method).toBe('marked');
  expect(marked.marks).toHaveLength(1);
  await expect(page.locator('#meet-hint')).toHaveText('Set where you marked');
  await expect(page.locator('#meet-adjust')).toBeVisible();
  await page.evaluate(() => window.__mt.liftMeeting(0.5));
  await expect(page.locator('#meet-hint')).toHaveText('Set where you marked · raised 0.5 mm');
  await shoot(page, testInfo, 'meet-marked');

  // The raycast of a tap: over the base's rim, it finds the base's top.
  const onRim = await page.evaluate(() => window.__mt.screenOf(1, [12, 0, 4]));
  const picked = await page.evaluate(([x, y]) => {
    const start = performance.now();
    const hit = window.__mt.pickAt(x, y);
    return { hit, ms: performance.now() - start };
  }, onRim!);
  expect(picked.hit?.file).toBe(1);
  expect(picked.hit!.point[2]).toBeCloseTo(4, 1);
  testInfo.annotations.push({ type: 'pick', description: `${picked.ms.toFixed(1)} ms` });

  await page.evaluate(() => window.__mt.confirmMeet());
  await ended(page);
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.progressLog.filter((p) => p.step === 'simplify')).toHaveLength(1);
  expect(state.stats!.pair!.placement!.method).toBe('marked');
  expect(state.stats!.asked.map((a) => a.role)).toEqual(['base', 'figure', 'meet']);
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await expect(page.locator('#placement')).toHaveText('Set where you marked · raised 0.5 mm');
  // No move, raise or turn after the conversion: mark again (PM decision 2026-09-30).
  await expect(page.locator('#move-by-hand')).toBeHidden();
  await expect(page.locator('#mark-meeting')).toBeVisible();

  // Mark where they meet: only the meet question, with the marks the mini was made with.
  const markingAgain = page.evaluate(() => window.__mt.markMeeting());
  const again = await question(page);
  expect(again).toMatchObject({ kind: 'meet', about: 'base' });
  expect((again as MeetAsked).marks).toHaveLength(1);
  await page.evaluate(() => window.__mt.resetMarks());
  expect((await meet(page)).placement!.method).toBe('detected');
  await page.evaluate(() => window.__mt.confirmMeet());
  await markingAgain;
  await ended(page);
  const reset = await page.evaluate(() => window.__mt.state.stats!);
  expect(reset.asked.map((a) => a.role)).toEqual(['meet']);
  expect(reset.pair!.placement!.method).toBe('detected');
  await expect(page.locator('#placement')).toHaveText('Set in the 13 mm recess');
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('marks with a finger', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await atMeeting(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const canvas = (await page.locator('#viewport').boundingBox())!;
    const tap = async (at: [number, number] | null): Promise<void> => {
      expect(at).not.toBeNull();
      await page.touchscreen.tap(canvas.x + at![0], canvas.y + at![1]);
    };
    // The spot on the base's top, from above.
    await tap(await page.evaluate(() => window.__mt.screenOf(1, [12, 0, 4])));
    await page.waitForFunction(() => window.__mt.state.marking.spot !== null);
    await shoot(page, testInfo, 'meet-phone-one-pin');
    // The contact on the sole, from below.
    await page.evaluate(() => window.__mt.setCamera(0, -40, 1));
    await page.waitForTimeout(300);
    const serial = await page.evaluate(() => window.__mt.state.question!.serial);
    await tap(await page.evaluate((sole) => window.__mt.screenOf(0, sole), SOLE));
    const marked = (await question(page, serial)) as MeetAsked;
    expect(marked.placement!.method).toBe('marked');
    await page.evaluate(() => window.__mt.setCamera(34, 22, 1));
    await page.locator('#meet-confirm').scrollIntoViewIfNeeded();
    await expect(page.locator('#meet-confirm')).toBeInViewport();
    await shoot(page, testInfo, 'meet-phone-marked');
  });
});
