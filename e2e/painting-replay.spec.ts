import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPaintFile, type PaintStep } from '../src/lib';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';

/**
 * The engine for a consumer without a painter (#197): the replay at `open` in slices, with its
 * progress and an end, on a shown view and on a hidden one; the recorded painting and a picked
 * fill replayed on another reduction of the table level; the paint as a KTX2 drawn beside its own
 * pixels. Through the team's Paint tool under ?dev, as `paint-file.spec.ts`.
 */

const RECORDED = 'src/regression/painting.mtpaint';
const REPLAYED = 'src/regression/painting-replay.json';
/** As `paint-file.spec.ts`: a channel of a replayed sample may differ by this much. _(PM decision 2026-10-20, #186)_ */
const REPLAY_TOLERANCE = 8;
/** As `paint-file.spec.ts`: at most this share of the samples may differ by more. _(PM decision 2026-10-20, #186)_ */
const REPLAY_OUTLIERS = 0.02;
/** The table level of the other reduction: fewer triangles than the policy's 35,012 for the figure. */
const OTHER_TABLE_TRIANGLES = 30_000;
/**
 * The recorded painting on the other reduction (#197): this share of its points may differ by more
 * than REPLAY_TOLERANCE. 18 of 198 (9 %) on CI: the hobby brushes and the eraser read the surface
 * from the detail texture, which is baked again for another mesh, and test sight and facing on
 * its triangles; at the dabs' edges they come out otherwise. Not the 2 % of the same mesh: the
 * PM's call on #197. _(proposal)_
 */
const OTHER_REDUCTION_OUTLIERS = 0.12;
/**
 * The steps of the long replay: enough for several slices in software rendering, where a step
 * takes about a third of a second (500, the issue's number, is `scripts/measure-painting.mjs`'s
 * on a GPU).
 */
const LONG_REPLAY = 100;
/**
 * A pixel of the mini drawn with the compressed paint may differ from the one drawn with the
 * paint's own pixels by this much, of 255, in its largest channel… _(proposal, #197)_
 */
const PAINT_KTX2_TOLERANCE = 12;
/** …and at most this share of the mini's pixels by more. _(proposal, #197)_ */
const PAINT_KTX2_OUTLIERS = 0.02;

test.describe.configure({ timeout: 300_000 });

