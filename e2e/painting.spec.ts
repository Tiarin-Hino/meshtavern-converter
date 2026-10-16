import { expect, test as base, type Page } from '@playwright/test';
import {
  AIR_HARDNESS,
  DEFAULT_BRUSH,
  DRY_OPACITY,
  DRY_REFERENCE_MIN,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
  FLAT_CAVITY,
  INK_FLAT,
  toolMask,
  WASH_FLAT,
  type BrushSettings,
  type ToolId,
} from '../src/lib';
import { encodeBinaryStl } from '../src/lib/dev';
import {
  generateFigure,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
  generateRidgedBlock,
} from '../src/regression/shapes';

/**
 * The painting engine (#127, design note `docs/design/painting-engine.md` §13), through the team's
 * Paint tool under ?dev: the view's methods are `window.__mt.painting.view()`'s, the paint is read
 * back as pixels and asserted on texel by texel.
 */

const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});

/** Converts `soup` on the normal path (baked, compressed) without the questions, and waits until it is shown. */
async function convert(page: Page, soup: Float32Array, name = 'figure.stl'): Promise<void> {
  await page.goto('/?dev&ask=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.setInputFiles('#file', file(name, soup));
  await page.waitForFunction(
    () => window.__mt.state.stats !== null && !window.__mt.state.busy,
    undefined,
    { timeout: 180_000 },
  );
  expect(await page.evaluate(() => window.__mt.state.baked)).not.toBeNull();
}

/**
 * The generated figure on its base, converted once per worker and shared by the tests that paint
 * it: each conversion bakes and compresses in software rendering, and thirteen of them loaded the
 * CI runner enough to time out a test of another file running beside them. Each test gets the
 * page with the view closed and its tool, brush, colour, camera and navigation as a new view has
 * them.
 */
const test = base.extend<{ figurePage: Page }, { figure: Page }>({
  figure: [
    async ({ browser }, use, workerInfo) => {
      const { baseURL, viewport } = workerInfo.project.use;
      const page = await browser.newPage({ baseURL, viewport });
      await convert(page, generateFigure(true));
      await use(page);
      await page.close();
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  figurePage: async ({ figure }, use) => {
    await figure.evaluate(async () => {
      const painting = window.__mt.painting;
      await painting.open();
      const view = painting.view();
      view.setTool('flat');
      view.setBrush({ sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null });
      view.setColour('#b03030');
      view.setNavigating(false);
      view.setCamera(34, 22, 1);
      painting.close();
    });
    await use(figure);
  },
});

test.describe.configure({ timeout: 300_000 });

// The tests with a mini of their own come first: once the shared figure's page exists, it keeps
// drawing beside them and slows them down severalfold in software rendering.

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

test('gives back the paint it was opened with, byte for byte', async ({ figurePage: page }) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    const given = painting.testPaint('x+');
    await painting.open('x+');
    const back = await painting.view().paint();
    let differing = 0;
    for (let k = 0; k < given.data.length; k++) if (given.data[k] !== back.data[k]) differing++;
    let painted = 0;
    for (let k = 3; k < given.data.length; k += 4) if (given.data[k] === 255) painted++;
    return { size: [back.width, back.height], differing, painted, state: painting.view().state };
  });
  expect(outcome.size).toEqual([1024, 1024]);
  expect(outcome.painted).toBeGreaterThan(10_000);
  expect(outcome.differing).toBe(0);
  expect(outcome.state.open).toBe(true);
  expect(outcome.state.steps).toBe(0);
});

test('stays closed when closed while it opens, and the later of two opens wins', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // Holds every GPU read-back: three.js polls `clientWaitSync` until the fence is passed. While
    // held, the call says the time ran out; `waiting` tells that an open has reached its read-back.
    const gl = WebGL2RenderingContext.prototype;
    const clientWaitSync = gl.clientWaitSync;
    const hold = { on: false, waiting: false };
    gl.clientWaitSync = function (this: WebGL2RenderingContext, ...args) {
      if (!hold.on) return clientWaitSync.apply(this, args);
      hold.waiting = true;
      return this.TIMEOUT_EXPIRED;
    };
    const atReadBack = async (): Promise<void> => {
      while (!hold.waiting) await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const release = (): void => {
      hold.on = false;
      hold.waiting = false;
    };
    // Closed while the atlas is read back: the open resolves and installs nothing.
    hold.on = true;
    const closing = painting.open('x+');
    await atReadBack();
    painting.close();
    release();
    await closing;
    await frame();
    await frame();
    const closed = { table: painting.table() !== null, open: window.__mt.state.painting?.open };
    // A second open while the first is read back (the page's tool closes the view, then opens): the
    // second's paint, bare, is the one open.
    hold.on = true;
    const first = painting.open('x+');
    await atReadBack();
    const second = painting.open();
    release();
    await Promise.all([first, second]);
    gl.clientWaitSync = clientWaitSync;
    const { data } = await painting.view().paint();
    let painted = 0;
    for (let k = 3; k < data.length; k += 4) if (data[k] !== 0) painted++;
    return { closed, open: painting.view().state.open, painted };
  });
  expect(outcome.closed).toEqual({ table: false, open: false });
  expect(outcome.open).toBe(true);
  expect(outcome.painted).toBe(0);
});

/** What a grid of canvas points sees: the texel under each, its paint's alpha and red, and its distance to the nearest dab. */
interface Seen {
  alpha: number;
  red: number;
  distance: number;
}

