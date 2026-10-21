import {
  AIR_HARDNESS,
  DRY_OPACITY,
  DRY_REFERENCE_MIN,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
  FLAT_CAVITY,
  INK_FLAT,
  WASH_FLAT,
} from '../src/lib';
import {
  type Vec3,
  type Under,
  brushOver,
  DOWN_THE_FRONT,
  FROM_THE_FRONT,
  expectMasked,
  mean,
  alphas,
  brushWith,
  expectBelowFlatBare,
  paintTheChest,
  expect,
  test,
} from './painting-helpers';

/**
 * The painting engine's hobby brushes, the pipette, the view's subscribers and the swatches, on the
 * shared figure (helpers and the figure in `painting-helpers.ts`).
 */

test.describe.configure({ timeout: 300_000 });

// The hobby brushes (#128, design note §6 and §13 step 11). Where a stroke lands is #127's and
// tested in `painting.spec.ts`; what a brush adds is its mask. So each test paints its stroke twice on the bare
// figure: with the flat brush at full opacity (what the stroke reaches, texel by texel: `reach`),
// then with the brush under test, and reads back what the masks read at every texel
// (`view.surface()`). A texel then holds `reach × opacity × toolMask(...)`.

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
        hint: document.querySelector('#paint-panel [data-hint]')?.textContent ?? '',
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

test('tells a subscriber every change after onChange, until it unsubscribes (#166)', async ({
  figurePage: page,
}) => {
  const heard = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    // The page's onChange writes state.painting: a subscriber called after it sees its own state there.
    const calls: { tool: string; afterOnChange: boolean }[] = [];
    const order: string[] = [];
    const first = view.subscribe((state) => {
      calls.push({ tool: state.tool, afterOnChange: window.__mt.state.painting === state });
      order.push('first');
    });
    const second = view.subscribe(() => order.push('second'));
    view.setTool('wash');
    view.setColour('#2050a0');
    first();
    view.setTool('flat');
    second();
    view.setTool('ink');
    view.setTool('flat');
    return { calls, order };
  });
  expect(heard.calls).toEqual([
    { tool: 'wash', afterOnChange: true },
    { tool: 'wash', afterOnChange: true },
  ]);
  expect(heard.order).toEqual(['first', 'second', 'first', 'second', 'second']);
});

test('carries the look it draws with in its state, the opened one and then setLook’s (#166)', async ({
  figurePage: page,
}) => {
  const looks = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const opened = view.state.look;
    const page = { ...window.__mt.state.look };
    const bone = { enabled: true, base: '#d8cdb0', occlusion: 0.8, wash: 0.75, edges: 0.3 };
    view.setLook(bone);
    const set = view.state.look;
    // The page takes the view's look as its own (#167): one value.
    return { opened, set, page, after: window.__mt.state.look };
  });
  // Opened with the page's look.
  expect(looks.opened).toEqual(looks.page);
  expect(looks.set).toEqual({
    enabled: true,
    base: '#d8cdb0',
    occlusion: 0.8,
    wash: 0.75,
    edges: 0.3,
  });
  expect(looks.after).toEqual(looks.set);
  await page.evaluate((look) => window.__mt.setLook(look), looks.page);
});

test('takes the next tap’s colour with pickColour and paints nothing; a pick ended without a tap gives undefined (#166)', async ({
  figurePage: page,
}) => {
  await paintTheChest(page);
  const chest = await page.evaluate(() => window.__mt.painting.view().screenOf([0, 14, 6]));
  const shown = await page.evaluate((at) => window.__mt.painting.view().colourAt(...at), chest);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  const host = page.locator('#paint-view');

  await page.evaluate(() => {
    const view = window.__mt.painting.view();
    view.setTool('wash');
    (window as unknown as { picked: Promise<string | null | undefined> }).picked =
      view.pickColour();
  });
  expect(await page.evaluate(() => window.__mt.painting.view().state.picking)).toBe(true);
  await expect(host).toHaveClass(/mt-painting-picking/);
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  const picked = await page.evaluate(
    () => (window as unknown as { picked: Promise<string | null | undefined> }).picked,
  );
  expect(picked).toBe(shown);
  const after = await page.evaluate(() => window.__mt.painting.view().state);
  expect(after.picking).toBe(false);
  expect(after.tool).toBe('wash');
  expect(after.steps).toBe(1);
  await expect(host).not.toHaveClass(/mt-painting-picking/);

  // As painted, the paint's own bytes; off the mini, null.
  await page.evaluate(() => {
    (window as unknown as { picked: Promise<string | null | undefined> }).picked =
      window.__mt.painting.view().pickColour('painted');
  });
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  expect(
    await page.evaluate(
      () => (window as unknown as { picked: Promise<string | null | undefined> }).picked,
    ),
  ).toBe('#b03030');
  await page.evaluate(() => {
    (window as unknown as { picked: Promise<string | null | undefined> }).picked =
      window.__mt.painting.view().pickColour();
  });
  await page.mouse.click(box.x + 2, box.y + 2);
  expect(
    await page.evaluate(
      () => (window as unknown as { picked: Promise<string | null | undefined> }).picked,
    ),
  ).toBeNull();

  // Cancelled, a second pick, and closing: each ends the waiting one without a tap, so undefined,
  // which a panel tells from the null of a tap that hit nothing.
  const ended = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const cancelled = view.pickColour();
    view.cancelPick();
    const replaced = view.pickColour();
    const closed = view.pickColour();
    const results = [await cancelled, await replaced];
    window.__mt.painting.close();
    results.push(await closed);
    // As strings: undefined does not travel out of evaluate as itself.
    return { results: results.map(String), picking: view.state.picking };
  });
  expect(ended.results).toEqual(['undefined', 'undefined', 'undefined']);
  expect(ended.picking).toBe(false);
});

