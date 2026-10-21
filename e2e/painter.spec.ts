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

test('the look is one value: the panel, Adjust and the viewer show the same', async ({ page }) => {
  await open(page, '/?ask=off&bake=256');
  await painting(page);
  // A chip in the panel's Look section is the page's look.
  await page.locator('#paint-panel [data-preset="bone"]').click();
  expect(await page.evaluate(() => window.__mt.state.lookPreset)).toBe('bone');
  await expect(page.locator('#look .summary-hint')).toHaveText('Bone');
  // The page's preset reaches the view and its panel, hidden or shown.
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  const preset = await page.evaluate(() => {
    const other = window.__mt.state.lookPreset === 'bone' ? 'steel' : 'bone';
    window.__mt.setLookPreset(other as never);
    return other;
  });
  const look = await page.evaluate(() => window.__mt.state.look);
  expect(await page.evaluate(() => window.__mt.painting.view().state.look)).toEqual(look);
  await page.locator('#paint-open').click();
  await expect(page.locator(`#paint-panel [data-preset="${preset}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

/** Pixels of a PNG whose red stands clear of its green: the paint's red under the look. */
async function redPixels(page: Page, png: Buffer | ArrayBuffer | null = null): Promise<number> {
  const bytes = png ? [...new Uint8Array(png)] : null;
  return page.evaluate(async (bytes) => {
    const buffer = bytes ? new Uint8Array(bytes).buffer : await window.__mt.thumbnail(256);
    const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! - data[i + 1]! > 60) red++;
    return red;
  }, bytes);
}

test('after Done the mini carries the paint: the thumbnail and the far level', async ({ page }) => {
  await open(page, '/?ask=off&bake=256');
  await painting(page);
  await page.evaluate(() => window.__mt.closePainter());
  // Nothing painted: Done leaves the mini as it was.
  expect(await page.evaluate(() => window.__mt.paint())).toBeNull();
  const bareThumbnail = await redPixels(page);
  await page.evaluate(() => {
    window.__mt.showLevel(3);
    window.__mt.setCamera(0, 10, 1);
  });
  await page.waitForTimeout(300);
  const bareFar = await redPixels(page, await page.locator('#viewport').screenshot());

  // Red all over (#125's test paint), then Done.
  await page.evaluate(() => window.__mt.painting.open('all'));
  await page.evaluate(() => window.__mt.closePainter());
  expect(await page.evaluate(async () => (await window.__mt.paint()) !== null)).toBe(true);
  expect(await redPixels(page)).toBeGreaterThan(bareThumbnail + 1000);
  await page.evaluate(() => {
    window.__mt.showLevel(3);
    window.__mt.setCamera(0, 10, 1);
  });
  await page.waitForTimeout(300);
  expect(await redPixels(page, await page.locator('#viewport').screenshot())).toBeGreaterThan(
    bareFar + 1000,
  );
});

/** A GLB's JSON chunk. */
function glbJson(bytes: number[]): Record<string, unknown> & {
  images?: unknown[];
  textures?: unknown[];
  materials: { pbrMetallicRoughness: { baseColorTexture?: unknown } }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  extras: { meshtavern?: { paint?: string } };
} {
  const buffer = Buffer.from(bytes);
  const length = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
}

test('the downloads carry the paint: the table level as a texture, the far level per vertex', async ({
  page,
}) => {
  await open(page, '/?ask=off&bake=256');
  await painting(page);
  const exported = (level: number): Promise<number[]> =>
    page.evaluate(
      async (level) => [...new Uint8Array(await window.__mt.exportGlb(level, false))],
      level,
    );
  await page.evaluate(() => window.__mt.closePainter());
  const bareTable = await exported(2);
  const bareFar = await exported(3);
  // Unpainted, the table level has no texture and both carry their colours.
  expect(glbJson(bareTable).images).toBeUndefined();
  expect(glbJson(bareTable).extras.meshtavern?.paint).toBeUndefined();

  await page.locator('#paint-open').click();
  await page.waitForFunction(() => window.__mt.state.page === 'painting');
  await strokeChest(page);
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.painted);

  const table = glbJson(await exported(2));
  expect(table.images).toHaveLength(1);
  expect(table.textures).toHaveLength(1);
  expect(table.materials[0]!.pbrMetallicRoughness.baseColorTexture).toEqual({
    index: 0,
    texCoord: 0,
  });
  expect(table.meshes[0]!.primitives[0]!.attributes).not.toHaveProperty('COLOR_0');
  expect(table.meshes[0]!.primitives[0]!.attributes).toHaveProperty('TEXCOORD_0');
  expect(table.extras.meshtavern?.paint).toBe('texture');
  const ms = await page.evaluate(() => window.__mt.state.paintExportMs);
  expect(ms).not.toBeNull();
  console.log(`painted texture and PNG: ${ms!.toFixed(0)} ms`);

  const far = await exported(3);
  expect(glbJson(far).extras.meshtavern?.paint).toBe('vertex');
  // The far level's mesh did not change; its colours did (and the extras say so).
  expect(glbJson(far).meshes).toEqual(glbJson(bareFar).meshes);
  expect(Buffer.from(far).equals(Buffer.from(bareFar))).toBe(false);
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