/** Paints a stroke of `points` (canvas points, cast onto the surface) and reads the paint back under a grid of canvas points. */
async function strokeAndLook(
  page: Page,
  options: {
    camera: [number, number, number];
    along: [number, number, number][];
    sizeMm: number;
    /** The brush, or the eraser on the paint the view is open with. */
    tool?: 'flat' | 'eraser';
    lookFrom?: [number, number, number];
    grid: { from: [number, number, number]; to: [number, number, number]; steps: number };
  },
): Promise<Seen[]> {
  return page.evaluate(async ({ camera, along, sizeMm, tool = 'flat', lookFrom, grid }) => {
    const painting = window.__mt.painting;
    if (tool === 'flat') await painting.open();
    const view = painting.view();
    view.setTool(tool);
    view.setBrush({ sizeMm, hardness: 0.8, opacity: 1 });
    view.setColour('#ff0000');
    view.setCamera(...camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // The stroke's points on the surface: what is under each of them on the canvas.
    const points = along.flatMap((point) => {
      const hit = view.texelAt(...view.screenOf(point));
      return hit ? [hit.point] : [];
    });
    await view.stroke(points);
    const dabs =
      view.history()[0]!.kind === 'stroke' ? (view.history()[0] as { dabs: number[] }).dabs : [];
    const { data } = await view.paint();
    if (lookFrom) view.setCamera(...lookFrom);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const seen: { alpha: number; red: number; distance: number }[] = [];
    for (let i = 0; i <= grid.steps; i++)
      for (let j = 0; j <= grid.steps; j++) {
        const at = [0, 1, 2].map(
          (k) => grid.from[k]! + ((grid.to[k]! - grid.from[k]!) * i) / grid.steps,
        ) as [number, number, number];
        at[1] = grid.from[1] + ((grid.to[1] - grid.from[1]) * j) / grid.steps;
        const hit = view.texelAt(...view.screenOf(at));
        if (!hit) continue;
        const [tx, ty] = hit.texel;
        let distance = Infinity;
        for (let k = 0; k < dabs.length; k += 4)
          distance = Math.min(
            distance,
            Math.hypot(
              hit.point[0] - dabs[k]!,
              hit.point[1] - dabs[k + 1]!,
              hit.point[2] - dabs[k + 2]!,
            ),
          );
        const texel = (ty * 1024 + tx) * 4;
        seen.push({ alpha: data[texel + 3]!, red: data[texel]!, distance });
      }
    return seen;
  }, options);
}

/** A stroke across the figure's chest, 14 mm up, its front 4 mm out in +z, at a 2 mm brush. */
const strokeAndLookWith = (page: Page, tool: 'flat' | 'eraser'): Promise<Seen[]> =>
  strokeAndLook(page, {
    camera: [0, 5, 1.6],
    along: [-2, -1, 0, 1, 2].map((x) => [x, 14, 6]),
    sizeMm: 2,
    tool,
    grid: { from: [-3.5, 11.5, 6], to: [3.5, 16.5, 6], steps: 24 },
  });

test('paints a stroke where its dabs are and leaves the far side bare', async ({
  figurePage: page,
}) => {
  const front = await strokeAndLookWith(page, 'flat');
  const near = front.filter((seen) => seen.distance < 0.7);
  const far = front.filter((seen) => seen.distance > 1.15);
  expect(near.length).toBeGreaterThan(20);
  expect(far.length).toBeGreaterThan(100);
  for (const seen of near) expect([seen.alpha, seen.red]).toEqual([255, 255]);
  for (const seen of far) expect(seen.alpha).toBe(0);

  // From behind: the figure's back, under the same canvas grid, is bare.
  const back = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const { data } = await view.paint();
    view.setCamera(180, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const alphas: number[] = [];
    for (let y = 0; y <= 20; y++)
      for (let x = 0; x <= 20; x++) {
        const at = view.screenOf([-3 + (6 * x) / 20, 11 + (6 * y) / 20, -6]);
        const hit = view.texelAt(...at);
        if (!hit || hit.point[2] > -1) continue;
        alphas.push(data[(hit.texel[1] * 1024 + hit.texel[0]) * 4 + 3]!);
      }
    return alphas;
  });
  expect(back.length).toBeGreaterThan(100);
  expect(back.filter((alpha) => alpha !== 0)).toEqual([]);
});

