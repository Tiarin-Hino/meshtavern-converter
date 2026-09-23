import { expect, test } from '@playwright/test';

/**
 * The longest the page may stand still, in ms (Phase 1 spec, story 2). CI runners draw the
 * scene in software on two shared cores, where one frame alone can take longer, so the
 * limit is only enforced as it stands where a GPU does the drawing: STALL_LIMIT=strict.
 */
const MAX_STALL_MS = process.env.STALL_LIMIT === 'strict' ? 100 : 400;

// Most tests are about something other than baking and switch it off (a development option)
// to stay quick on CI runners; the tests of the normal path open the page without options.
test.beforeEach(async ({ page }) => {
  await page.goto('/?bake=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
});

test('converts the demo mini in the worker and renders it', async ({ page }, testInfo) => {
  await page.evaluate(() => window.__mt.loadDemo());
  const state = await page.evaluate(() => window.__mt.state);

  expect(state.error).toBeNull();
  expect(state.stats?.sourceTriangles).toBe(6);
  expect(state.stats?.vertices).toBe(5);
  // Y-up after conversion: 25 mm base, 32 mm tall.
  expect(state.stats?.sizeMm).toEqual([25, 32, 25]);
  expect(state.progressLog.map((p) => p.step)).toEqual([
    'read',
    'weld',
    'orient',
    'size',
    'simplify',
    'shade',
    'levels',
  ]);
  await expect(page.locator('#stats')).toContainText('Triangles');

  // Attached to the CI run so a human can check what the agent cannot: does it look right?
  await page.waitForTimeout(500);
  await testInfo.attach('demo-mini', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });
});

test('keeps the page responsive while a large mesh converts', async ({ page }) => {
  // 500 quads per side = 500,000 triangles, a 25 MB STL: large enough to take a while, small enough for CI.
  await page.evaluate(() => window.__mt.loadGenerated(500));
  const state = await page.evaluate(() => window.__mt.state);

  expect(state.error).toBeNull();
  expect(state.stats?.triangles).toBe(500_000);
  expect(state.stats?.vertices).toBe(501 * 501);
  // Frames kept coming while the worker was busy, with no stall near the conversion time.
  // Every level is a real reduction of the 500k sheet.
  expect(state.stats?.lods.map((lod) => lod.name)).toEqual(['close', 'table', 'far']);
  for (const lod of state.stats!.lods) {
    expect(lod.triangles).toBeLessThan(500_000);
    expect(lod.triangles).toBeGreaterThan(3_000);
  }
  expect(state.framesWhileConverting).toBeGreaterThan(2);
  expect(state.longestFrameGapMs).toBeLessThan(Math.max(250, state.stats!.totalMs / 2));
});

test('switches between detail levels without moving the camera', async ({ page }, testInfo) => {
  await page.evaluate(() => window.__mt.loadGenerated(200));
  await page.getByRole('button', { name: /^far/ }).click();
  expect(await page.evaluate(() => window.__mt.state.shownLevel)).toBe(3);
  await expect(page.getByRole('button', { name: /^far/ })).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => window.__mt.setWireframe(true));
  await page.waitForTimeout(300);
  await testInfo.attach('sheet-4k-wireframe', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });
});

test('fills the table with 100 minis and reports rendering figures', async ({ page }, testInfo) => {
  // Software rendering of 100 minis is slow on CI runners.
  test.setTimeout(180_000);
  await page.evaluate(() => window.__mt.loadGenerated(200));
  await page.getByRole('button', { name: '100 minis', exact: true }).click();
  await page.waitForFunction(() => window.__mt.state.perf?.minis === 100);
  await page.waitForTimeout(1500);
  const perf = await page.evaluate(() => window.__mt.state.perf!);

  // Structure only. CI renders in software, so its speed says nothing about real hardware.
  expect(perf.drawCalls).toBeGreaterThanOrEqual(100);
  expect(perf.minisPerLod.reduce((sum, count) => sum + count, 0)).toBe(100);
  expect(perf.triangles).toBeGreaterThan(100 * 3000);
  expect(perf.frameMs).toBeGreaterThan(0);
  await testInfo.attach('stress-100', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });

  await page.getByRole('button', { name: 'Single mini' }).click();
  expect(await page.evaluate(() => window.__mt.state.stressCount)).toBe(0);
});

