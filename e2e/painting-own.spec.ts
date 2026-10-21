import { DRY_OPACITY, DRY_REFERENCE_MIN, FLAT_CAVITY, toolMask } from '../src/lib';
import {
  generateFigure,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
  generateRidgedBlock,
} from '../src/regression/shapes';
import {
  file,
  convert,
  paintNow,
  chestPath,
  alphasAt,
  ring,
  type Vec3,
  brushOver,
  expectMasked,
  brushWith,
  expectBelowFlatBare,
} from './painting-helpers';
import { expect, test } from '@playwright/test';

/**
 * The painting engine's tests with a mini of their own (helpers in `painting-helpers.ts`). They
 * use Playwright's own `test`, without the shared figure: a worker fixture is a part of what
 * Playwright groups workers by, so these never run in a worker whose figure page keeps drawing
 * beside them, which slowed them down severalfold in software rendering.
 */

test.describe.configure({ timeout: 300_000 });

test('leaves a plate’s underside bare under a brush wider than the plate is thick', async ({
  page,
}) => {
  // A 30 mm plate 2 mm thick, painted on its top at an 8 mm brush: the underside lies within the
  // dab's sphere, but not in sight of the stroke's camera.
  await convert(
    page,
    generatePlate(30, 2, 1, () => false),
    'plate.stl',
  );
  // A bare plate has no base to stand on: it is laid flat, as its file has it, and 2 mm tall it
  // would be guessed to be in inches.
  await page.evaluate(() => window.__mt.setUp('+z'));
  await page.evaluate(() => window.__mt.setSizing({ units: 'mm' }));
  expect(await page.evaluate(() => window.__mt.state.stats!.sizeMm[1])).toBeCloseTo(2, 1);
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setBrush({ sizeMm: 8, hardness: 0.8, opacity: 1 });
    view.setColour('#ff0000');
    view.setCamera(0, 80, 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const top = view.texelAt(...view.screenOf([0, 2, 0]))!;
    await view.stroke([top.point]);
    const { data } = await view.paint();
    const alphaAt = (hit: { texel: [number, number] }): number =>
      data[(hit.texel[1] * 1024 + hit.texel[0]) * 4 + 3]!;
    view.setCamera(0, -80, 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const under: number[] = [];
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++) {
        const hit = view.texelAt(...view.screenOf([i * 0.5 + 0.25, 0, j * 0.5 + 0.25]));
        if (hit && hit.point[1] < 0.1) under.push(alphaAt(hit));
      }
    return { top: [top.point[1], alphaAt(top)], under };
  });
  expect(outcome.top[0]).toBeCloseTo(2, 1);
  expect(outcome.top[1]).toBe(255);
  expect(outcome.under.length).toBe(81);
  expect(outcome.under.filter((alpha) => alpha !== 0)).toEqual([]);
});

