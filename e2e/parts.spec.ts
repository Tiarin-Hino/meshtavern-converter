import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { COPY, describeTooManyFiles } from '../src/page/page-state';
import {
  generateRecessBase,
  generateWingedFigure,
  movedSoup,
  WINGED_FIGURE,
} from '../src/regression/shapes';

/**
 * A figure in several files (#93, design note docs/design/marks-where-parts-meet.md §6.2, §10
 * step 7): the parts question, a part lying apart joined by two marks, the base and figure after
 * it; parts without a base; too many files. Generated files, picked through #file.
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

async function question(page: Page, after = 0): Promise<Asked> {
  await page.waitForFunction(
    (s) => (window.__mt.state.question?.serial ?? 0) > s && window.__mt.state.page === 'asking',
    after,
  );
  return page.evaluate(() => window.__mt.state.question!);
}

async function ended(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

async function open(page: Page): Promise<void> {
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
}

const WING_MOVE: [number, number, number] = [50, 0, 0];
const moved = (p: readonly number[]): [number, number, number] => [
  p[0]! + WING_MOVE[0],
  p[1]! + WING_MOVE[1],
  p[2]! + WING_MOVE[2],
];

test('joins a wing that lies apart, then asks about the base and the figure', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await open(page);
  const { body, wing } = generateWingedFigure();
  await page.setInputFiles('#file', [
    file('body.stl', body),
    file('wing.stl', movedSoup(wing, WING_MOVE)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  const parts = await question(page);
  expect(parts).toMatchObject({ kind: 'meet', about: 'parts' });
  if (parts.kind !== 'meet') throw new Error('expected the parts question');
  expect(parts.shown.map((s) => s.file)).toEqual([0, 1]);
  expect(parts.proposed).toEqual([]);
  await expect(page.locator('#meet-question')).toHaveText(COPY.askParts);
  await expect(page.locator('#meet-parts li')).toHaveText([
    'body · the body',
    'wing · lies apart: mark where it goes',
  ]);
  await expect(page.locator('#meet-confirm')).toHaveText(COPY.confirmParts);
  await shoot(page, testInfo, 'parts-wing-apart');

  // The spot on the body's shoulder plate, then the contact on the wing's root.
  await page.evaluate((spot) => window.__mt.mark(0, spot, [1, 0, 0]), WINGED_FIGURE.joint);
  await expect(page.locator('#meet-hint')).toHaveText(
    'Now tap the contact on the part that goes there.',
  );
  await page.evaluate(
    (contact) => window.__mt.mark(1, contact, [-1, 0, 0]),
    moved(WINGED_FIGURE.joint),
  );
  const joined = await page.evaluate(() => window.__mt.state.question!);
  if (joined.kind !== 'meet') throw new Error('expected the parts question');
  expect(joined.parts[1]).toMatchObject({ file: 1, source: 'marked' });
  await expect(page.locator('#meet-parts li')).toHaveText(['body · the body', 'wing · marked']);
  await expect(page.locator('#meet-adjust')).toBeVisible();
  await shoot(page, testInfo, 'parts-wing-joined');

  await page.evaluate(() => window.__mt.confirmMeet());
  const base = await question(page, joined.serial);
  expect(base).toMatchObject({ kind: 'up', role: 'base', file: 2 });
  await expect(page.locator('#ask-base-choice')).toBeVisible();
  await page.evaluate(() => window.__mt.confirmUp());
  const figure = await question(page, base.serial);
  expect(figure).toMatchObject({ kind: 'up', role: 'figure', file: 0 });
  expect(figure.shown.map((s) => s.file)).toEqual([0, 1]);
  await expect(page.locator('#ask-file')).toHaveText('Figure: body.stl + wing.stl');
  await page.evaluate(() => window.__mt.confirmUp());
  const meeting = await question(page, figure.serial);
  expect(meeting).toMatchObject({ kind: 'meet', about: 'base' });
  await page.evaluate(() => window.__mt.confirmMeet());
  await ended(page);

  await expect(page.locator('#heading')).toHaveText('body + wing + recess-base');
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.asked.map((a) => a.role)).toEqual(['parts', 'base', 'figure', 'meet']);
  expect(stats.pair!.parts.map((p) => p.source)).toEqual(['body', 'marked']);
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await expect(page.locator('#pair-parts')).toHaveText('Parts: wing marked');
  await expect(page.locator('#pair-files')).toHaveText(
    'Base: recess-base.stl · Figure: body.stl + wing.stl',
  );
  await expect(page.locator('#mark-parts')).toBeVisible();
});

test('makes parts of one figure when there is no base, and refuses a seventh file', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await open(page);
  const { body, wing } = generateWingedFigure();
  await page.setInputFiles('#file', [file('body.stl', body), file('wing.stl', wing)]);
  const base = await question(page);
  expect(base).toMatchObject({ kind: 'up', role: 'base' });
  await page.evaluate(() => window.__mt.chooseBase(null));
  const parts = await question(page, base.serial);
  expect(parts).toMatchObject({
    kind: 'meet',
    about: 'parts',
    roles: { baseFile: null, figureFiles: [0, 1] },
  });
  // The wing is where its file puts it: pinned where it touches the body.
  if (parts.kind !== 'meet') throw new Error('expected the parts question');
  expect(parts.proposed).toHaveLength(1);
  await page.evaluate(() => window.__mt.confirmMeet());
  const mini = await question(page, parts.serial);
  expect(mini).toMatchObject({ kind: 'up', role: 'mini' });
  await page.evaluate(() => window.__mt.confirmUp());
  await ended(page);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.pair).toMatchObject({ placement: null, baseOrientation: null });
  expect(stats.asked.map((a) => a.role)).toEqual(['parts', 'mini']);
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await expect(page.locator('#pair-files')).toHaveText('Figure: body.stl + wing.stl');
  await expect(page.locator('#add-base')).toBeVisible();

  const seven = Array.from({ length: 7 }, (_, k) => file(`part-${k}.stl`, wing));
  await page.setInputFiles('#file', seven);
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('#status')).toHaveText(describeTooManyFiles(6));
  expect(await page.evaluate(() => window.__mt.state.errorCode)).toBe('too-many-files');
});

test('drops the joints when another base is chosen after them', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  const { body, wing } = generateWingedFigure();
  await page.setInputFiles('#file', [
    file('body.stl', body),
    file('wing.stl', movedSoup(wing, WING_MOVE)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  const parts = await question(page);
  await page.evaluate((spot) => window.__mt.mark(0, spot, [1, 0, 0]), WINGED_FIGURE.joint);
  await page.evaluate(
    (contact) => window.__mt.mark(1, contact, [-1, 0, 0]),
    moved(WINGED_FIGURE.joint),
  );
  await page.evaluate(() => window.__mt.confirmMeet());
  const base = await question(page, parts.serial);
  expect(base).toMatchObject({ kind: 'up', role: 'base', file: 2 });
  // The wing named as the base: the joint that placed it names a file that is no part now.
  await page.evaluate(() => window.__mt.chooseBase(1));
  const again = await question(page, base.serial);
  expect(again).toMatchObject({ kind: 'meet', about: 'parts', marks: [] });
  await page.evaluate(() => window.__mt.confirmMeet());
  const next = await question(page, again.serial);
  expect(next).toMatchObject({ kind: 'up', role: 'base', file: 1 });
  expect(await page.evaluate(() => window.__mt.state.error)).toBeNull();
  await page.evaluate(() => window.__mt.cancel());
});