test('draws the 32 mm grid and stands stress minis one footprint apart', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  // The demo pyramid stands on a 25 mm base: Small, one square.
  await page.evaluate(() => window.__mt.loadDemo());
  await page.evaluate(() => window.__mt.setCamera(34, 55, 0.3));
  await page.waitForTimeout(500);
  await testInfo.attach('grid-32mm-demo', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__mt.startStress(16));
  await expect.poll(() => page.evaluate(() => window.__mt.state.perf?.stressSpacingMm)).toBe(32);
  await page.waitForTimeout(500);
  await testInfo.attach('grid-32mm-stress-small', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });

  // A mini chosen Large takes 2×2 squares: 64 mm apart.
  await page.evaluate(() => window.__mt.loadGenerated(40));
  await page.evaluate(() => window.__mt.setSizing({ size: 'large' }));
  expect(await page.evaluate(() => window.__mt.state.stats!.sizing.footprintSquares)).toBe(2);
  await page.evaluate(() => window.__mt.startStress(16));
  // The figures refresh twice a second; the first read may still be the last scene's.
  await expect.poll(() => page.evaluate(() => window.__mt.state.perf?.stressSpacingMm)).toBe(64);
});

test('suggests a creature size and lets the user change units, size, scale and base', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const sizing = () => page.evaluate(() => window.__mt.state.stats!.sizing);
  const sizeMm = () => page.evaluate(() => window.__mt.state.stats!.sizeMm);
  // A control converts the file again; the next step waits until that is done.
  const settled = () => page.waitForFunction(() => !window.__mt.state.busy);

  // The demo pyramid stands on a 25 mm square base: Small, one square.
  await page.evaluate(() => window.__mt.loadDemo());
  expect(await sizing()).toMatchObject({
    units: 'mm',
    unitsMethod: 'guessed',
    size: 'small',
    sizeMethod: 'suggested',
    footprintSquares: 1,
    baseDiameterMm: 25,
    base: { shape: 'other' },
  });
  await expect(page.locator('#stats')).toContainText('Small (1×1) (suggested), base 25.0 mm');
  await expect(page.locator('#stats')).toContainText('mm (guessed)');
  await expect(page.locator('#size')).toHaveValue('small');
  await expect(page.locator('#plain-base')).toBeDisabled();

  await page.evaluate(() => window.__mt.setSizing({ size: 'medium' }));
  expect(await sizing()).toMatchObject({ size: 'medium', sizeMethod: 'manual' });
  await expect(page.locator('#stats')).toContainText('Medium (1×1) (chosen)');

  // Scaling to a 32 mm base: 25 → 32 mm across, the height with it.
  await page.evaluate(() => window.__mt.setSizing({ scaleToBaseMm: 32 }));
  expect((await sizing()).scale).toBeCloseTo(1.28, 6);
  const [width, height] = await sizeMm();
  expect(width).toBeCloseTo(32, 4);
  expect(height).toBeCloseTo(32 * 1.28, 4);
  // The size choice was kept.
  expect((await sizing()).size).toBe('medium');

  // Choosing Tiny for a 32 mm base: a warning and the offer to scale; nothing rescaled.
  await page.evaluate(() => window.__mt.setSizing({ scaleToBaseMm: undefined }));
  await page.selectOption('#size', 'large');
  await settled();
  await expect(page.locator('#stats')).toContainText('Large (2×2) (chosen)');
  await page.evaluate(() => window.__mt.setSizing({ size: 'tiny', scaleToBaseMm: 40 }));
  expect((await sizing()).warnings).toEqual([
    { kind: 'base-exceeds-footprint', baseMm: 40, footprintMm: 32 },
  ]);
  await expect(page.locator('#sizing-warning')).toBeVisible();
  await testInfo.attach('sizing-warning', {
    body: await page.locator('header').screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Scale to fit' }).click();
  await settled();
  await expect(page.locator('#sizing-warning')).toBeHidden();
  expect(await sizing()).toMatchObject({ size: 'tiny', baseDiameterMm: 32, warnings: [] });

  // Units: the file read as inches is 25.4 times larger.
  await page.selectOption('#units', 'in');
  await settled();
  await expect(page.locator('#stats')).toContainText('inches (chosen)');
  expect((await sizeMm())[0]).toBeCloseTo(25 * 25.4, 2);
  expect((await sizing()).warnings.map((warning) => warning.kind)).toContain(
    'larger-than-gargantuan',
  );

  // A new file starts without the choices of the last one.
  await page.evaluate(() => window.__mt.loadDemo());
  expect(await sizing()).toMatchObject({ units: 'mm', size: 'small', scale: 1 });
});

test('adds a plain base to a mini without one', async ({ page }) => {
  // A 50 mm sheet has no base: Medium, whatever its width.
  await page.evaluate(() => window.__mt.loadGenerated(20));
  expect(await page.evaluate(() => window.__mt.state.stats!.sizing)).toMatchObject({
    base: null,
    plainBase: null,
    size: 'medium',
    suggestedFrom: 'default',
  });
  const before = await page.evaluate(() => window.__mt.state.stats!.triangles);
  await page.locator('#plain-base').check();
  await page.waitForFunction(() => !window.__mt.state.busy);
  const stats = await page.evaluate(() => window.__mt.state.stats!);
  expect(stats.sizing).toMatchObject({ plainBase: { diameterMm: 32 }, baseDiameterMm: 32 });
  expect(stats.triangles).toBeGreaterThan(before);
  await expect(page.locator('#stats')).toContainText('plain base 32.0 mm (added)');
});

test('applies the primed-and-washed look and lets the user adjust it', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => window.__mt.loadGenerated(200));
  expect(await page.evaluate(() => window.__mt.state.look.enabled)).toBe(true);
  expect(await page.evaluate(() => window.__mt.state.stats?.timings.map((t) => t.step))).toContain(
    'shade',
  );

  await page.getByLabel('Base coat').fill('#c9b994');
  await page.getByLabel('Shadows').fill('1');
  expect(await page.evaluate(() => window.__mt.state.look)).toMatchObject({
    base: '#c9b994',
    occlusion: 1,
  });
  await page.waitForTimeout(300);
  await testInfo.attach('sheet-washed-bone', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });

  await page.getByLabel('Primed and washed').uncheck();
  expect(await page.evaluate(() => window.__mt.state.look.enabled)).toBe(false);
});