test('paints both sides of a seam and the gutter beside each', async ({ figurePage: page }) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const table = painting.table()!;
    const { positions, indices } = table;
    const uvs = table.uvs!;
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Edges two triangles share by their corners' positions, with other texture coordinates on
    // each side: where the unwrap cut. One on the chest, facing the camera.
    const key = (v: number): string =>
      `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    const edges = new Map<string, [number, number, number][]>();
    for (let t = 0; t < indices.length / 3; t++)
      for (let c = 0; c < 3; c++) {
        const a = indices[t * 3 + c]!;
        const b = indices[t * 3 + ((c + 1) % 3)]!;
        const id = [key(a), key(b)].sort().join('|');
        const list = edges.get(id) ?? [];
        list.push([t, a, b]);
        edges.set(id, list);
      }
    const uv = (v: number): [number, number] => [uvs[v * 2]!, uvs[v * 2 + 1]!];
    for (const sides of edges.values()) {
      if (sides.length !== 2) continue;
      const [[t1, a1, b1], [t2, a2, b2]] = sides as [
        [number, number, number],
        [number, number, number],
      ];
      const same = (p: number, q: number): boolean => key(p) === key(q);
      const a2Matching = same(a1, a2) ? a2 : b2;
      if (uv(a1)[0] === uv(a2Matching)[0] && uv(a1)[1] === uv(a2Matching)[1]) continue;
      const middle: [number, number, number] = [0, 1, 2].map(
        (k) => (positions[a1 * 3 + k]! + positions[b1 * 3 + k]!) / 2,
      ) as [number, number, number];
      if (middle[1] < 11 || middle[1] > 17 || middle[2] < 2.5 || Math.abs(middle[0]) > 2.5)
        continue;
      const hit = view.texelAt(...view.screenOf(middle));
      if (!hit) continue;
      const seen = Math.hypot(
        hit.point[0] - middle[0],
        hit.point[1] - middle[1],
        hit.point[2] - middle[2],
      );
      if (seen > 0.05) continue;
      view.setBrush({ sizeMm: 3, hardness: 0.8, opacity: 1 });
      view.setColour('#ff0000');
      await view.stroke([middle]);
      const { data } = await view.paint();
      // On each side: from the edge's middle in texture space, half a texel and a texel outward.
      const alphas: number[] = [];
      for (const [t, a, b] of [
        [t1, a1, b1],
        [t2, a2, b2],
      ] as [number, number, number][]) {
        const third = [0, 1, 2].map((c) => indices[t * 3 + c]!).find((v) => v !== a && v !== b)!;
        const [ua, va] = uv(a);
        const [ub, vb] = uv(b);
        const [uc, vc] = uv(third);
        const [mu, mv] = [(ua + ub) / 2, (va + vb) / 2];
        let [nu, nv] = [-(vb - va), ub - ua];
        const length = Math.hypot(nu, nv);
        [nu, nv] = [nu / length, nv / length];
        // Outward: away from the triangle's third corner.
        if (nu * (uc - mu) + nv * (vc - mv) > 0) [nu, nv] = [-nu, -nv];
        for (const out of [0.5, 1, 1.5, 2]) {
          const x = Math.floor(mu * 1024 + nu * out);
          const y = Math.floor(mv * 1024 + nv * out);
          alphas.push(data[(y * 1024 + x) * 4 + 3]!);
        }
      }
      return { found: true, alphas, resolution: window.__mt.state.baked!.resolution };
    }
    return { found: false, alphas: [], resolution: window.__mt.state.baked!.resolution };
  });
  expect(outcome.found).toBe(true);
  expect(outcome.alphas).toEqual(Array(8).fill(255));
});

/** How many bytes two paints differ in, and how many texels each has painted. */
async function paintNow(page: Page): Promise<{ painted: number; hash: number }> {
  return page.evaluate(async () => {
    const { data } = await window.__mt.painting.view().paint();
    let painted = 0;
    let hash = 0;
    for (let k = 0; k < data.length; k++) {
      hash = (Math.imul(hash, 31) + data[k]!) | 0;
      if (k % 4 === 3 && data[k]! > 0) painted++;
    }
    return { painted, hash };
  });
}

/** A path across the figure's chest on the canvas, from the front. */
async function chestPath(page: Page): Promise<[number, number][]> {
  return page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return Array.from({ length: 30 }, (_, k) =>
      view.screenOf([-3 + (6 * k) / 29, 14 + Math.sin(k / 4), 6]),
    );
  });
}

test('paints the same texels from a canvas path as from its points on the surface', async ({
  figurePage: page,
}) => {
  await page.evaluate(() => window.__mt.painting.open());
  const path = await chestPath(page);
  await page.evaluate(async (path) => {
    const view = window.__mt.painting.view();
    view.setBrush({ sizeMm: 1.5 });
    await view.strokeAt(path);
  }, path);
  const fromPath = await paintNow(page);
  const state = await page.evaluate(() => window.__mt.painting.view().state);
  expect(state.steps).toBe(1);
  expect(state.perf.frames).toBeGreaterThanOrEqual(path.length);
  // The same stroke from the points on the surface under the path.
  await page.evaluate(() => window.__mt.painting.open());
  await page.evaluate(async (path) => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    view.setBrush({ sizeMm: 1.5 });
    const points = path.flatMap(([x, y]) => {
      const hit = view.texelAt(x, y);
      return hit ? [hit.point] : [];
    });
    await view.stroke(points);
  }, path);
  const fromPoints = await paintNow(page);
  expect(fromPath.painted).toBeGreaterThan(1000);
  expect(fromPoints).toEqual(fromPath);
});

test('paints with the left button, orbits with the right', async ({ figurePage: page }) => {
  await page.evaluate(() => window.__mt.painting.open());
  const path = await chestPath(page);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  // The left button: a stroke, one step.
  await page.mouse.move(box.x + path[0]![0], box.y + path[0]![1]);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__mt.painting.view().state.steps === 1);
  expect((await paintNow(page)).painted).toBeGreaterThan(1000);
  // The right button turns the mini: the canvas's middle shows another triangle, nothing painted.
  const middle: [number, number] = [box.width / 2, box.height / 2];
  const before = await page.evaluate(
    (at) => window.__mt.painting.view().texelAt(...at)?.triangle,
    middle,
  );
  await page.mouse.move(box.x + middle[0], box.y + middle[1]);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + middle[0] + 150, box.y + middle[1], { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const after = await page.evaluate(
    (at) => window.__mt.painting.view().texelAt(...at)?.triangle,
    middle,
  );
  expect(before).toBeDefined();
  expect(after).not.toBe(before);
  expect(await page.evaluate(() => window.__mt.painting.view().state.steps)).toBe(1);
});

test('draws the brush’s ring under the pointer, and turns the mini instead while navigating', async ({
  figurePage: page,
}) => {
  await page.evaluate(() => window.__mt.painting.open());
  const path = await chestPath(page);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  const cursor = page.locator('#paint-view .mt-painting-cursor');
  // Over the chest: a ring as wide as a 4 mm brush there.
  await page.evaluate(() => window.__mt.painting.view().setBrush({ sizeMm: 4 }));
  await page.mouse.move(box.x + path[15]![0], box.y + path[15]![1]);
  await expect(cursor).toBeVisible();
  const ring = (await cursor.boundingBox())!;
  const span = await page.evaluate(() => {
    const view = window.__mt.painting.view();
    const [ax] = view.screenOf([-2, 14, 4]);
    const [bx] = view.screenOf([2, 14, 4]);
    return bx - ax;
  });
  expect(ring.width).toBeGreaterThan(span * 0.8);
  expect(ring.width).toBeLessThan(span * 1.25);
  // Off the mini: no ring.
  await page.mouse.move(box.x + 5, box.y + 5);
  await expect(cursor).toBeHidden();
  // Navigating, the left button turns the mini and paints nothing.
  await page.evaluate(() => window.__mt.painting.view().setNavigating(true));
  const middle: [number, number] = [box.width / 2, box.height / 2];
  const before = await page.evaluate(
    (at) => window.__mt.painting.view().texelAt(...at)?.triangle,
    middle,
  );
  await page.mouse.move(box.x + path[0]![0], box.y + path[0]![1]);
  await page.mouse.down();
  await page.mouse.move(box.x + path[0]![0] + 150, box.y + path[0]![1], { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => window.__mt.painting.view().state);
  expect(state.navigating).toBe(true);
  expect(state.steps).toBe(0);
  expect(
    await page.evaluate((at) => window.__mt.painting.view().texelAt(...at)?.triangle, middle),
  ).not.toBe(before);
});

test('undoes and redoes strokes to the same bytes, back to the paint as opened', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    const opened = painting.testPaint('x-');
    await painting.open('x-');
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const at = (x: number, y: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, y, 6]))!.point;
    const hash = async (): Promise<number> => {
      const { data } = await view.paint();
      let h = 0;
      for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
      return h;
    };
    const same = async (expected: Uint8Array): Promise<boolean> => {
      const { data } = await view.paint();
      return data.every((value, k) => value === expected[k]);
    };
    for (const [colour, y] of [
      ['#ff0000', 12],
      ['#00ff00', 14],
      ['#0000ff', 16],
    ] as const) {
      view.setColour(colour);
      await view.stroke([at(-3, y), at(0, y + 1), at(3, y)]);
    }
    const three = await hash();
    await view.undo();
    const two = await hash();
    await view.redo();
    const redone = await hash();
    const counts = [view.state.steps, view.state.undone];
    for (let k = 0; k < 3; k++) await view.undo();
    const backToOpened = await same(opened.data);
    await view.undo();
    const stillOpened = await same(opened.data);
    const afterFourth = [view.state.steps, view.state.undone];
    // A stroke after an undo drops what could have been redone.
    await view.redo();
    await view.redo();
    await view.undo();
    await view.stroke([at(-1, 13), at(1, 13)]);
    return {
      three,
      two,
      redone,
      counts,
      backToOpened,
      stillOpened,
      afterFourth,
      end: [view.state.steps, view.state.undone],
    };
  });
  expect(outcome.two).not.toBe(outcome.three);
  expect(outcome.redone).toBe(outcome.three);
  expect(outcome.counts).toEqual([3, 0]);
  expect(outcome.backToOpened).toBe(true);
  expect(outcome.stillOpened).toBe(true);
  expect(outcome.afterFourth).toEqual([0, 3]);
  expect(outcome.end).toEqual([2, 0]);
});

test('keeps at least UNDO_STEPS strokes to undo', async ({ figurePage: page }) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const point = view.texelAt(...view.screenOf([0, 14, 6]))!.point;
    view.setBrush({ sizeMm: 1 });
    // 55 strokes and 10 more: past the oldest keyframe's drop (design note §8).
    for (let k = 0; k < 65; k++) {
      view.setColour(`#${(k * 3).toString(16).padStart(2, '0')}0000`);
      await view.stroke([point]);
    }
    let undone = 0;
    for (let k = 0; k < 70; k++) {
      const before = view.state.steps;
      await view.undo();
      if (view.state.steps === before) break;
      undone++;
    }
    return { undone, history: view.history().length };
  });
  expect(outcome.undone).toBeGreaterThanOrEqual(50);
  expect(outcome.undone).toBeLessThan(65);
  expect(outcome.history).toBe(65 - outcome.undone);
});

