import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { PROBLEM_MESSAGES } from '../src/lib';
import { COPY } from '../src/page/page-state';
import {
  generateFigure,
  generatePuddleFigure,
  generateQuadruped,
  generateRecessBase,
} from '../src/regression/shapes';

/**
 * Which way is up, asked on the full-detail mesh before anything is reduced (#92, design note
 * docs/design/up-before-reduce.md §6, §10 step 8). Generated files, picked through #file as a
 * person picks them. The screenshots are drawn in software on CI: they show that the question's
 * mesh is on screen, not how it looks on a real GPU.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});

/** The generated figure without a base, stored lying: its up is +x, and the detection takes +z. */
function lyingFigure(): Float32Array {
  const soup = generateFigure(false);
  const lying = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    lying[i] = soup[i + 2]!;
    lying[i + 1] = soup[i + 1]!;
    lying[i + 2] = 0 - soup[i]!;
  }
  return lying;
}

async function open(page: Page, search = '?bake=off'): Promise<void> {
  await page.goto(`/${search}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
}

type Asked = NonNullable<Window['__mt']['state']['question']>;
type UpAsked = Extract<Asked, { kind: 'up' }>;

/** Waits until a question with a serial above `after` is on screen: the next one of this conversion. */
async function anyQuestion(page: Page, after = 0): Promise<Asked> {
  await page.waitForFunction(
    (s) => (window.__mt.state.question?.serial ?? 0) > s && window.__mt.state.page === 'asking',
    after,
  );
  return page.evaluate(() => window.__mt.state.question!);
}

/** The next up question (#92). */
async function question(page: Page, after = 0): Promise<UpAsked> {
  const asked = await anyQuestion(page, after);
  expect(asked.kind).toBe('up');
  return asked as UpAsked;
}

/** The up question on screen. */
const current = (page: Page): Promise<UpAsked> =>
  page.evaluate(() => window.__mt.state.question!) as Promise<UpAsked>;

/** Every pair is shown where it meets its base before it converts (#93): confirms that as shown. */
async function confirmMeet(page: Page): Promise<void> {
  const asked = await anyQuestion(page);
  expect(asked).toMatchObject({ kind: 'meet', about: 'base' });
  await page.evaluate(() => window.__mt.confirmMeet());
}

/** Waits until the conversion ended, in a mini or an error. */
async function ended(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

const progressSteps = (page: Page) =>
  page.evaluate(() => window.__mt.state.progressLog.map((p) => p.step));

test('stops after the orient step and converts on Confirm', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  const asked = await question(page);
  expect(asked).toMatchObject({ role: 'mini', reason: 'base', name: 'hero.stl' });
  await expect(page.locator('body')).toHaveAttribute('data-state', 'asking');
  await expect(page.locator('#ask-question')).toHaveText(COPY.askUp);
  await expect(page.locator('#ask-found')).toHaveText('Standing on its base, 25 mm across.');
  await expect(page.locator('#ask-file')).toBeHidden();
  await expect(page.locator('#ask-swap')).toBeHidden();
  await expect(page.locator('#ask-confirm')).toHaveText(COPY.confirmUp);
  await expect(page.locator('#cancel')).toBeVisible();
  await expect(page.locator('#progress')).toBeHidden();
  // Nothing after the orient step has run.
  expect(await progressSteps(page)).toEqual(['read', 'weld', 'orient']);
  await expect(page.locator('#ask-up')).toHaveValue('+z');
  await page.waitForFunction(() => window.__mt.state.questionMs !== null);
  await shoot(page, testInfo, 'question-upright');

  await page.locator('#ask-confirm').click();
  await ended(page);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.asked).toEqual([{ role: 'mini', tries: 0, waitedMs: expect.any(Number) }]);
  expect(stats.upMethod).toBe('base');
  expect(await page.evaluate(() => window.__mt.state.questionMs)).toBeGreaterThan(0);
});

test('stands a lying figure up at the question and converts it once', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', file('lying.stl', lyingFigure()));
  const first = await question(page);
  expect(first.orientation.up).toBe('+z');
  await expect(page.locator('#ask-found')).toHaveText(
    'No base found, so the taller way was taken as up. Check it.',
  );
  await shoot(page, testInfo, 'question-lying');

  await page.evaluate(() => window.__mt.answerUp({ up: '+x' }));
  const standing = await page.evaluate(() => window.__mt.state.question!);
  expect(standing).toMatchObject({ reason: 'chosen', orientation: { up: '+x', method: 'manual' } });
  expect(standing.serial).toBeGreaterThan(first.serial);
  await expect(page.locator('#ask-up')).toHaveValue('+x');
  await expect(page.locator('#ask-found')).toHaveText('As you turned it.');
  await shoot(page, testInfo, 'question-stood-up');

  await page.evaluate(() => window.__mt.confirmUp());
  await ended(page);
  const steps = await progressSteps(page);
  expect(steps.filter((step) => step === 'simplify')).toHaveLength(1);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats).toMatchObject({ up: '+x', upMethod: 'manual' });
  expect(stats.asked).toEqual([{ role: 'mini', tries: 1, waitedMs: expect.any(Number) }]);
  expect(stats.sizeMm[1]).toBeGreaterThan(29);
});

test('previews a turn without asking, and asks again for Set down and Reset', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  const first = await question(page);

  // Two presses of Pitch +15°: a preview, the worker hears nothing.
  const pitch = page.locator('#ask-turn [data-turn="pitch"][data-deg="15"]');
  await pitch.click();
  await pitch.click();
  await expect(page.locator('#ask-pending')).toHaveText('Turned 30°');
  expect(await page.evaluate(() => window.__mt.state.question!.serial)).toBe(first.serial);

  // Set down asks again, with the turn; Reset asks again with the proposal.
  await page.locator('#ask-set-down').click();
  const setDown = await question(page, first.serial);
  expect(setDown.orientation.method).toBe('manual');
  await expect(page.locator('#ask-pending')).toBeHidden();
  await page.locator('#ask-reset').click();
  const reset = await question(page, setDown.serial);
  expect(reset).toMatchObject({ reason: 'base', orientation: { up: '+z', method: 'base' } });

  // A turn being tried out is what Confirm converts.
  await pitch.click();
  await pitch.click();
  await page.locator('#ask-confirm').click();
  await ended(page);
  const orientation = await page.evaluate(() => window.__mt.state.stats!.orientation);
  expect(orientation).toMatchObject({ up: '+z', method: 'manual' });
  expect(orientation.tiltDeg).toBeCloseTo(30, 1);
});

test('asks about the base of a pair, then the figure, and swaps at the question', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await open(page);
  await page.setInputFiles('#file', [
    file('hero.stl', generatePuddleFigure(12)),
    file('hero-base.stl', generateRecessBase()),
  ]);
  const base = await question(page);
  expect(base).toMatchObject({ role: 'base', file: 1, reason: 'underside' });
  await expect(page.locator('#ask-file')).toHaveText('Base: hero-base.stl');
  await expect(page.locator('#ask-found')).toHaveText('Standing on its flat underside.');
  await expect(page.locator('#ask-swap')).toBeVisible();
  await expect(page.locator('#ask-confirm')).toHaveText(COPY.confirmBaseUp);
  await expect(page.locator('#ask-warning')).toHaveText(
    'The figure has a flat underside of its own; it was set on the base anyway.',
  );
  await shoot(page, testInfo, 'question-base');

  // The base turned over and back.
  await page.evaluate(() => window.__mt.answerUp({ up: '-z' }));
  expect((await current(page)).orientation.up).toBe('-z');
  await page.evaluate(() => window.__mt.answerUp({}));
  expect((await current(page)).reason).toBe('underside');
  await page.evaluate(() => window.__mt.confirmUp());
  const figure = await question(page);
  expect(figure).toMatchObject({ role: 'figure', file: 0 });
  await expect(page.locator('#ask-file')).toHaveText('Figure: hero.stl');
  await expect(page.locator('#ask-confirm')).toHaveText(COPY.confirmFigureUp);

  // Swap: the questions start again with the other file as the base.
  await page.evaluate(() => window.__mt.swapAtQuestion());
  const swapped = await current(page);
  expect(swapped).toMatchObject({ role: 'base', file: 0 });
  await expect(page.locator('#ask-file')).toHaveText('Base: hero.stl');
  await page.evaluate(() => window.__mt.confirmUp());
  await question(page);
  await page.evaluate(() => window.__mt.confirmUp());
  await confirmMeet(page);
  await ended(page);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.pair!.pairing).toMatchObject({ baseFile: 0, method: 'manual' });
  // In the order confirmed: the first base, confirmed before the swap at the figure, stays listed.
  expect(stats.asked.map((a) => a.role)).toEqual(['base', 'base', 'figure', 'meet']);
});

test('asks which file is the base when neither has a flat underside', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await page.setInputFiles('#file', [
    file('standing.stl', generateFigure(false)),
    file('low.stl', generateQuadruped()),
  ]);
  const base = await question(page);
  expect(base).toMatchObject({ role: 'base', file: 1, reason: 'guess' });
  await expect(page.locator('#ask-warning')).toHaveText(
    'Neither file has a flat underside, so the converter cannot tell which one is the base. It took the lower, wider one. If this is the figure, swap them.',
  );
  await expect(page.locator('#ask-found')).toHaveText('No flat underside found. Check it.');

  // The person says the standing figure is the base.
  await page.locator('#ask-swap').click();
  const swapped = await question(page);
  expect(swapped).toMatchObject({ role: 'base', file: 0 });
  await page.locator('#ask-confirm').click();
  await question(page);
  await page.locator('#ask-confirm').click();
  await confirmMeet(page);
  await ended(page);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.pair!.pairing).toMatchObject({ baseFile: 0, method: 'manual' });
  await expect(page.locator('#pair-warning')).toHaveText(
    'Neither file has a flat underside; you said which one is the base.',
  );
  await expect(page.locator('#pair-files')).toHaveText('Base: standing.stl · Figure: low.stl');
});

test('cancels at the question, and the next file converts', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await question(page);
  await page.locator('#cancel').click();
  await page.waitForFunction(() => !window.__mt.state.busy);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#status')).toHaveText(COPY.cancelled);
  expect(await page.evaluate(() => window.__mt.state.question)).toBeNull();

  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await question(page);
  await page.evaluate(() => window.__mt.confirmUp());
  await ended(page);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
});

test('asks about a new base, and about the figure only when its up was not chosen', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await open(page);
  const base = () => page.setInputFiles('#base-file', file('hero-base.stl', generateRecessBase()));

  // A figure confirmed as detected: adding a base asks about both.
  await page.setInputFiles('#file', file('hero.stl', generatePuddleFigure(12)));
  await question(page);
  await page.evaluate(() => window.__mt.confirmUp());
  await ended(page);
  await base();
  expect((await question(page)).role).toBe('base');
  await page.evaluate(() => window.__mt.confirmUp());
  expect((await question(page)).role).toBe('figure');
  await page.evaluate(() => window.__mt.confirmUp());
  await confirmMeet(page);
  await ended(page);

  // A figure whose up was chosen: only the base is asked about.
  await page.setInputFiles('#file', file('hero.stl', generatePuddleFigure(12)));
  await question(page);
  await page.evaluate(() => window.__mt.confirmUp({ up: '+z' }));
  await ended(page);
  await base();
  expect((await question(page)).role).toBe('base');
  await page.evaluate(() => window.__mt.confirmUp());
  await confirmMeet(page);
  await ended(page);
  expect(await page.evaluate(() => window.__mt.state.stats!.asked.map((a) => a.role))).toEqual([
    'base',
    'meet',
  ]);

  // Changing the size in Adjust asks nothing.
  await page.evaluate(() => window.__mt.setSizing({ size: 'large' }));
  await ended(page);
  expect(await page.evaluate(() => window.__mt.state.stats!.asked)).toEqual([]);
  expect(await page.evaluate(() => window.__mt.state.stats!.sizing.size)).toBe('large');
});

test('converts without a question with ?ask=off, and refuses two figures there', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, '?bake=off&ask=off');
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await ended(page);
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.page).toBe('done');
  expect(state.stats!.asked).toEqual([]);
  expect(state.questionMs).toBeNull();

  await page.setInputFiles('#file', [
    file('standing.stl', generateFigure(false)),
    file('low.stl', generateQuadruped()),
  ]);
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('#status')).toHaveText(PROBLEM_MESSAGES['not-a-pair']);
});

test('asks on a phone, the panel as a sheet under the mesh', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.setInputFiles('#file', file('lying.stl', lyingFigure()));
  await question(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await page.locator('#viewport').boundingBox())!.height).toBeGreaterThanOrEqual(844 / 2);
  await page.locator('#ask-confirm').scrollIntoViewIfNeeded();
  await expect(page.locator('#ask-confirm')).toBeInViewport();
  await page.waitForTimeout(300);
  await shoot(page, testInfo, 'question-phone');
});