test('leaves a surface in sight behind the dab bare beyond BRUSH_DEPTH_MM', async ({ page }) => {
  // A 10 mm plate 1 mm thick, 2 mm above a 30 mm plate (#134), painted near the small plate's
  // edge from above at an 8 mm brush: the big plate's top beside the edge is in sight and within
  // the dab's sphere, but 3 mm behind the dab along the line of sight, further than a brush reaches.
  const lower = generatePlate(30, 2, 1, () => false);
  const upper = generatePlate(10, 1, 1, () => false);
  for (let i = 2; i < upper.length; i += 3) upper[i] = upper[i]! + 4;
  const soup = new Float32Array(lower.length + upper.length);
  soup.set(lower);
  soup.set(upper, lower.length);
  await convert(page, soup, 'plates.stl');
  await page.evaluate(() => window.__mt.setUp('+z'));
  await page.evaluate(() => window.__mt.setSizing({ units: 'mm' }));
  expect(await page.evaluate(() => window.__mt.state.stats!.sizeMm[1])).toBeCloseTo(5, 1);
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setBrush({ sizeMm: 8, hardness: 0.8, opacity: 1 });
    view.setColour('#ff0000');
    view.setCamera(0, 80, 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const dab = view.texelAt(...view.screenOf([4.5, 5, 0]))!;
    await view.stroke([dab.point]);
    const { data } = await view.paint();
    const look = (x: number, y: number, z: number) => {
      const hit = view.texelAt(...view.screenOf([x, y, z]));
      if (!hit) return null;
      const distance = Math.hypot(
        hit.point[0] - dab.point[0],
        hit.point[1] - dab.point[1],
        hit.point[2] - dab.point[2],
      );
      return {
        y: hit.point[1],
        distance,
        alpha: data[(hit.texel[1] * 1024 + hit.texel[0]) * 4 + 3]!,
      };
    };
    const near: ReturnType<typeof look>[] = [];
    const behind: ReturnType<typeof look>[] = [];
    for (let i = 0; i <= 4; i++)
      for (let j = -2; j <= 2; j++) {
        near.push(look(2 + i * 0.6, 5, j * 0.5));
        behind.push(look(5.4 + i * 0.2, 2, j * 0.4));
      }
    return { dab: dab.point, near, behind };
  });
  expect(outcome.dab[1]).toBeCloseTo(5, 1);
  // The small plate's top around the dab: painted in full.
  const near = outcome.near.filter((seen) => seen !== null && Math.abs(seen.y - 5) < 0.1);
  expect(near.length).toBe(25);
  for (const seen of near) {
    expect(seen!.distance).toBeLessThan(3.2);
    expect(seen!.alpha).toBe(255);
  }
  // The big plate's top beyond the edge: within the sphere's painted part, and bare.
  const behind = outcome.behind.filter((seen) => seen !== null && Math.abs(seen.y - 2) < 0.1);
  expect(behind.length).toBe(25);
  for (const seen of behind) {
    expect(seen!.distance).toBeLessThan(3.6);
    expect(seen!.alpha).toBe(0);
  }
});

test('dry-brushes the crests of low detail under a small brush, further down with more pressure (#133)', async ({
  page,
}) => {
  // Ridges 0.06 mm high every 1.6 mm on a 0.2 mm grid: crests three or four of the detail
  // texture's steps above flat, the low detail of the issue, where an absolute threshold lays
  // nothing below about 0.87 of the pressure. A 1 mm brush across them from above, starting on a
  // crest.
  await convert(page, generateRidgedBlock(12.8, 8, 0.2, 0.06, 1.6, 0.3), 'ridges.stl');
  const along = [-3.2, -1.6, 0, 1.6, 3.2].map((x): Vec3 => [x, 8.06, 0]);
  const painted = new Map<number, Map<number, number>>();
  for (const pressure of [0.75, 0.9, 1]) {
    const brush = brushWith({ sizeMm: 1, hardness: 0.8, opacity: pressure });
    const { under, steps, reference } = await brushOver(page, {
      tool: 'dry',
      brush,
      camera: [0, 70, 1.6],
      along,
    });
    expect(steps).toBe(1);
    // The crest under the first dab: low detail, under the floor, which then scales the rule.
    expect(reference).toBeGreaterThan(0.04);
    expect(reference - FLAT_CAVITY).toBeLessThan(DRY_REFERENCE_MIN);
    const full = expectMasked(under, 'dry', brush, DRY_OPACITY, reference);
    // The crests' highest texels (the reference's own reading) are painted, nearly a full coat at
    // full pressure (the read-back's steps leave their height within 0.008 of the reference's), and
    // at three quarters, where an absolute threshold gave them nothing. Under the floor their share
    // is about a fifth here (software rendering reads the crest at about 0.05; 0.3 on the GPU at
    // 0.067): they start to take paint at about 0.6 of the pressure here.
    const crests = full.filter((texel) => texel.cavity >= reference - 0.002);
    expect(crests.length).toBeGreaterThan(50);
    for (const texel of crests)
      expect(texel.rgba[3]).toBeGreaterThan(pressure === 1 ? 0.9 * 255 * DRY_OPACITY : 0);
    if (pressure <= 0.75)
      for (const texel of crests)
        expect(toolMask('dry', texel.cavity, texel.occlusion, texel.normal, brush)).toBe(0);
    // The troughs, below flat: not a byte changed.
    expect(expectBelowFlatBare(under).length).toBeGreaterThan(50);
    painted.set(
      pressure,
      new Map(
        under.filter((texel) => texel.rgba[3] > 0).map((texel) => [texel.texel, texel.rgba[3]]),
      ),
    );
  }
  // More pressure reaches further down the ridges: more texels, each at least as painted.
  for (const [lower, higher] of [
    [0.75, 0.9],
    [0.9, 1],
  ] as const) {
    const less = painted.get(lower)!;
    const more = painted.get(higher)!;
    expect(more.size).toBeGreaterThan(less.size);
    for (const [texel, alpha] of less) expect(more.get(texel) ?? 0).toBeGreaterThanOrEqual(alpha);
  }
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('drops a finger’s stroke when a second finger arrives', async ({ page }) => {
    await convert(page, generateFigure(true));
    await page.evaluate(() => window.__mt.painting.open());
    const path = await chestPath(page);
    const box = (await page.locator('#paint-view canvas').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ x: box.x + x, y: box.y + y, id })),
      });
    // One finger across the chest: a stroke on the canvas.
    await touch('touchStart', [path[0]!]);
    for (const point of path.slice(1, 15)) await touch('touchMove', [point]);
    await page.waitForFunction(() => window.__mt.painting.view().state.painting);
    // A second finger above the first (the page's level buttons lie over the canvas's foot): the
    // person meant to pinch.
    const second: [number, number] = [path[14]![0], path[14]![1] - 80];
    await touch('touchStart', [path[14]!, second]);
    await touch('touchMove', [path[15]!, [second[0], second[1] + 20]]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => !window.__mt.painting.view().state.painting);
    expect(await page.evaluate(() => window.__mt.painting.view().state.steps)).toBe(0);
    expect((await paintNow(page)).painted).toBe(0);
  });
});