/** The paint's alpha under canvas points of `points` (on the mini, from the camera given), and the points hit. */
async function alphasAt(
  page: Page,
  camera: [number, number, number],
  points: [number, number, number][],
): Promise<{ alpha: number; y: number }[]> {
  return page.evaluate(
    async ({ camera, points }) => {
      const view = window.__mt.painting.view();
      const { data } = await view.paint();
      view.setCamera(...camera);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return points.flatMap((point) => {
        const hit = view.texelAt(...view.screenOf(point));
        if (!hit) return [];
        const [x, y] = hit.texel;
        return [{ alpha: data[(y * 1024 + x) * 4 + 3]!, y: hit.point[1] }];
      });
    },
    { camera, points },
  );
}

/** Points on a ring around the vertical axis at height `y`, `r` out. */
const ring = (r: number, y: number, count = 24): [number, number, number][] =>
  Array.from({ length: count }, (_, k) => [
    r * Math.cos((2 * Math.PI * k) / count),
    y,
    r * Math.sin((2 * Math.PI * k) / count),
  ]);

test('fills the figure from a tap with the fill tool, and not its base', async ({
  figurePage: page,
}) => {
  await page.evaluate(() => window.__mt.painting.open());
  const path = await chestPath(page);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  await page.evaluate(() => {
    const view = window.__mt.painting.view();
    view.setTool('fill');
    view.setColour('#3060ff');
  });
  await page.mouse.click(box.x + path[15]![0], box.y + path[15]![1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.steps === 1);
  const history = await page.evaluate(() => window.__mt.painting.view().history());
  expect(history).toHaveLength(1);
  expect(history[0]!.kind).toBe('fill');
  // The chest, from the front: filled. The disc's top around the feet, from above: bare.
  const chest = await alphasAt(
    page,
    [0, 5, 1.6],
    Array.from({ length: 25 }, (_, k) => [-2 + (k % 5), 11 + Math.floor(k / 5), 6]),
  );
  expect(chest.length).toBeGreaterThan(20);
  expect(chest.filter((seen) => seen.alpha !== 255)).toEqual([]);
  const disc = await alphasAt(page, [0, 70, 1], [...ring(8, 3, 16), ...ring(11, 3, 16)]);
  expect(disc.length).toBe(32);
  expect(disc.filter((seen) => seen.alpha !== 0)).toEqual([]);
});

test('erases back to bare where the eraser goes, and only there', async ({ figurePage: page }) => {
  await page.evaluate(() => window.__mt.painting.open('all'));
  const front = await strokeAndLookWith(page, 'eraser');
  const near = front.filter((seen) => seen.distance < 0.7);
  const far = front.filter((seen) => seen.distance > 1.15);
  expect(near.length).toBeGreaterThan(20);
  expect(far.length).toBeGreaterThan(100);
  expect(near.filter((seen) => seen.alpha !== 0)).toEqual([]);
  expect(far.filter((seen) => seen.alpha !== 255)).toEqual([]);
  expect(await page.evaluate(() => window.__mt.painting.view().state.steps)).toBe(1);
});
// The lift (#137, design note `docs/design/lift-eraser.md`): an eraser stroke that takes away the
// step it starts on, wherever that step is the top layer, and shows the paint beneath it.

/** What a lift test reads: the paint's bytes compared with earlier paints, texel by texel. */
interface Compared {
  /** Texels equal to the first paint, not to the second. */
  first: number;
  /** Texels equal to the second paint, not to the first. */
  second: number;
  /** Texels equal to neither. */
  neither: number;
}

test('lifts the stroke it starts on back to the bytes before it, and leaves the rest alone', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const at = (x: number, y: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, y, 6]))!.point;
    const read = async (): Promise<Uint8Array> => (await view.paint()).data;
    const same = (a: Uint8Array, b: Uint8Array): boolean => a.every((value, k) => value === b[k]);
    const compare = (now: Uint8Array, first: Uint8Array, second: Uint8Array): Compared => {
      const counts = { first: 0, second: 0, neither: 0 };
      for (let texel = 0; texel < now.length; texel += 4) {
        const is = (paint: Uint8Array): boolean =>
          [0, 1, 2, 3].every((k) => now[texel + k] === paint[texel + k]);
        const isFirst = is(first);
        const isSecond = is(second);
        if (isFirst && !isSecond) counts.first++;
        else if (isSecond && !isFirst) counts.second++;
        else if (!isFirst && !isSecond) counts.neither++;
      }
      return counts;
    };

    // A red stroke across the chest at 14 mm, a blue one down across it.
    view.setColour('#ff0000');
    view.setBrush({ sizeMm: 3 });
    await view.stroke([at(-3, 13), at(0, 13), at(3, 13)]);
    const afterFirst = await read();
    view.setColour('#0000ff');
    view.setBrush({ sizeMm: 1.5 });
    await view.stroke([at(0, 10.5), at(0, 13), at(0, 15.5)]);
    const afterSecond = await read();
    const changedBySecond = compare(afterSecond, afterFirst, afterFirst).neither;

    // A lift wider than the blue stroke, started on its end above the red one, along it.
    view.setTool('lift');
    view.setBrush({ sizeMm: 5, hardness: 1 });
    await view.stroke([at(0, 15.5), at(0, 13), at(0, 10.5)]);
    const lifted = await read();
    const wide = {
      backToFirst: same(lifted, afterFirst),
      lift: view.state.lift,
      steps: view.state.steps,
      lifts: (view.history()[2] as { lifts?: number }).lifts,
    };

    // Undo puts the blue stroke back; redo takes it away again, to the same bytes.
    await view.undo();
    const undone = same(await read(), afterSecond);
    await view.redo();
    const redone = same(await read(), lifted);

    // A stroke after the lift, undone: the lift is replayed from the paint before the blue stroke.
    view.setTool('flat');
    view.setColour('#00ff00');
    await view.stroke([at(-3, 16), at(3, 16)]);
    await view.undo();
    const replayed = same(await read(), lifted);

    // Started again where the two crossed, the next lift takes the layer beneath: the red stroke.
    view.setTool('lift');
    view.setBrush({ sizeMm: 1.5, hardness: 1 });
    await view.stroke([at(0, 13), at(0.5, 13)]);
    const peeled = {
      lift: view.state.lift,
      compared: compare(await read(), afterFirst, afterFirst),
    };
    const centre = view.texelAt(...view.screenOf([0, 13, 6]))!.texel;
    const centreAlpha = (await read())[(centre[1] * 1024 + centre[0]) * 4 + 3];

    // A narrow lift inside a wide blue stroke over the red one: inside it the red comes back,
    // outside the blue stays.
    await painting.open();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    view.setTool('flat');
    view.setColour('#ff0000');
    view.setBrush({ sizeMm: 3, hardness: 0.8 });
    await view.stroke([at(-3, 13), at(3, 13)]);
    const red = await read();
    view.setColour('#0000ff');
    view.setBrush({ sizeMm: 5 });
    await view.stroke([at(-3, 13), at(3, 13)]);
    const blue = await read();
    view.setTool('lift');
    view.setBrush({ sizeMm: 1.5, hardness: 1 });
    await view.stroke([at(-0.5, 13), at(0.5, 13)]);
    const narrow = compare(await read(), red, blue);
    return {
      changedBySecond,
      wide,
      undone,
      redone,
      replayed,
      peeled,
      centreAlpha,
      narrow,
      steps: view.state.steps,
    };
  });
  expect(outcome.changedBySecond).toBeGreaterThan(100);
  expect(outcome.wide).toEqual({
    backToFirst: true,
    lift: { lifted: 1 },
    steps: 3,
    lifts: 1,
  });
  expect(outcome.undone).toBe(true);
  expect(outcome.redone).toBe(true);
  expect(outcome.replayed).toBe(true);
  expect(outcome.peeled.lift).toEqual({ lifted: 0 });
  expect(outcome.peeled.compared.neither).toBeGreaterThan(20);
  expect(outcome.centreAlpha).toBe(0);
  expect(outcome.narrow.first).toBeGreaterThan(20);
  expect(outcome.narrow.second).toBeGreaterThan(outcome.narrow.first);
  // Lifted part way only at the dab's edge: its hardness is at most 0.999, a band a few
  // thousandths of a mm wide (2 of 862 texels in the Linux container).
  expect(outcome.narrow.neither).toBeLessThanOrEqual(outcome.narrow.first / 100);
  expect(outcome.steps).toBe(3);
});

