import { expect, test, type FileChooser, type Locator, type Page } from '@playwright/test';
import { COPY } from '../src/page/page-state';
import { SIZE_STEP_MM } from '../src/lib/painting-panel';
import { generateFigure } from '../src/regression/shapes';
import {
  asking,
  converting,
  cancel,
  done,
  error,
  file,
  open,
  painting,
  pairsStop,
  question,
} from './states';

/**
 * The keyboard pass (#146, spec docs/specs/look-and-feel.md L4, design note
 * docs/design/look-and-feel.md §11): in every state Tab reaches every control on screen and each
 * one shows the application's focus ring; then every kind of control is driven with keys alone:
 * the file button, the disclosures, the segmented groups, the sliders, the chips, the sheet's
 * handle, the menu and the dialog.
 */

/** What the Tab sweep found: the controls on screen, those Tab reached, and the rings it saw. */
interface Sweep {
  controls: string[];
  missed: string[];
  /** Controls whose focus ring was not the application's: `name: outline`. */
  rings: string[];
}

/**
 * Presses Tab from the top of the page (or of an open dialog) until the focus comes round, and
 * compares what it reached with every visible, enabled control that is not taken out of the order
 * (`tabindex="-1"`: the hidden file inputs, the menu's items, which the arrows move between).
 */
async function sweep(page: Page): Promise<Sweep> {
  const controls = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('.dialog');
    const scope = dialog?.checkVisibility() ? dialog : document.body;
    const all = scope.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, [tabindex]',
    );
    let k = 0;
    const found: string[] = [];
    for (const element of all) {
      delete element.dataset.kb;
      if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled) continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      if (element.closest('[inert]')) continue;
      element.dataset.kb = String(k++);
      const label =
        element.getAttribute('aria-label') ??
        element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30) ??
        '';
      found.push(
        `${element.dataset.kb} ${element.id ? `#${element.id}` : element.tagName}: ${label}`,
      );
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return found;
  });
  const reached = new Set<string>();
  const rings: string[] = [];
  for (let i = 0; i < controls.length + 8; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element?.dataset.kb) return null;
      // The ring's colour is the role's, resolved the way the outline resolves it.
      const probe = document.createElement('span');
      probe.style.color = 'var(--focus-ring)';
      element.parentElement!.append(probe);
      const ring = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      const outline = `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
      return {
        kb: element.dataset.kb,
        ring: element.matches(':focus-visible') && outline === `solid 2px ${ring}`,
        outline,
      };
    });
    if (!at) continue;
    reached.add(at.kb);
    if (!at.ring) rings.push(`${controls[Number(at.kb)]}: ${at.outline}`);
  }
  const missed = controls.filter((c) => !reached.has(c.split(' ')[0]!));
  return { controls, missed, rings: [...new Set(rings)] };
}

async function expectSwept(page: Page, state: string): Promise<void> {
  const result = await sweep(page);
  expect(result.controls.length, `${state}: controls on screen`).toBeGreaterThan(0);
  expect(result.missed, `${state}: controls Tab never reached`).toEqual([]);
  expect(result.rings, `${state}: focus rings that are not the application's`).toEqual([]);
}

/**
 * Collects every file picker the page opens from now on. Call it before the page opens: Playwright
 * asks Chromium to catch pickers when the first listener is added and does not wait for the answer.
 * A key press goes into the page another way, without a round trip first (a click makes several),
 * so a `waitForEvent('filechooser')` just before it can lose to it: the picker opens uncaught and
 * the wait times out (#170). Added before `open`, every round trip after it comes behind the request.
 */
function catchPickers(page: Page): FileChooser[] {
  const pickers: FileChooser[] = [];
  page.on('filechooser', (picker) => pickers.push(picker));
  return pickers;
}

