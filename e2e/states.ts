import { type Page } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure, generatePuddleFigure, generateRecessBase } from '../src/regression/shapes';

/**
 * The ways into each state of the page that the quality bar's specs share (#146: the scan, the
 * keyboard pass, the reference screenshots). Each one ends when the state is on screen and still:
 * the page's state set, the question drawn, the conversion finished.
 */

export const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});

/** Opens the page at `path` and waits for start-up. */
export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
}

/** Waits until a question with a serial above `after` is on screen and drawn; returns its serial. */
export async function question(page: Page, after = 0): Promise<number> {
  await page.waitForFunction(
    (s) =>
      (window.__mt.state.question?.serial ?? 0) > s &&
      window.__mt.state.page === 'asking' &&
      window.__mt.state.questionMs !== null,
    after,
  );
  return page.evaluate(() => window.__mt.state.question!.serial);
}

/** The demo mini, six triangles, done at once: the done state without a wait. */
export async function done(page: Page): Promise<void> {
  await page.evaluate(() => window.__mt.loadDemo());
  await page.waitForFunction(() => window.__mt.state.page === 'done');
}

/** An empty file: the error state with the message of problems.ts. */
export async function error(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'empty.stl',
    mimeType: 'model/stl',
    buffer: Buffer.alloc(0),
  });
  await page.waitForFunction(() => window.__mt.state.page === 'error');
}

/** The generated figure picked as a new file: the up question. */
export async function asking(page: Page): Promise<number> {
  await page.setInputFiles('#file', file('hero.stl', generateFigure(true)));
  return question(page);
}

/**
 * A sheet of 180,000 triangles converting: it stays in the converting state for seconds even on a
 * fast machine. The caller cancels it (`window.__mt.cancel()`) when done with the state.
 */
export async function converting(page: Page): Promise<void> {
  void page.evaluate(() => window.__mt.loadGenerated(300)).catch(() => undefined);
  await page.waitForFunction(
    () => window.__mt.state.page === 'converting' && window.__mt.state.progressLog.length > 1,
  );
}

/** Stops a conversion and waits for the page to settle back. */
export async function cancel(page: Page): Promise<void> {
  await page.evaluate(() => window.__mt.cancel());
  await page.waitForFunction(() => !window.__mt.state.busy);
}

/** A figure and its base picked together, both up questions confirmed: the pairs stop. */
export async function pairsStop(page: Page): Promise<number> {
  await page.setInputFiles('#file', [
    file('figure.stl', generatePuddleFigure(12)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  let serial = await question(page);
  await page.evaluate(() => window.__mt.confirmUp());
  serial = await question(page, serial);
  await page.evaluate(() => window.__mt.confirmUp());
  return question(page, serial);
}

/** A file dragged over the page: the drop overlay, without a drop. */
export async function dragOver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['solid'], 'mini.stl', { type: 'model/stl' }));
    document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
  });
  await page.waitForFunction(() => document.body.hasAttribute('data-dragging'));
}

/** The drag leaves the page again. */
export async function dragLeave(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true })),
  );
  await page.waitForFunction(() => !document.body.hasAttribute('data-dragging'));
}
