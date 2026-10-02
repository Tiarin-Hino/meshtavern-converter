import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { SOURCE_PRESETS } from '../src/lib';
import { COPY } from '../src/page/page-state';
import { generateFigure } from '../src/regression/shapes';

/**
 * Source presets (#100, design note docs/design/source-presets.md §5): the select at the up
 * question and at the top of Adjust. A generated figure written in metres, Y up, picked through
 * #file as a person picks it. Screenshots are drawn in software on CI.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The generated figure on its base, Y up and in metres: 0.03 units tall. */
function metresYUp(): Float32Array {
  const soup = generateFigure(true);
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    out[i] = soup[i]! / 1000;
    out[i + 1] = soup[i + 2]! / 1000;
    out[i + 2] = (0 - soup[i + 1]!) / 1000;
  }
  return out;
}

type Asked = NonNullable<Window['__mt']['state']['question']>;

async function question(page: Page, after = 0): Promise<Asked & { kind: 'up' }> {
  await page.waitForFunction(
    (s) => (window.__mt.state.question?.serial ?? 0) > s && window.__mt.state.page === 'asking',
    after,
  );
  const asked = await page.evaluate(() => window.__mt.state.question!);
  expect(asked.kind).toBe('up');
  return asked as Asked & { kind: 'up' };
}

async function ended(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

const unitsRow = (page: Page) => page.locator('#stats dt:text-is("Units") + dd');
const upRow = (page: Page) => page.locator('#stats dt:text-is("Up") + dd');

test('a preset at the question stands the file its way, and None in Adjust guesses again', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/?dev&bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  // Both selects offer None, then every preset by its label.
  const labels = [COPY.noPreset, ...SOURCE_PRESETS.map((preset) => preset.label)];
  await expect(page.locator('#ask-source option')).toHaveText(labels);
  await expect(page.locator('#source option')).toHaveText(labels);

  await page.setInputFiles('#file', {
    name: 'scene.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(encodeBinaryStl(metresYUp())),
  });
  const first = await question(page);
  expect(first).toMatchObject({ role: 'mini', reason: 'base', orientation: { up: '+y' } });
  await expect(page.locator('#ask-source')).toHaveValue('');
  expect(await page.evaluate(() => window.__mt.state.preset)).toBeNull();

  // The preset answers: the question comes again, on the preset's axis.
  await page.evaluate(() => window.__mt.setPreset('scene-m-y'));
  const second = await question(page, first.serial);
  expect(second).toMatchObject({ reason: 'chosen', orientation: { up: '+y', method: 'manual' } });
  await expect(page.locator('#ask-found')).toHaveText('Standing as its source says.');
  await expect(page.locator('#ask-source')).toHaveValue('scene-m-y');
  await expect(page.locator('#ask-up')).toHaveValue('+y');
  await shoot(page, testInfo, 'question-with-preset');

  await page.locator('#ask-confirm').click();
  await ended(page);
  expect(await page.evaluate(() => window.__mt.state.preset)).toBe('scene-m-y');
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.sizing).toMatchObject({ units: 'm', unitsMethod: 'manual', scale: 1000 });
  expect(stats.sizeMm[1]).toBeGreaterThan(25);
  expect(stats.choices.preset?.id).toBe('scene-m-y');
  await expect(unitsRow(page)).toHaveText('metres (preset)');
  await expect(upRow(page)).toHaveText('+y (preset)');
  await expect(page.locator('#source')).toHaveValue('scene-m-y');
  await shoot(page, testInfo, 'adjust-with-preset');

  // In Adjust: None converts again with no question, and the guess is back.
  await page.evaluate(() => window.__mt.setPreset(null));
  await ended(page);
  const log = await page.evaluate(() => window.__mt.state.progressLog.map((p) => p.step));
  expect(log).toContain('size');
  expect(await page.evaluate(() => window.__mt.state.question)).toBeNull();
  const again = await page.evaluate(() => window.__mt.state.stats!);
  expect(again.asked).toEqual([]);
  expect(again.sizing).toMatchObject({ units: 'm', unitsMethod: 'guessed' });
  expect(again.upMethod).toBe('base');
  expect(again.choices.preset).toBeUndefined();
  await expect(unitsRow(page)).toHaveText('metres (guessed)');
  await expect(page.locator('#source')).toHaveValue('');
});

test('a preset picked in Adjust converts with it and replaces the axis chosen by hand', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?dev&bake=off&ask=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', {
    name: 'scene.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(encodeBinaryStl(metresYUp())),
  });
  await ended(page);
  await page.evaluate(() => window.__mt.setUp('+x'));
  expect(await page.evaluate(() => window.__mt.state.stats!.up)).toBe('+x');

  await page.locator('#source').selectOption('scene-m-y');
  await page.waitForFunction(() => window.__mt.state.preset === 'scene-m-y');
  await ended(page);
  await page.waitForFunction(() => window.__mt.state.stats?.choices.preset?.id === 'scene-m-y');
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.up).toBe('+y');
  expect(stats.choices.orientation).toEqual({});
  await expect(upRow(page)).toHaveText('+y (preset)');

  // An axis chosen afterwards wins over the preset, which stays selected.
  await page.evaluate(() => window.__mt.setUp('+x'));
  await expect(upRow(page)).toHaveText('+x (manual)');
  await expect(page.locator('#source')).toHaveValue('scene-m-y');
});
