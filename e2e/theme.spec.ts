import { expect, test, type Page } from '@playwright/test';

/**
 * The theme (#143, design note docs/design/look-and-feel.md §2.2): the page follows the system's
 * setting and has the table application's switch, Light, Dark or System; the choice lives in this
 * browser's localStorage as `mt-theme` and is never sent. The scene stays dark in both themes.
 */

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
}

/** The page root's theme attribute (null: the system's), the stored choice and a role's value. */
const theme = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      attribute: root.getAttribute('data-theme'),
      stored: localStorage.getItem('mt-theme'),
      surface: style.backgroundColor,
      backdrop: style.getPropertyValue('--scene-backdrop').trim(),
    };
  });

const pressed = (page: Page) =>
  page.locator('[data-theme-switch] [aria-pressed="true"]').getAttribute('aria-label');

test('the switch sets the theme on the page and in localStorage, and asks nothing of the network', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  const group = page.getByRole('group', { name: 'Theme' });
  await expect(group).toBeVisible();
  expect(await pressed(page)).toBe('System');
  const system = await theme(page);
  expect(system).toMatchObject({ attribute: null, stored: null });

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await group.getByRole('button', { name: 'Dark' }).click();
  const dark = await theme(page);
  expect(dark).toMatchObject({ attribute: 'dark', stored: 'dark' });
  expect(await pressed(page)).toBe('Dark');
  // The chrome changed colour; the scene's backdrop is the same dark in both themes.
  expect(dark.surface).not.toBe(system.surface);
  expect(dark.backdrop).toBe(system.backdrop);

  await group.getByRole('button', { name: 'Light' }).click();
  expect(await theme(page)).toMatchObject({ attribute: 'light', stored: 'light' });
  expect((await theme(page)).surface).toBe(system.surface);

  await group.getByRole('button', { name: 'System' }).click();
  expect(await theme(page)).toMatchObject({ attribute: null, stored: null });
  expect(await pressed(page)).toBe('System');

  expect(requests).toEqual([]);
});

test('a stored choice is the theme the page opens in', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
  await page.reload();
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  expect(await theme(page)).toMatchObject({ attribute: 'dark', stored: 'dark' });
  expect(await pressed(page)).toBe('Dark');
});

test('without a choice the page follows the system’s setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  const dark = await theme(page);
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await theme(page);
  expect(dark.attribute).toBeNull();
  expect(dark.surface).not.toBe(light.surface);
});
