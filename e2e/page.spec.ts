import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { COPY, STEP_LABELS } from '../src/page-state';
import { PROBLEM_MESSAGES } from '../src/pipeline/problems';

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