test('lifts nothing where nothing was painted, or too long ago, and says why', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    const view = () => painting.view();
    const hash = async (): Promise<number> => {
      const { data } = await view().paint();
      let h = 0;
      for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
      return h;
    };
    const look = async (): Promise<void> => {
      view().setCamera(0, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const at = (x: number, y: number): [number, number, number] =>
      view().texelAt(...view().screenOf([x, y, 6]))!.point;
    const liftAt = async (x: number, y: number) => {
      view().setTool('lift');
      const before = await hash();
      await view().stroke([at(x, y), at(x + 1, y)]);
      return {
        lift: view().state.lift,
        steps: view().state.steps,
        same: (await hash()) === before,
      };
    };

    await painting.open();
    await look();
    const bare = await liftAt(0, 14);

    await painting.open('all');
    await look();
    const opened = await liftAt(0, 14);

    // One stroke at 11 mm, then enough elsewhere that undo no longer reaches it.
    await painting.open();
    await look();
    view().setTool('flat');
    view().setBrush({ sizeMm: 1 });
    await view().stroke([at(-2, 11)]);
    const elsewhere = at(2, 17);
    // Two colours in turn: a stroke that leaves the bytes as they were changes no texel.
    for (let k = 0; k < 60; k++) {
      view().setColour(k % 2 ? '#00ff00' : '#0000ff');
      await view().stroke([elsewhere]);
    }
    const old = await liftAt(-2, 11);
    // The newest stroke still lifts.
    const recent = await liftAt(2, 17);
    return { bare, opened, old, recent };
  });
  expect(outcome.bare).toEqual({
    lift: { refused: 'nothing-painted' },
    steps: 0,
    same: true,
  });
  expect(outcome.opened).toEqual({
    lift: { refused: 'nothing-painted' },
    steps: 0,
    same: true,
  });
  expect(outcome.old).toEqual({
    lift: { refused: 'too-long-ago' },
    steps: 61,
    same: true,
  });
  expect(outcome.recent.lift).toEqual({ lifted: 60 });
  expect(outcome.recent.steps).toBe(62);
  expect(outcome.recent.same).toBe(false);
});

test('lifts a stroke painted from the canvas with a stroke from the canvas', async ({
  figurePage: page,
}) => {
  await page.evaluate(() => window.__mt.painting.open());
  const path = await chestPath(page);
  const outcome = await page.evaluate(async (path) => {
    const view = window.__mt.painting.view();
    view.setBrush({ sizeMm: 1.5 });
    await view.strokeAt(path);
    view.setTool('lift');
    view.setBrush({ sizeMm: 4, hardness: 1 });
    await view.strokeAt(path);
    const { data } = await view.paint();
    let painted = 0;
    for (let k = 3; k < data.length; k += 4) if (data[k]! > 0) painted++;
    return { painted, state: view.state };
  }, path);
  expect(outcome.state.lift).toEqual({ lifted: 0 });
  expect(outcome.state.steps).toBe(2);
  expect(outcome.state.perf.frames).toBeGreaterThanOrEqual(path.length);
  expect(outcome.painted).toBe(0);
});

// The hobby brushes (#128, design note §6 and §13 step 11). Where a stroke lands is #127's and
// tested above; what a brush adds is its mask. So each test paints its stroke twice on the bare
// figure: with the flat brush at full opacity (what the stroke reaches, texel by texel: `reach`),
// then with the brush under test, and reads back what the masks read at every texel
// (`view.surface()`). A texel then holds `reach × opacity × toolMask(...)`.

type Vec3 = [number, number, number];

/** A texel near a stroke: what the masks read there, how much the flat brush's stroke reached it, and the brush's paint. */
interface Under {
  texel: number;
  cavity: number;
  occlusion: number;
  normal: Vec3;
  /** The flat brush's alpha there, 0–255: the stroke's coverage, in sight and facing. */
  reach: number;
  rgba: [number, number, number, number];
}

/**
 * Opens the converted mini bare and paints with `tool` along the canvas points of `along` (points
 * of the mini, projected from `camera`), by the surface points under a canvas path through them,
 * `passes` times. First the same stroke with the flat brush at full opacity and `reachHardness`
 * (the reach), undone before the brush paints. Gives every texel the reach covered, and every
 * texel the brush changed, and the stroke's reference as the engine measures it (#133): the
 * highest cavity under its first dab, the texels a one-dab flat stroke there covers (undone too).
 */
