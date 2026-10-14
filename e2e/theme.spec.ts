import { expect, test, type Page } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';

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

/** The most common colour in a patch of the screen, as [r, g, b]: a grid line crossing it does not count. */
async function screenColour(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number[]> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [mode] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return mode![0].split(',').map(Number);
  }, png.toString('base64'));
}

/** A patch near the stage's bottom-left corner, clear of the drop card and the level chips. */
async function stagePatch(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + 8, y: box.y + box.height * 0.5, width: 32, height: 32 };
}

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

test('the viewer and the question scene draw the --scene-backdrop, the same dark in both themes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?bake=off');
    await page.waitForFunction(() => window.__mt?.state.ready === true);
    const role = (await theme(page)).backdrop;
    expect(role).toMatch(/^#[0-9a-f]{6}$/);
    const expected = [1, 3, 5].map((i) => parseInt(role.slice(i, i + 2), 16));
    const near = (colour: number[]) =>
      colour.forEach((channel, k) =>
        expect(Math.abs(channel - expected[k]!)).toBeLessThanOrEqual(2),
      );

    near(await screenColour(page, await stagePatch(page, '#viewport')));

    await page.setInputFiles('#file', {
      name: 'hero.stl',
      mimeType: 'model/stl',
      buffer: Buffer.from(encodeBinaryStl(generateFigure(true))),
    });
    await page.waitForFunction(
      () => window.__mt.state.page === 'asking' && window.__mt.state.questionMs !== null,
    );
    near(await screenColour(page, await stagePatch(page, '#question-view')));
  }
});
