// Spike, issue #10: original sculpt vs table level with per-vertex look (variant A) vs
// table level with baked maps (variant B), in real Chrome. Writes out/bake/<name>-<size>.png
// and prints unwrap and bake figures.
// Usage: npm run build && node scripts/compare-bake.mjs [resolution=2048] [file.stl ...]
// Nothing from corpus/ or out/ is ever committed.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';
import { corpusFiles } from './lib/corpus-files.mjs';

const PORT = 4179;
const OUT = join('out', 'bake');
const resolution = Number(process.argv[2] ?? 2048);
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
  { name: 'very close', azimuth: 25, elevation: 8, zoom: 5 },
];

const named = process.argv.slice(3);
const files = named.length ? named : corpusFiles();
mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto(`http://localhost:${PORT}/?bake=${resolution}&ktx=${process.env.KTX ?? 'off'}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  for (const file of files) {
    const name = basename(file, '.stl');
    await page.evaluate(() => (window.__mt.state.stats = null));
    await page.setInputFiles('#file', join('corpus', file));
    await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
      timeout: 600_000,
    });
    const { stats, baked, error } = await page.evaluate(() => window.__mt.state);
    if (error || !baked) {
      console.log(`${name}: FAILED ${error}`);
      continue;
    }

    const columns = [
      { label: 'original sculpt, plain', show: () => window.__mt.showLevel(0) },
      { label: 'table, per-vertex look (A)', show: () => window.__mt.showBaked(false) },
      { label: `table, baked ${resolution} px (B)`, show: () => window.__mt.showBaked(true) },
    ];
    const shots = [];
    for (const view of VIEWS) {
      for (const column of columns) {
        await page.evaluate(column.show);
        await page.evaluate((v) => window.__mt.setCamera(v.azimuth, v.elevation, v.zoom), view);
        await page.waitForTimeout(400);
        const png = await page.locator('#viewport').screenshot();
        shots.push({ caption: `${column.label} · ${view.name}`, data: png.toString('base64') });
      }
    }
    const sheet = await browser.newPage({ viewport: { width: 380 * 3 + 20, height: 100 } });
    await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
      <h3 style="margin:0 0 8px">${name}: table level ${stats.lods[1].triangles.toLocaleString()} triangles, ${baked.charts.toLocaleString()} UV islands</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
      </div></body>`);
    await sheet.screenshot({ path: join(OUT, `${name}-${resolution}.png`), fullPage: true });
    await sheet.close();

    const ms = (step) => Math.round(stats.timings.find((t) => t.step === step).ms);
    console.log(
      `| ${name} | ${stats.lods[1].triangles.toLocaleString()} | ${baked.charts.toLocaleString()} | ${stats.lods[1].vertices.toLocaleString()} → ${baked.vertices.toLocaleString()} | ${(ms('unwrap') / 1000).toFixed(1)} s | ${(ms('bake') / 1000).toFixed(1)} s | ${(baked.coverage * 100).toFixed(0)} % | ${(baked.fallback * 100).toFixed(1)} % | BVH ${Math.round(baked.bvhBuildMs)} ms, ${Math.round(baked.bvhBytes / 1048576)} MB | ${baked.ktx2Bytes ? `KTX2 ${Math.round(baked.ktx2Bytes / 1024)} KB in ${Math.round(baked.ktx2EncodeMs)} ms` : 'no KTX2'} | ${(stats.totalMs / 1000).toFixed(1)} s | ${Math.round(stats.peakBufferBytes / 1048576)} MB |`,
    );
  }
} finally {
  await browser.close();
  server.kill();
}
