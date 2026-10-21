import {
  alphasAt,
  maskTheChest,
  ARM_MIDDLE,
  openWithTheArmInFront,
  headGroup,
  openWithTheArmApart,
  groupTexelsOf,
  expect,
  test,
} from './painting-helpers';

/**
 * The painting engine's mask (#138) and groups (#139, #180), on the shared figure (helpers and the
 * figure in `painting-helpers.ts`).
 */

test.describe.configure({ timeout: 300_000 });

test('keeps a masked area’s bytes under every tool, a wash over the whole figure included (#138)', async ({
  figurePage: page,
}) => {
  await maskTheChest(page, 'all');
  const outcome = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const at = (x: number, y: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, y, 6]))!.point;
    const mask = (await view.mask()).data;
    const opened = window.__mt.painting.testPaint('all').data;
    // Every stroke tool down the whole front of the figure at the largest brush, a fill of the
    // figure, then a flat stroke across the mask and a lift started beside the mask.
    view.setColour('#0000ff');
    const down = [24, 19, 14, 9, 4].map((y) => at(0, y));
    for (const tool of ['flat', 'wash', 'ink', 'dry', 'airbrush', 'eraser'] as const) {
      view.setTool(tool);
      view.setBrush({ sizeMm: 16, hardness: 0.8, opacity: 1 });
      await view.stroke(down);
    }
    await view.fillRegion('figure');
    view.setTool('flat');
    view.setColour('#00ff00');
    view.setBrush({ sizeMm: 6 });
    await view.stroke([at(-4, 14), at(4, 14)]);
    view.setTool('lift');
    await view.stroke([at(0, 16.8), at(0, 11.2)]);
    const lift = view.state.lift;
    const { data } = await view.paint();
    let masked = 0;
    let kept = 0;
    let changed = 0;
    for (let texel = 0; texel < mask.length; texel++) {
      const same = [0, 1, 2, 3].every((k) => data[texel * 4 + k] === opened[texel * 4 + k]);
      if (mask[texel] === 255) {
        masked++;
        if (same) kept++;
      } else if (!same) changed++;
    }
    return { masked, kept, changed, lift, steps: view.state.steps };
  });
  expect(outcome.masked).toBeGreaterThan(500);
  expect(outcome.kept).toBe(outcome.masked);
  expect(outcome.changed).toBeGreaterThan(10_000);
  // The lift took a step away beside the mask (which one is on top there is the brushes' business).
  expect(outcome.lift).toHaveProperty('lifted');
  expect(outcome.steps).toBe(10);
});

test('makes the mask with its brush, eraser, fill, clear and invert, each one step, undone and redone to the same bytes (#138)', async ({
  figurePage: page,
}) => {
  await maskTheChest(page);
  await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const store = window as unknown as { masks: Uint8Array[] };
    store.masks = [new Uint8Array(1024 * 1024), (await view.mask()).data];
    // The mask eraser, narrower, along the band; the base masked as a ready region.
    view.setTool('unmask');
    view.setBrush({ sizeMm: 1.5 });
    await view.stroke([-3, 0, 3].map((x) => view.texelAt(...view.screenOf([x, 14, 6]))!.point));
    store.masks.push((await view.mask()).data);
    await view.maskRegion('base');
    store.masks.push((await view.mask()).data);
    view.setTool('mask-fill');
    view.setBrush({ tolerance: 0.5 });
  });
  // A tap with the mask fill on the head.
  const head = await page.evaluate(() => window.__mt.painting.view().screenOf([0, 28.5, 3.8]));
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  await page.mouse.click(box.x + head[0], box.y + head[1]);
  await page.waitForFunction(() => window.__mt.painting.view().state.steps === 4);
  const outcome = await page.evaluate(async () => {
    const view = window.__mt.painting.view();
    const store = window as unknown as { masks: Uint8Array[] };
    store.masks.push((await view.mask()).data);
    await view.invertMask();
    store.masks.push((await view.mask()).data);
    await view.clearMask();
    store.masks.push((await view.mask()).data);
    const masks = store.masks;
    const count = (mask: Uint8Array): number => mask.filter((value) => value === 255).length;
    const same = (a: Uint8Array, b: Uint8Array): boolean => a.every((value, k) => value === b[k]);
    const within = (a: Uint8Array, b: Uint8Array): boolean => a.every((value, k) => value <= b[k]!);
    const inverted = masks[5]!.every((value, k) => value === 255 - masks[4]![k]!);
    const kinds = view
      .history()
      .map((step) => `${step.kind}:${'tool' in step ? step.tool : step.change}`);
    // The paint stays bare all along: the mask is not in it.
    const paint = (await view.paint()).data;
    let painted = 0;
    for (let k = 3; k < paint.length; k += 4) if (paint[k] !== 0) painted++;
    // Undo all six, each back to the mask before it; redo all six.
    const undone: boolean[] = [];
    for (let k = 5; k >= 0; k--) {
      await view.undo();
      undone.push(same((await view.mask()).data, masks[k]!));
    }
    const redone: boolean[] = [];
    for (let k = 1; k <= 6; k++) {
      await view.redo();
      redone.push(same((await view.mask()).data, masks[k]!));
    }
    return {
      counts: masks.map(count),
      erasedWithin: within(masks[2]!, masks[1]!),
      baseAdded: within(masks[2]!, masks[3]!),
      headAdded: within(masks[3]!, masks[4]!),
      inverted,
      kinds,
      painted,
      undone,
      redone,
    };
  });
  const [none, brushed, erased, base, onHead, inverse, cleared] = outcome.counts as number[];
  expect(none).toBe(0);
  expect(brushed).toBeGreaterThan(500);
  expect(erased).toBeLessThan(brushed!);
  expect(erased).toBeGreaterThan(100);
  expect(outcome.erasedWithin).toBe(true);
  expect(base).toBeGreaterThan(erased! + 5000);
  expect(outcome.baseAdded).toBe(true);
  expect(onHead).toBeGreaterThan(base! + 500);
  expect(outcome.headAdded).toBe(true);
  expect(outcome.inverted).toBe(true);
  expect(inverse).toBeGreaterThan(onHead!);
  expect(cleared).toBe(0);
  expect(outcome.kinds).toEqual([
    'stroke:mask',
    'stroke:unmask',
    'fill:mask-fill',
    'fill:mask-fill',
    'mask:invert',
    'mask:clear',
  ]);
  expect(outcome.painted).toBe(0);
  expect(outcome.undone).toEqual([true, true, true, true, true, true]);
  expect(outcome.redone).toEqual([true, true, true, true, true, true]);
});

