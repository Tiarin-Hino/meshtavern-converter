import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { COPY, MESHTAVERN_URL, STEP_LABELS } from '../src/page/page-state';
import { PROBLEM_MESSAGES } from '../src/lib';

/**
 * The product page (#41): the four states a person sees, as the page opens without options, on
 * MeshTavern's components (#144, design note docs/design/look-and-feel.md §4): the app bar, the
 * centred card, the panel frame, the disclosures, the chips, the bottom sheet on a phone. The
 * screenshots attached here are what the PM judges the page by.
 */

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Written to a file too, so a local run leaves the pictures in test-results/.
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const pageState = (page: Page) => page.evaluate(() => window.__mt.state.page);
const open = (page: Page, path = '/') =>
  page.goto(path).then(() => page.waitForFunction(() => window.__mt?.state.ready === true));

test('shows the empty, converting, done and error states on the components', async ({
  page,
}, testInfo) => {
  // The normal path bakes and compresses, which is slow on CI runners.
  test.setTimeout(240_000);
  await open(page);

  // The bar: the name, the promise, the file button, the theme switch, the link and Credits.
  const bar = page.locator('#top');
  await expect(bar.locator('#wordmark')).toHaveText(COPY.title);
  await expect(bar.getByText(COPY.promiseShort)).toBeVisible();
  await expect(bar.getByRole('button', { name: COPY.openStl })).toHaveClass(/btn-primary/);
  await expect(bar.getByRole('group', { name: 'Theme' })).toBeVisible();
  await expect(bar.getByRole('link', { name: COPY.meshTavern })).toHaveAttribute(
    'href',
    MESHTAVERN_URL,
  );
  await expect(bar.getByRole('button', { name: COPY.credits })).toBeVisible();
  await expect(bar.getByRole('button', { name: COPY.more })).toBeHidden();

  // Empty: the centred card with the heading, the button and the promise.
  expect(await pageState(page)).toBe('empty');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#panel')).toHaveClass(/\bcard\b/);
  await expect(page.getByRole('heading', { name: COPY.dropHeading })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.chooseFile })).toHaveClass(/btn-primary/);
  await expect(page.locator('#panel').getByText(COPY.promise)).toBeVisible();
  await shoot(page, testInfo, 'page-empty');

  // Converting: the file name, the step in words over the progress component, and Cancel.
  const conversion = page.evaluate(() => window.__mt.loadGenerated(300));
  await page.waitForFunction(
    () => window.__mt.state.page === 'converting' && window.__mt.state.progressLog.length > 1,
  );
  await expect(page.locator('body')).toHaveAttribute('data-state', 'converting');
  await expect(page.locator('#panel')).toHaveClass(/\bcard\b/);
  const step = (await page.locator('#status').textContent())?.trim() ?? '';
  expect(
    Object.values(STEP_LABELS).some((label) => step.startsWith(label)),
    step,
  ).toBe(true);
  await expect(page.locator('#heading')).toHaveText('generated-300.stl');
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('#progress')).toHaveClass(/\bprogress\b/);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await shoot(page, testInfo, 'page-converting');
  await conversion;

  // Done: the panel frame, its header with Close, the size line, the downloads, Adjust's
  // disclosures (Up and turn open on a desktop) and the chips; no figures without ?dev.
  expect(await pageState(page)).toBe('done');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#panel')).toHaveClass(/\bpanel\b/);
  await expect(page.locator('#heading')).toHaveText('generated-300');
  await expect(page.locator('#panel').getByRole('button', { name: COPY.close })).toBeVisible();
  await expect(page.locator('#status')).toContainText('Ready. Converted from');
  await expect(page.locator('#mini-size')).toHaveText('50 mm tall · Medium, 1 square · no base');
  for (const name of [COPY.downloadTable, COPY.downloadFar])
    await expect(page.getByRole('button', { name })).toHaveClass(/btn-primary/);
  await expect(page.locator('#orient')).toHaveAttribute('open');
  for (const closed of ['#sizing', '#look', '#pair'])
    await expect(page.locator(closed)).not.toHaveAttribute('open');
  await expect(page.locator('#sizing .summary-hint')).toHaveText('Medium, mm');
  await expect(page.locator('#look .summary-hint')).toHaveText('Grey primer');
  await expect(page.locator('#pair .summary-hint')).toHaveText('one file');
  // The six-way axis is a segmented group; the axis the mini stands on is pressed.
  const up = page.getByRole('group', { name: 'Up axis in file' });
  await expect(up.getByRole('button')).toHaveText(['+X', '−X', '+Y', '−Y', '+Z', '−Z']);
  await expect(up.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('#levels .chip')).toHaveCount(4);
  await expect(page.locator('#stats')).toHaveCount(0);
  await page.waitForTimeout(500);
  await shoot(page, testInfo, 'page-done');

  // Close goes back to the drop card, as before the first file.
  await page.locator('#panel').getByRole('button', { name: COPY.close }).click();
  expect(await pageState(page)).toBe('empty');
  await expect(page.locator('#panel')).toHaveClass(/\bcard\b/);
  await expect(page.locator('#status')).toHaveText(COPY.dropHint);
  await expect(page.getByRole('button', { name: COPY.chooseFile })).toBeFocused();

  // Error: the heading, the message from problems.ts in the error callout, the way to the next file.
  await page.setInputFiles('#file', {
    name: 'empty.stl',
    mimeType: 'model/stl',
    buffer: Buffer.alloc(0),
  });
  await page.waitForFunction(() => window.__mt.state.page === 'error');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#panel')).toHaveClass(/\bcard\b/);
  await expect(page.getByRole('heading', { name: COPY.errorHeading })).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('empty.stl');
  await expect(page.locator('#status')).toHaveText(PROBLEM_MESSAGES.empty);
  await expect(page.locator('#status')).toHaveClass(/problem/);
  await expect(page.locator('#status')).toHaveClass(/callout-error/);
  await expect(page.locator('#status svg.icon')).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.chooseAnother })).toBeVisible();
  await shoot(page, testInfo, 'page-error');
});

