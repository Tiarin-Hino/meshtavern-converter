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
  await page.goto('/?dev&bake=off');
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
  // The 50 mm sheet is Medium without a base; 32 mm apart the copies overlap and the scene
  // gets too heavy for CI's software renderer. As Large they stand 64 mm apart, close to the
  // 50.8 mm the scene had before the 32 mm grid.
  await page.evaluate(() => window.__mt.loadGenerated(200, { size: 'large' }));
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
  // End on a drawn frame of the single mini: in software rendering one frame of 100 minis can
  // take seconds, and closing the page during it broke the browser for the next test on CI.
  await page.waitForFunction(() => window.__mt.state.perf?.minis === 0, null, { timeout: 120_000 });
});

test('draws the 32 mm grid and stands stress minis one footprint apart', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  // The demo pyramid stands on a 25 mm base: Medium, one square.
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

  // The demo pyramid stands on a 25 mm square base: Medium, one square.
  await page.evaluate(() => window.__mt.loadDemo());
  expect(await sizing()).toMatchObject({
    units: 'mm',
    unitsMethod: 'guessed',
    size: 'medium',
    sizeMethod: 'suggested',
    footprintSquares: 1,
    baseDiameterMm: 25,
    base: { shape: 'other' },
  });
  await expect(page.locator('#stats')).toContainText('Medium (1×1) (suggested), base 25.0 mm');
  await expect(page.locator('#stats')).toContainText('mm (guessed)');
  await expect(page.locator('#size')).toHaveValue('medium');
  await expect(page.locator('#plain-base')).toBeDisabled();

  await page.evaluate(() => window.__mt.setSizing({ size: 'small' }));
  expect(await sizing()).toMatchObject({ size: 'small', sizeMethod: 'manual' });
  await expect(page.locator('#stats')).toContainText('Small (1×1) (chosen)');

  // A Medium mini on a 20 mm base is offered a scale up to 25 mm, and only scaled on the click.
  await page.evaluate(() => window.__mt.setSizing({ size: 'medium', scaleToBaseMm: 20 }));
  expect((await sizing()).warnings).toEqual([
    { kind: 'base-small-for-size', baseMm: 20, targetMm: 25 },
  ]);
  expect((await sizing()).baseDiameterMm).toBeCloseTo(20, 4);
  await page.getByRole('button', { name: 'Scale up to a 25 mm base' }).click();
  await settled();
  expect(await sizing()).toMatchObject({ size: 'medium', baseDiameterMm: 25, warnings: [] });
  await expect(page.locator('#sizing-warning')).toBeHidden();

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
    body: await page.locator('#panel').screenshot(),
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
  // A 635 mm base: the page asks about the units and offers no scale button.
  expect((await sizing()).warnings[0]?.kind).toBe('larger-than-gargantuan');
  await expect(page.locator('#sizing-warning')).toContainText('are the units right?');
  await expect(page.locator('#scale-fit')).toBeHidden();

  // A new file starts without the choices of the last one.
  await page.evaluate(() => window.__mt.loadDemo());
  expect(await sizing()).toMatchObject({ units: 'mm', size: 'medium', scale: 1 });
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

test('turns the mini by hand, shows the turn before converting, and sets it down', async ({
  page,
}, testInfo) => {
  const stats = () => page.evaluate(() => window.__mt.state.stats!);
  // The demo pyramid stands on a flat 25 mm base: found as a base, Z-up.
  await page.evaluate(() => window.__mt.loadDemo());
  expect((await stats()).orientation).toMatchObject({ up: '+z', method: 'base', tiltDeg: 0 });
  await expect(page.locator('#stats')).toContainText('+z (base, 1.00)');
  const conversions = await page.evaluate(() => window.__mt.state.progressLog.length);

  // Two steps of 15°: shown in the viewer and in words, nothing converted.
  await page.evaluate(() => {
    window.__mt.turn('pitch', 15);
    window.__mt.turn('pitch', 15);
  });
  const turned = await page.evaluate(() => window.__mt.state.orientation);
  expect(turned.turnDeg).toBeCloseTo(30, 6);
  expect(await page.evaluate(() => window.__mt.state.busy)).toBe(false);
  expect(await page.evaluate(() => window.__mt.state.progressLog.length)).toBe(conversions);
  await expect(page.locator('#turn-pending')).toHaveText('Turned 30°, not set down yet');
  await page.evaluate(() => window.__mt.setCamera(90, 10, 1));
  await page.waitForTimeout(500);
  const pendingShot = testInfo.outputPath('turn-pending.png');
  await page.screenshot({ path: pendingShot });
  await testInfo.attach('turn-pending', { path: pendingShot, contentType: 'image/png' });

  // Set down: converted with the turn, and back on its flat base, level.
  await page.evaluate(() => window.__mt.setDown());
  const orientation = (await stats()).orientation;
  expect(orientation).toMatchObject({ up: '+z', method: 'manual', tiltDeg: 0 });
  expect(orientation.setDownDeg).toBeCloseTo(30, 3);
  expect((await stats()).sizing.base).not.toBeNull();
  expect((await stats()).sizeMm).toEqual([25, 32, 25]);
  await expect(page.locator('#stats')).toContainText('+z (manual, set down 30°)');
  await expect(page.locator('#turn-pending')).toBeHidden();
  expect(await page.evaluate(() => window.__mt.state.orientation.turn)).toBeNull();
  await page.evaluate(() => window.__mt.setCamera(90, 10, 1));
  await page.waitForTimeout(500);
  const setDownShot = testInfo.outputPath('turn-set-down.png');
  await page.locator('#viewport').screenshot({ path: setDownShot });
  await testInfo.attach('turn-set-down', { path: setDownShot, contentType: 'image/png' });

  // Apply keeps exactly what the user turned: the placement is theirs, nothing is levelled.
  await page.evaluate(() => window.__mt.turn('roll', 15));
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__mt.state.stats?.orientation.method))
    .toBe('manual');
  await page.waitForFunction(() => !window.__mt.state.busy);
  const applied = (await stats()).orientation;
  expect(applied).toMatchObject({ up: '+z', setDownDeg: 0 });
  expect(applied.tiltDeg).toBeCloseTo(15, 3);
  await expect(page.locator('#stats')).toContainText('+z (manual, tilted 15°)');

  // The six-way select takes the axis as chosen, without setting the mini down.
  await page.evaluate(() => window.__mt.setUp('+x'));
  expect((await stats()).orientation).toMatchObject({
    up: '+x',
    method: 'manual',
    tiltDeg: 0,
    setDownDeg: 0,
  });

  // A turn can be dropped again without converting.
  await page.getByRole('button', { name: 'Roll +15°' }).click();
  await expect(page.locator('#turn-pending')).toHaveText('Turned 15°, not set down yet');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#turn-pending')).toBeHidden();
  expect(await page.evaluate(() => window.__mt.state.orientation.turnDeg)).toBe(0);
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
    // The generated sheet is Y-up in its file: turned by nothing.
    rotation: [0, 0, 0, 1],
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

  // The two download buttons offer files named after the mini and their own level, whatever
  // level is on screen; the close level is shown but never offered (PM decision, 2026-09-20).
  await page.evaluate(() => window.__mt.loadGenerated(50));
  await page.getByRole('button', { name: /^Close|^close/ }).click();
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download table level' }).click();
  expect((await download).suggestedFilename()).toBe('generated-50-table.glb');
  download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download far level' }).click();
  expect((await download).suggestedFilename()).toBe('generated-50-far.glb');
  await expect(page.getByRole('button', { name: /download close/i })).toHaveCount(0);
});

test('bakes and compresses a mini without being asked to, and shows it that way', async ({
  page,
}, testInfo) => {
  // Loading and warming up the unwrapper, unwrapping, baking and encoding are slow on CI runners.
  test.setTimeout(240_000);
  await page.goto('/?dev');
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
  await expect(page.locator('#status')).toContainText(/cancelled/i);
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
  await page.goto('/?dev&settle=1');
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