test('gives the mask back as pixels, opens on it again, inverted paints only where it was, and tints it (#138)', async ({
  figurePage: page,
}) => {
  await maskTheChest(page);
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
    let view = painting.view();
    const mask = await view.mask();
    // The tint: the masked chest looks bluer than with the tint off; the head the same either way.
    const chest = view.screenOf([0, 14, 6]);
    const head = view.screenOf([0, 28.5, 3.8]);
    const rgb = (hex: string | null): number[] =>
      [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16));
    const look = async (): Promise<{ chest: number[]; head: number[] }> => ({
      chest: rgb(await view.colourAt(...chest)),
      head: rgb(await view.colourAt(...head)),
    });
    const shown = await look();
    view.setMaskShown(false);
    const hidden = await look();
    const maskShown = view.state.maskShown;
    view.setMaskShown(true);

    // Opened again on the mask: the same bytes, no step.
    await painting.open(null, mask);
    view = painting.view();
    view.setCamera(0, 5, 1.6);
    await frame();
    const reopened = (await view.mask()).data.every((value, k) => value === mask.data[k]);
    const steps = view.state.steps;
    const across = [-4, -2, 0, 2, 4].map((x) => view.texelAt(...view.screenOf([x, 14, 6]))!.point);
    const paintAcross = async (): Promise<{
      inside: number[];
      outside: number;
    }> => {
      view.setTool('flat');
      view.setBrush({ sizeMm: 16, hardness: 0.8, opacity: 1 });
      await view.stroke(across);
      const { data } = await view.paint();
      const inside: number[] = [];
      let outside = 0;
      for (let texel = 0; texel < mask.data.length; texel++) {
        const alpha = data[texel * 4 + 3]!;
        if (mask.data[texel] === 255) inside.push(alpha);
        else if (mask.data[texel] === 0 && alpha !== 0) outside++;
      }
      return { inside, outside };
    };
    const masked = await paintAcross();
    await view.undo();
    await view.invertMask();
    const inverted = await paintAcross();
    return {
      shown,
      hidden,
      maskShown,
      reopened,
      steps,
      masked: {
        inside: masked.inside.filter((a) => a !== 0).length,
        outside: masked.outside,
      },
      inverted: {
        inside: inverted.inside.filter((a) => a !== 255).length,
        count: inverted.inside.length,
        outside: inverted.outside,
      },
    };
  });
  expect(outcome.maskShown).toBe(false);
  // Bluer under the tint, and less red; the head untouched by it.
  expect(outcome.shown.chest[2]! - outcome.shown.chest[0]!).toBeGreaterThan(
    outcome.hidden.chest[2]! - outcome.hidden.chest[0]! + 20,
  );
  for (let k = 0; k < 3; k++)
    expect(Math.abs(outcome.shown.head[k]! - outcome.hidden.head[k]!)).toBeLessThanOrEqual(1);
  expect(outcome.reopened).toBe(true);
  expect(outcome.steps).toBe(0);
  // Masked: nothing inside the mask, plenty around it.
  expect(outcome.masked.inside).toBe(0);
  expect(outcome.masked.outside).toBeGreaterThan(5000);
  // Inverted ("paint only the chest"): all of the band painted, nothing that was open.
  expect(outcome.inverted.count).toBeGreaterThan(500);
  expect(outcome.inverted.inside).toBe(0);
  expect(outcome.inverted.outside).toBe(0);
});