/** Height of an element's box, CSS pixels. */
const heightOf = async (page: Page, selector: string): Promise<number> =>
  (await page.locator(selector).boundingBox())!.height;

for (const viewport of [
  { width: 390, height: 844 },
  // The spec's phone width (look-and-feel.md L2): the sheet's first screen still holds the downloads.
  { width: 375, height: 812 },
]) {
  test.describe(`a phone at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });

    test('fits the screen: the bar, the card and the bottom sheet', async ({ page }, testInfo) => {
      await open(page, '/?bake=off');
      const noSideways = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const name = `phone-${viewport.width}`;

      // The bar keeps the name, the file button (its words its name) and More.
      expect(await noSideways()).toBe(true);
      await expect(page.locator('#wordmark')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Theme' })).toBeHidden();
      await expect(page.locator('#promise-short')).toBeHidden();
      for (const button of [
        page.getByRole('button', { name: COPY.openStl }),
        page.getByRole('button', { name: COPY.more }),
        page.locator('#choose-again'),
      ]) {
        await expect(button).toBeVisible();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await shoot(page, testInfo, `${name}-empty`);

      await page.evaluate(() => window.__mt.loadDemo());
      expect(await noSideways()).toBe(true);
      // The sheet's first screen: the size line and both downloads, before any scroll; every
      // disclosure closed; the viewport keeps the rest of the stage.
      const sheet = await heightOf(page, '#panel');
      expect(sheet).toBeLessThanOrEqual(viewport.height * 0.44 + 1);
      expect((await heightOf(page, '#view')) + sheet).toBeCloseTo(
        await heightOf(page, '#stage'),
        0,
      );
      await expect(page.locator('#mini-size')).toBeInViewport();
      await expect(page.getByRole('button', { name: COPY.downloadTable })).toBeInViewport();
      await expect(page.getByRole('button', { name: COPY.downloadFar })).toBeInViewport();
      for (const disclosure of ['#orient', '#sizing', '#look', '#pair'])
        await expect(page.locator(disclosure)).not.toHaveAttribute('open');
      for (const button of await page.locator('#panel button:visible').all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.waitForTimeout(500);
      await shoot(page, testInfo, `${name}-done`);

      // The grab handle, at the tap size, expands the sheet and shrinks it again.
      const handle = page.getByRole('button', { name: COPY.expandPanel });
      expect(await heightOf(page, '#sheet-handle')).toBeGreaterThanOrEqual(44);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      expect(await heightOf(page, '#panel')).toBeGreaterThan(sheet + 100);
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(await heightOf(page, '#panel')).toBeCloseTo(sheet, 0);

      // Opened, Look scrolls inside the sheet and nothing runs off the side.
      await page.locator('#look > summary').click();
      await page.getByLabel('Edges').scrollIntoViewIfNeeded();
      expect(await noSideways()).toBe(true);
      await expect(page.getByLabel('Edges')).toBeInViewport();
      await shoot(page, testInfo, `${name}-look`);
    });
  });
}

test.describe('the More menu on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('holds the theme, the link and Credits, and gives the focus back', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    const more = page.getByRole('button', { name: COPY.more });
    const menu = page.getByRole('menu');
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');

    await more.click();
    await expect(menu).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(menu.getByRole('menuitem', { name: COPY.meshTavern })).toHaveAttribute(
      'href',
      MESHTAVERN_URL,
    );
    // The arrows move between the items; Escape closes and gives the focus back to More.
    await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // A theme from the menu is the switch's: the page and localStorage follow.
    await more.click();
    await menu.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(menu).toBeHidden();
    expect(
      await page.evaluate(() => [
        document.documentElement.dataset.theme,
        localStorage.getItem('mt-theme'),
      ]),
    ).toEqual(['dark', 'dark']);
    await more.click();
    await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Credits opens the dialog; Escape closes it and the focus goes back to More.
    await menu.getByRole('menuitem', { name: COPY.credits }).click();
    const dialog = page.getByRole('dialog', { name: COPY.credits });
    await expect(dialog).toBeVisible();
    await expect(menu).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test('Credits in the bar opens the dialog, which its Close and the scrim close', async ({
  page,
}) => {
  await open(page);
  const opener = page.locator('#top').getByRole('button', { name: COPY.credits });
  const dialog = page.getByRole('dialog', { name: COPY.credits });
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await dialog.getByRole('button', { name: COPY.close }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test('names the levels on the chips and opens Size for a size warning', async ({ page }) => {
  await open(page, '/?bake=off');
  await page.evaluate(() => window.__mt.loadDemo());

  // The chips read the level, the triangles are in the title; the table level is pressed.
  const levels = page.getByRole('group', { name: 'Detail level' });
  await expect(levels.getByRole('button')).toHaveText(['Original', 'Close', 'Table', 'Far']);
  await expect(levels.locator('.chip')).toHaveCount(4);
  await expect(levels.getByRole('button', { name: 'Table' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(levels.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'title',
    '6 triangles',
  );

  // Size is closed; a conversion that ends with a warning opens it, with the warning's callout.
  await expect(page.locator('#sizing')).not.toHaveAttribute('open');
  await page.evaluate(() => window.__mt.setSizing({ size: 'tiny', scaleToBaseMm: 40 }));
  await expect(page.locator('#sizing')).toHaveAttribute('open');
  await expect(page.locator('#sizing-warning')).toBeVisible();
  await expect(page.locator('#sizing-warning')).toHaveClass(/callout-warn/);
  await expect(page.locator('#sizing .summary-hint')).toHaveText('Tiny, mm');

  // The look's hint follows its controls.
  await page.evaluate(() => window.__mt.setLookPreset('bone'));
  await expect(page.locator('#look .summary-hint')).toHaveText('Bone');
  await page.evaluate(() => window.__mt.setLook({ wash: 0.123 }));
  await expect(page.locator('#look .summary-hint')).toHaveText('Your own');
});

test("keeps the team's tools behind ?dev", async ({ page }) => {
  const tools = ['#stats', '#stress', '#bench', '#compact', '#perf', '#dev-badge'];
  const glb = { name: 'mini.glb', mimeType: 'model/gltf-binary', buffer: Buffer.alloc(64, 1) };

  // Without dev: none of the tools exist, the picker offers STL only, a GLB is refused.
  await open(page, '/?bake=off');
  for (const tool of tools) await expect(page.locator(tool), tool).toHaveCount(0);
  await expect(page.locator('#file')).toHaveAttribute('accept', '.stl');
  await page.setInputFiles('#file', glb);
  await expect(page.locator('#status')).toHaveText('mini.glb is not an STL file.');
  expect(await page.evaluate(() => window.__mt.state.imported)).toBeNull();

  // With dev: they are all there, on the components' classes, and the benchmark's mode links keep dev.
  await open(page, '/?dev&bake=off');
  for (const tool of tools) await expect(page.locator(tool), tool).toHaveCount(1);
  await expect(page.locator('#dev-badge')).toHaveClass(/badge-warn/);
  await expect(page.locator('#file')).toHaveAttribute('accept', '.stl,.glb');
  for (const button of await page.locator('#stress button, #bench button').all())
    await expect(button).toHaveClass(/\bbtn\b/);
  await expect(page.locator('#bench a')).toHaveCount(3);
  for (const link of await page.locator('#bench a').all()) {
    expect(await link.getAttribute('href')).toMatch(/^\?dev/);
  }
});
