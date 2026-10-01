// One pair of a feedback session (issue #70, design note docs/design/base-file.md §13.2): the page
// converts the pair, an overlay says what the keys do, the PM corrects the placement with the
// page's own controls and gives a verdict, and the record and a sheet are written. A figure in
// parts converts with its parts after its base (#93), and the record keeps the joints and marks
// the PM set at the questions. Used by scripts/feedback.mjs and by e2e/feedback.spec.ts.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { asDetected, convertAnswering, fromChoices } from './answer-up.mjs';

/**
 * A pair answered by a script that does not finish converting within this is recorded as skipped.
 * While the PM answers the questions there is no limit: marking a kit takes as long as it takes.
 */
export const FEEDBACK_TIMEOUT_MS = 600_000;

/** The views of a record's sheet: the ones of the corpus report's placement sheet. */
const VIEWS = [
  { name: 'front low', azimuth: 25, elevation: 8, zoom: 1.3 },
  { name: 'side', azimuth: 115, elevation: 12, zoom: 1.3 },
  { name: 'from above', azimuth: 25, elevation: 55, zoom: 1.3 },
];

/** R, S, K, N and Escape as verdicts; everything else is the page's. */
const KEYS = { r: 'right', s: 'placed', k: 'skipped', n: 'next', escape: 'end' };

/**
 * Prepares a page for a session: the overlay and a key listener that hands R, S, K, N and
 * Escape to the script. Keys typed into the page's fields are left alone. Returns a function
 * that waits for the next verdict.
 */
export async function installFeedback(page) {
  let waiting = null;
  await page.exposeFunction('__feedbackKey', (verdict) => waiting?.(verdict));
  // The overlay and the keys again on every load: a pair that fails reloads the page.
  const install = (keys) => {
    const add = () => {
      if (document.querySelector('#feedback-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'feedback-overlay';
      overlay.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:20;max-width:60%;padding:8px 12px;border-radius:8px;' +
        'background:rgb(0 0 0 / 0.75);color:#fff;font:14px system-ui;pointer-events:none;white-space:pre-line';
      document.body.append(overlay);
      document.addEventListener('keydown', (event) => {
        const target = event.target;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName)) return;
        const verdict = keys[event.key.toLowerCase()];
        if (!verdict) return;
        event.preventDefault();
        window.__feedbackKey(verdict);
      });
    };
    if (document.body) add();
    else document.addEventListener('DOMContentLoaded', add);
  };
  await page.addInitScript(install, KEYS);
  await page.evaluate(install, KEYS);
  return () =>
    new Promise((resolve) => {
      waiting = resolve;
    });
}

const toBase64 = (buffer) => buffer.toString('base64');

