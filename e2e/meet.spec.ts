import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { COPY } from '../src/page/page-state';
import { generatePuddleFigure, generateRecessBase, RECESS_BASE } from '../src/regression/shapes';

/**
 * Where the figure meets its base (#93, design note docs/design/patches-where-parts-meet.md §7,
 * §11 step 9): the pairs stop with the figure beside its base and the proposed pair, the person's
 * own pairs by taps and the brush, then the final view, before the conversion. The generated
 * figure on its puddle and the recess base, picked through #file. The screenshots are drawn in
 * software on CI: they show what is on screen, not how it looks on a real GPU.
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
/** Which files the pairs on screen are on: `[on, of]` per pair, null for a side not marked. */
const sides = (asked: MeetAsked): (number | null)[][] =>
  asked.pairs.map(({ on, of }) => [on?.file ?? null, of?.file ?? null]);

async function ended(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

/** The pair picked together; its base and figure confirmed as detected: the pairs stop is next. */
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
  expect(asked).toMatchObject({ kind: 'meet', about: 'base', stage: 'pairs' });
  return asked as MeetAsked;
}

const FLOOR_MM = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
/** Points on the recess floor in the base's file (Z-up), and on the puddle's sole in the figure's. */
const FLOOR_A: [number, number, number] = [2, 0, FLOOR_MM];
const SOLE_A: [number, number, number] = [0, 0, 0];
const FLOOR_B: [number, number, number] = [-1.5, 0, FLOOR_MM];
const SOLE_B: [number, number, number] = [-3.5, 0, 0];

test('proposes the pair apart, shows where it puts the figure, and converts once', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const proposed = await atMeeting(page);
  // The figure stands beside its base, the proposed pair on both.
  expect(proposed.proposed).toBe(true);
  expect(proposed.marks).toBeNull();
  expect(sides(proposed)).toEqual([[1, 0]]);
  expect(proposed.pairs[0]!.on!.areaMm2).toBeGreaterThan(0);
  expect(proposed.shown.map((s) => s.file)).toEqual([1, 0]);
  await expect(page.locator('#meet-question')).toHaveText(COPY.askPairs);
  await expect(page.locator('#meet-hint')).toHaveText(
    'Confirm, or tap where they touch to mark your own.',
  );
  await expect(page.locator('#meet-pairs .chip')).toHaveText(['1  recess-base · figure  proposed']);
  await expect(page.locator('#meet-confirm')).toHaveText(COPY.confirmPairs);
  await expect(page.locator('#meet-final')).toBeHidden();
  await expect(page.locator('#heading')).toHaveText('figure.stl + recess-base.stl');
  await shoot(page, testInfo, 'pairs-proposed');

  await page.locator('#meet-confirm').click();
  const fitted = await question(page, proposed.serial);
  expect(fitted).toMatchObject({ kind: 'meet', stage: 'fitted', proposed: true });
  expect((fitted as MeetAsked).placement!.method).toBe('detected');
  await expect(page.locator('#meet-question')).toHaveText(COPY.askMeet);
  await expect(page.locator('#meet-placement')).toHaveText('Set in the 13 mm recess');
  await expect(page.locator('#meet-adjust')).toBeVisible();
  // The automatic placement turns about the vertical only: nothing to tilt.
  await expect(page.locator('#meet-tilt')).toBeHidden();
  await expect(page.locator('#meet-marking')).toBeHidden();
  await shoot(page, testInfo, 'final-automatic');

  await page.locator('#meet-confirm').click();
  await ended(page);
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.progressLog.filter((p) => p.step === 'simplify')).toHaveLength(1);
  expect(state.stats!.pair!.placement!.method).toBe('detected');
  expect(state.stats!.asked.map((a) => [a.role, a.tries])).toEqual([
    ['base', 0],
    ['figure', 0],
    ['meet', 0],
  ]);
  expect(state.stats!.choices.placement).toBeUndefined();
});