test('fills the base of a pair as a ready region, and not the figure', async ({ page }) => {
  await page.goto('/?dev&ask=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', [
    file('figure.stl', generatePuddleFigure(12)),
    file('recess-base.stl', generateRecessBase()),
  ]);
  await page.waitForFunction(
    () => window.__mt.state.stats?.pair != null && !window.__mt.state.busy,
    undefined,
    {
      timeout: 180_000,
    },
  );
  await page.evaluate(() => window.__mt.painting.open());
  const state = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setColour('#806040');
    await view.fillRegion('base');
    return view.state;
  });
  expect(state.regions).toEqual(['base', 'figure']);
  expect(state.steps).toBe(1);
  // The base's top outside the recess (4 mm up, 7–16 mm out): filled. The figure's head: bare.
  const seen = await alphasAt(page, [0, 89, 1], [...ring(10, 4, 16), ...ring(14, 4, 16)]);
  // From above, the figure's arms hide a few of the inner ring's points.
  const base = seen.filter((point) => point.y < 4.5);
  expect(base.length).toBeGreaterThan(24);
  expect(base.filter((point) => point.alpha !== 255)).toEqual([]);
  const head = await alphasAt(
    page,
    [0, 5, 1.6],
    Array.from({ length: 9 }, (_, k) => [-1 + (k % 3), 27 + Math.floor(k / 3), 6]),
  );
  expect(head.length).toBeGreaterThan(5);
  expect(head.filter((seen) => seen.alpha !== 0)).toEqual([]);
  // Undone, the base is bare; redone, the fill is found again from its seed, the same bytes.
  const replayed = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const before = (await view.paint()).data;
    await view.undo();
    const bare = (await view.paint()).data.every((value, k) => k % 4 !== 3 || value === 0);
    await view.redo();
    const after = (await view.paint()).data;
    return { bare, same: after.every((value, k) => value === before[k]) };
  });
  expect(replayed).toEqual({ bare: true, same: true });
});