test('stops a fill at a band of mask around the body, and fills past it without the band (#138)', async ({
  figurePage: page,
}) => {
  const fillFromTheChest = async (): Promise<void> => {
    const chest = await page.evaluate(async () => {
      const view = window.__mt.painting.view();
      view.setCamera(0, 5, 1.6);
      view.setTool('fill');
      view.setBrush({ tolerance: 1, opacity: 1 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return view.screenOf([0, 17, 6]);
    });
    const box = (await page.locator('#paint-view canvas').boundingBox())!;
    const before = await page.evaluate(() => window.__mt.painting.view().state.steps);
    await page.mouse.click(box.x + chest[0], box.y + chest[1]);
    await page.waitForFunction(
      (before) => window.__mt.painting.view().state.steps === before + 1,
      before,
    );
  };
  const above = Array.from({ length: 5 }, (_, k): [number, number, number] => [-2 + k, 18, 6]);
  const below = Array.from({ length: 5 }, (_, k): [number, number, number] => [-2 + k, 6.5, 6]);

  await page.evaluate(() => window.__mt.painting.open());
  await fillFromTheChest();
  const whole = {
    above: await alphasAt(page, [0, 5, 1.6], above),
    below: await alphasAt(page, [0, 5, 1.6], below),
  };

  // A band of mask all round the body 10 mm up: from eight sides, a stroke along the table
  // level's vertices there that the side has in sight, in order round the body; then the same fill.
  const strokes = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const table = painting.table()!;
    const ring: [number, number, number][] = [];
    for (let v = 0; v < table.positions.length / 3; v++) {
      const [x, y, z] = [0, 1, 2].map((k) => table.positions[v * 3 + k]!);
      // The body only: the arms hang beside it from 12 mm up, 4 mm out and more.
      if (Math.abs(y! - 10) < 0.3 && Math.abs(x!) < 5.6) ring.push([x!, y!, z!]);
    }
    ring.sort((a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
    view.setTool('mask');
    view.setBrush({ sizeMm: 5, hardness: 0.9, opacity: 1 });
    for (let side = 0; side < 8; side++) {
      view.setCamera(side * 45, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const seen = ring.filter((point) => {
        const hit = view.texelAt(...view.screenOf(point));
        return hit !== null && Math.hypot(...point.map((c, k) => c - hit.point[k]!)) < 0.3;
      });
      await view.stroke(seen);
    }
    return view.state.steps;
  });
  expect(strokes).toBe(8);
  await fillFromTheChest();
  const cut = {
    above: await alphasAt(page, [0, 5, 1.6], above),
    below: await alphasAt(page, [0, 5, 1.6], below),
  };
  for (const seen of [whole.above, whole.below, cut.above, cut.below]) expect(seen).toHaveLength(5);
  expect(whole.above.filter((seen) => seen.alpha !== 255)).toEqual([]);
  expect(whole.below.filter((seen) => seen.alpha !== 255)).toEqual([]);
  expect(cut.above.filter((seen) => seen.alpha !== 255)).toEqual([]);
  expect(cut.below.filter((seen) => seen.alpha !== 0)).toEqual([]);
});
// The groups (#139, design note `docs/design/paint-groups.md`): the generated figure's shells are
// its automatic groups (body, base, head, two arms); a hidden group is drawn nowhere, takes no
// paint, and lets the surface behind it be painted; hiding is not a step, and each step records
// what was hidden, so its replay gives the same bytes whatever is hidden then.

test('lets the surface behind a hidden group be painted, and draws and paints nothing of the group (#139)', async ({
  figurePage: page,
}) => {
  const { arm } = await openWithTheArmInFront(page);
  const outcome = await page.evaluate(
    async ({ arm, middle }) => {
      const painting = window.__mt.painting;
      const view = painting.view();
      const table = painting.table()!;
      const { of, made } = view.groups();
      const frame = (): Promise<unknown> =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      // Every texel at the middle of one of the arm's triangles.
      const armTexels: number[] = [];
      for (let t = 0; t < of.length; t++) {
        if (of[t] !== arm) continue;
        let u = 0;
        let v = 0;
        for (let corner = 0; corner < 3; corner++) {
          const vertex = table.indices[t * 3 + corner]!;
          u += table.uvs![vertex * 2]! / 3;
          v += table.uvs![vertex * 2 + 1]! / 3;
        }
        armTexels.push(Math.floor(v * 1024) * 1024 + Math.floor(u * 1024));
      }
      const p = view.screenOf(middle);
      const shownBefore = await view.colourAt(...p, 'shown');
      view.setGroupShown(arm, false);
      await frame();
      const hiddenBare = await view.colourAt(...p, 'shown');
      const behind = view.texelAt(...p)!;
      // A 16 mm stroke across the hidden arm, along the surface behind it.
      const points: [number, number, number][] = [];
      for (let dx = -24; dx <= 24; dx += 4) {
        const hit = view.texelAt(p[0] + dx, p[1]);
        if (hit) points.push(hit.point);
      }
      view.setTool('flat');
      view.setColour('#ffff00');
      view.setBrush({ sizeMm: 16, hardness: 0.8, opacity: 1 });
      await view.stroke(points);
      const hiddenColour = await view.colourAt(...p, 'shown');
      const hidden = view.state.groups.hidden;
      view.showAllGroups();
      await frame();
      const shownColour = await view.colourAt(...p, 'shown');
      const again = view.texelAt(...p)!;
      const { data } = await view.paint();
      const [bx, by] = behind.texel;
      return {
        groups: made.length,
        armTriangles: armTexels.length,
        behindGroup: of[behind.triangle],
        behindAlpha: data[(by * 1024 + bx) * 4 + 3],
        armPainted: armTexels.filter((texel) => data[texel * 4 + 3] !== 0).length,
        againGroup: of[again.triangle],
        shownBefore,
        hiddenBare,
        hiddenColour,
        shownColour,
        hidden,
        points: points.length,
      };
    },
    { arm, middle: ARM_MIDDLE },
  );
  // Body, base, head and two arms.
  expect(outcome.groups).toBeGreaterThanOrEqual(5);
  expect(outcome.armTriangles).toBeGreaterThan(500);
  expect(outcome.points).toBeGreaterThan(8);
  expect(outcome.hidden).toEqual([arm]);
  // Hidden, the arm is not there to hit: the tap finds the body behind it, which takes the paint.
  expect(outcome.behindGroup).not.toBe(arm);
  expect(outcome.behindAlpha).toBe(255);
  expect(outcome.armPainted).toBe(0);
  // On screen too: hidden, the pixel is the body behind (it turns yellow when the body is
  // painted); drawn again, the arm is in front once more, as it was.
  expect(outcome.againGroup).toBe(arm);
  const rgb = (hex: string | null): number[] =>
    [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16));
  expect(outcome.hiddenBare).not.toBe(outcome.shownBefore);
  const [r0, g0, b0] = rgb(outcome.hiddenBare);
  const [r1, g1, b1] = rgb(outcome.hiddenColour);
  expect(Math.min(r1!, g1!) - b1!).toBeGreaterThan(Math.min(r0!, g0!) - b0! + 20);
  expect(outcome.shownColour).toBe(outcome.shownBefore);
});

test('hides and shows without a step, and replays a stroke made with a group hidden to the same bytes with it shown (#139)', async ({
  figurePage: page,
}) => {
  const { arm } = await openWithTheArmInFront(page);
  const outcome = await page.evaluate(
    async ({ arm, middle }) => {
      const view = window.__mt.painting.view();
      const frame = (): Promise<unknown> =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      const hash = async (): Promise<number> => {
        const { data } = await view.paint();
        let h = 0;
        for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
        return h;
      };
      const opened = await hash();
      view.setGroupShown(arm, false);
      view.setGroupShown(arm, true);
      view.setGroupShown(arm, false);
      await frame();
      const afterHiding = {
        steps: view.state.steps,
        undone: view.state.undone,
        same: (await hash()) === opened,
      };
      const p = view.screenOf(middle);
      const points: [number, number, number][] = [];
      for (let dx = -16; dx <= 16; dx += 4) {
        const hit = view.texelAt(p[0] + dx, p[1]);
        if (hit) points.push(hit.point);
      }
      view.setColour('#ff00ff');
      view.setBrush({ sizeMm: 8 });
      await view.stroke(points);
      const withHidden = await hash();
      view.showAllGroups();
      // A stroke with every group shown, on the arm itself.
      await view.stroke([view.texelAt(...p)!.point]);
      const both = await hash();
      const record = view.history().map((step) => (step.kind === 'mask' ? null : step.groups));
      const hasGroups = view.history().map((step) => 'groups' in step);
      await view.undo();
      const undoneOnce = await hash();
      await view.undo();
      const undoneTwice = await hash();
      await view.redo();
      const redone = await hash();
      await view.redo();
      const redoneBoth = await hash();
      // An undo after a hide leaves the group hidden.
      view.setGroupShown(arm, false);
      await view.undo();
      const stillHidden = view.state.groups.hidden;
      return {
        afterHiding,
        record,
        hasGroups,
        changed: withHidden !== opened && both !== withHidden,
        undoneOnce: undoneOnce === withHidden,
        undoneTwice: undoneTwice === opened,
        redone: redone === withHidden,
        redoneBoth: redoneBoth === both,
        stillHidden,
      };
    },
    { arm, middle: ARM_MIDDLE },
  );
  expect(outcome.afterHiding).toEqual({ steps: 0, undone: 0, same: true });
  expect(outcome.record).toEqual([{ hidden: [arm], apart: [] }, undefined]);
  expect(outcome.hasGroups).toEqual([true, false]);
  expect(outcome.changed).toBe(true);
  expect(outcome.undoneOnce).toBe(true);
  expect(outcome.undoneTwice).toBe(true);
  // Redone with the arm shown, the first stroke still reaches the body behind it: the same bytes.
  expect(outcome.redone).toBe(true);
  expect(outcome.redoneBoth).toBe(true);
  expect(outcome.stillHidden).toEqual([arm]);
});

test('gives back the groups it was opened with, and refuses groups that are not the mesh’s (#139)', async ({
  figurePage: page,
}) => {
  const outcome = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const automatic = painting.view().groups();
    // Fifty triangles of the body moved into a group made by hand.
    const of = automatic.of.slice();
    let moved = 0;
    for (let t = 0; t < of.length && moved < 50; t++)
      if (of[t] === 0) {
        of[t] = automatic.made.length;
        moved++;
      }
    const made = [...automatic.made, { by: 'hand' as const }];
    await painting.open(null, null, { of, made });
    const view = painting.view();
    const back = view.groups();
    const list = view.state.groups.list.map((entry) => entry.triangles);
    const refusals: string[] = [];
    for (const groups of [
      { of: new Uint8Array(3), made: [{ by: 'body' as const }] },
      {
        of: of.map((group) => (group === made.length - 1 ? made.length : group)),
        made,
      },
      { of, made: [] },
    ])
      await painting.open(null, null, groups).then(
        () => refusals.push('opened'),
        (error: unknown) => refusals.push(error instanceof RangeError ? 'range' : String(error)),
      );
    return {
      automatic: automatic.made,
      same: back.of.length === of.length && back.of.every((group, t) => group === of[t]),
      made: back.made,
      list,
      refusals,
    };
  });
  expect(outcome.automatic[0]).toEqual({ by: 'body' });
  expect(outcome.automatic).toContainEqual({ by: 'base' });
  // The head and the two arms are shells of the body (the base may have one of its own: the
  // body's foot buried in the disc).
  expect(
    outcome.automatic.filter((origin) => origin.by === 'shell' && origin.of === 0),
  ).toHaveLength(3);
  expect(outcome.same).toBe(true);
  expect(outcome.made).toEqual([...outcome.automatic, { by: 'hand' }]);
  expect(outcome.list.at(-1)).toBe(50);
  expect(outcome.refusals).toEqual(['range', 'range', 'range']);
});
// The group tools (#139, §6): the group brush takes the triangles whose middle its stroke covers,
// the group fill floods what is connected up to the mask and the edge of its group, and the
// per-group fill and mask are steps with a `group` seed.

