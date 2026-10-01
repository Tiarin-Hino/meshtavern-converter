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
 * A figure in several files (#93, design notes docs/design/marks-where-parts-meet.md §6.2 and
 * docs/design/patches-where-parts-meet.md §7, §11 step 9): the parts question, a part lying apart
 * joined by two pairs, the base and figure after it; parts without a base, pulled apart; too many
 * files. Generated files, picked through #file.
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

async function question(page: Page, after = 0): Promise<Asked> {
  await page.waitForFunction(
    (s) => (window.__mt.state.question?.serial ?? 0) > s && window.__mt.state.page === 'asking',
    after,
  );
  return page.evaluate(() => window.__mt.state.question!);
}
const current = (page: Page): Promise<MeetAsked> =>
  page.evaluate(() => window.__mt.state.question!) as Promise<MeetAsked>;

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

test('joins a wing that lies apart by two pairs, then asks about the base and the figure', async ({
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
  const parts = (await question(page)) as MeetAsked;
  expect(parts).toMatchObject({ kind: 'meet', about: 'parts', stage: 'pairs', proposed: true });
  expect(parts.shown.map((s) => s.file)).toEqual([0, 1]);
  // The wing lies 50 mm apart: nothing touches, nothing is proposed.
  expect(parts.pairs).toEqual([]);
  await expect(page.locator('#meet-question')).toHaveText(COPY.askPairs);
  await expect(page.locator('#meet-hint')).toHaveText(
    'Nothing touches. Tap where they touch, or confirm to keep the parts where their files put them.',
  );
  await expect(page.locator('#meet-parts li')).toHaveText([
    'body · the body',
    'wing · lies apart: mark where it goes',
  ]);
  await expect(page.locator('#meet-confirm')).toHaveText(COPY.confirmPairs);
  await shoot(page, testInfo, 'parts-wing-apart');

  // The body's shoulder plate and the wing's root; then a second pair on the same faces, the
  // wing tapped first.
  await page.evaluate((point) => window.__mt.tap(0, point), WINGED_FIGURE.joint);
  await page.evaluate((point) => window.__mt.tap(1, point), moved(WINGED_FIGURE.joint));
  await page.evaluate(() => window.__mt.addPair());
  const second: [number, number, number] = [8.5, 1, 13];
  await page.evaluate((point) => window.__mt.tap(1, point), moved(second));
  await page.evaluate((point) => window.__mt.tap(0, point), second);
  const marked = await current(page);
  expect(marked.pairs.map(({ on, of }) => [on?.file, of?.file])).toEqual([
    [0, 1],
    [0, 1],
  ]);
  await expect(page.locator('#meet-hint')).toHaveText(
    'Tap a part in place and the part that goes there, where they touch.',
  );
  await shoot(page, testInfo, 'parts-wing-pairs');

  await page.evaluate(() => window.__mt.fitMeeting());
  const joined = await current(page);
  expect(joined.stage).toBe('fitted');
  expect(joined.parts[1]).toMatchObject({ file: 1, source: 'marked' });
  await expect(page.locator('#meet-question')).toHaveText(COPY.askParts);
  await expect(page.locator('#meet-parts li')).toHaveText([
    'body · the body',
    'wing · set where you marked · kept upright',
  ]);
  await expect(page.locator('#meet-adjust')).toBeVisible();
  await expect(page.locator('#meet-confirm')).toHaveText(COPY.confirmParts);
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
  expect(meeting).toMatchObject({ kind: 'meet', about: 'base', stage: 'pairs' });
  await page.evaluate(() => window.__mt.confirmMeet());
  await page.evaluate(() => window.__mt.confirmMeet());
  await ended(page);

  await expect(page.locator('#heading')).toHaveText('body + wing + recess-base');
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.asked.map((a) => a.role)).toEqual(['parts', 'base', 'figure', 'meet']);
  expect(stats.pair!.parts.map((p) => p.source)).toEqual(['body', 'marked']);
  expect(stats.choices.parts!.joints[0]!.pairs).toHaveLength(2);
  await page.locator('#adjust').evaluate((details: HTMLDetailsElement) => (details.open = true));
  await expect(page.locator('#pair-parts')).toHaveText('Parts: wing marked');
  await expect(page.locator('#pair-files')).toHaveText(
    'Base: recess-base.stl · Figure: body.stl + wing.stl',
  );
  await expect(page.locator('#mark-parts')).toBeVisible();
});

test('makes parts of one figure when there is no base, pulls them apart, refuses a seventh file', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await open(page);
  const { body, wing } = generateWingedFigure();
  await page.setInputFiles('#file', [file('body.stl', body), file('wing.stl', wing)]);
  const base = await question(page);
  expect(base).toMatchObject({ kind: 'up', role: 'base' });
  await page.evaluate(() => window.__mt.chooseBase(null));
  const parts = (await question(page, base.serial)) as MeetAsked;
  expect(parts).toMatchObject({
    kind: 'meet',
    about: 'parts',
    proposed: true,
    roles: { baseFile: null, figureFiles: [0, 1] },
  });
  // The wing is where its file puts it: the pair where it touches the body is proposed.
  expect(parts.pairs).toHaveLength(1);
  expect(parts.apart!.shown.map((s) => s.file)).toEqual([0, 1]);
  await expect(page.locator('#meet-apart')).toBeVisible();
  await page.locator('#meet-apart').click();
  await expect(page.locator('#meet-apart')).toHaveAttribute('aria-pressed', 'true');
  await shoot(page, testInfo, 'parts-pulled-apart');
  // A kit in place has no final view: one Confirm.
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
  await question(page);
  await page.evaluate((point) => window.__mt.tap(0, point), WINGED_FIGURE.joint);
  await page.evaluate((point) => window.__mt.tap(1, point), moved(WINGED_FIGURE.joint));
  await page.evaluate(() => window.__mt.fitMeeting());
  const fitted = await current(page);
  await page.evaluate(() => window.__mt.confirmMeet());
  const base = await question(page, fitted.serial);
  expect(base).toMatchObject({ kind: 'up', role: 'base', file: 2 });
  // The wing named as the base: the joint that placed it names a file that is no part now.
  await page.evaluate(() => window.__mt.chooseBase(1));
  const again = await question(page, base.serial);
  expect(again).toMatchObject({ kind: 'meet', about: 'parts', proposed: true, marks: null });
  await page.evaluate(() => window.__mt.confirmMeet());
  const next = await question(page, again.serial);
  expect(next).toMatchObject({ kind: 'up', role: 'base', file: 1 });
  expect(await page.evaluate(() => window.__mt.state.error)).toBeNull();
  await page.evaluate(() => window.__mt.cancel());
});
