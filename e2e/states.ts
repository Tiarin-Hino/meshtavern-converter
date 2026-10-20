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
 * A generated sheet of `quadsPerSide`² × 2 triangles converting (180,000 by default): it stays in
 * the converting state for seconds even on a fast machine. The reference pictures take 600, so the
 * conversion outlasts the picture taken of it. The caller cancels it (`cancel`) when done.
 */
export async function converting(page: Page, quadsPerSide = 300): Promise<void> {
  void page.evaluate((n) => window.__mt.loadGenerated(n), quadsPerSide).catch(() => undefined);
  await page.waitForFunction(
    () => window.__mt.state.page === 'converting' && window.__mt.state.progressLog.length > 1,
  );
}

/**
 * Holds the status line at `text` until `releaseStatus`: the conversion goes on and writes each
 * step into it, and the line is put back at once, before the page is drawn again. A picture of the
 * converting state then has the same line, and the same width of its mask, whichever step the
 * conversion is at: the line is as wide as its words, and "Reducing the detail…" is 2 px wider
 * than "Joining the surface…"; the pictures hold "Reducing the detail…".
 */
export async function holdStatus(page: Page, text: string): Promise<void> {
  await page.evaluate((held) => {
    const w = window as typeof window & { __heldStatus?: MutationObserver };
    const line = document.querySelector('#status .status-text')!;
    w.__heldStatus?.disconnect();
    const hold = () => {
      if (line.textContent !== held) line.textContent = held;
    };
    hold();
    w.__heldStatus = new MutationObserver(hold);
    w.__heldStatus.observe(line, { childList: true, characterData: true, subtree: true });
  }, text);
}

export async function releaseStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as typeof window & { __heldStatus?: MutationObserver };
    w.__heldStatus?.disconnect();
    delete w.__heldStatus;
  });
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

/**
 * Holds every animation-frame callback the page asks for, so the 3D scenes stop drawing: a
 * picture of the page then takes milliseconds, not the seconds a software-rendered frame costs on
 * a busy machine. `thawFrames` hands the held callbacks back, and the scenes go on.
 */
export async function freezeFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as typeof window & {
      __held?: { raf: typeof requestAnimationFrame; queue: FrameRequestCallback[] };
    };
    if (w.__held) return;
    const held = { raf: w.requestAnimationFrame.bind(w), queue: [] as FrameRequestCallback[] };
    w.__held = held;
    w.requestAnimationFrame = (callback) => {
      held.queue.push(callback);
      return 0;
    };
    // The frames already asked for run once more and ask again, into the queue.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

export async function thawFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as typeof window & {
      __held?: { raf: typeof requestAnimationFrame; queue: FrameRequestCallback[] };
    };
    const held = w.__held;
    if (!held) return;
    delete w.__held;
    w.requestAnimationFrame = held.raf;
    for (const callback of held.queue) held.raf(callback);
  });
}