test('makes a group of exactly the triangles whose middle a group stroke covers, one step undone and redone (#139)', async ({
  figurePage: page,
}) => {
  await page.evaluate(() => window.__mt.painting.open());
  const head = await headGroup(page);
  const outcome = await page.evaluate(async (head) => {
    const painting = window.__mt.painting;
    const view = painting.view();
    const table = painting.table()!;
    view.setCamera(0, 5, 1.6);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const path = [-2, -1, 0, 1, 2].map((x) => view.texelAt(...view.screenOf([x, 28, 6]))!.point);
    const before = view.groups();
    view.setTool('group');
    view.setGroupTarget('new');
    view.setBrush({ sizeMm: 3, hardness: 0.8, opacity: 1 });
    const target = view.state.groups.target;
    await view.stroke(path);
    const after = view.groups();
    const steps = view.state.steps;
    // The same path with the flat brush: its alpha at each triangle's middle is the coverage the
    // group stroke read there.
    view.setTool('flat');
    await view.stroke(path);
    const { data } = await view.paint();
    let covered = 0;
    let mismatched = 0;
    for (let t = 0; t < after.of.length; t++) {
      let u = 0;
      let v = 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = table.indices[t * 3 + corner]!;
        u += table.uvs![vertex * 2]! / 3;
        v += table.uvs![vertex * 2 + 1]! / 3;
      }
      const texel = Math.floor(v * 1024) * 1024 + Math.floor(u * 1024);
      const inStroke = data[texel * 4 + 3]! >= 128;
      if (inStroke) covered++;
      const moved = after.of[t] === target;
      if (moved !== inStroke) mismatched++;
      if (!moved && after.of[t] !== before.of[t]) mismatched++;
    }
    const movedFrom = new Set<number>();
    for (let t = 0; t < after.of.length; t++)
      if (after.of[t] === target) movedFrom.add(before.of[t]!);
    // The new group hidden, then the two steps undone: the first leaves it hidden (its step is
    // replayed), the second takes it away, and with it out of the hidden ones.
    view.setGroupShown(target, false);
    await view.undo();
    const hiddenAfterOne = view.state.groups.hidden;
    await view.undo();
    const hiddenAfterTwo = view.state.groups.hidden;
    const undone = view.groups();
    await view.redo();
    const redone = view.groups();
    const same = (a: Uint8Array, b: Uint8Array): boolean =>
      a.length === b.length && a.every((group, t) => group === b[t]);
    return {
      target,
      groupsBefore: before.made.length,
      made: after.made.at(-1),
      steps,
      covered,
      mismatched,
      movedFrom: [...movedFrom],
      undone: same(undone.of, before.of) && undone.made.length === before.made.length,
      redone: same(redone.of, after.of) && redone.made.length === after.made.length,
      hiddenAfterOne,
      hiddenAfterTwo,
      head,
    };
  }, head);
  expect(outcome.target).toBe(outcome.groupsBefore);
  expect(outcome.made).toEqual({ by: 'hand' });
  expect(outcome.steps).toBe(1);
  expect(outcome.covered).toBeGreaterThan(20);
  expect(outcome.mismatched).toBe(0);
  // The stroke was on the head only.
  expect(outcome.movedFrom).toEqual([head]);
  expect(outcome.undone).toBe(true);
  expect(outcome.redone).toBe(true);
  expect(outcome.hiddenAfterOne).toEqual([outcome.target]);
  expect(outcome.hiddenAfterTwo).toEqual([]);
});

