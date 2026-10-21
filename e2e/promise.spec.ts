import { expect, test, type Page } from '@playwright/test';
import { COPY, describeUnsavedPainting } from '../src/page/page-state';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';
import { paintEveryKind } from './painting-steps';
import { file, painting } from './states';

/**
 * "Your file never leaves your computer." is on the page, so it must be true (#41). This
 * records every request the page makes while a file is picked, converted on the normal path
 * (baked and compressed), painted with every kind of step, saved as a paint file and downloaded
 * (#167), and checks that none of them could carry the file. It cannot prove what a future
 * third-party script would do; it fails the moment one is added. Beside it, what the page keeps
 * on this device (#167): it works without storage, and an unsaved painting comes back.
 */

/** A marker in the STL header: if it ever appears in a request, the file left the tab. */
const MARKER = 'MESHTAVERN-E2E-NEVER-UPLOADED';
/** Longer URLs could smuggle data in the address. _(proposal)_ */
const MAX_URL_LENGTH = 2048;
/**
 * Where the page's own code, workers and WebAssembly are served from, and its theme: the table
 * application's stylesheets and fonts under /theme/ (#143). A font is fetched when the first
 * glyph of its face is drawn, which can be after the file is picked; so can the favicon (#145).
 */
const OWN_FILES = /^\/((assets|basis|theme)\/|favicon\.svg$)/;

interface Recorded {
  url: string;
  method: string;
  postData: string | null;
  type: string;
  afterPick: boolean;
}

test('no request carries the file: the promise on the page is true', async ({ page }) => {
  // Loading the unwrapper, baking and encoding are slow on CI runners; so is painting (#167).
  test.setTimeout(300_000);
  const requests: Recorded[] = [];
  let sockets = 0;
  let picked = false;
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
      type: request.resourceType(),
      afterPick: picked,
    }),
  );
  page.on('websocket', () => sockets++);

  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  // A binary STL whose 80-byte header carries the marker (not starting with "solid").
  // The generated figure on its base: what the painting below knows its way around (#167).
  const stl = new Uint8Array(encodeBinaryStl(generateFigure(true)));
  stl.fill(0x20, 0, 80);
  stl.set(new TextEncoder().encode(MARKER), 0);
  picked = true;
  await page.setInputFiles('#file', {
    name: 'promise-check.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(stl),
  });
  // The change event and the first read are asynchronous: wait for the question after the
  // orient step (#92) and confirm it, so the promise is proven with the question in the path.
  await page.waitForFunction(
    () => window.__mt.state.page === 'asking' || window.__mt.state.page === 'error',
  );
  await page.evaluate(() => window.__mt.confirmUp());
  await page.waitForFunction(
    () => window.__mt.state.page === 'done' || window.__mt.state.page === 'error',
  );
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.page).toBe('done');
  // The normal path: baked, so the transcoder was fetched while the file was converted.
  expect(state.showingBaked).toBe(true);

  // Paint (#167): every kind of step and a fill, the paint file saved, Done. A download is a
  // blob: URL made in the tab, not a request.
  await page.locator('#paint-open').click();
  await page.waitForFunction(() => window.__mt.state.painting?.open === true, undefined, {
    timeout: 120_000,
  });
  await paintEveryKind(page);
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: COPY.savePaintFile }).click();
  expect((await saved).suggestedFilename()).toBe('promise-check.mtpaint');
  await page.getByRole('button', { name: COPY.done }).click();
  await page.waitForFunction(() => window.__mt.state.painted);
  for (const name of [COPY.downloadTable, COPY.downloadFar]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    await download;
  }

  const origin = new URL(page.url()).origin;
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.some((r) => r.afterPick && r.url.includes('/basis/'))).toBe(true);
  // Our own builds of xatlas and the Basis encoder, same-origin and fetched only once a file
  // needs unwrapping and compressing: two distinct modules under /assets/.
  const ownModules = new Set(
    requests
      .filter((r) => r.afterPick)
      .map((r) => new URL(r.url).pathname)
      .filter((path) => /^\/assets\/[^/]+\.wasm$/.test(path)),
  );
  expect([...ownModules].sort()).toEqual([
    expect.stringMatching(/^\/assets\/basis_encoder-[^/]+\.wasm$/),
    expect.stringMatching(/^\/assets\/xatlas-[^/]+\.wasm$/),
  ]);
  for (const request of requests) {
    const url = new URL(request.url);
    expect(url.origin, request.url).toBe(origin);
    expect(request.method, request.url).toBe('GET');
    expect(request.postData, request.url).toBeNull();
    expect(request.url.length, request.url).toBeLessThan(MAX_URL_LENGTH);
    expect(request.url, request.url).not.toContain(MARKER);
    // A blob: URL is an object the tab made in memory, not the network: three.js starts its
    // KTX2 transcoder worker from one, built from /basis/basis_transcoder.js.
    if (request.afterPick && url.protocol !== 'blob:') {
      expect(url.pathname, request.url).toMatch(OWN_FILES);
    }
  }
  expect(sockets).toBe(0);
  // The theme and both of its fonts came from this origin, not a font service (#143).
  const paths = new Set(requests.map((r) => new URL(r.url).pathname));
  for (const path of [
    '/theme/theme.js',
    '/theme/tokens.css',
    '/theme/components.css',
    '/theme/fonts/inter-latin-variable.woff2',
    '/theme/fonts/fraunces-latin-variable.woff2',
  ]) {
    expect(paths, path).toContain(path);
  }
  await expect(page.getByText(COPY.promise).filter({ visible: true }).first()).toBeVisible();
});