/** Converts the generated figure baked, without the questions; `table` reduces its table level otherwise (`?table=`). */
async function convertFigure(page: Page, table: number | null = null): Promise<void> {
  await page.goto(`/?dev&ask=off${table === null ? '' : `&table=${table}`}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', {
    name: 'figure.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(encodeBinaryStl(generateFigure(true))),
  });
  await page.waitForFunction(
    () => window.__mt.state.stats !== null && !window.__mt.state.busy,
    undefined,
    { timeout: 180_000 },
  );
  expect(await page.evaluate(() => window.__mt.state.baked)).not.toBeNull();
}

const recorded = async (): Promise<PaintStep[]> =>
  (await readPaintFile(readFileSync(RECORDED))).steps;

/** LONG_REPLAY steps: the recorded painting's plain strokes over and over (no lift, no group, no hidden group). */
async function longPainting(): Promise<PaintStep[]> {
  const strokes = (await recorded()).filter(
    (step) =>
      step.kind === 'stroke' &&
      step.lifts === undefined &&
      step.groups === undefined &&
      step.tool !== 'group',
  );
  return Array.from({ length: LONG_REPLAY }, (_, k) => strokes[k % strokes.length]!);
}

/** As `paint-file.spec.ts`: every fourth dab of the strokes, and rings on the base's top. */
function samplePoints(steps: PaintStep[]): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (const step of steps)
    if (step.kind === 'stroke')
      for (let k = 0; k < step.dabs.length; k += 4)
        points.push([step.dabs[k]!, step.dabs[k + 1]!, step.dabs[k + 2]!]);
  for (const r of [7, 9, 11])
    for (let k = -12; k < 12; k++) {
      const t = k / 4;
      points.push([(r * (1 - t * t)) / (1 + t * t), 3, (r * 2 * t) / (1 + t * t)]);
    }
  return points;
}

/** Opens the painter with `steps`, shown or hidden; the time, the progress reports and the paint's SHA-256. */
function replay(
  page: Page,
  steps: PaintStep[],
  hidden: boolean,
): Promise<{ ms: number; reports: [number, number][]; paint: string; open: [number, number] }> {
  return page.evaluate(
    async ({ steps, hidden }) => {
      const painting = window.__mt.painting;
      painting.close();
      const reports: [number, number][] = [];
      const started = performance.now();
      await painting.open(null, null, null, {
        steps,
        hidden,
        onReplay: (done, total) => reports.push([done, total]),
      });
      const ms = performance.now() - started;
      const view = painting.view();
      const data = (await view.paint()).data;
      const paint = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      return { ms, reports, paint, open: [view.state.steps, view.state.undone] };
    },
    { steps, hidden },
  );
}

test('replays a long painting in slices with its progress, hidden as shown, to the same paint', async ({
  page,
}) => {
  await convertFigure(page);
  const steps = await longPainting();
  const shown = await replay(page, steps, false);
  const hidden = await replay(page, steps, true);
  for (const run of [shown, hidden]) {
    expect(run.open).toEqual([LONG_REPLAY, 0]);
    // More than one slice, each report further on, the last one the end.
    expect(run.reports.length).toBeGreaterThan(1);
    expect(run.reports.at(-1)).toEqual([LONG_REPLAY, LONG_REPLAY]);
    for (let k = 1; k < run.reports.length; k++)
      expect(run.reports[k]![0]).toBeGreaterThan(run.reports[k - 1]![0]);
  }
  expect(hidden.paint).toBe(shown.paint);
  test.info().annotations.push({
    type: 'replay',
    description: `${LONG_REPLAY} steps: shown ${Math.round(shown.ms)} ms in ${shown.reports.length} slices, hidden ${Math.round(hidden.ms)} ms in ${hidden.reports.length}`,
  });
});

test('close and a later open end a replay at its next slice, and nothing of it stays', async ({
  page,
}) => {
  await convertFigure(page);
  const steps = await longPainting();
  const outcome = await page.evaluate(async (steps) => {
    const painting = window.__mt.painting;
    painting.close();
    // Closed at the first report.
    let closedAt = 0;
    let after = 0;
    await painting.open(null, null, null, {
      steps,
      onReplay: (done) => {
        if (closedAt === 0) {
          closedAt = done;
          painting.close();
        } else after++;
      },
    });
    const closed = {
      closedAt,
      after,
      open: (() => {
        try {
          return painting.view().state.open;
        } catch {
          return false;
        }
      })(),
    };
    // Opened again, bare, at the first report: the later open is the one that opens.
    let replaced = false;
    let later: Promise<void> | null = null;
    const first = painting.open(null, null, null, {
      steps,
      onReplay: () => {
        if (replaced) return;
        replaced = true;
        later = painting.open();
      },
    });
    await first;
    await later;
    const view = painting.view();
    const bare = (await view.paint()).data.every((byte) => byte === 0);
    return { closed, replaced, open: [view.state.steps, view.state.undone], bare };
  }, steps);
  expect(outcome.closed.closedAt).toBeGreaterThan(0);
  expect(outcome.closed.closedAt).toBeLessThan(LONG_REPLAY);
  expect(outcome.closed.after).toBe(0);
  expect(outcome.closed.open).toBe(false);
  expect(outcome.replaced).toBe(true);
  expect(outcome.open).toEqual([0, 0]);
  expect(outcome.bare).toBe(true);
});

/** The paint at `points` after replaying `steps` on the converted mini. */
async function samplesAfter(
  page: Page,
  steps: PaintStep[],
  points: [number, number, number][],
): Promise<number[]> {
  return page.evaluate(
    async ({ steps, points }) => {
      const painting = window.__mt.painting;
      painting.close();
      await painting.open(null, null, null, { steps });
      return painting.sample(points);
    },
    { steps, points },
  );
}

/** How many of the points differ by more than REPLAY_TOLERANCE in a channel, and the worst difference. */
function compare(a: number[], b: number[]): { outliers: number; worst: number } {
  let outliers = 0;
  let worst = 0;
  for (let k = 0; k < a.length / 4; k++) {
    let off = 0;
    for (let c = 0; c < 4; c++) off = Math.max(off, Math.abs(a[k * 4 + c]! - b[k * 4 + c]!));
    worst = Math.max(worst, off);
    if (off > REPLAY_TOLERANCE) outliers++;
  }
  return { outliers, worst };
}

test('replays the recorded painting on another reduction of the table level to the colours it had', async ({
  page,
}) => {
  await convertFigure(page, OTHER_TABLE_TRIANGLES);
  const steps = await recorded();
  const points = samplePoints(steps);
  const samples = await samplesAfter(page, steps, points);
  const tableTriangles = await page.evaluate(
    () => window.__mt.painting.table()!.indices.length / 3,
  );
  const expected = JSON.parse(readFileSync(REPLAYED, 'utf8')) as {
    points: number;
    samples: number[];
  };
  expect(expected.points).toBe(points.length);
  const { outliers, worst } = compare(samples, expected.samples);
  // Which step each point beyond the tolerance is a dab of (or a ring): for the diagnosis.
  const owners: string[] = [];
  steps.forEach((step, index) => {
    if (step.kind === 'stroke')
      for (let k = 0; k < step.dabs.length; k += 4) owners.push(`${index}`);
  });
  const beyond = points
    .map((_, k) => k)
    .filter((k) =>
      [0, 1, 2, 3].some(
        (c) => Math.abs(samples[k * 4 + c]! - expected.samples[k * 4 + c]!) > REPLAY_TOLERANCE,
      ),
    )
    .map(
      (k) =>
        `${owners[k] ?? 'ring'}:${samples.slice(k * 4, k * 4 + 4).join('/')}≠${expected.samples.slice(k * 4, k * 4 + 4).join('/')}`,
    );
  test.info().annotations.push({
    type: 'replay',
    description: `table level of ${tableTriangles} triangles: ${points.length} points, ${outliers} beyond ${REPLAY_TOLERANCE}, worst ${worst}; ${beyond.join(' ')}`,
  });
  expect(outliers / points.length).toBeLessThanOrEqual(OTHER_REDUCTION_OUTLIERS);
});

/** A picked fill of the base's top, seeded at a point of it on the open table level. */
function pickedFill(page: Page): Promise<PaintStep> {
  return page.evaluate(() => {
    const table = window.__mt.painting.table()!;
    // The triangle of the base's top closest to (9, 3, 0), and its middle.
    let best = -1;
    let bestDistance = Infinity;
    let middle: [number, number, number] = [0, 0, 0];
    for (let t = 0; t < table.indices.length / 3; t++) {
      const c = [0, 1, 2].map(
        (axis) =>
          [0, 1, 2].reduce(
            (sum, corner) => sum + table.positions[table.indices[t * 3 + corner]! * 3 + axis]!,
            0,
          ) / 3,
      ) as [number, number, number];
      const d = (c[0] - 9) ** 2 + (c[1] - 3) ** 2 + c[2] ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = t;
        middle = c;
      }
    }
    return {
      kind: 'fill' as const,
      tool: 'fill' as const,
      colour: '#2f6fb0',
      brush: { sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null },
      seed: { kind: 'picked' as const, triangle: best, point: middle },
    };
  });
}

test('a picked fill painted on one reduction fills the same surface on another', async ({
  page,
}) => {
  await convertFigure(page);
  await page.evaluate(() => window.__mt.painting.open());
  const fill = await pickedFill(page);
  const points = samplePoints([]);
  const own = await samplesAfter(page, [fill], points);
  // Painted on the base's top, every ring point.
  for (let k = 0; k < points.length; k++) expect(own[k * 4 + 3]).toBe(255);

  await convertFigure(page, OTHER_TABLE_TRIANGLES);
  const other = await samplesAfter(page, [fill], points);
  const { outliers, worst } = compare(own, other);
  test.info().annotations.push({
    type: 'replay',
    description: `seed triangle ${fill.kind === 'fill' && fill.seed.kind === 'picked' ? fill.seed.triangle : ''}: ${points.length} points, ${outliers} beyond ${REPLAY_TOLERANCE}, worst ${worst}`,
  });
  expect(outliers / points.length).toBeLessThanOrEqual(REPLAY_OUTLIERS);
});

test('the paint as a KTX2 draws as its own pixels do, near and with the mini 64 px tall', async ({
  page,
}) => {
  await convertFigure(page);
  const steps = await recorded();
  await page.evaluate((steps) => window.__mt.painting.open(null, null, null, { steps }), steps);
  for (const size of [512, 64]) {
    const check = await page.evaluate((size) => window.__mt.painting.compressedPaint(size), size);
    const beyond = check.histogram.slice(PAINT_KTX2_TOLERANCE + 1).reduce((a, b) => a + b, 0);
    const beyondMipmapped = check.mipmapped
      .slice(PAINT_KTX2_TOLERANCE + 1)
      .reduce((a, b) => a + b, 0);
    const beyondSpread = check.spread.slice(PAINT_KTX2_TOLERANCE + 1).reduce((a, b) => a + b, 0);
    const worst = check.histogram.reduce((last, count, d) => (count > 0 ? d : last), 0);
    test.info().annotations.push({
      type: 'ktx2',
      description: `${size} px: ${check.pixels} pixels, ${beyond} beyond ${PAINT_KTX2_TOLERANCE}, worst ${worst} (against mipmapped own pixels ${beyondMipmapped}, against the spread paint mipmapped ${beyondSpread}); ${check.ktx2Bytes} bytes, encoded in ${Math.round(check.encodeMs)} ms`,
    });
    expect(check.pixels).toBeGreaterThan(size * size * 0.1);
    // Near, against the paint's own pixels as the viewer draws them; with the mini 64 px tall,
    // against the same paint spread and mipmapped, uncompressed: the own pixels without mipmaps
    // alias there (10 % beyond on CI), and with plain mipmaps they show the dark rim the spread
    // takes away (3 %), so only the spread paint isolates what compressing changes (#197, journal).
    expect((size === 64 ? beyondSpread : beyond) / check.pixels).toBeLessThanOrEqual(
      PAINT_KTX2_OUTLIERS,
    );
  }
});