test('makes a group of the body above a band of mask with one tap of the group fill, and moves it back with another (#139)', async ({
  figurePage: page,
}) => {
  const tapTheChest = async (): Promise<void> => {
    const chest = await page.evaluate(async () => {
      const view = window.__mt.painting.view();
      view.setCamera(0, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return view.screenOf([0, 17, 6]);
    });
    const box = (await page.locator('#paint-view canvas').boundingBox())!;
    const before = await page.evaluate(() => window.__mt.painting.view().state.steps);
    await page.mouse.click(box.x + chest[0], box.y + chest[1]);
    await page.waitForFunction(
      (before) => window.__mt.painting.view().state.steps === before + 1,
      before,
    );
  };
  // The band of the #138 fill test: 10 mm up, all round the body, from eight sides.
  const original = await page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const table = painting.table()!;
    const ring: [number, number, number][] = [];
    for (let v = 0; v < table.positions.length / 3; v++) {
      const [x, y, z] = [0, 1, 2].map((k) => table.positions[v * 3 + k]!);
      if (Math.abs(y! - 10) < 0.3 && Math.abs(x!) < 5.6) ring.push([x!, y!, z!]);
    }
    ring.sort((a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
    view.setTool('mask');
    view.setBrush({ sizeMm: 5, hardness: 0.9, opacity: 1 });
    for (let side = 0; side < 8; side++) {
      view.setCamera(side * 45, 5, 1.6);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const seen = ring.filter((point) => {
        const hit = view.texelAt(...view.screenOf(point));
        return hit !== null && Math.hypot(...point.map((c, k) => c - hit.point[k]!)) < 0.3;
      });
      await view.stroke(seen);
    }
    view.setTool('group-fill');
    view.setGroupTarget('new');
    return Array.from(view.groups().of);
  });
  await tapTheChest();
  const filled = await page.evaluate((original) => {
    const painting = window.__mt.painting;
    const view = painting.view();
    const table = painting.table()!;
    const { of, made } = view.groups();
    const group = made.length - 1;
    const y = (t: number): number =>
      [0, 1, 2].reduce(
        (sum, corner) => sum + table.positions[table.indices[t * 3 + corner]! * 3 + 1]! / 3,
        0,
      );
    let inGroup = 0;
    let fromElsewhere = 0;
    let below = 0;
    let bodyAbove = 0;
    let bodyAboveLeft = 0;
    for (let t = 0; t < of.length; t++) {
      if (of[t] === group) {
        inGroup++;
        if (original[t] !== 0) fromElsewhere++;
        if (y(t) < 9) below++;
      }
      // Above the band: the 5 mm brush laid mask up to 12.5 mm.
      if (original[t] === 0 && y(t) > 13.5) {
        bodyAbove++;
        if (of[t] !== group) bodyAboveLeft++;
      }
    }
    view.setGroupTarget(0);
    return {
      made: made.at(-1),
      steps: view.state.steps,
      inGroup,
      fromElsewhere,
      below,
      bodyAbove,
      bodyAboveLeft,
    };
  }, original);
  await tapTheChest();
  const back = await page.evaluate((original) => {
    const view = window.__mt.painting.view();
    const { of } = view.groups();
    return {
      steps: view.state.steps,
      same: of.every((group, t) => group === original[t]),
    };
  }, original);
  expect(filled.made).toEqual({ by: 'hand' });
  expect(filled.steps).toBe(9);
  expect(filled.inGroup).toBeGreaterThan(500);
  // Only the body's triangles, none below the band, and all of the body above it.
  expect(filled.fromElsewhere).toBe(0);
  expect(filled.below).toBe(0);
  expect(filled.bodyAbove).toBeGreaterThan(500);
  expect(filled.bodyAboveLeft).toBe(0);
  expect(back).toEqual({ steps: 10, same: true });
});

test('fills and masks a group as one step each (#139)', async ({ figurePage: page }) => {
  await page.evaluate(() => window.__mt.painting.open());
  const head = await headGroup(page);
  const outcome = await page.evaluate(async (head) => {
    const painting = window.__mt.painting;
    const view = painting.view();
    const table = painting.table()!;
    const { of } = view.groups();
    // The texel at each triangle's middle, by whether it is the head's.
    const middles: { texel: number; head: boolean }[] = [];
    for (let t = 0; t < of.length; t++) {
      let u = 0;
      let v = 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = table.indices[t * 3 + corner]!;
        u += table.uvs![vertex * 2]! / 3;
        v += table.uvs![vertex * 2 + 1]! / 3;
      }
      middles.push({
        texel: Math.floor(v * 1024) * 1024 + Math.floor(u * 1024),
        head: of[t] === head,
      });
    }
    const alphas = (data: Uint8Array) => ({
      head: middles.filter((m) => m.head && data[m.texel * 4 + 3] !== 255).length,
      others: middles.filter((m) => !m.head && data[m.texel * 4 + 3] !== 0).length,
    });
    view.setColour('#00ff00');
    await view.fillGroup(head);
    const filled = alphas((await view.paint()).data);
    const afterFill = view.state.steps;
    // Masked, the head keeps its green under a red fill of the figure; unmasked, it turns red.
    await view.maskGroup(head, true);
    view.setColour('#ff0000');
    await view.fillRegion('figure');
    const red = (data: Uint8Array) =>
      middles.filter((m) => m.head && data[m.texel * 4] === 255 && data[m.texel * 4 + 1] === 0)
        .length;
    const whileMasked = red((await view.paint()).data);
    await view.maskGroup(head, false);
    await view.fillRegion('figure');
    const unmasked = red((await view.paint()).data);
    return {
      heads: middles.filter((m) => m.head).length,
      filled,
      afterFill,
      whileMasked,
      unmasked,
      steps: view.state.steps,
      tools: view
        .history()
        .map((step) => (step.kind === 'fill' ? [step.tool, step.seed.kind] : [])),
    };
  }, head);
  expect(outcome.heads).toBeGreaterThan(500);
  expect(outcome.filled).toEqual({ head: 0, others: 0 });
  expect(outcome.afterFill).toBe(1);
  expect(outcome.whileMasked).toBe(0);
  expect(outcome.unmasked).toBe(outcome.heads);
  expect(outcome.steps).toBe(5);
  expect(outcome.tools).toEqual([
    ['fill', 'group'],
    ['mask-fill', 'group'],
    ['fill', 'figure'],
    ['unmask-fill', 'group'],
    ['fill', 'figure'],
  ]);
});
test('lists the groups in the Paint tool, hides one from its box, and shows them in colour with a group tool (#139)', async ({
  figurePage: page,
}) => {
  await page.evaluate(async () => {
    await window.__mt.painting.open();
  });
  // The panel's rows (#166): a row a group with its Hide (the Apart beside it pulls it apart, #180).
  const panel = page.locator('#paint-panel');
  const rows = panel.locator('[data-groups]');
  const hide = rows.locator('[data-shown]');
  const count = await page.evaluate(() => window.__mt.painting.view().state.groups.list.length);
  await expect(hide).toHaveCount(count);
  await expect(rows.locator('[data-group="0"]')).toContainText('The body');
  await expect(rows).toContainText('The base');
  await expect(rows).toContainText('Shell 2 of the body');
  // The target starts at a new group: nothing to fill or mask yet.
  await expect(rows.locator('[data-target="new"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('[data-action="group-fill"]')).toBeDisabled();

  await hide.nth(1).click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.groups.hidden)).toEqual([1]);
  await expect(rows.locator('[data-group="1"]')).toHaveClass(/row-hidden/);
  await expect(hide.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('[data-action="groups-all"]').click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.groups.hidden)).toEqual([]);
  await expect(hide.nth(1)).toHaveAttribute('aria-pressed', 'false');

  await panel.locator('[data-tool="group"]').click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.groupTint)).toBe(true);
  await expect(panel.locator('[data-action="groups-tint"]')).toBeChecked();
  await panel.locator('[data-tool="flat"]').click();
  expect(await page.evaluate(() => window.__mt.painting.view().state.groupTint)).toBe(false);

  await rows.locator('[data-target="0"]').click();
  await expect(rows.locator('[data-group="0"]')).toHaveClass(/row-selected/);
  await panel.locator('[data-action="group-mask"]').click();
  await page.waitForFunction(() => window.__mt.painting.view().state.steps === 1);
  expect(
    await page.evaluate(() => {
      const step = window.__mt.painting.view().history()[0]!;
      return step.kind === 'fill' ? [step.tool, step.seed] : null;
    }),
  ).toEqual(['mask-fill', { kind: 'group', group: 0 }]);
});