async function brushOver(
  page: Page,
  options: {
    tool: ToolId;
    brush: Partial<BrushSettings>;
    reachHardness?: number;
    camera: Vec3;
    along: Vec3[];
    passes?: number;
  },
): Promise<{ under: Under[]; steps: number; reference: number }> {
  return page.evaluate(async ({ tool, brush, reachHardness, camera, along, passes = 1 }) => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setColour('#203040');
    view.setCamera(...camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const anchors = along.map((point) => view.screenOf(point));
    // A canvas point every 3 px through the anchors, and the surface under each.
    const points: Vec3[] = [];
    for (let k = 1; k < anchors.length; k++) {
      const [ax, ay] = anchors[k - 1]!;
      const [bx, by] = anchors[k]!;
      const n = k === anchors.length - 1 ? 1 : 0;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
      for (let i = 0; i < steps + n; i++) {
        const hit = view.texelAt(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
        if (hit) points.push(hit.point);
      }
    }
    // The reach and the first dab's footprint, undone; then the brush.
    view.setTool('flat');
    view.setBrush({ ...brush, opacity: 1, hardness: reachHardness ?? brush.hardness });
    await view.stroke(points);
    const reach = await view.paint();
    await view.undo();
    await view.stroke(points.slice(0, 1));
    const firstDab = await view.paint();
    await view.undo();
    view.setTool(tool);
    view.setBrush(brush);
    for (let pass = 0; pass < passes; pass++) await view.stroke(points);
    const painted = await view.paint();
    const surface = await view.surface();
    // The highest cavity under the first dab, as the reference is encoded: −1 where none is covered.
    let reference = -1;
    for (let texel = 0; texel < 1024 * 1024; texel++)
      if (firstDab.data[texel * 4 + 3]! > 0)
        reference = Math.max(reference, surface.cavity[texel]!);
    const under: Under[] = [];
    for (let texel = 0; texel < 1024 * 1024; texel++) {
      const k = texel * 4;
      if (reach.data[k + 3] === 0 && painted.data[k + 3] === 0) continue;
      under.push({
        texel,
        cavity: surface.cavity[texel]!,
        occlusion: surface.occlusion[texel]!,
        normal: [0, 1, 2].map((axis) => surface.normal[texel * 3 + axis]!) as Vec3,
        reach: reach.data[k + 3]!,
        rgba: [0, 1, 2, 3].map((c) => painted.data[k + c]!) as Under['rgba'],
      });
    }
    return { under, steps: view.state.steps, reference };
  }, options);
}

/** Down the figure's front from its chest, over the disc's top and its rim: creases, crests, flat and an edge. */
const DOWN_THE_FRONT: Vec3[] = [
  ...[18, 16, 14, 12, 10, 8].map((y): Vec3 => [0.5, y, 6]),
  ...[5.5, 7, 8.5, 10, 11.5].map((z): Vec3 => [0.5, 3, z]),
  [0.5, 2.2, 12.6],
];
const FROM_THE_FRONT: Vec3 = [0, 20, 1];

/**
 * Every texel the stroke reached took the tool's mask: its alpha is `reach × opacity × toolMask`
 * of what the masks read there (and the stroke's reference, for the dry brush), within the
 * rounding of the reach, the read-back and the paint; a texel it did not reach is bare. Gives the
 * texels it reached fully.
 */
function expectMasked(
  under: Under[],
  tool: ToolId,
  brush: BrushSettings,
  opacity: number,
  reference?: number,
): Under[] {
  for (const texel of under) {
    const masks = [-1, 0, 1].flatMap((dc) =>
      [-1, 0, 1].map((doc) =>
        toolMask(
          tool,
          texel.cavity + dc / 127,
          texel.occlusion + doc / 255,
          texel.normal,
          brush,
          reference,
        ),
      ),
    );
    const low = Math.max(0, texel.reach - 0.5) * opacity * Math.min(...masks) - 1.5;
    const high = Math.min(255, texel.reach + 0.5) * opacity * Math.max(...masks) + 1.5;
    const alpha = texel.rgba[3];
    if (alpha < low || alpha > high)
      throw new Error(
        `${tool}: texel ${texel.texel} (reach ${texel.reach}, cavity ${texel.cavity.toFixed(3)}, occlusion ${texel.occlusion.toFixed(3)}) has alpha ${alpha}, expected ${low.toFixed(1)}–${high.toFixed(1)}`,
      );
  }
  const full = under.filter((texel) => texel.reach === 255);
  expect(full.length).toBeGreaterThan(1000);
  return full;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const alphas = (texels: Under[]): number[] => texels.map((texel) => texel.rgba[3]);
const brushWith = (changes: Partial<BrushSettings>): BrushSettings => ({
  ...DEFAULT_BRUSH,
  ...changes,
});

test('washes into the creases, faintly and evenly over flat, and nearly not on an edge', async ({
  figurePage: page,
}) => {
  const brush = brushWith({ sizeMm: 3, hardness: 0.8, opacity: 1 });
  const { under, steps } = await brushOver(page, {
    tool: 'wash',
    brush,
    camera: FROM_THE_FRONT,
    along: DOWN_THE_FRONT,
  });
  expect(steps).toBe(1);
  const full = expectMasked(under, 'wash', brush, 1);
  // The edge: the disc's rim, raised and open, keeps within a tenth of a full coat.
  const edge = full.filter((texel) => texel.cavity > 0.6 && texel.occlusion > 0.9);
  const crease = full.filter((texel) => texel.cavity < -0.3);
  const flat = full.filter((texel) => Math.abs(texel.cavity) < 0.01 && texel.occlusion > 0.95);
  expect(edge.length).toBeGreaterThan(10);
  expect(crease.length).toBeGreaterThan(10);
  expect(flat.length).toBeGreaterThan(20);
  expect(Math.max(...alphas(edge))).toBeLessThanOrEqual(Math.round(0.1 * 255));
  // The creases: darker than any edge, and than the flat tint.
  expect(Math.min(...alphas(crease))).toBeGreaterThan(Math.max(...alphas(edge)));
  expect(mean(alphas(crease))).toBeGreaterThan(2 * mean(alphas(flat)));
  // The flat, open disc: a faint tint, even: WASH_FLAT, and at most what a twentieth less
  // occlusion and the read-back's rounding of the cavity add to it.
  const tint = Math.round(255 * WASH_FLAT);
  for (const value of alphas(flat)) {
    expect(value).toBeGreaterThanOrEqual(tint - 2);
    expect(value).toBeLessThanOrEqual(tint + 8);
  }
});

test('inks every texel under the stroke, the creases most', async ({ figurePage: page }) => {
  const brush = brushWith({ sizeMm: 3, hardness: 0.8, opacity: 0.8 });
  const { under, steps } = await brushOver(page, {
    tool: 'ink',
    brush,
    camera: FROM_THE_FRONT,
    along: DOWN_THE_FRONT,
  });
  expect(steps).toBe(1);
  const full = expectMasked(under, 'ink', brush, 0.8);
  // Every texel the stroke reached is stained, down to its soft rim.
  const reached = under.filter((texel) => texel.reach * 0.8 * INK_FLAT >= 2);
  expect(reached.length).toBeGreaterThan(full.length);
  expect(reached.filter((texel) => texel.rgba[3] === 0)).toEqual([]);
  for (const texel of full)
    expect(texel.rgba[3]).toBeGreaterThanOrEqual(Math.round(255 * 0.8 * INK_FLAT) - 2);
  const crease = alphas(full.filter((texel) => texel.cavity < -0.3));
  const flat = alphas(full.filter((texel) => Math.abs(texel.cavity) < 0.02));
  expect(crease.length).toBeGreaterThan(10);
  expect(mean(crease)).toBeGreaterThan(mean(flat) + 30);
});

/**
 * The dry brush leaves every texel below flat exactly as it was (#133). The read-back gives the
 * cavity in steps of 2/255: the encoding's flat (FLAT_CAVITY, 2/255) is a tie in its rounding and
 * reads 0.004 or 0.012, the texture's step below it −0.004 or −0.012, so a texel reading under 0
 * lies below flat. Gives those the stroke reached fully.
 */
function expectBelowFlatBare(under: Under[]): Under[] {
  const below = under.filter((texel) => texel.cavity < 0);
  expect(below.filter((texel) => texel.rgba.some((value) => value !== 0))).toEqual([]);
  return below.filter((texel) => texel.reach === 255);
}

test('dry-brushes the raised surface only, the creases left as they were', async ({
  figurePage: page,
}) => {
  for (const pressure of [1, 0.5]) {
    const brush = brushWith({ sizeMm: 3, hardness: 0.8, opacity: pressure });
    const { under, steps, reference } = await brushOver(page, {
      tool: 'dry',
      brush,
      camera: FROM_THE_FRONT,
      along: DOWN_THE_FRONT,
    });
    expect(steps).toBe(1);
    // The chest under the first dab (#133): its highest point is well above the floor.
    expect(reference).toBeGreaterThan(FLAT_CAVITY + DRY_REFERENCE_MIN);
    const full = expectMasked(under, 'dry', brush, DRY_OPACITY, reference);
    // A crease or a hollow: not a byte changed, anywhere under the stroke.
    expect(expectBelowFlatBare(under).length).toBeGreaterThan(50);
    // Flat: no paint. The figure's detail texture is the paint's size, so a texel reads its own
    // byte: flat reads under 2/255 above it, the next step up 0.020. Its share may be a hair over 0
    // (the GPU's decode of flat and FLAT_CAVITY differ by float rounding), so its colour may take
    // the brush's at alpha 0, as at any stroke's faintest fringe; its alpha stays 0.
    const flat = under.filter((texel) => texel.cavity < FLAT_CAVITY + 2 / 255);
    expect(flat.filter((texel) => texel.reach === 255).length).toBeGreaterThan(500);
    expect(flat.filter((texel) => texel.rgba[3] !== 0)).toEqual([]);
    // Relative to the reference: past the threshold and the softness, the dry brush's opacity.
    const share = (texel: Under): number =>
      (texel.cavity - FLAT_CAVITY) / (reference - FLAT_CAVITY);
    const threshold = DRY_THRESHOLD * (1 - pressure);
    const edge = full.filter((texel) => share(texel) > threshold + DRY_SOFTNESS + 0.02);
    expect(edge.length).toBeGreaterThan(10);
    for (const texel of edge) expect(texel.rgba[3]).toBe(Math.round(255 * DRY_OPACITY));
    // Less pressure reaches less far down: what lies below its threshold stays bare.
    const below = under.filter((texel) => share(texel) < threshold - 0.02);
    expect(below.filter((texel) => texel.rgba[3] !== 0)).toEqual([]);
  }
});

test('airbrushes from above only what faces up, building up over passes', async ({
  figurePage: page,
}) => {
  // From below the figure's waist, so that its underside and the undersides of its arms are in
  // sight: down its front, from the shoulders to the disc.
  const options = {
    tool: 'airbrush' as const,
    brush: { sizeMm: 8, opacity: 1, direction: [0, 1, 0] as Vec3 },
    reachHardness: AIR_HARDNESS,
    camera: [0, -15, 1] as Vec3,
    along: [22, 18, 14, 10, 6].map((y): Vec3 => [0.5, y, 6]),
  };
  const once = await brushOver(page, options);
  expect(once.steps).toBe(1);
  const down = once.under.filter((texel) => texel.normal[1] < -0.02);
  const up = once.under.filter((texel) => texel.reach > 128 && texel.normal[1] > 0.35);
  expect(down.filter((texel) => texel.reach > 128).length).toBeGreaterThan(200);
  expect(up.length).toBeGreaterThan(50);
  // Facing down: not a byte changed.
  expect(down.filter((texel) => texel.rgba.some((value) => value !== 0))).toEqual([]);
  // Facing up: sprayed, a little at a time.
  expect(up.filter((texel) => texel.rgba[3] === 0)).toEqual([]);
  expect(Math.max(...alphas(up))).toBeLessThan(255);

  const twice = await brushOver(page, { ...options, passes: 2 });
  expect(twice.steps).toBe(2);
  const after = new Map(twice.under.map((texel) => [texel.texel, texel.rgba[3]]));
  const built = up.filter((texel) => (after.get(texel.texel) ?? 0) > texel.rgba[3]);
  expect(built.length).toBeGreaterThan(0.9 * up.length);
  const stillDown = twice.under.filter((texel) => texel.normal[1] < -0.02);
  expect(stillDown.filter((texel) => texel.rgba.some((value) => value !== 0))).toEqual([]);
});

test('makes every hobby brush’s stroke one step, replayed to the same bytes', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const path = Array.from({ length: 30 }, (_, k) =>
      view.screenOf([-3 + (6 * k) / 29, 14 + Math.sin(k / 4), 6]),
    );
    const hash = async (): Promise<number> => {
      const { data } = await view.paint();
      let h = 0;
      for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
      return h;
    };
    const rows: {
      tool: string;
      hint: string;
      steps: number;
      changed: boolean;
      undone: boolean;
      redone: boolean;
    }[] = [];
    for (const tool of ['wash', 'ink', 'dry', 'airbrush'] as const) {
      view.setTool(tool);
      view.setBrush({
        sizeMm: 4,
        opacity: 0.7,
        direction: tool === 'airbrush' ? [0, 0, 1] : null,
      });
      const before = await hash();
      const steps = view.state.steps;
      // A pointer's stroke, a few dabs a frame; undo and redo replay it whole.
      await view.strokeAt(path);
      const after = await hash();
      await view.undo();
      const undone = (await hash()) === before;
      await view.redo();
      const redone = (await hash()) === after;
      rows.push({
        tool,
        // The ?dev panel says what the brush does (PAINT_COPY.toolHints).
        hint: document.querySelector('#paint-hint')?.textContent ?? '',
        steps: view.state.steps - steps,
        changed: after !== before,
        undone,
        redone,
      });
    }
    return rows;
  });
  for (const row of outcome)
    expect(row).toEqual({
      tool: row.tool,
      hint: row.hint,
      steps: 1,
      changed: true,
      undone: true,
      redone: true,
    });
  const hints = outcome.map((row) => row.hint);
  expect(hints.every((hint) => hint.length > 20)).toBe(true);
  expect(new Set(hints).size).toBe(hints.length);
});

