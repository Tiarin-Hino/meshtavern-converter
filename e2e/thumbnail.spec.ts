import { expect, test, type Page } from '@playwright/test';
import { generateFigure } from '../src/regression/shapes';
import { encodeBinaryStl } from '../src/lib/dev';

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

/**
 * A paint under the look (#125): the generated figure's thumbnail without a paint, painted red on
 * its +x half, on its -x half and all over. Each half's paint changes the picture where that half
 * is and nowhere else: the two changes do not overlap but for the line where the halves meet, and
 * together they are the change of the paint all over.
 */
/** How far from a pixel both half-paints changed both halves must be seen, for it to lie on their line. */
const NEAR_THE_LINE_PX = 4;

test('draws a paint under the look where it is painted, and only there', async ({ page }) => {
  // A full baked conversion of the generated figure and four thumbnails: slow on CI runners.
  test.setTimeout(240_000);
  await page.goto('/?dev&ask=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', {
    name: 'figure.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(encodeBinaryStl(generateFigure(true))),
  });
  await page.waitForFunction(() => window.__mt.state.stats !== null && !window.__mt.state.busy);
  expect(await page.evaluate(() => window.__mt.state.baked)).not.toBeNull();

  const figures = await page.evaluate(async (near) => {
    const read = async (paint?: 'x+' | 'x-' | 'all'): Promise<Uint8ClampedArray> => {
      const png = await window.__mt.thumbnail(undefined, paint);
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const bare = await read();
    const right = await read('x+');
    const left = await read('x-');
    const all = await read('all');
    const size = Math.sqrt(bare.length / 4);
    // A pixel changed when any channel moved by more than a rounding step.
    const changed = (painted: Uint8ClampedArray, p: number): boolean =>
      [0, 1, 2, 3].some((c) => Math.abs(painted[p * 4 + c]! - bare[p * 4 + c]!) > 2);
    /** 1 changed by the +x paint only, 2 by the -x paint only, 3 by both. */
    const which = new Uint8Array(size * size);
    let opaque = 0;
    let allChanged = 0;
    let allNotHalves = 0;
    let halvesNotAll = 0;
    let redder = 0;
    for (let p = 0; p < size * size; p++) {
      if (bare[p * 4 + 3] === 255) opaque++;
      const r = changed(right, p);
      const l = changed(left, p);
      const a = changed(all, p);
      which[p] = (r ? 1 : 0) | (l ? 2 : 0);
      if (a) allChanged++;
      if (a && !r && !l) allNotHalves++;
      if ((r || l) && !a) halvesNotAll++;
      if (r && !l && right[p * 4]! - right[p * 4 + 1]! > bare[p * 4]! - bare[p * 4 + 1]!) redder++;
    }
    const count = (kind: number): number => which.filter((k) => k === kind).length;
    // A pixel both paints change must lie where the halves meet: both halves within reach.
    let bothAwayFromTheLine = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (which[y * size + x] !== 3) continue;
        let seen = 0;
        for (let dy = -near; dy <= near; dy++)
          for (let dx = -near; dx <= near; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
            if (which[sy * size + sx] === 1) seen |= 1;
            if (which[sy * size + sx] === 2) seen |= 2;
          }
        if (seen !== 3) bothAwayFromTheLine++;
      }
    return {
      opaque,
      rightOnly: count(1),
      leftOnly: count(2),
      both: count(3),
      bothAwayFromTheLine,
      allChanged,
      allNotHalves,
      halvesNotAll,
      redder,
    };
  }, NEAR_THE_LINE_PX);

  // Both halves are in the picture, and each paint shows.
  expect(figures.rightOnly).toBeGreaterThan(figures.opaque * 0.1);
  expect(figures.leftOnly).toBeGreaterThan(figures.opaque * 0.1);
  // The paint all over changes the whole mini, and nothing a half's paint did not.
  expect(figures.allChanged).toBeGreaterThan(figures.opaque * 0.95);
  expect(figures.halvesNotAll).toBe(0);
  // Each half changes only its own pixels: a pixel both change lies on the line where they meet,
  // where a texel is filtered from both (the hook's paint has no mipmaps, which would mix
  // neighbouring islands of the atlas into specks: see the journal entry of #125).
  expect(figures.both).toBeLessThan((figures.rightOnly + figures.leftOnly) * 0.02);
  expect(figures.bothAwayFromTheLine).toBeLessThan(figures.opaque * 0.001);
  expect(figures.allNotHalves).toBeLessThan(figures.allChanged * 0.001);
  // And it is the red paint that shows.
  expect(figures.redder).toBeGreaterThan(figures.rightOnly * 0.95);
});