// Pulling groups apart (#180, design note `docs/design/paint-groups.md` §9).

test('paints only the group a dab is on when groups are pulled apart, and replays to the same bytes with them together (#180)', async ({
  figurePage: page,
}) => {
  const { arm, offset, body, armBox } = await openWithTheArmApart(page);
  // The arm lies to the body's +x: pulled apart that way, at least the gap away.
  expect(offset[0]).toBeGreaterThan(5);
  expect(armBox.min[0]! - body.max[0]!).toBeGreaterThanOrEqual(9.9);
  const { of, texels } = await groupTexelsOf(page);
  const outcome = await page.evaluate(
    async ({ offset, body, armBox, of, texels }) => {
      const view = window.__mt.painting.view();
      const hash = async (): Promise<number> => {
        const { data } = await view.paint();
        let h = 0;
        for (let k = 0; k < data.length; k++) h = (Math.imul(h, 31) + data[k]!) | 0;
        return h;
      };
      const paintedByGroup = async (): Promise<Record<number, number>> => {
        const { data } = await view.paint();
        const counts: Record<number, number> = {};
        texels.forEach((texel, t) => {
          if (data[texel * 4 + 3] !== 0) counts[of[t]!] = (counts[of[t]!] ?? 0) + 1;
        });
        return counts;
      };
      const opened = await hash();
      // The arm's axis as drawn, at the height of its middle, and the pointer's path down its
      // front, from 4 mm above the middle to 4 mm below.
      const middle = [6 + offset[0], 19 + offset[1], -1 + offset[2]] as [number, number, number];
      const p = view.screenOf(middle);
      const under = view.texelAt(...p)!;
      const path: [number, number][] = [];
      for (let dy = 4; dy >= -4; dy -= 1)
        path.push(view.screenOf([middle[0], middle[1] + dy, middle[2]]));
      view.setTool('flat');
      view.setColour('#ffff00');
      view.setBrush({ sizeMm: 8, hardness: 0.8, opacity: 1 });
      await view.strokeAt(path);
      const apart = await paintedByGroup();
      const withApart = await hash();
      const step = view.history()[0]!;
      const dabs = step.kind === 'stroke' ? step.dabs : [];
      // A path from the body across the gap onto the arm: a second step, its dabs never in the gap.
      const across: [number, number][] = [];
      const start = view.screenOf([0, 19, 4]);
      for (let k = 0; k <= 12; k++)
        across.push([
          start[0] + ((p[0] - start[0]) * k) / 12,
          start[1] + ((p[1] - start[1]) * k) / 12,
        ]);
      await view.strokeAt(across);
      const crossing = view.history()[1]!;
      const crossingDabs = crossing.kind === 'stroke' ? crossing.dabs : [];
      let inGap = 0;
      for (let k = 0; k < crossingDabs.length; k += 4) {
        const x = crossingDabs[k]!;
        if (x > body.max[0]! + 1 && x < armBox.min[0]! - 1) inGap++;
      }
      const both = await paintedByGroup();
      await view.undo();
      const stateApart = view.state.groups.apart;
      // Together again: undo and redo replay the stroke with the offsets it recorded.
      view.putTogether();
      const together = view.state.groups.apart;
      await view.undo();
      const undone = await hash();
      await view.redo();
      const redone = await hash();
      // The same dabs with the groups together, in the mini's own coordinates: the body's shoulder
      // takes paint too, within the brush of the arm.
      const own: [number, number, number][] = [];
      for (let k = 0; k < dabs.length; k += 4)
        own.push([dabs[k]! - offset[0], dabs[k + 1]! - offset[1], dabs[k + 2]! - offset[2]]);
      await view.stroke(own);
      const togetherPainted = await paintedByGroup();
      const records = view.history().map((step) => (step.kind === 'mask' ? null : step.groups));
      return {
        underGroup: of[under.triangle],
        underPoint: under.point,
        dabs: dabs.length / 4,
        apart,
        inGap,
        crossingDabs: crossingDabs.length / 4,
        both,
        stateApart,
        together,
        undone: undone === opened,
        redone: redone === withApart,
        togetherPainted,
        records,
      };
    },
    { offset, body, armBox, of, texels },
  );
  // The tap lands on the arm as drawn, and gives the point in the mini's own coordinates.
  expect(outcome.underGroup).toBe(arm);
  expect(outcome.underPoint[0]).toBeLessThan(10);
  expect(outcome.dabs).toBeGreaterThanOrEqual(4);
  // The stroke down the arm paints the arm alone: the body's shoulder, within the brush in the
  // mini's own coordinates, lies the gap away as drawn.
  expect(outcome.apart[arm]).toBeGreaterThan(50);
  expect(outcome.apart[0] ?? 0).toBe(0);
  expect(Object.keys(outcome.apart)).toEqual([String(arm)]);
  // Across the gap the brush lifts: both take paint, no dab lies between them.
  expect(outcome.crossingDabs).toBeGreaterThan(4);
  expect(outcome.inGap).toBe(0);
  expect(outcome.both[0]).toBeGreaterThan(0);
  expect(outcome.both[arm]).toBeGreaterThan(outcome.apart[arm]!);
  // Undo leaves the groups apart; Put together is not a step.
  expect(outcome.stateApart.map((entry) => entry.group)).toContain(arm);
  expect(outcome.together).toEqual([]);
  expect(outcome.undone).toBe(true);
  expect(outcome.redone).toBe(true);
  expect(outcome.togetherPainted[0]).toBeGreaterThan(0);
  expect(outcome.records[0]).toEqual({
    hidden: [],
    apart: expect.arrayContaining([{ group: arm, offset }]),
  });
  expect(outcome.records[1]).toBeUndefined();
});

