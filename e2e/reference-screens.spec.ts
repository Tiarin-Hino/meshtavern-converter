import { expect, test, type Page } from '@playwright/test';
import { asking, cancel, converting, error, freezeFrames, open, thawFrames } from './states';

/**
 * The reference screenshots (#146, spec docs/specs/look-and-feel.md L4, design note
 * docs/design/look-and-feel.md §11): the page's five states on a desktop and on two phones, in
 * both themes, with the 3D canvas hidden (`reference-screens.css`), compared with the pictures in
 * `reference-screens.spec.ts-snapshots/`. One set per platform: Playwright names each file after
 * it, and a platform's first run writes its set. A deliberate change of the look rewrites them
 * with `--update-snapshots`; docs/guides/reference-screenshots.md says how.
 */

const FRAMES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, phone: false },
  // The two phones the page's tests hold the sheet to (page.spec.ts).
  { name: 'phone-375', viewport: { width: 375, height: 812 }, phone: true },
  { name: 'phone-390', viewport: { width: 390, height: 844 }, phone: true },
];
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/**
 * Compares the screen in `theme` with its picture. The comparison is soft: the run goes on past a
 * picture that differs, so one run reports, and writes the actual picture of, every one that does.
 */
async function shot(page: Page, name: string, theme: Theme, mask: string[] = []) {
  await page.emulateMedia({ colorScheme: theme });
  await expect.soft(page).toHaveScreenshot(`${name}-${theme}.png`, {
    mask: mask.map((selector) => page.locator(selector)),
  });
}

/** Compares the screen in both themes, the scenes held while the pictures are taken. */
async function both(page: Page, frame: string, state: string) {
  await freezeFrames(page);
  for (const theme of THEMES) await shot(page, `${frame}-${state}`, theme);
  await thawFrames(page);
}

for (const frame of FRAMES) {
  test.describe(frame.name, () => {
    test.use({ viewport: frame.viewport, hasTouch: frame.phone, reducedMotion: 'reduce' });

    test('the five states in both themes', async ({ page }) => {
      test.setTimeout(240_000);
      // No detail texture: the canvas is not on these pictures.
      await open(page, '/?bake=off');
      // The canvases hidden for the whole run, and their scenes held while a picture is taken
      // (freezeFrames): a frame drawn in software on a busy runner kept a picture waiting a minute.
      await page.addStyleTag({ path: 'e2e/reference-screens.css' });
      await both(page, frame.name, 'empty');

      // Converting: one conversion per picture, so the conversion cannot end between the two
      // themes; the step and the bar move on while the picture is taken, so they are masked. A
      // conversion that ended under the picture fails the run instead of recording the done state.
      for (const theme of THEMES) {
        await converting(page, 600);
        await freezeFrames(page);
        await shot(page, `${frame.name}-converting`, theme, ['#status', '#progress']);
        expect(await page.evaluate(() => window.__mt.state.page)).toBe('converting');
        await thawFrames(page);
        await cancel(page);
      }

      await error(page);
      await both(page, frame.name, 'error');

      await asking(page);
      await both(page, frame.name, 'asking');

      await page.evaluate(() => window.__mt.confirmUp());
      await page.waitForFunction(
        () => window.__mt.state.page === 'done' && !window.__mt.state.busy,
      );
      await both(page, frame.name, 'done');
    });
  });
}
