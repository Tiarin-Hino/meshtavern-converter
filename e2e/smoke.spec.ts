import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
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
    return {
      plainBytes: plain.byteLength,
      compactBytes: compact.byteLength,
      imported: window.__mt.state.imported,
      table: window.__mt.state.stats!.lods[1]!,
      error: window.__mt.state.error,
    };
  });

  expect(result.error).toBeNull();
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
  expect((await download).suggestedFilename()).toBe('generated-50-close.glb');
});
