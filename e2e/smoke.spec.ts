import { expect, test } from '@playwright/test';

test('loads the demo mini and renders it', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  await page.evaluate(() => window.__mt.loadDemo());
  const info = await page.evaluate(() => window.__mt.state.info);
  expect(info?.triangleCount).toBe(6);
  expect(info?.bounds?.max[2]).toBe(32);
  await expect(page.locator('#status')).toContainText('6 triangles');

  // Attached to the CI run so a human can check what the agent cannot: does it look right?
  await page.waitForTimeout(500);
  await testInfo.attach('demo-mini', {
    body: await page.locator('#viewport').screenshot(),
    contentType: 'image/png',
  });
});
