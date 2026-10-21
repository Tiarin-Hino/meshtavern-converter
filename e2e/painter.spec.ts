import { expect, test, type Page } from '@playwright/test';
import { COPY } from '../src/page/page-state';
import { PAINT_COPY } from '../src/lib/painting';
import { open, painting } from './states';

/**
 * The painter on the page (#167, design note `docs/design/painter-on-the-page.md`): Paint in the
 * done panel enters the painting state with the painter's panel and the footer, Done goes back,
 * and Paint again goes on where it was, the view kept open and hidden in between.
 */

test.describe.configure({ timeout: 300_000 });

/** One stroke of the flat brush across the figure's chest, in red. */
async function strokeChest(page: Page, colour = '#c03020'): Promise<void> {
  await page.evaluate(async (hex) => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    view.setTool('flat');
    view.setColour(hex);
    view.setBrush({ sizeMm: 3, opacity: 1, hardness: 0.8 });
    const at = (x: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, 14, 6]))!.point;
    await view.stroke([at(-3), at(0), at(3)]);
  }, colour);
}

test('Paint enters the painter, Done goes back, Paint again goes on with its undo', async ({
  page,
}) => {
  await open(page, '/?ask=off&bake=256');
  await painting(page);
  await expect(page.locator('#paint-panel')).toBeVisible();
  for (const id of ['#paint-file-open', '#paint-file-save', '#paint-done'])
    await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#close')).toBeHidden();
  await expect(page.locator('#paint-view canvas')).toBeVisible();
  await strokeChest(page);
  expect(await page.evaluate(() => window.__mt.state.painting!.steps)).toBe(1);
  expect(await page.evaluate(() => window.__mt.state.painterMs)).not.toBeNull();

  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  await expect(page.locator('#paint-view')).toBeHidden();
  await expect(page.locator('#paint-open')).toBeFocused();
  // The view is open behind the done panel, its steps kept.
  expect(await page.evaluate(() => window.__mt.state.painting!.open)).toBe(true);

  await page.locator('#paint-open').click();
  await page.waitForFunction(() => window.__mt.state.page === 'painting');
  expect(await page.evaluate(() => window.__mt.state.painting!.steps)).toBe(1);
  await page.evaluate(() => window.__mt.painting.view().undo());
  expect(
    await page.evaluate(() => [
      window.__mt.state.painting!.steps,
      window.__mt.state.painting!.undone,
    ]),
  ).toEqual([0, 1]);
});

test('a hidden view draws no frame and still gives its paint (setShown)', async ({ page }) => {
  await open(page, '/?ask=off&bake=256');
  await painting(page);
  await strokeChest(page, '#ff0000');
  const point = await page.evaluate(() => {
    const view = window.__mt.painting.view();
    return view.screenOf(view.texelAt(...view.screenOf([0, 14, 6]))!.point);
  });
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  const hidden = await page.evaluate(async ([x, y]) => {
    const view = window.__mt.painting.view();
    // The canvas's pixel comes from the next frame: none is drawn, so there is none.
    const shown = await view.colourAt(x, y, 'shown');
    const { data } = await view.paint();
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 3] === 255) red++;
    return { shown, red, steps: view.history().length };
  }, point);
  expect(hidden.shown).toBeNull();
  expect(hidden.red).toBeGreaterThan(0);
  expect(hidden.steps).toBe(1);
});

test('a mini without a detail texture cannot be painted, and the hint says why', async ({
  page,
}) => {
  await open(page, '/?ask=off&bake=off');
  await page.evaluate(() => window.__mt.loadDemo());
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  await expect(page.locator('#paint-section')).toBeVisible();
  await expect(page.locator('#paint-section h2')).toHaveText(COPY.paint);
  await expect(page.locator('#paint-open')).toBeDisabled();
  await expect(page.locator('#paint-cannot')).toHaveText(PAINT_COPY.cannotPaint);
});
