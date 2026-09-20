// Exports every level of every STL in corpus/ as GLB, plain and compressed, opens each
// compressed file again in the viewer, and prints a size table. Real Chrome, GPU on.
// Usage: npm run build && node scripts/export-sizes.mjs
// Files are only measured, never written to disk.
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4178;
const files = readdirSync('corpus').filter((file) => file.toLowerCase().endsWith('.stl'));
if (files.length === 0) throw new Error('No STL files in corpus/');

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString()} KB`;
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  console.log('| Mini | STL | Level | Triangles | Plain GLB | Compressed GLB | Re-opened |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');

  for (const file of files) {
    await page.evaluate(() => (window.__mt.state.stats = null));
    await page.setInputFiles('#file', join('corpus', file));
    await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
      timeout: 120_000,
    });
    const rows = await page.evaluate(async () => {
      const out = [];
      const lods = window.__mt.state.stats.lods;
      for (let level = 1; level <= lods.length; level++) {
        const plain = await window.__mt.exportGlb(level, false);
        const start = performance.now();
        const compact = await window.__mt.exportGlb(level, true);
        const encodeMs = performance.now() - start;
        out.push({
          level,
          plain: plain.byteLength,
          compact: compact.byteLength,
          encodeMs,
          glb: compact,
        });
      }
      // Re-open from the smallest to the largest, so the last one on screen is the close level.
      for (const row of out.reverse()) {
        await window.__mt.loadGlb(row.glb);
        row.reopened = window.__mt.state.imported?.triangles ?? 0;
        row.error = window.__mt.state.error;
        delete row.glb;
      }
      return out.reverse().map((row) => ({ ...row, lod: lods[row.level - 1] }));
    });
    for (const row of rows) {
      const ok = row.reopened === row.lod.triangles ? 'yes' : `NO (${row.reopened}, ${row.error})`;
      console.log(
        `| ${basename(file, '.stl')} | ${kb(statSync(join('corpus', file)).size)} | ${row.lod.name} | ${row.lod.triangles.toLocaleString()} | ${kb(row.plain)} | ${kb(row.compact)} (${Math.round(row.encodeMs)} ms) | ${ok} |`,
      );
    }
  }
  await page.locator('#viewport').screenshot({ path: join('out', 'reopened-glb.png') });
} finally {
  await browser.close();
  server.kill();
}