async function sheet(page, browser, path, title) {
  const shots = [];
  for (const view of VIEWS) {
    await page.evaluate((v) => window.__mt.setCamera(v.azimuth, v.elevation, v.zoom), view);
    await page.waitForTimeout(300);
    shots.push({
      caption: view.name,
      data: toBase64(await page.locator('#viewport').screenshot()),
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  const sheetPage = await browser.newPage({ viewport: { width: 1100, height: 400 } });
  try {
    await sheetPage.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
    <h3 style="margin:0 0 8px">${title}</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
    ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
    </div></body>`);
    await sheetPage.waitForLoadState('load');
    // A plain screenshot at the content's height: a full-page capture of a freshly built page
    // fails on CI's software renderer ("Unable to capture screenshot").
    const height = await sheetPage.evaluate(() => document.documentElement.scrollHeight);
    await sheetPage.setViewportSize({ width: 1100, height: Math.min(Math.max(height, 100), 4000) });
    await sheetPage.screenshot({ path });
  } catch (error) {
    // The record matters more than its picture: keep the first view alone rather than fail the session.
    console.warn(
      `sheet for ${title}: ${error instanceof Error ? error.message : error}; saving the first view only`,
    );
    writeFileSync(path, Buffer.from(shots[0].data, 'base64'));
  } finally {
    await sheetPage.close();
  }
}

/** A key as a file name: folders kept, anything odd replaced. */
export const recordPath = (outDir, key) =>
  join(outDir, `${key.replace(/[^A-Za-z0-9/_-]+/g, '_')}.json`);

/**
 * The answers to a pair's questions after the orient step (#92) from its own `up`, `rotation`
 * and `baseUp`; a proposal that already stands that way is confirmed as it is. A pair with
 * `choices` (a record's, #93) is answered with them: its joints and marks included.
 */
export function pickFromPair(pair) {
  const fromIndex = (question) => {
    if (question.kind === 'meet') return {};
    if (question.role === 'base')
      return pair.baseUp && pair.baseUp !== question.orientation.up ? { up: pair.baseUp } : {};
    if (pair.rotation) return { rotation: pair.rotation };
    return pair.up && pair.up !== question.orientation.up ? { up: pair.up } : {};
  };
  // A pair that carries the choices of a conversion (#93): its joints and marks too.
  return pair.choices ? fromChoices(pair.choices, fromIndex) : fromIndex;
}

/**
 * Waits for the conversion to end while the PM answers the questions on the page (#92), however
 * long it takes; the overlay says so while one is open.
 */
async function answeredByThePm(page) {
  await page.waitForFunction(
    () => {
      const { question, stats, error, busy } = window.__mt.state;
      const overlay = document.querySelector('#feedback-overlay');
      if (overlay)
        overlay.textContent = question ? 'answer the question on the page' : 'converting…';
      return (stats || error) && !busy;
    },
    null,
    { timeout: 0, polling: 250 },
  );
}

/**
 * Converts one pair, waits for the verdict, writes the record and its sheet. Returns the verdict,
 * or 'end' when the PM pressed Escape (nothing is written then).
 *
 * @param pair `{ key, figure, base }`: paths to the two files; for `up: 'index'` also the
 *   figure's `up` or `rotation` and the base's `baseUp`.
 * @param session `{ index, total, commit, outDir, browser, nextVerdict, up }`. `up` is how the
 *   questions after the orient step are answered: `ask` (the default: the PM answers on the
 *   page), `detected`, or `index` (the pair's own).
 */
export async function reviewPair(page, pair, session) {
  const { index, total, commit, outDir, browser, nextVerdict, up = 'ask' } = session;
  const parts = pair.parts ?? [];
  const base = {
    key: pair.key,
    figureFile: pair.figure,
    baseFile: pair.base,
    ...(parts.length > 0 && { partFiles: parts }),
    date: new Date().toISOString(),
    commit,
  };
  const write = (record) => {
    const path = recordPath(outDir, pair.key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  };

  await page.evaluate(() => {
    Object.assign(window.__mt.state, { stats: null, error: null });
    document.querySelector('#feedback-overlay').textContent = 'converting…';
  });
  await page.setInputFiles('#file', [pair.figure, ...(pair.base ? [pair.base] : []), ...parts]);
  try {
    if (up === 'ask') await answeredByThePm(page);
    else
      await convertAnswering(
        page,
        up === 'index' ? pickFromPair(pair) : asDetected,
        FEEDBACK_TIMEOUT_MS,
      );
  } catch (error) {
    const note = error instanceof Error ? error.message.split('\n')[0] : String(error);
    write({ ...base, verdict: 'skipped', note });
    console.warn(`${pair.key}: skipped (${note})`);
    await page.reload();
    await page.waitForFunction(() => window.__mt?.state.ready === true);
    return 'skipped';
  }
  const first = await page.evaluate(() => {
    const { stats, error } = window.__mt.state;
    return { error, pair: stats?.pair ?? null, placement: stats?.pair?.placement ?? null };
  });
  // A figure in parts without a base has no placement (#93), but it is a mini to record.
  if (first.error || !first.pair) {
    write({ ...base, verdict: 'refused', note: String(first.error ?? 'not converted as a pair') });
    return 'refused';
  }
  const detected = first.placement && {
    spot: first.placement.spot,
    offsetMm: first.placement.offsetMm,
    yawDeg: first.placement.yawDeg,
    method: first.placement.method,
  };

  await page.evaluate(
    ([i, n, key]) => {
      const line = window.__mt.state.stats?.pair?.placement
        ? (document.querySelector('#placement')?.textContent ?? '')
        : (document.querySelector('#pair-files')?.textContent ?? '');
      document.querySelector('#feedback-overlay').textContent =
        `pair ${i} of ${n} · ${key}\n${line}\nR right · S save placement · K skip · N next · Esc end`;
    },
    [index, total, pair.key],
  );
  const verdict = await nextVerdict();
  if (verdict === 'end') return 'end';

  // Right means the automatic placement: a preview left pending does not count.
  if (verdict === 'right') await page.evaluate(() => window.__mt.resetPlacement());
  const now = await page.evaluate(() => {
    const { stats, pair: pending } = window.__mt.state;
    return {
      orientation: stats?.orientation ?? null,
      // How the base file stands and what was confirmed at the questions (#92).
      baseOrientation: stats?.pair?.baseOrientation ?? null,
      choices: stats?.choices ?? null,
      pairing: stats?.pair
        ? { baseFile: stats.pair.pairing.baseFile, method: stats.pair.pairing.method }
        : null,
      // Where the parts and the figure were marked to meet (#93), as the result has them.
      marks: stats?.pair?.placement?.marks ?? null,
      parts:
        stats?.pair && stats.pair.parts.length > 1
          ? stats.pair.parts.map((part) => ({
              file: part.file,
              source: part.source,
              ...(part.joint && { joint: part.joint }),
            }))
          : null,
      pending,
      figure: window.__mt.figurePlacement(),
      baseFootprintMm: stats?.sizing.base
        ? stats.sizing.base.footprintMm.map((mm) => mm / stats.sizing.scale)
        : null,
    };
  });
  const inParts = !first.placement;
  if (verdict === 'skipped' || verdict === 'next' || (!now.figure && !inParts)) {
    write({ ...base, verdict: 'skipped', ...(verdict === 'next' ? { note: 'next' } : {}) });
    return 'skipped';
  }
  const sheetPath = join(outDir, 'sheets', `${pair.key.replace(/[^A-Za-z0-9/_-]+/g, '_')}.png`);
  await page.evaluate(() => document.querySelector('#feedback-overlay').replaceChildren());
  await sheet(page, browser, sheetPath, `${pair.key}: ${verdict}`);
  const pending = verdict === 'placed' ? now.pending : null;
  write({
    ...base,
    verdict,
    orientation: now.orientation,
    baseOrientation: now.baseOrientation,
    choices: now.choices,
    pairing: now.pairing,
    ...(now.marks && { marks: now.marks }),
    ...(now.parts && { parts: now.parts }),
    detected,
    placed: now.figure && {
      moveMm: pending?.moveMm ?? [0, 0],
      liftMm: pending?.liftMm ?? 0,
      turnDeg: pending?.turnDeg ?? 0,
      offsetMm: now.figure.offsetMm,
      yawDeg: now.figure.yawDeg,
      figureCentreMm: now.figure.figureCentreMm,
      figureLowestMm: now.figure.figureLowestMm,
    },
    figureCentreMm: now.figure?.figureCentreMm ?? null,
    baseFootprintMm: now.baseFootprintMm,
    sheet: sheetPath,
  });
  return verdict;
}