test('takes the colour under a tap after Pick in the Paint tool, without painting (#135)', async ({
  figurePage: page,
}) => {
  await paintTheChest(page);
  await page.evaluate(() => {
    window.__mt.painting.view().setColour('#2050a0');
  });
  const chest = await page.evaluate(() => window.__mt.painting.view().screenOf([0, 14, 6]));
  const shown = await page.evaluate((at) => window.__mt.painting.view().colourAt(...at), chest);
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  // The panel's pipette (#166): an icon button named by PAINT_COPY.pick.button.
  const pick = page.locator('#paint-panel [data-action="pick"]');
  const status = page.locator('#paint-panel [data-status]');
  await expect(pick).toHaveAccessibleName('Pick a colour');

  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.colour !== '#2050a0');
  expect(await page.evaluate(() => window.__mt.painting.view().state.colour)).toBe(shown);
  await expect(pick).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#paint-panel [data-colour]')).toHaveValue(shown!);

  // Off the mini: nothing to pick, said on the status line; a second press cancels without a word.
  await pick.click();
  await page.mouse.click(box.x + 2, box.y + 2);
  await expect(status).toHaveText('Nothing to pick there: off the mini, or no paint on it.');
  await pick.click();
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveText('');

  await page.locator('#paint-pick-mode').selectOption('painted');
  expect(await page.evaluate(() => window.__mt.painting.panel().state.pickMode)).toBe('painted');
  await pick.click();
  await page.mouse.click(box.x + chest[0], box.y + chest[1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.colour === '#b03030');
  expect(await page.evaluate(() => window.__mt.painting.view().state.steps)).toBe(1);
  await page.locator('#paint-pick-mode').selectOption('shown');
});

test('shows the colours used as swatches in the Paint tool, and a click paints with one again (#136)', async ({
  figurePage: page,
}) => {
  // The page's palette of this device (#167) fills as the tests before this one paint: emptied,
  // the row shows the mini's own colours.
  await page.evaluate(() => localStorage.removeItem('mt-palette'));
  await paintTheChest(page);
  const swatches = page.locator('#paint-panel [data-swatches] [data-swatch]');
  await page.evaluate(async () => {
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
  expect(await swatches.evaluateAll((all) => all.map((s) => s.dataset.swatch))).toEqual([
    '#2050a0',
    '#b03030',
  ]);
  await expect(swatches.first()).toHaveAccessibleName('Paint with #2050a0');

  await swatches.nth(1).click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.colour)).toBe('#b03030');
  await expect(page.locator('#paint-panel [data-colour]')).toHaveValue('#b03030');
  await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true');

  // Undone steps are not in the history, so their colours leave the row. The page's palette of
  // this device keeps them (#167): set it aside to see the mini's own.
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    await view.undo();
    await view.undo();
    window.__mt.painting.panel().setPalette([]);
  });
  await expect(swatches).toHaveCount(1);
  await expect(swatches.first()).toHaveAttribute('data-swatch', '#b03030');

  // The consumer's palette after the mini's colours, each once (#166).
  await page.evaluate(() => window.__mt.painting.panel().setPalette(['#B03030', '#ffffff']));
  expect(await page.evaluate(() => window.__mt.painting.panel().state.swatches)).toEqual([
    '#b03030',
    '#ffffff',
  ]);
  await expect(swatches).toHaveCount(2);
  await page.evaluate(() => window.__mt.painting.panel().setPalette([]));
});
// The mask (#138, design note `docs/design/paint-mask.md`): masked surface keeps its bytes under
// every tool; the mask is made with its own tools, each one step, goes in and out as pixels, shows
// as a tint, and cuts the fill.