test('makes an arm-without-hand group with the arm pulled apart, a band of mask at the wrist and one tap of the group fill (#180)', async ({
  figurePage: page,
}) => {
  const { arm, offset } = await openWithTheArmApart(page);
  // The wrist: a 3 mm band of mask round the arm at y = 17 (the arm spans 13 to 25), laid from
  // eight sides on the arm as drawn, through the middles of the triangles the band crosses.
  const original = await page.evaluate(
    async ({ arm, offset }) => {
      const painting = window.__mt.painting;
      const view = painting.view();
      const table = painting.table()!;
      const { of } = view.groups();
      const ring: [number, number, number][] = [];
      for (let t = 0; t < of.length; t++) {
        if (of[t] !== arm) continue;
        const middle = [0, 0, 0];
        for (let corner = 0; corner < 3; corner++) {
          const v = table.indices[t * 3 + corner]! * 3;
          for (let k = 0; k < 3; k++) middle[k] = middle[k]! + table.positions[v + k]! / 3;
        }
        if (Math.abs(middle[1]! - 17) < 0.8)
          ring.push([middle[0]! + offset[0], middle[1]! + offset[1], middle[2]! + offset[2]]);
      }
      view.setTool('mask');
      view.setBrush({ sizeMm: 3, hardness: 0.9, opacity: 1 });
      for (let side = 0; side < 8; side++) {
        view.setCamera(side * 45, 5, 1.6);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const inSight = ring.filter((point) => {
          const hit = view.texelAt(...view.screenOf(point));
          if (hit === null || of[hit.triangle] !== arm) return false;
          const own = [point[0] - offset[0], point[1] - offset[1], point[2] - offset[2]];
          return Math.hypot(...own.map((c, k) => c - hit.point[k]!)) < 0.3;
        });
        await view.stroke(inSight);
      }
      view.setCamera(0, 5, 1);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      view.setTool('group-fill');
      view.setGroupTarget('new');
      return { of: Array.from(of), ring: ring.length, steps: view.state.steps };
    },
    { arm, offset },
  );
  expect(original.ring).toBeGreaterThan(8);
  expect(original.steps).toBeGreaterThan(0);
  // One tap on the arm above the band, as drawn.
  const upper = await page.evaluate(
    ({ offset }) =>
      window.__mt.painting.view().screenOf([6 + offset[0], 22 + offset[1], 1 + offset[2]]),
    { offset },
  );
  const box = (await page.locator('#paint-view canvas').boundingBox())!;
  await page.mouse.click(box.x + upper[0], box.y + upper[1]);
  await page.waitForFunction(
    (before) => window.__mt.painting.view().state.steps === before + 1,
    original.steps,
  );
  const filled = await page.evaluate(
    ({ original, arm }) => {
      const painting = window.__mt.painting;
      const view = painting.view();
      const table = painting.table()!;
      const { of, made } = view.groups();
      const group = made.length - 1;
      const y = (t: number): number =>
        [0, 1, 2].reduce(
          (sum, corner) => sum + table.positions[table.indices[t * 3 + corner]! * 3 + 1]! / 3,
          0,
        );
      let inGroup = 0;
      let fromElsewhere = 0;
      let below = 0;
      let armAbove = 0;
      let armAboveLeft = 0;
      let handLeft = 0;
      let handMoved = 0;
      for (let t = 0; t < of.length; t++) {
        if (of[t] === group) {
          inGroup++;
          if (original[t] !== arm) fromElsewhere++;
          if (y(t) < 15) below++;
        }
        if (original[t] !== arm) continue;
        // Above the band: the 3 mm brush laid mask up to 18.5 mm.
        if (y(t) > 19.5) {
          armAbove++;
          if (of[t] !== group) armAboveLeft++;
        }
        // The hand, below the band.
        if (y(t) < 15) {
          if (of[t] === arm) handLeft++;
          else handMoved++;
        }
      }
      const step = view.history().at(-1)!;
      return {
        made: made.at(-1),
        record: step.kind === 'fill' ? step.groups : null,
        inGroup,
        fromElsewhere,
        below,
        armAbove,
        armAboveLeft,
        handLeft,
        handMoved,
        apart: view.state.groups.apart.map((entry) => entry.group),
      };
    },
    { original: original.of, arm },
  );
  expect(filled.made).toEqual({ by: 'hand' });
  // The arm above the wrist, and only that: nothing of the body, nothing below the band.
  expect(filled.inGroup).toBeGreaterThan(100);
  expect(filled.fromElsewhere).toBe(0);
  expect(filled.below).toBe(0);
  expect(filled.armAbove).toBeGreaterThan(100);
  expect(filled.armAboveLeft).toBe(0);
  // The hand stays in the arm's group, which keeps its offset.
  expect(filled.handLeft).toBeGreaterThan(10);
  expect(filled.handMoved).toBe(0);
  expect(filled.apart).toContain(arm);
  expect(filled.record?.apart.map((entry) => entry.group)).toContain(arm);
});