test('measures a dry stroke’s reference again when it is replayed after another (#133)', async ({
  figurePage: page,
}) => {
  // Stroke A across the chest, whose highest point stands well above the floor; stroke B from the
  // disc's flat top over its rim, whose reference is flat (the floor scales it). Undoing B replays
  // A, which leaves A's reference measured; redoing B must measure B's again, or the rim's flanks
  // would take A's scale.
  const outcome = await page.evaluate(
    async ({ chest, disc }) => {
      const painting = window.__mt.painting;
      await painting.open();
      const view = painting.view();
      view.setCamera(0, 20, 1);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pathOf = (points: Vec3[]): [number, number][] => {
        const anchors = points.map((point) => view.screenOf(point));
        const path: [number, number][] = [];
        for (let k = 1; k < anchors.length; k++)
          for (let i = 0; i < 8; i++) {
            const [ax, ay] = anchors[k - 1]!;
            const [bx, by] = anchors[k]!;
            path.push([ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8]);
          }
        path.push(anchors.at(-1)!);
        return path;
      };
      const paths = [pathOf(chest), pathOf(disc)];
      const brush = { sizeMm: 3, hardness: 0.8, opacity: 0.5, direction: null };
      // Each stroke's reference, as the engine measures it: the highest cavity under a one-dab
      // flat stroke at its first point (undone).
      view.setTool('flat');
      view.setBrush({ ...brush, opacity: 1 });
      const footprints: Uint8Array[] = [];
      for (const path of paths) {
        await view.stroke([view.texelAt(...path[0]!)!.point]);
        footprints.push((await view.paint()).data);
        await view.undo();
      }
      const surface = await view.surface();
      const references = footprints.map((data) => {
        let highest = -1;
        for (let texel = 0; texel < 1024 * 1024; texel++)
          if (data[texel * 4 + 3]! > 0) highest = Math.max(highest, surface.cavity[texel]!);
        return highest;
      });
      const hash = async (): Promise<number> => {
        const { data } = await view.paint();
        let h = 0;
        for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
        return h;
      };
      view.setTool('dry');
      view.setBrush(brush);
      const bare = await hash();
      await view.strokeAt(paths[0]!);
      const afterA = await hash();
      await view.strokeAt(paths[1]!);
      const afterB = await hash();
      await view.undo();
      const undoneB = (await hash()) === afterA;
      await view.redo();
      const redoneB = (await hash()) === afterB;
      await view.undo();
      await view.undo();
      const undoneBoth = (await hash()) === bare;
      await view.redo();
      await view.redo();
      const redoneBoth = (await hash()) === afterB;
      return {
        references,
        steps: view.state.steps,
        changed: [afterA !== bare, afterB !== afterA],
        undoneB,
        redoneB,
        undoneBoth,
        redoneBoth,
      };
    },
    {
      chest: [-2, -1, 0, 1, 2].map((x): Vec3 => [x, 14, 6]),
      disc: [9, 10, 11, 12].map((z): Vec3 => [0.5, 3, z]).concat([[0.5, 2.2, 12.6]]),
    },
  );
  // The two references differ: A's scale is its own height, B's the floor.
  const [chestReference, discReference] = outcome.references;
  expect(chestReference! - FLAT_CAVITY).toBeGreaterThan(DRY_REFERENCE_MIN + 0.1);
  expect(discReference! - FLAT_CAVITY).toBeLessThan(DRY_REFERENCE_MIN);
  expect(outcome).toEqual({
    references: outcome.references,
    steps: 2,
    changed: [true, true],
    undoneB: true,
    redoneB: true,
    undoneBoth: true,
    redoneBoth: true,
  });
});