test('exports a level as GLB and opens the file again', async ({ page }, testInfo) => {
  await page.evaluate(() => window.__mt.loadGenerated(200));
  const result = await page.evaluate(async () => {
    const plain = await window.__mt.exportGlb(2, false);
    const compact = await window.__mt.exportGlb(2, true);
    await window.__mt.loadGlb(compact, 'round-trip.glb');
    const jsonLength = new DataView(plain).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(plain, 20, jsonLength)));
    return {
      extras: json.extras.meshtavern,
      plainBytes: plain.byteLength,
      compactBytes: compact.byteLength,
      imported: window.__mt.state.imported,
      table: window.__mt.state.stats!.lods[1]!,
      error: window.__mt.state.error,
    };
  });

  expect(result.error).toBeNull();
  // What the table needs to place the mini travels in the file.
  expect(result.extras).toEqual({
    gridSquareMm: 32,
    size: 'medium',
    footprintSquares: 1,
    baseDiameterMm: 32,
    units: 'mm',
    scale: 1,
  });
  expect(result.compactBytes).toBeLessThan(result.plainBytes / 2);
  expect(result.imported?.triangles).toBe(result.table.triangles);
  // glTF is in metres; after the round trip the sheet must be 50 mm wide again.
  expect(result.imported?.sizeMm[0]).toBeCloseTo(50, 1);
  await expect(page.locator('#status')).toContainText('round-trip.glb');
  await page.waitForTimeout(300);
  await testInfo.attach('reopened-glb', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });

  // The download button offers a file named after the mini and the level.
  await page.evaluate(() => window.__mt.loadGenerated(50));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download GLB' }).click();
  // A converted mini opens on its table level.
  expect((await download).suggestedFilename()).toBe('generated-50-table.glb');
});