/** Moves the focus to `target` with Tab alone, from where it is; fails after `limit` presses. */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab did not reach ${target}`);
}

test('Tab reaches every control in every state, each with the application’s focus ring', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await open(page, '/?bake=off');
  await expectSwept(page, 'empty');

  await page.locator('#top').getByRole('button', { name: COPY.credits }).click();
  await expectSwept(page, 'credits');
  await page.keyboard.press('Escape');

  await converting(page);
  await expectSwept(page, 'converting');
  await cancel(page);

  await error(page);
  await expectSwept(page, 'error');

  await asking(page);
  await expectSwept(page, 'up question');
  await page.evaluate(() => window.__mt.confirmUp());
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  for (const id of ['#orient', '#sizing', '#look', '#pair'])
    await page.locator(id).evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await expectSwept(page, 'done');

  await pairsStop(page);
  await expectSwept(page, 'pairs stop');
});

test('a phone: Tab reaches the bar, the handle and the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, '/?bake=off');
  await expectSwept(page, 'phone empty');
  await done(page);
  await expectSwept(page, 'phone done');
});

test('the file button, the dialog and the theme switch with keys alone', async ({ page }) => {
  const pickers = catchPickers(page);
  await open(page);
  // The bar's file button and the card's: Enter and Space open the picker.
  const choose = page.locator('#top').getByRole('button', { name: COPY.openStl });
  await tabTo(page, choose);
  await page.keyboard.press('Enter');
  await expect.poll(() => pickers.length).toBe(1);
  expect(pickers[0]!.isMultiple()).toBe(true);
  await tabTo(page, page.getByRole('button', { name: COPY.chooseFile }));
  await page.keyboard.press('Space');
  await expect.poll(() => pickers.length).toBe(2);

  // The theme switch: each choice is a tab stop, Space presses it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const theme = page.getByRole('group', { name: 'Theme' });
  await tabTo(page, theme.getByRole('button', { name: 'Dark' }));
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Shift+Tab');
  await expect(theme.getByRole('button', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Credits: Enter opens it with the focus inside, Tab stays inside, Escape gives it back.
  const credits = page.locator('#top').getByRole('button', { name: COPY.credits });
  await tabTo(page, credits);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: COPY.credits });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(credits).toBeFocused();
});

test('the panel with keys alone: disclosures, the axis, a slider, the chips', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, '/?bake=off');
  await done(page);

  // A disclosure: Enter opens it, Space closes it.
  const size = page.locator('#sizing > summary');
  await tabTo(page, size);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sizing')).toHaveAttribute('open');
  await page.keyboard.press('Space');
  await expect(page.locator('#sizing')).not.toHaveAttribute('open');

  // A level chip: Enter shows that level.
  const levels = page.getByRole('group', { name: 'Detail level' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, levels.getByRole('button', { name: 'Original' }));
  await page.keyboard.press('Enter');
  await expect(levels.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => window.__mt.state.shownLevel)).toBe(0);

  // Look: a preset chip with Space, then a slider with the arrows makes the look your own.
  await page.locator('#look > summary').focus();
  await page.keyboard.press('Enter');
  const presets = page.locator('#look-presets');
  const bone = presets.getByRole('button', { name: 'Bone' });
  await tabTo(page, bone);
  await page.keyboard.press('Space');
  await expect(page.locator('#look .summary-hint')).toHaveText('Bone');
  const shadows = page.getByLabel('Shadows');
  await tabTo(page, shadows);
  const before = Number(await shadows.inputValue());
  await page.keyboard.press(before < 1 ? 'ArrowRight' : 'ArrowLeft');
  expect(Number(await shadows.inputValue())).not.toBe(before);
  await expect(page.locator('#look .summary-hint')).toHaveText('Your own');

  // The segmented axis: each axis a tab stop, Enter stands the mini on it and converts again.
  const up = page.getByRole('group', { name: 'Up axis in file' });
  const pressed = await up.locator('[aria-pressed="true"]').textContent();
  const other = pressed === '+Y' ? '+X' : '+Y';
  await page.locator('#orient > summary').focus();
  await tabTo(page, up.getByRole('button', { name: other, exact: true }));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mt.state.page === 'done' && !window.__mt.state.busy);
  await expect(up.locator('[aria-pressed="true"]')).toHaveText(other);
});

test('the question with keys alone: an axis, then Confirm', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, '/?bake=off');
  const serial = await asking(page);
  const axis = page.locator('#ask-up');
  const pressed = await axis.locator('[aria-pressed="true"]').textContent();
  const other = pressed === '+Y' ? '+X' : '+Y';
  await tabTo(page, axis.getByRole('button', { name: other, exact: true }));
  await page.keyboard.press('Enter');
  await question(page, serial);
  await expect(axis.locator('[aria-pressed="true"]')).toHaveText(other);
  await tabTo(page, page.locator('#ask-confirm'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mt.state.page === 'done');
});

test('the painting panel: Tab reaches every control, and the tools, a slider, a swatch, a chip and a group’s Hide work by keys (#166)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await open(page, '/?dev&ask=off&bake=256');
  await painting(page);
  // A stroke for a swatch, and a group pulled apart, so every kind of control is on screen.
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const hit = view.texelAt(...view.screenOf([0, 14, 6]));
    if (hit) await view.stroke([hit.point]);
    view.setTool('airbrush');
    view.pullApart(2);
    view.setColour('#2050a0');
  });
  await expectSwept(page, 'painting panel');

  const panel = page.locator('#paint-panel');
  const state = () => page.evaluate(() => window.__mt.painting.view().state);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // A tool with Space.
  await tabTo(page, panel.locator('[data-tool="wash"]'), 200);
  await page.keyboard.press('Space');
  expect((await state()).tool).toBe('wash');

  // The size slider with the arrows: one SIZE_STEP_MM.
  const size = panel.locator('[data-slider="sizeMm"] input');
  await tabTo(page, size);
  const before = (await state()).brush.sizeMm;
  await page.keyboard.press('ArrowRight');
  expect((await state()).brush.sizeMm).toBeCloseTo(before + SIZE_STEP_MM);

  // A swatch with Space: the stroke's colour again.
  await tabTo(page, panel.locator('[data-swatch]').first());
  await page.keyboard.press('Space');
  expect((await state()).colour).toBe('#b03030');

  // A look preset with Space.
  await tabTo(page, panel.locator('[data-preset="bone"]'));
  await page.keyboard.press('Space');
  expect((await state()).look.base).toBe('#d8cdb0');

  // A group's Hide with Space hides it, Enter shows it again.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const hide = panel.locator('[data-groups] [data-shown="1"]');
  await tabTo(page, hide, 200);
  await page.keyboard.press('Space');
  expect((await state()).groups.hidden).toEqual([1]);
  // The rows were built again, and the focus is on the same row's Hide.
  await expect(hide).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await state()).groups.hidden).toEqual([]);
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('the sheet’s handle and the More menu with keys alone', async ({ page }) => {
    await open(page, '/?bake=off');
    // More: Enter opens the menu on its first item, the arrows move, Enter picks, Escape closes.
    const more = page.getByRole('button', { name: COPY.more });
    await tabTo(page, more);
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // The handle: Enter expands the sheet, Space folds it again.
    await done(page);
    const handle = page.getByRole('button', { name: COPY.expandPanel });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, handle);
    await page.keyboard.press('Enter');
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
  });
});

test('the painter by keys: Paint, Save paint file, Done, and the confirm dialog (#167)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await open(page, '/?ask=off&bake=256');
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  await page.waitForFunction(
    () => window.__mt.state.page === 'done' && !window.__mt.state.busy && window.__mt.state.baked,
    undefined,
    { timeout: 180_000 },
  );
  // Paint in the done panel by Enter.
  await tabTo(page, page.locator('#paint-open'), 200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__mt.state.page === 'painting' && window.__mt.state.painting?.open === true,
    undefined,
    { timeout: 120_000 },
  );
  await expectSwept(page, 'painter');
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const hit = view.texelAt(...view.screenOf([0, 14, 6]));
    if (hit) await view.stroke([hit.point]);
  });
  // Save paint file by Enter: a download.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, page.locator('#paint-file-save'), 300);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('hero.mtpaint');
  // Done by Enter leaves the state, the focus back on Paint.
  await tabTo(page, page.locator('#paint-done'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  await expect(page.locator('#paint-open')).toBeFocused();

  // An unsaved stroke, then a reconversion: the confirm dialog, no by Escape, yes by Tab and Enter.
  await page.locator('#paint-open').click();
  await page.waitForFunction(() => window.__mt.state.page === 'painting');
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const hit = view.texelAt(...view.screenOf([0, 18, 6]));
    if (hit) await view.stroke([hit.point]);
  });
  await page.locator('#paint-done').click();
  await page.waitForFunction(() => window.__mt.state.page === 'done');
  let sizing = page.evaluate(() => window.__mt.setSizing({ size: 'huge' }));
  await expect(page.locator('#confirm')).toBeVisible();
  await page.keyboard.press('Escape');
  await sizing;
  await expect(page.locator('#confirm')).toBeHidden();
  sizing = page.evaluate(() => window.__mt.setSizing({ size: 'huge' }));
  await expect(page.locator('#confirm')).toBeVisible();
  await tabTo(page, page.locator('#confirm-yes'), 5);
  await page.keyboard.press('Enter');
  await sizing;
  expect(await page.evaluate(() => window.__mt.state.stats!.sizing.size)).toBe('huge');
});
