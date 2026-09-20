// Converts every STL in corpus/ in real Chrome (GPU on) and writes to out/lods/:
//   <name>.png   one comparison image: rows = whole mini and close-up, columns = detail levels
//   results.md   table of triangles, error and timings
// Usage: npm run build && node scripts/compare-lods.mjs
// Nothing from corpus/ or out/ is ever committed.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4174;
const OUT = join('out', 'lods');
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
];

const files = readdirSync('corpus').filter((file) => file.toLowerCase().endsWith('.stl'));
if (files.length === 0) throw new Error('No STL files in corpus/');
mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);

  for (const file of files) {
    const name = basename(file, '.stl');
    await page.evaluate(() => (window.__mt.state.stats = null));
    await page.setInputFiles('#file', join('corpus', file));
    await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
      timeout: 120_000,
    });
    const stats = await page.evaluate(() => window.__mt.state.stats);
    const labels = [
      'Full',
      ...stats.lods.map((lod) => `${Math.round(lod.targetTriangles / 1000)}k`),
    ];

    const shots = [];
    for (const view of VIEWS) {
      for (let level = 0; level < labels.length; level++) {
        await page.evaluate(
          ([l, v]) => {
            window.__mt.showLevel(l);
            window.__mt.setCamera(v.azimuth, v.elevation, v.zoom);
          },
          [level, view],
        );
        await page.waitForTimeout(350);
        const png = await page.locator('#viewport').screenshot();
        shots.push({ view: view.name, label: labels[level], data: png.toString('base64') });
      }
    }

    const sheet = await browser.newPage({
      viewport: { width: 380 * labels.length + 20, height: 100 },
    });
    await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
      <h3 style="margin:0 0 8px">${name}: ${stats.triangles.toLocaleString()} triangles, ${stats.sizeMm.map((v) => v.toFixed(0)).join(' × ')} mm</h3>
      <div style="display:grid;grid-template-columns:repeat(${labels.length},1fr);gap:6px">
      ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.label} · ${s.view}</figcaption></figure>`).join('')}
      </div></body>`);
    await sheet.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await sheet.close();

    const step = (n) => Math.round(stats.timings.find((t) => t.step === n).ms);
    rows.push(
      `| ${name} | ${stats.triangles.toLocaleString()} | ${stats.lods.map((l) => `${l.triangles.toLocaleString()} (±${l.errorMm.toFixed(2)} mm)`).join(' | ')} | ${step('simplify')} ms | ${Math.round(stats.totalMs)} ms |`,
    );
    console.log(rows.at(-1));
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(
  join(OUT, 'results.md'),
  `| Mini | Source triangles | 50k LOD | 15k LOD | 4k LOD | Simplify | Whole conversion |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`,
);