/** Opens the view and paints the figure's chest in #b03030 from the front: where a test picks from. */
async function paintTheChest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setBrush({ sizeMm: 4 });
    view.setColour('#b03030');
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const points = [-2, -1, 0, 1, 2].flatMap((x) => {
      const hit = view.texelAt(...view.screenOf([x, 14, 6]));
      return hit ? [hit.point] : [];
    });
    await view.stroke(points);
  });
}

test('picks the paint as painted, the pixel as shown, and nothing where there is none (#135)', async ({
  figurePage: page,
}) => {
  await paintTheChest(page);
  const picked = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const chest = view.screenOf([0, 14, 6]);
    // Below the stroke, 2.5 mm from its dabs’ centres: bare.
    const below = view.screenOf([0, 11.5, 6]);
    const result = {
      painted: await view.colourAt(...chest, 'painted'),
      shown: await view.colourAt(...chest),
      bareShown: await view.colourAt(...below, 'shown'),
      barePainted: await view.colourAt(...below, 'painted'),
      offShown: await view.colourAt(2, 2),
      offPainted: await view.colourAt(2, 2, 'painted'),
      belowOnMini: view.texelAt(...below) !== null,
    };
    // From behind, the figure's back is bare.
    view.setCamera(180, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const back = view.screenOf([0, 14, -6]);
    return { ...result, back: await view.colourAt(...back, 'painted'), steps: view.state.steps };
  });
  expect(picked.painted).toBe('#b03030');
  expect(picked.belowOnMini).toBe(true);
  expect(picked.barePainted).toBeNull();
  expect(picked.back).toBeNull();
  expect(picked.offShown).toBeNull();
  expect(picked.offPainted).toBeNull();
  // As shown: the paint under the table's light, red over the primer's grey, and not the paint's own bytes.
  const rgb = (hex: string): [number, number, number] =>
    [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number];
  const [r, g, b] = rgb(picked.shown!);
  expect(r - g).toBeGreaterThan(30);
  expect(r - b).toBeGreaterThan(30);
  const [br, bg] = rgb(picked.bareShown!);
  expect(Math.abs(br - bg)).toBeLessThan(30);
  // Picking paints nothing.
  expect(picked.steps).toBe(1);
});

test('takes the colour under a tap after Pick in the Paint tool, without painting (#135)', async ({
  figurePage: page,
}) => {
  await paintTheChest(page);
  await page.evaluate(() => {
    (document.querySelector('#dev-paint') as HTMLDetailsElement).open = true;
    window.__mt.painting.view().setColour('#2050a0');
  });
  const chest = await page.evaluate(() => window.__mt.painting.view().screenOf([0, 14, 6]));
  const shown = await page.evaluate((at) => window.__mt.painting.view().colourAt(...at), chest);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  const pick = page.locator('#paint-pick');
  await expect(pick).toHaveText('Pick a colour');

  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.colour !== '#2050a0');
  expect(await page.evaluate(() => window.__mt.painting.view().state.colour)).toBe(shown);
  await expect(pick).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#paint-pick-mode').selectOption('painted');
  await pick.click();
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.colour === '#b03030');
  expect(await page.evaluate(() => window.__mt.painting.view().state.steps)).toBe(1);
});

test('shows the colours used as swatches in the Paint tool, and a click paints with one again (#136)', async ({
  figurePage: page,
}) => {
  await paintTheChest(page);
  const swatches = page.locator('#paint-recent .paint-swatch');
  await page.evaluate(async () => {
    (document.querySelector('#dev-paint') as HTMLDetailsElement).open = true;
    const view = window.__mt.painting.view();
    const points = [-2, 0, 2].flatMap((x) => {
      const hit = view.texelAt(...view.screenOf([x, 14, 6]));
      return hit ? [hit.point] : [];
    });
    view.setColour('#2050a0');
    await view.stroke(points);
    // The eraser carries a colour that is never shown: it is no swatch.
    view.setTool('eraser');
    view.setColour('#20a050');
    await view.stroke(points);
    view.setTool('flat');
  });
  await expect(swatches).toHaveCount(2);
  expect(await swatches.evaluateAll((all) => all.map((s) => s.dataset.colour))).toEqual([
    '#2050a0',
    '#b03030',
  ]);
  await expect(swatches.first()).toHaveAccessibleName('Paint with #2050a0');

  await swatches.nth(1).click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.colour)).toBe('#b03030');
  await expect(page.locator('#paint-colour')).toHaveValue('#b03030');

  // Undone steps are not in the history, so their colours leave the row.
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    await view.undo();
    await view.undo();
  });
  await expect(swatches).toHaveCount(1);
  await expect(swatches.first()).toHaveAttribute('data-colour', '#b03030');
});
