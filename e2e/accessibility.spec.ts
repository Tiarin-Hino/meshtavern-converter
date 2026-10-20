import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { COPY } from '../src/page/page-state';
import {
  asking,
  cancel,
  converting,
  done,
  dragLeave,
  dragOver,
  error,
  open,
  pairsStop,
  painting,
  question,
} from './states';

/**
 * The accessibility scan (#146, spec docs/specs/look-and-feel.md L4, design note
 * docs/design/look-and-feel.md §11): axe-core over every state of the page, the question view's
 * stops and the painting panel, in both themes, as the table application's accessibility spec. A
 * serious or critical violation fails; the others are counted and attached to the report.
 */

/** WCAG 2.2 A and AA, the application's bar. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FAILING = new Set(['serious', 'critical']);
const THEMES = ['light', 'dark'] as const;

/** Scans what is on screen; fails on a serious or critical violation and names each one. */
async function scan(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const lines = results.violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(', ')}`,
  );
  await testInfo.attach(`${name}.txt`, {
    body: lines.length ? lines.join('\n') : 'no violations',
    contentType: 'text/plain',
  });
  const failing = results.violations.filter((v) => FAILING.has(v.impact ?? ''));
  expect(
    failing.map((v) => lines[results.violations.indexOf(v)]),
    `${name}: serious or critical violations`,
  ).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`the ${theme} theme`, () => {
    // The theme's motion off, so a dialog or a menu is scanned at its end, not half faded in.
    test.use({ colorScheme: theme, reducedMotion: 'reduce' });

    test('the page in every state, the drag overlay, the credits and the question', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await open(page);
      await scan(page, testInfo, `${theme}-empty`);

      await dragOver(page);
      await scan(page, testInfo, `${theme}-drag`);
      await dragLeave(page);

      await page.locator('#top').getByRole('button', { name: COPY.credits }).click();
      await expect(page.getByRole('dialog', { name: COPY.credits })).toBeVisible();
      await scan(page, testInfo, `${theme}-credits`);
      await page.keyboard.press('Escape');

      await converting(page);
      await scan(page, testInfo, `${theme}-converting`);
      await cancel(page);

      await error(page);
      await scan(page, testInfo, `${theme}-error`);

      await asking(page);
      await scan(page, testInfo, `${theme}-up-question`);
      await page.evaluate(() => window.__mt.confirmUp());
      await page.waitForFunction(() => window.__mt.state.page === 'done', undefined, {
        timeout: 180_000,
      });
      // Every section of Adjust open, so their controls are scanned too.
      for (const id of ['#orient', '#sizing', '#look', '#pair'])
        await page.locator(id).evaluate((d) => ((d as HTMLDetailsElement).open = true));
      await scan(page, testInfo, `${theme}-done`);
    });

    test('where a figure meets its base: the pairs stop and the final view', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await open(page, '/?bake=off');
      const serial = await pairsStop(page);
      await scan(page, testInfo, `${theme}-pairs`);
      await page.locator('#meet-confirm').click();
      await question(page, serial);
      await scan(page, testInfo, `${theme}-fitted`);
    });

    test('a phone: the bottom sheet and the More menu', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, '/?bake=off');
      await page.getByRole('button', { name: COPY.more }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await scan(page, testInfo, `${theme}-phone-menu`);
      await page.keyboard.press('Escape');
      await done(page);
      await page.getByRole('button', { name: COPY.expandPanel }).click();
      await scan(page, testInfo, `${theme}-phone-done`);
    });

    test('the painting panel (the ?dev Paint tool)', async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await open(page, '/?dev&ask=off&bake=256');
      await painting(page);
      // The painter's panel (#166) with everything it can show: a stroke's colour as a swatch,
      // the airbrush's direction, a group hidden and one pulled apart, the groups' tint.
      await page.evaluate(async () => {
        const view = window.__mt.painting.view();
        view.setCamera(0, 5, 1.6);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const hit = view.texelAt(...view.screenOf([0, 14, 6]));
        if (hit) await view.stroke([hit.point]);
        view.setTool('airbrush');
        view.setGroupShown(1, false);
        view.pullApart(2);
        view.setGroupTint(true);
      });
      await expect(page.locator('#paint-controls [data-swatch]')).not.toHaveCount(0);
      await expect(page.locator('#paint-controls')).toBeVisible();
      await scan(page, testInfo, `${theme}-painting`);
    });
  });
}