/** Converts the generated figure without the question and paints one stroke in red. */
async function strokeOnFigure(page: Page): Promise<[number, number, number]> {
  await painting(page);
  return page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const at = (x: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, 14, 6]))!.point;
    view.setTool('flat');
    view.setBrush({ sizeMm: 3, opacity: 1, hardness: 0.8 });
    view.setColour('#c03020');
    await view.stroke([at(-3), at(0), at(3)]);
    return at(0);
  });
}

test('the page works without storage: blocked, the painting goes on and nothing is said', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // IndexedDB and localStorage both throw, as in a browser that refuses site data.
  await page.addInitScript(() => {
    const refuse = (): never => {
      throw new DOMException('The storage is blocked', 'SecurityError');
    };
    IDBFactory.prototype.open = refuse;
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
    Storage.prototype.removeItem = refuse;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?ask=off&bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await strokeOnFigure(page);
  // A step, then a second for the record's write to be tried and refused.
  await page.waitForTimeout(1500);
  await expect(page.locator('#status')).toHaveText(COPY.paintingKept);
  expect(await page.evaluate(() => window.__mt.storage.palette())).toEqual([]);
  expect(await page.evaluate(() => window.__mt.storage.unsaved())).toBeNull();
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.painted);
  expect(await page.evaluate(() => window.__mt.state.error)).toBeNull();
  expect(errors).toEqual([]);
});

test('an unsaved painting comes back on the next drop of the same file, and so do its colours', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/?ask=off&bake=256');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  const point = await strokeOnFigure(page);
  // Written a second after the step (UNSAVED_WRITE_DELAY_MS).
  await expect
    .poll(() => page.evaluate(async () => (await window.__mt.storage.unsaved()) !== null))
    .toBe(true);
  expect(await page.evaluate(() => window.__mt.storage.palette())).toEqual(['#c03020']);

  await page.reload();
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await page.waitForFunction(() => window.__mt.state.confirm !== null);
  const offer = await page.evaluate(() => window.__mt.state.unsavedOffer!);
  expect(offer.names).toEqual(['hero.stl']);
  // The day is in the browser's locale, which need not be Node's.
  const locale = await page.evaluate(() => navigator.language);
  await expect(page.locator('#confirm-text')).toHaveText(describeUnsavedPainting(offer, locale));
  await page.getByRole('button', { name: COPY.continuePainting }).click();
  await page.waitForFunction(
    () => window.__mt.state.page === 'painting' && window.__mt.state.painting?.steps === 1,
    undefined,
    { timeout: 120_000 },
  );
  const [r, g, b, a] = await page.evaluate((point) => window.__mt.painting.sample([point]), point);
  expect([r, g, b, a]).toEqual([0xc0, 0x30, 0x20, 255]);

  // Convert afresh forgets it.
  await page.locator('#paint-done').click();
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await page.waitForFunction(() => window.__mt.state.confirm !== null);
  await page.getByRole('button', { name: COPY.convertAfresh }).click();
  await page.waitForFunction(() => window.__mt.state.page === 'done', undefined, {
    timeout: 120_000,
  });
  expect(await page.evaluate(() => window.__mt.storage.unsaved())).toBeNull();
  // The colour painted with before the reload is a swatch of the panel on a bare mini.
  await page.locator('#paint-open').click();
  await page.waitForFunction(() => window.__mt.state.painting?.open === true);
  expect(await page.evaluate(() => window.__mt.state.painting!.steps)).toBe(0);
  await expect(page.locator('#paint-panel [data-swatch="#c03020"]')).toHaveCount(1);
});
