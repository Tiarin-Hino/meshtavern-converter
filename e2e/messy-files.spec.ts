import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { generateBumpySheet } from '../src/pipeline/generate';
import { PROBLEM_MESSAGES } from '../src/pipeline/problems';
import { encodeAsciiStl, encodeBinaryStl } from '../src/pipeline/stl';

/**
 * Files that are not clean (#43), picked the way a user picks them. Every case ends in a
 * mini or in a message for the user; the page never throws and keeps working.
 */

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function pick(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.evaluate(() => Object.assign(window.__mt.state, { stats: null, error: null }));
  await page.setInputFiles('#file', { name, mimeType: 'model/stl', buffer });
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
  );
}

test('refuses broken files with a message for the user, and the next file still converts', async ({
  page,
}, testInfo) => {
  const sheet = Buffer.from(encodeBinaryStl(generateBumpySheet(20)));
  const png = Buffer.alloc(5000, 0x5a);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const cases = [
    { name: 'empty.stl', buffer: Buffer.alloc(0), code: 'empty' },
    { name: 'cut-off.stl', buffer: sheet.subarray(0, sheet.length / 2), code: 'truncated' },
    { name: 'picture.stl', buffer: png, code: 'not-stl' },
    {
      name: 'broken.stl',
      buffer: Buffer.from(encodeBinaryStl(new Float32Array(90).fill(NaN))),
      code: 'no-surface',
    },
  ] as const;

  for (const { name, buffer, code } of cases) {
    await pick(page, name, buffer);
    const state = await page.evaluate(() => window.__mt.state);
    expect(state, name).toMatchObject({ errorCode: code, stats: null, busy: false });
    await expect(page.locator('#status')).toContainText(PROBLEM_MESSAGES[code]);
    await expect(page.locator('#status')).toHaveClass(/problem/);
    // Attached to the CI run, so a human can judge how the message reads on the page.
    await testInfo.attach(`refused-${code}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }

  await pick(page, 'sheet.stl', sheet);
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.error).toBeNull();
  expect(state.stats?.triangles).toBe(800);
  await expect(page.locator('#status')).not.toHaveClass(/problem/);
});

test('converts an ASCII STL of realistic size without freezing the page', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  // 500k triangles, about 100 MB of text: an ordinary mini exported as ASCII.
  const path = testInfo.outputPath('ascii-sheet.stl');
  writeFileSync(path, encodeAsciiStl(generateBumpySheet(500)));
  await page.setInputFiles('#file', path);
  await page.waitForFunction(
    () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
    null,
    { timeout: 150_000 },
  );
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.error).toBeNull();
  expect(state.stats).toMatchObject({ format: 'ascii', triangles: 500_000 });
  expect(state.framesWhileConverting).toBeGreaterThan(2);
});

test.describe('on a device with little memory', () => {
  test.beforeEach(async ({ page }) => {
    // What Chrome reports on a device with 256 MB: too little for any conversion.
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 }),
    );
    await page.goto('/?bake=off');
    await page.waitForFunction(() => window.__mt?.state.ready === true);
  });

  test('refuses a file too large for the device before converting it', async ({ page }) => {
    await pick(page, 'sheet.stl', Buffer.from(encodeBinaryStl(generateBumpySheet(20))));
    const picked = await page.evaluate(() => window.__mt.state);
    expect(picked).toMatchObject({ errorCode: 'too-large', progressLog: [] });
    await expect(page.locator('#status')).toContainText(PROBLEM_MESSAGES['too-large']);

    // A mesh that never was a file is checked by the worker, with the same result.
    await page.evaluate(() => window.__mt.loadGenerated(20));
    const generated = await page.evaluate(() => window.__mt.state);
    expect(generated).toMatchObject({ errorCode: 'too-large', stats: null, busy: false });
    expect(generated.progressLog).toEqual([]);
  });
});
