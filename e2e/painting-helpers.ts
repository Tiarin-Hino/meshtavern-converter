import { expect, test as base, type Page } from '@playwright/test';
import { DEFAULT_BRUSH, toolMask, type BrushSettings, type ToolId } from '../src/lib';
import { encodeBinaryStl } from '../src/lib/dev';
import { generateFigure } from '../src/regression/shapes';

export { expect };

/**
 * What the painting engine's pixel tests share (#127, design note `docs/design/painting-engine.md`
 * §13): they go through the team's Paint tool under ?dev, the view's methods are
 * `window.__mt.painting.view()`'s, the paint is read back as pixels and asserted on texel by texel.
 * The tests are four files, `painting*.spec.ts`, so that the CI runner's workers share them: in one
 * file they ran on one worker for 18 minutes, alone for the last half of the run.
 */

export const file = (name: string, soup: Float32Array) => ({
  name,
  mimeType: 'model/stl',
  buffer: Buffer.from(encodeBinaryStl(soup)),
});

/** Converts `soup` on the normal path (baked, compressed) without the questions, and waits until it is shown. */
export async function convert(page: Page, soup: Float32Array, name = 'figure.stl'): Promise<void> {
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
export const test = base.extend<{ figurePage: Page }, { figure: Page }>({
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

/** What a grid of canvas points sees: the texel under each, its paint's alpha and red, and its distance to the nearest dab. */
export interface Seen {
  alpha: number;
  red: number;
  distance: number;
}

/** Paints a stroke of `points` (canvas points, cast onto the surface) and reads the paint back under a grid of canvas points. */
export async function strokeAndLook(
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
export const strokeAndLookWith = (page: Page, tool: 'flat' | 'eraser'): Promise<Seen[]> =>
  strokeAndLook(page, {
    camera: [0, 5, 1.6],
    along: [-2, -1, 0, 1, 2].map((x) => [x, 14, 6]),
    sizeMm: 2,
    tool,
    grid: { from: [-3.5, 11.5, 6], to: [3.5, 16.5, 6], steps: 24 },
  });

/** How many bytes two paints differ in, and how many texels each has painted. */
export async function paintNow(page: Page): Promise<{ painted: number; hash: number }> {
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
export async function chestPath(page: Page): Promise<[number, number][]> {
  return page.evaluate(async () => {
    const view = window.__mt.painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return Array.from({ length: 30 }, (_, k) =>
      view.screenOf([-3 + (6 * k) / 29, 14 + Math.sin(k / 4), 6]),
    );
  });
}

/** The paint's alpha under canvas points of `points` (on the mini, from the camera given), and the points hit. */
export async function alphasAt(
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
export const ring = (r: number, y: number, count = 24): [number, number, number][] =>
  Array.from({ length: count }, (_, k) => [
    r * Math.cos((2 * Math.PI * k) / count),
    y,
    r * Math.sin((2 * Math.PI * k) / count),
  ]);

/** What a lift test reads: the paint's bytes compared with earlier paints, texel by texel. */
export interface Compared {
  /** Texels equal to the first paint, not to the second. */
  first: number;
  /** Texels equal to the second paint, not to the first. */
  second: number;
  /** Texels equal to neither. */
  neither: number;
}

export type Vec3 = [number, number, number];

/** A texel near a stroke: what the masks read there, how much the flat brush's stroke reached it, and the brush's paint. */
export interface Under {
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
export async function brushOver(
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
export const DOWN_THE_FRONT: Vec3[] = [
  ...[18, 16, 14, 12, 10, 8].map((y): Vec3 => [0.5, y, 6]),
  ...[5.5, 7, 8.5, 10, 11.5].map((z): Vec3 => [0.5, 3, z]),
  [0.5, 2.2, 12.6],
];
export const FROM_THE_FRONT: Vec3 = [0, 20, 1];

/**
 * Every texel the stroke reached took the tool's mask: its alpha is `reach × opacity × toolMask`
 * of what the masks read there (and the stroke's reference, for the dry brush), within the
 * rounding of the reach, the read-back and the paint; a texel it did not reach is bare. Gives the
 * texels it reached fully.
 */
export function expectMasked(
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

export const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
export const alphas = (texels: Under[]): number[] => texels.map((texel) => texel.rgba[3]);
export const brushWith = (changes: Partial<BrushSettings>): BrushSettings => ({
  ...DEFAULT_BRUSH,
  ...changes,
});

/**
 * The dry brush leaves every texel below flat exactly as it was (#133). The read-back gives the
 * cavity in steps of 2/255: the encoding's flat (FLAT_CAVITY, 2/255) is a tie in its rounding and
 * reads 0.004 or 0.012, the texture's step below it −0.004 or −0.012, so a texel reading under 0
 * lies below flat. Gives those the stroke reached fully.
 */
export function expectBelowFlatBare(under: Under[]): Under[] {
  const below = under.filter((texel) => texel.cavity < 0);
  expect(below.filter((texel) => texel.rgba.some((value) => value !== 0))).toEqual([]);
  return below.filter((texel) => texel.reach === 255);
}

/** Opens the view and paints the figure's chest in #b03030 from the front: where a test picks from. */
export async function paintTheChest(page: Page): Promise<void> {
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

/** Lays a band of mask on the chest, 14 mm up, across it from the front at a 4 mm brush. */
export async function maskTheChest(page: Page, paint: 'all' | null = null): Promise<void> {
  await page.evaluate(async (paint) => {
    const painting = window.__mt.painting;
    await painting.open(paint);
    const view = painting.view();
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const at = (x: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, 14, 6]))!.point;
    view.setTool('mask');
    view.setBrush({ sizeMm: 4, hardness: 0.8, opacity: 1 });
    await view.stroke([at(-3), at(-1.5), at(0), at(1.5), at(3)]);
  }, paint);
}

/** Where the right arm hangs beside the body (x 4–8, y 13–25, z −3.5–1.5): its middle. */
export const ARM_MIDDLE: [number, number, number] = [6, 19, -1];

/**
 * Opens the view on the figure with its automatic groups and turns it so that the right arm
 * hides the body behind it: the arm's group and the camera's azimuth.
 */
export async function openWithTheArmInFront(page: Page): Promise<{ arm: number; azimuth: number }> {
  return page.evaluate(async (middle) => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const { of, made } = view.groups();
    const table = painting.table()!;
    // The shell whose triangles lie furthest out along +x.
    let arm = -1;
    let furthest = -Infinity;
    for (let group = 1; group < made.length; group++) {
      let sum = 0;
      let count = 0;
      for (let t = 0; t < of.length; t++) {
        if (of[t] !== group) continue;
        sum += table.positions[table.indices[t * 3]! * 3]!;
        count++;
      }
      if (count > 0 && sum / count > furthest) [arm, furthest] = [group, sum / count];
    }
    for (const azimuth of [90, 270]) {
      view.setCamera(azimuth, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const hit = view.texelAt(...view.screenOf(middle));
      if (hit && of[hit.triangle] === arm) return { arm, azimuth };
    }
    throw new Error('No side has the arm in front');
  }, ARM_MIDDLE);
}

/** The figure's head: the group whose triangles lie highest. */
export async function headGroup(page: Page): Promise<number> {
  return page.evaluate(() => {
    const painting = window.__mt.painting;
    const { of, made } = painting.view().groups();
    const table = painting.table()!;
    let head = -1;
    let highest = -Infinity;
    for (let group = 1; group < made.length; group++) {
      let sum = 0;
      let count = 0;
      for (let t = 0; t < of.length; t++) {
        if (of[t] !== group) continue;
        sum += table.positions[table.indices[t * 3]! * 3 + 1]!;
        count++;
      }
      if (count > 0 && sum / count > highest) [head, highest] = [group, sum / count];
    }
    return head;
  });
}

/**
 * Opens the view on the figure, pulls every group apart and turns the camera to the front: the
 * right arm (the shell furthest along +x) lies beside the body with the gap between them. Its
 * group, its offset, and the body's and the arm's boxes as drawn.
 */
export async function openWithTheArmApart(page: Page): Promise<{
  arm: number;
  offset: [number, number, number];
  body: { min: number[]; max: number[] };
  armBox: { min: number[]; max: number[] };
}> {
  return page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const table = painting.table()!;
    const { of, made } = view.groups();
    const box = (group: number, by: number[]): { min: number[]; max: number[] } => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let t = 0; t < of.length; t++) {
        if (of[t] !== group) continue;
        for (let corner = 0; corner < 3; corner++) {
          const v = table.indices[t * 3 + corner]! * 3;
          for (let k = 0; k < 3; k++) {
            const value = table.positions[v + k]! + by[k]!;
            min[k] = Math.min(min[k]!, value);
            max[k] = Math.max(max[k]!, value);
          }
        }
      }
      return { min, max };
    };
    let arm = -1;
    let furthest = -Infinity;
    for (let group = 1; group < made.length; group++) {
      const { min, max } = box(group, [0, 0, 0]);
      const middle = (min[0]! + max[0]!) / 2;
      if (Number.isFinite(middle) && middle > furthest) [arm, furthest] = [group, middle];
    }
    const before = { steps: view.state.steps, undone: view.state.undone };
    view.pullAllApart();
    const entry = view.state.groups.apart.find((entry) => entry.group === arm);
    if (!entry) throw new Error(`Group ${arm} was not pulled apart`);
    if (view.state.steps !== before.steps || view.state.undone !== before.undone)
      throw new Error('Pulling apart made a step');
    view.setCamera(0, 5, 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      arm,
      offset: entry.offset,
      body: box(0, [0, 0, 0]),
      armBox: box(arm, entry.offset),
    };
  });
}

/** The texel at the middle of every triangle, and each triangle's group: where a group's paint is read (#139). */
export async function groupTexelsOf(page: Page): Promise<{ of: number[]; texels: number[] }> {
  return page.evaluate(() => {
    const painting = window.__mt.painting;
    const table = painting.table()!;
    const { of } = painting.view().groups();
    const texels: number[] = [];
    for (let t = 0; t < of.length; t++) {
      let u = 0;
      let v = 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = table.indices[t * 3 + corner]!;
        u += table.uvs![vertex * 2]! / 3;
        v += table.uvs![vertex * 2 + 1]! / 3;
      }
      texels.push(Math.floor(v * 1024) * 1024 + Math.floor(u * 1024));
    }
    return { of: Array.from(of), texels };
  });
}