test('marks two pairs of its own, brushes and erases, fits, goes back and tilts', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await atMeeting(page);
  // The first tap starts the person's own marks: one side, Confirm waits for the other.
  await page.evaluate((point) => window.__mt.tap(1, point), FLOOR_A);
  let asked = await meet(page);
  expect(asked.proposed).toBe(false);
  expect(sides(asked)).toEqual([[1, null]]);
  await expect(page.locator('#meet-hint')).toHaveText('Mark the other side, or clear the pair.');
  await expect(page.locator('#meet-confirm')).toBeDisabled();
  await page.evaluate((point) => window.__mt.tap(0, point), SOLE_A);
  asked = await meet(page);
  expect(sides(asked)).toEqual([[1, 0]]);
  await expect(page.locator('#meet-confirm')).toBeEnabled();
  await expect(page.locator('#meet-hint')).toHaveText(
    'Tap the base and the figure where they touch.',
  );
  // The brush grows the floor's patch; the eraser takes some of it away.
  const tapped = asked.pairs[0]!.on!.areaMm2;
  await page.evaluate((points) => window.__mt.brush(1, points), [
    [4.5, 0, FLOOR_MM],
    [5, 1, FLOOR_MM],
  ] as [number, number, number][]);
  const brushed = (await meet(page)).pairs[0]!.on!.areaMm2;
  expect(brushed).toBeGreaterThan(tapped);
  await page.evaluate((points) => window.__mt.brush(1, points, { erase: true }), [
    [2, 0, FLOOR_MM],
  ] as [number, number, number][]);
  expect((await meet(page)).pairs[0]!.on!.areaMm2).toBeLessThan(brushed);

  // Start over, and two pairs by taps: the second in its own colour.
  await page.evaluate(() => window.__mt.clearMarks());
  expect((await meet(page)).proposed).toBe(true);
  await page.evaluate((point) => window.__mt.tap(1, point), FLOOR_A);
  await page.evaluate((point) => window.__mt.tap(0, point), SOLE_A);
  await page.evaluate(() => window.__mt.addPair());
  await page.evaluate((point) => window.__mt.tap(1, point), FLOOR_B);
  await page.evaluate((point) => window.__mt.tap(0, point), SOLE_B);
  asked = await meet(page);
  expect(sides(asked)).toEqual([
    [1, 0],
    [1, 0],
  ]);
  await expect(page.locator('#meet-pairs .chip')).toHaveText([
    '1  recess-base · figure',
    '2  recess-base · figure',
  ]);
  await page.evaluate(() => window.__mt.selectPair(0));
  await expect(page.locator('#meet-pairs .chip[aria-pressed="true"]')).toHaveText(
    '1  recess-base · figure',
  );
  await shoot(page, testInfo, 'pairs-own-two');

  // What a tap over the base's rim hits: the base's top, in the base's file.
  const onRim = await page.evaluate(() => window.__mt.screenOf(1, [12, 0, 4]));
  const hit = await page.evaluate(([x, y]) => window.__mt.pickAt(x, y), onRim!);
  expect(hit?.file).toBe(1);
  expect(hit!.point[2]).toBeCloseTo(4, 1);

  // Put together: set where marked, kept upright on a flat floor.
  await page.evaluate(() => window.__mt.fitMeeting());
  asked = await meet(page);
  expect(asked.stage).toBe('fitted');
  expect(asked.placement!.method).toBe('marked');
  expect(asked.placement!.marks!.fit.kept).toBe('standing');
  await expect(page.locator('#meet-placement')).toHaveText('Set where you marked · kept upright');
  await expect(page.locator('#meet-tilt')).toHaveText(COPY.letTilt);
  // The patches seen through the feet, from above.
  await page.evaluate(() => window.__mt.setCamera(30, 70, 1));
  await shoot(page, testInfo, 'final-marked-from-above');
  await page.evaluate(() => window.__mt.setCamera(34, 22, 1));
  await page.evaluate(() => window.__mt.liftMeeting(0.5));
  await expect(page.locator('#meet-placement')).toHaveText(
    'Set where you marked · kept upright · raised 0.5 mm',
  );
  await page.evaluate(() => window.__mt.setTilt('free'));
  expect((await meet(page)).placement!.marks!.fit.kept).toBe('free');
  await expect(page.locator('#meet-tilt')).toHaveText(COPY.keepUpright);
  await page.evaluate(() => window.__mt.setTilt(null));
  await shoot(page, testInfo, 'final-marked');

  // Back to the pairs: the marks are kept. Start over brings the proposal; Undo the marks.
  await page.evaluate(() => window.__mt.backToMarks());
  asked = await meet(page);
  expect(asked.stage).toBe('pairs');
  expect(asked.pairs).toHaveLength(2);
  await page.evaluate(() => window.__mt.clearMarks());
  expect((await meet(page)).proposed).toBe(true);
  await page.evaluate(() => window.__mt.undoMark());
  expect((await meet(page)).pairs).toHaveLength(2);

  await page.evaluate(() => window.__mt.fitMeeting());
  await page.evaluate(() => window.__mt.confirmMeet());
  await ended(page);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.pair!.placement!.method).toBe('marked');
  expect(stats.choices.placement!.marks!.pairs).toHaveLength(2);
  expect(stats.choices.placement!.marks!.liftMm).toBe(0.5);
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await expect(page.locator('#placement')).toHaveText(
    'Set where you marked · kept upright · raised 0.5 mm',
  );
  // No move, raise or turn after the conversion: mark again (PM decision 2026-09-30).
  await expect(page.locator('#move-by-hand')).toBeHidden();
  await expect(page.locator('#mark-meeting')).toBeVisible();

  // Mark where they meet: only the meet question, with the pairs the mini was made with.
  const markingAgain = page.evaluate(() => window.__mt.markMeeting());
  const again = (await question(page)) as MeetAsked;
  expect(again).toMatchObject({ kind: 'meet', about: 'base', stage: 'pairs', proposed: false });
  expect(again.pairs).toHaveLength(2);
  await page.evaluate(() => window.__mt.clearMarks());
  await page.evaluate(() => window.__mt.fitMeeting());
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
      const serial = await page.evaluate(() => window.__mt.state.question!.serial);
      await page.touchscreen.tap(canvas.x + at![0], canvas.y + at![1]);
      await question(page, serial);
    };
    // The base's top, from above.
    await tap(await page.evaluate(() => window.__mt.screenOf(1, [12, 0, 4])));
    expect(sides(await meet(page))).toEqual([[1, null]]);
    await shoot(page, testInfo, 'pairs-phone-one-side');
    // The sole, from below.
    await page.evaluate(() => window.__mt.setCamera(0, -40, 1));
    await page.waitForTimeout(300);
    await tap(await page.evaluate((sole) => window.__mt.screenOf(0, sole), SOLE_A));
    expect(sides(await meet(page))).toEqual([[1, 0]]);
    await page.evaluate(() => window.__mt.setCamera(34, 22, 1));
    await page.locator('#meet-confirm').scrollIntoViewIfNeeded();
    await expect(page.locator('#meet-confirm')).toBeInViewport();
    await shoot(page, testInfo, 'pairs-phone');
    const serial = await page.evaluate(() => window.__mt.state.question!.serial);
    await page.locator('#meet-confirm').tap();
    const fitted = (await question(page, serial)) as MeetAsked;
    expect(fitted.placement!.method).toBe('marked');
    await shoot(page, testInfo, 'final-phone');
  });
});
