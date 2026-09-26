import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { COPY, STEP_LABELS } from '../src/page/page-state';
import { PROBLEM_MESSAGES } from '../src/lib/pipeline/problems';

/**
 * The product page (#41): the four states a person sees, as the page opens without options.
 * The screenshots attached here are what the PM judges the page by.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Written to a file too, so a local run leaves the pictures in test-results/.
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const pageState = (page: Page) => page.evaluate(() => window.__mt.state.page);

test('shows the empty, converting, done and error states', async ({ page }, testInfo) => {
  // The normal path bakes and compresses, which is slow on CI runners.
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  // Empty: the card with the heading, the button and the promise.
  expect(await pageState(page)).toBe('empty');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByRole('heading', { name: COPY.dropHeading })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.chooseFile })).toBeVisible();
  await expect(page.locator('#panel').getByText(COPY.promise)).toBeVisible();
  await shoot(page, testInfo, 'page-empty');

  // Converting: the file name, the step in words, the bar and Cancel.
  const conversion = page.evaluate(() => window.__mt.loadGenerated(300));
  await page.waitForFunction(
    () => window.__mt.state.page === 'converting' && window.__mt.state.progressLog.length > 1,
  );
  await expect(page.locator('body')).toHaveAttribute('data-state', 'converting');
  const step = (await page.locator('#status').textContent()) ?? '';
  expect(
    Object.values(STEP_LABELS).some((label) => step.startsWith(label)),
    step,
  ).toBe(true);
  await expect(page.locator('#heading')).toHaveText('generated-300.stl');
  await expect(page.locator('#progress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await shoot(page, testInfo, 'page-converting');
  await conversion;

  // Done: the mini, its size line, the downloads and the chips; no figures without ?dev.
  expect(await pageState(page)).toBe('done');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#heading')).toHaveText('generated-300');
  await expect(page.locator('#status')).toContainText('Ready. Converted from');
  await expect(page.locator('#mini-size')).toHaveText('50 mm tall · Medium, 1 square · no base');
  await expect(page.getByRole('button', { name: COPY.downloadTable })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.downloadFar })).toBeVisible();
  await expect(page.locator('#levels button')).toHaveCount(4);
  await expect(page.locator('#stats')).toHaveCount(0);
  await page.waitForTimeout(500);
  await shoot(page, testInfo, 'page-done');

  // Error: the heading, the message from problems.ts, and the way to the next file.
  await page.setInputFiles('#file', {
    name: 'empty.stl',
    mimeType: 'model/stl',
    buffer: Buffer.alloc(0),
  });
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('heading', { name: COPY.errorHeading })).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('empty.stl');
  await expect(page.locator('#status')).toHaveText(PROBLEM_MESSAGES.empty);
  await expect(page.locator('#status')).toHaveClass(/problem/);
  await expect(page.getByRole('button', { name: COPY.chooseAnother })).toBeVisible();
  await shoot(page, testInfo, 'page-error');
});

test('fits a phone screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  const noSideways = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  expect(await noSideways()).toBe(true);
  for (const button of [page.locator('#choose'), page.locator('#choose-again')]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await shoot(page, testInfo, 'phone-empty');

  await page.evaluate(() => window.__mt.loadDemo());
  expect(await noSideways()).toBe(true);
  // The viewport keeps at least half of the screen; the sheet's first screen has the size
  // line and both downloads; Adjust is closed.
  expect((await page.locator('#viewport').boundingBox())!.height).toBeGreaterThanOrEqual(844 / 2);
  await expect(page.locator('#mini-size')).toBeInViewport();
  await expect(page.getByRole('button', { name: COPY.downloadTable })).toBeInViewport();
  await expect(page.getByRole('button', { name: COPY.downloadFar })).toBeInViewport();
  await expect(page.locator('#adjust')).not.toHaveAttribute('open');
  for (const button of await page.locator('#panel button:visible').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.waitForTimeout(500);
  await shoot(page, testInfo, 'phone-done');

  // Opened, Adjust scrolls inside the sheet and nothing runs off the side.
  await page.locator('#adjust summary').click();
  await page.getByLabel('Edges').scrollIntoViewIfNeeded();
  expect(await noSideways()).toBe(true);
  await expect(page.getByLabel('Edges')).toBeInViewport();
  await shoot(page, testInfo, 'phone-adjust');
});

test('names the levels on the chips and opens Adjust for a size warning', async ({ page }) => {
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadDemo());

  // The chips read the level, the triangles are in the title; the table level is pressed.
  await expect(page.locator('#levels button')).toHaveText(['Original', 'Close', 'Table', 'Far']);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'title',
    '6 triangles',
  );

  // Someone closed Adjust; a conversion that ends with a warning opens it again.
  await page.locator('#adjust summary').click();
  await expect(page.locator('#adjust')).not.toHaveAttribute('open');
  await page.evaluate(() => window.__mt.setSizing({ size: 'tiny', scaleToBaseMm: 40 }));
  await expect(page.locator('#adjust')).toHaveAttribute('open');
  await expect(page.locator('#sizing-warning')).toBeVisible();
});

test("keeps the team's tools behind ?dev", async ({ page }) => {
  const tools = ['#stats', '#stress', '#bench', '#compact', '#perf', '#dev-badge'];
  const glb = { name: 'mini.glb', mimeType: 'model/gltf-binary', buffer: Buffer.alloc(64, 1) };

  // Without dev: none of the tools exist, the picker offers STL only, a GLB is refused.
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  for (const tool of tools) await expect(page.locator(tool), tool).toHaveCount(0);
  await expect(page.locator('#file')).toHaveAttribute('accept', '.stl');
  await page.setInputFiles('#file', glb);
  await expect(page.locator('#status')).toHaveText('mini.glb is not an STL file.');
  expect(await page.evaluate(() => window.__mt.state.imported)).toBeNull();

  // With dev: they are all there, and the benchmark's mode links keep dev.
  await page.goto('/?dev&bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  for (const tool of tools) await expect(page.locator(tool), tool).toHaveCount(1);
  await expect(page.locator('#file')).toHaveAttribute('accept', '.stl,.glb');
  await expect(page.locator('#bench a')).toHaveCount(3);
  for (const link of await page.locator('#bench a').all()) {
    expect(await link.getAttribute('href')).toMatch(/^\?dev/);
  }
});
