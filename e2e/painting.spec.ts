import { expect, test as base, type Page } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import {
  generateFigure,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
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
