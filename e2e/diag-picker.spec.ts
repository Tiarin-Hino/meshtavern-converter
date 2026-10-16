import { expect, test, type FileChooser, type Locator, type Page } from '@playwright/test';
import { COPY } from '../src/page/page-state';
import { open } from './states';

// Temporary diagnosis for #170: the old and the new way of catching the picker, many times each,
// under the load of four workers drawing in software. Not to be merged.

test.setTimeout(15_000);

async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab did not reach ${target}`);
}

test('before: waitForEvent just before Enter', async ({ page }) => {
  await open(page);
  await tabTo(page, page.locator('#top').getByRole('button', { name: COPY.openStl }));
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  expect((await chooser).isMultiple()).toBe(true);
});

test('after: a listener before the page opens', async ({ page }) => {
  const pickers: FileChooser[] = [];
  page.on('filechooser', (picker) => pickers.push(picker));
  await open(page);
  await tabTo(page, page.locator('#top').getByRole('button', { name: COPY.openStl }));
  await page.keyboard.press('Enter');
  await expect.poll(() => pickers.length, { timeout: 10_000 }).toBe(1);
  expect(pickers[0]!.isMultiple()).toBe(true);
  await tabTo(page, page.getByRole('button', { name: COPY.chooseFile }));
  await page.keyboard.press('Space');
  await expect.poll(() => pickers.length, { timeout: 10_000 }).toBe(2);
});
