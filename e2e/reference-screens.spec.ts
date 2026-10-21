import { expect, test, type Page } from '@playwright/test';
import { describeProgress } from '../src/page/page-state';
import {
  asking,
  cancel,
  converting,
  error,
  freezeFrames,
  holdStatus,
  open,
  painting,
  releaseStatus,
  thawFrames,
} from './states';

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
async function shot(page: Page, name: string, theme: Theme, mask: string[] = [], timeout?: number) {
  await page.emulateMedia({ colorScheme: theme });
  await expect.soft(page).toHaveScreenshot(`${name}-${theme}.png`, {
    mask: mask.map((selector) => page.locator(selector)),
    ...(timeout !== undefined && { timeout }),
  });
}

/** Compares the screen in both themes, the scenes held while the pictures are taken. */
async function both(page: Page, frame: string, state: string, timeout?: number) {
  await freezeFrames(page);
  for (const theme of THEMES) await shot(page, `${frame}-${state}`, theme, [], timeout);
  await thawFrames(page);
}

/**
 * How long a picture with the painter open may take (#167): in software rendering the painting
 * view's targets are on the GPU process's queue when the picture is asked for, and a page picture
 * then takes seconds, past the 5 s a comparison allows by default. The page pictures of the
 * painting state and the panel's own tall pictures share it: on CI the three painter pictures
 * timed out at 5 s with the page responsive, as the panel's had before they got this budget.
 */
const PAINTER_PICTURE_TIMEOUT_MS = 30_000;

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
      // themes; the step and the bar move on while the picture is taken, so they are masked. The
      // mask is as wide as the step's words, so the line is held at the step the pictures were
      // taken at (holdStatus) while the conversion goes on. A conversion that ended under the
      // picture fails the run instead of recording the done state.
      for (const theme of THEMES) {
        await converting(page, 600);
        await holdStatus(page, describeProgress({ step: 'simplify', percent: 0 }));
        await freezeFrames(page);
        await shot(page, `${frame.name}-converting`, theme, ['#status', '#progress']);
        expect(await page.evaluate(() => window.__mt.state.page)).toBe('converting');
        await thawFrames(page);
        await releaseStatus(page);
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

/**
 * The painting state (#167, design note docs/design/painter-on-the-page.md §11): the page with the
 * painter on the generated figure at the frame's size, the panel's first screen (on a phone the
 * sheet as it opens), the canvases hidden and their frames held, in both themes.
 */
for (const frame of FRAMES) {
  test.describe(frame.name, () => {
    test.use({ viewport: frame.viewport, hasTouch: frame.phone, reducedMotion: 'reduce' });
    test.describe.configure({ timeout: 240_000 });

    test('the painting state in both themes', async ({ page }) => {
      await open(page, '/?ask=off&bake=256');
      await page.addStyleTag({ path: 'e2e/reference-screens.css' });
      await painting(page);
      await page.mouse.move(0, 0);
      await both(page, frame.name, 'painter', PAINTER_PICTURE_TIMEOUT_MS);
    });
  });
}

/**
 * The painter's panel (#166, design note docs/design/painting-panel.md §12): the ?dev Paint tool on
 * the generated figure with the panel mounted, compared as the panel alone (`#paint-panel`)
 * in both themes. A test of its own beside the five states, so their time budget holds. The page
 * converts and opens the painting at the frame's size; then the scenes' frames are held and the
 * window is made tall enough that the whole panel is on screen at once (the panel sits in the
 * page's scrolling panel, on a phone in its sheet, and a picture is cut where that frame ends).
 * Held, the scenes never draw at the tall size, which in software rendering slowed the whole run
 * past CI's limit and kept the next test's browser waiting; the frames are not handed back. The
 * airbrush is the tool, so its direction is on the picture.
 */
for (const frame of FRAMES) {
  test.describe(frame.name, () => {
    test.use({
      viewport: frame.viewport,
      hasTouch: frame.phone,
      reducedMotion: 'reduce',
    });
    test.describe.configure({ timeout: 240_000 });

    test('the painter’s panel in both themes', async ({ page }) => {
      await open(page, '/?dev&ask=off&bake=256');
      await page.addStyleTag({ path: 'e2e/reference-screens.css' });
      await painting(page);
      if (frame.phone) await page.locator('#sheet-handle').click();
      await page.evaluate(() => window.__mt.painting.view().setTool('airbrush'));
      // No hover on the picture: the pointer is left where the last click was, over a group's row
      // once the panel scrolls, and moving it away did not clear the row's hover on CI.
      await page.mouse.move(0, 0);
      await page.addStyleTag({
        content: '#paint-panel { pointer-events: none; }',
      });
      await freezeFrames(page);
      await page.setViewportSize({
        width: frame.viewport.width,
        height: frame.phone ? 3400 : 2600,
      });
      await page.evaluate(() => {
        // The panel's own scrolling body only: scrollIntoView would move the window too, and the
        // picture is clipped against the window.
        const controls = document.querySelector<HTMLElement>('#paint-panel')!;
        const body = document.querySelector<HTMLElement>('#panel-body')!;
        body.scrollTop += controls.getBoundingClientRect().top - body.getBoundingClientRect().top;
        window.scrollTo(0, 0);
      });
      // The page clipped to the panel's box, once the box stays where it is (the sheet may still
      // be moving up on a phone), not a picture of the element: that one waits for animation
      // frames, which are held.
      const panel = page.locator('#paint-panel');
      let clip = (await panel.boundingBox())!;
      await expect
        .poll(async () => {
          const before = JSON.stringify(clip);
          await page.waitForTimeout(250);
          clip = (await panel.boundingBox())!;
          return JSON.stringify(clip) === before;
        })
        .toBe(true);
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await expect.soft(page).toHaveScreenshot(`${frame.name}-painting-${theme}.png`, {
          clip,
          // A frame 3400 px tall takes seconds a picture in software rendering.
          timeout: PAINTER_PICTURE_TIMEOUT_MS,
        });
      }
    });
  });
}
