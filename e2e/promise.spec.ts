import { expect, test } from '@playwright/test';
import { COPY } from '../src/page/page-state';
import { generateBumpySheet } from '../src/lib/pipeline/generate';
import { encodeBinaryStl } from '../src/lib/pipeline/stl';

/**
 * "Your file never leaves your computer." is on the page, so it must be true (#41). This
 * records every request the page makes while a file is picked, converted on the normal path
 * (baked and compressed) and downloaded, and checks that none of them could carry the file.
 * It cannot prove what a future third-party script would do; it fails the moment one is added.
 */

/** A marker in the STL header: if it ever appears in a request, the file left the tab. */
const MARKER = 'MESHTAVERN-E2E-NEVER-UPLOADED';
/** Longer URLs could smuggle data in the address. _(proposal)_ */
const MAX_URL_LENGTH = 2048;
/** Where the page's own code, workers and WebAssembly are served from. */
const OWN_FILES = /^\/(assets|basis)\//;

interface Recorded {
  url: string;
  method: string;
  postData: string | null;
  type: string;
  afterPick: boolean;
}

test('no request carries the file: the promise on the page is true', async ({ page }) => {
  // Loading the unwrapper, baking and encoding are slow on CI runners.
  test.setTimeout(240_000);
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
  const stl = new Uint8Array(encodeBinaryStl(generateBumpySheet(20)));
  stl.fill(0x20, 0, 80);
  stl.set(new TextEncoder().encode(MARKER), 0);
  picked = true;
  await page.setInputFiles('#file', {
    name: 'promise-check.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(stl),
  });
  // The change event and the first read are asynchronous: wait for the end, not for "not busy".
  await page.waitForFunction(
    () => window.__mt.state.page === 'done' || window.__mt.state.page === 'error',
  );
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.page).toBe('done');
  // The normal path: baked, so the transcoder was fetched while the file was converted.
  expect(state.showingBaked).toBe(true);

  // A download is a blob: URL made in the tab, not a request.
  for (const name of [COPY.downloadTable, COPY.downloadFar]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    await download;
  }

  const origin = new URL(page.url()).origin;
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.some((r) => r.afterPick && r.url.includes('/basis/'))).toBe(true);
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
  await expect(page.getByText(COPY.promise).filter({ visible: true }).first()).toBeVisible();
});