test('pulls the groups apart and puts them together from the Paint tool, one group from its box (#180)', async ({
  figurePage: page,
}) => {
  await page.evaluate(async () => {
    await window.__mt.painting.open();
  });
  const apart = (): Promise<number[]> =>
    page.evaluate(() => window.__mt.painting.view().state.groups.apart.map((entry) => entry.group));
  const count = await page.evaluate(() => window.__mt.painting.view().state.groups.list.length);
  // An Apart a group but the body, unpressed: nothing is apart.
  const panel = page.locator('#paint-panel');
  const boxes = panel.locator('[data-groups] [data-apart]');
  const together = panel.locator('[data-action="groups-together"]');
  await expect(boxes).toHaveCount(count - 1);
  await expect(together).toBeDisabled();
  expect(await apart()).toEqual([]);

  await panel.locator('[data-action="groups-apart"]').click();
  // The base, the head and both arms all lie within the gap of the body.
  expect((await apart()).length).toBeGreaterThanOrEqual(4);
  await expect(boxes.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(together).toBeEnabled();
  await together.click();
  expect(await apart()).toEqual([]);
  await expect(boxes.first()).toHaveAttribute('aria-pressed', 'false');

  await boxes.nth(1).click();
  expect(await apart()).toEqual([2]);
  await expect(boxes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await boxes.nth(1).click();
  expect(await apart()).toEqual([]);
  // Not a step, and hiding is untouched.
  expect(
    await page.evaluate(() => {
      const { steps, undone, groups } = window.__mt.painting.view().state;
      return { steps, undone, hidden: groups.hidden };
    }),
  ).toEqual({ steps: 0, undone: 0, hidden: [] });
});
