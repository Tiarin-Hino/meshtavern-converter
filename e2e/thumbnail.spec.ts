import { expect, test, type Page } from '@playwright/test';

/**
 * The thumbnail of the table level (#99, design note `docs/design/thumbnail-and-kind.md` §4):
 * square, transparent around the mini, the mini filling the frame less its margin. Drawn with
 * the viewer's renderer, on the per-vertex path (?bake=off) and the baked one (the default).
 */

interface Decoded {
  width: number;
  height: number;
  corners: number[];
  centreAlpha: number;
  /** The opaque pixels' box as a share of the frame, width and height. */
  span: [number, number];
}

/** Draws the hook's PNG into a canvas in the page and reads what a test needs from it. */
async function decodeThumbnail(page: Page, size?: number): Promise<Decoded> {
  return page.evaluate(async (size) => {
    const png = await window.__mt.thumbnail(size);
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const alpha = (x: number, y: number): number => data[(y * width + x) * 4 + 3]!;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (alpha(x, y) === 255) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    return {
      width,
      height,
      corners: [
        alpha(0, 0),
        alpha(width - 1, 0),
        alpha(0, height - 1),
        alpha(width - 1, height - 1),
      ],
      centreAlpha: alpha(Math.floor(width / 2), Math.floor(height * 0.6)),
      span: [(right - left + 1) / width, (bottom - top + 1) / height],
    };
  }, size);
}

async function expectThumbnail(page: Page): Promise<void> {
  const full = await decodeThumbnail(page);
  expect([full.width, full.height]).toEqual([512, 512]);
  expect(full.corners).toEqual([0, 0, 0, 0]);
  expect(full.centreAlpha).toBe(255);
  expect(Math.max(...full.span)).toBeGreaterThanOrEqual(0.85);

  const small = await decodeThumbnail(page, 128);
  expect([small.width, small.height]).toEqual([128, 128]);

  const refused = await page.evaluate(() =>
    window.__mt.thumbnail(1024).then(
      () => 'drawn',
      (error: Error) => error.name,
    ),
  );
  expect(refused).toBe('RangeError');
}

test('draws the per-vertex table level into a transparent 512 px thumbnail', async ({ page }) => {
  await page.goto('/?dev&bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadDemo());
  expect(await page.evaluate(() => window.__mt.state.baked)).toBeNull();
  expect(await page.evaluate(() => window.__mt.state.kind?.method)).toBe('guessed');
  await expectThumbnail(page);
});

test('draws the baked table level the same way', async ({ page }) => {
  await page.goto('/?dev');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadDemo());
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.stats?.bakeSkipped).toBeNull();
  expect(state.baked).not.toBeNull();
  await expectThumbnail(page);
  // Under ?dev the picture and the guess are shown next to the viewer.
  await expect(page.locator('#dev-kind')).toContainText('Kind: ');
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('#dev-thumbnail');
    return image !== null && image.complete && image.naturalWidth === 512;
  });
});

test('refuses a mini opened from a GLB, which has no result', async ({ page }) => {
  await page.goto('/?dev&bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadDemo());
  const outcome = await page.evaluate(async () => {
    await window.__mt.loadGlb(await window.__mt.exportGlb(2, false));
    return window.__mt.thumbnail().then(
      () => 'drawn',
      (error: Error) => error.message,
    );
  });
  expect(outcome).toBe('No converted mini to draw');
});