test('bakes and compresses a mini without being asked to, and shows it that way', async ({
  page,
}, testInfo) => {
  // Loading and warming up the unwrapper, unwrapping, baking and encoding are slow on CI runners.
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadGenerated(300));
  const state = await page.evaluate(() => window.__mt.state);

  expect(state.error).toBeNull();
  expect(state.stats?.bakeSkipped).toBeNull();
  // Every step ran in the worker, was announced and was timed.
  const steps = [
    'read',
    'weld',
    'orient',
    'size',
    'simplify',
    'shade',
    'levels',
    'unwrap',
    'bake',
    'compress',
  ];
  expect(state.progressLog.map((p) => p.step)).toEqual(steps);
  expect(state.stats?.timings.map((t) => t.step)).toEqual(steps);
  // A 50 mm sheet: the size policy picks 1024 px.
  expect(state.baked?.resolution).toBe(1024);
  expect(state.baked?.charts).toBeGreaterThan(0);
  expect(state.baked?.coverage).toBeGreaterThan(0.2);

  // The texture the page holds is the KTX2 file, with Zstandard, far below 4 bytes a texel.
  const header = await page.evaluate(() => {
    const ktx2 = window.__mt.detailKtx2()!;
    const view = new DataView(ktx2.buffer, ktx2.byteOffset);
    return {
      magic: String.fromCharCode(...ktx2.subarray(1, 7)),
      width: view.getUint32(20, true),
      supercompression: view.getUint32(44, true),
      bytes: ktx2.byteLength,
    };
  });
  expect(header).toMatchObject({ magic: 'KTX 20', width: 1024, supercompression: 2 });
  expect(header.bytes).toBe(state.baked?.ktx2Bytes);
  expect(header.bytes).toBeLessThan(1024 * 1024);

  // What is on screen is the baked table level, drawn from the compressed texture.
  expect(state.shownLevel).toBe(2);
  expect(state.showingBaked).toBe(true);
  await page.waitForTimeout(600);
  const perf = await page.evaluate(() => window.__mt.state.perf!);
  expect(perf.bakedMinis).toBe(1);
  expect(perf.textureBytes).toBe(Math.round((1024 * 1024 * 4) / 3));
  await expect(page.locator('#stats')).toContainText('baked, 1024 px');
  await testInfo.attach('sheet-baked', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });

  await page.evaluate(() => window.__mt.showBaked(false));
  expect(await page.evaluate(() => window.__mt.state.showingBaked)).toBe(false);
});

test('the page does not freeze while a mini is converted, baked and shown', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  // The first conversion after opening the page is the hardest case: everything loads and compiles.
  await page.evaluate(() => window.__mt.loadGenerated(300));
  const state = await page.evaluate(() => window.__mt.state);

  expect(state.error).toBeNull();
  expect(state.showingBaked).toBe(true);
  expect(state.framesWhileConverting).toBeGreaterThan(10);
  expect(state.longestFrameGapMs).toBeLessThan(MAX_STALL_MS);
});

test('a running conversion can be cancelled, and the next one works', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  const conversion = page.evaluate(() => window.__mt.loadGenerated(500));
  await page.waitForFunction(() => window.__mt.state.progressLog.length > 1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await conversion;

  const state = await page.evaluate(() => window.__mt.state);
  expect(state).toMatchObject({ cancelled: true, busy: false, error: null, stats: null });
  await expect(page.locator('#status')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden();

  await page.evaluate(() => window.__mt.loadDemo());
  const after = await page.evaluate(() => window.__mt.state);
  expect(after).toMatchObject({ cancelled: false, error: null, showingBaked: true });
  expect(after.stats?.sourceTriangles).toBe(6);
});

test('development options switch compression off', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?bake=256&ktx=off');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.evaluate(() => window.__mt.loadGenerated(300));
  const state = await page.evaluate(() => window.__mt.state);
  expect(state.baked).toMatchObject({ resolution: 256, ktx2Bytes: null });
  expect(state.stats?.timings.map((t) => t.step)).not.toContain('compress');
  expect(await page.evaluate(() => window.__mt.detailKtx2())).toBeNull();
});

test('runs the device benchmark and offers the result as text', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?settle=1');
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.getByText('Benchmark this device').click();

  // The buttons run the light and full sizes, too heavy for a software renderer; the hook runs a tiny one.
  const result = await page.evaluate(() => window.__mt.runBenchmark('tiny'));
  expect(result).toContain('**GPU:**');
  expect(result).toContain('| Source triangles | 7,200 |');
  expect(result).toContain('| 400 minis, detail by distance |');
  expect(result).toContain('**Headroom:**');
  await expect(page.locator('#bench-result')).toHaveValue(/100 minis, all at table level/);
  await expect(page.getByRole('button', { name: 'Copy result' })).toBeEnabled();
});
