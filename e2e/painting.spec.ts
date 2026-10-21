import {
  strokeAndLookWith,
  paintNow,
  chestPath,
  alphasAt,
  ring,
  type Compared,
  expect,
  test,
} from './painting-helpers';

/**
 * The painting engine on the shared figure: open, strokes, input, undo, the fill, the eraser and
 * the lift (helpers and the figure in `painting-helpers.ts`).
 */

test.describe.configure({ timeout: 300_000 });

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

test('undoes every stroke, past UNDO_STEPS back to the paint as opened (#165)', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const point = view.texelAt(...view.screenOf([0, 14, 6]))!.point;
    view.setBrush({ sizeMm: 1 });
    // 55 strokes and 10 more: past the window's keyframes (design note §8), so the last undos
    // replay from the paint as opened (#165).
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
    const bare = (await view.paint()).data.every((value) => value === 0);
    return { undone, history: view.history().length, bare };
  });
  expect(outcome.undone).toBe(65);
  expect(outcome.history).toBe(0);
  expect(outcome.bare).toBe(true);
});

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
