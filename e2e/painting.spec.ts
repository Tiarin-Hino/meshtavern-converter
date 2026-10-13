import { expect, test, type Page } from '@playwright/test';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure, generatePlate } from '../src/regression/shapes';

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

test.describe.configure({ timeout: 300_000 });

test('gives back the paint it was opened with, byte for byte', async ({ page }) => {
  await convert(page, generateFigure(true));
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
    lookFrom?: [number, number, number];
    grid: { from: [number, number, number]; to: [number, number, number]; steps: number };
  },
): Promise<Seen[]> {
  return page.evaluate(async ({ camera, along, sizeMm, lookFrom, grid }) => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    view.setTool('flat');
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

test('paints a stroke where its dabs are and leaves the far side bare', async ({ page }) => {
  await convert(page, generateFigure(true));
  // The figure's chest, 14 mm up, its front 4 mm out in +z; the stroke across it at a 2 mm brush.
  const along: [number, number, number][] = [-2, -1, 0, 1, 2].map((x) => [x, 14, 6]);
  const front = await strokeAndLook(page, {
    camera: [0, 5, 1.6],
    along,
    sizeMm: 2,
    grid: { from: [-3.5, 11.5, 6], to: [3.5, 16.5, 6], steps: 24 },
  });
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

test('paints both sides of a seam and the gutter beside each', async ({ page }) => {
  await convert(page, generateFigure(true));
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
