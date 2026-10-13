#!/usr/bin/env node
// Renders the look-and-feel mockups (#142, docs/design/look-and-feel.md) into
// docs/design/look-and-feel/shots/ with headless Chromium, as the table application renders its
// style guide: the page's five states on a desktop (1440 × 900) and a phone (375 × 812, the
// spec's width) in both themes through the emulated system setting, the drag overlay on a desktop,
// and the two views in the application's dialog on a desktop.
// Usage: node scripts/look-and-feel-shots.mjs  (PLAYWRIGHT_CHROMIUM_EXECUTABLE picks the browser)

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve('docs/design/look-and-feel');
const out = resolve(root, 'shots');
const SIZES = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 375, height: 812 },
};
const SCHEMES = ['light', 'dark'];

/** Every shot: the mockup, the frame and the colour scheme. */
const SHOTS = [
  ...['page-empty', 'page-converting', 'page-question', 'page-done', 'page-error'].flatMap((page) =>
    ['desktop', 'phone'].flatMap((frame) =>
      SCHEMES.map((scheme) => ({ page, frame, scheme, name: `${page}-${frame}-${scheme}` })),
    ),
  ),
  ...SCHEMES.map((scheme) => ({
    page: 'page-empty',
    query: '?drag',
    frame: 'desktop',
    scheme,
    name: `page-drag-desktop-${scheme}`,
  })),
  ...['app-question', 'app-painting'].flatMap((page) =>
    SCHEMES.map((scheme) => ({
      page,
      frame: 'desktop',
      scheme,
      name: `${page}-desktop-${scheme}`,
    })),
  ),
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: SIZES[shot.frame],
      colorScheme: shot.scheme,
      reducedMotion: 'reduce',
      hasTouch: shot.frame === 'phone',
    });
    const page = await context.newPage();
    const url = pathToFileURL(resolve(root, `${shot.page}.html`)).href + (shot.query ?? '');
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const file = resolve(out, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`${shot.name}.png`);
    await context.close();
  }
} finally {
  await browser.close();
}
