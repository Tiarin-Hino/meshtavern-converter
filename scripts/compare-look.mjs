// Images of the look for every STL in corpus/, at the table level, in real Chrome: the plain
// base coat and every preset of the page (#45), side by side. Writes out/look/<name>.png and
// prints the shade step's time.
// Usage: npm run build && node scripts/compare-look.mjs [--baked] [part of a file name…]
// Without --baked the minis have the per-vertex look, which is quick; with it they are baked
// as the table shows them.
// Nothing from corpus/ or out/ is ever committed.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';
import { corpusFiles } from './lib/corpus-files.mjs';

const PORT = 4177;
const OUT = join('out', 'look');
const TABLE_LEVEL = 2;
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
  { name: 'back', azimuth: 205, elevation: 12, zoom: 1 },
];

const args = process.argv.slice(2);
const baked = args.includes('--baked');
const wanted = args.filter((arg) => !arg.startsWith('--'));
const files = corpusFiles().filter(
  (file) => wanted.length === 0 || wanted.some((part) => file.includes(part)),
);
if (files.length === 0) throw new Error('No STL files in corpus/');
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
  await page.goto(`http://localhost:${PORT}/?ask=off${baked ? '' : '&bake=off'}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  // The panel and the level chips lie over the canvas: hidden, so the pictures show the mini alone.
  await page.addStyleTag({ content: '#panel, #levels { display: none }' });
  // The presets are the page's: its buttons say which there are.
  const presets = await page.$$eval('#look-presets button', (buttons) =>
    buttons.map((button) => ({ id: button.dataset.preset, label: button.textContent })),
  );
  const LOOKS = [{ id: presets[0].id, label: 'plain', off: true }, ...presets];

  for (const file of files) {
    const name = basename(file, '.stl');
    await page.evaluate(() => (window.__mt.state.stats = null));
    await page.setInputFiles('#file', join('corpus', file));
    await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
      timeout: baked ? 600_000 : 120_000,
    });
    const stats = await page.evaluate(() => window.__mt.state.stats);
    await page.evaluate((level) => window.__mt.showLevel(level), TABLE_LEVEL);

    const shots = [];
    for (const view of VIEWS) {
      for (const { id, label, off } of LOOKS) {
        await page.evaluate(
          ([preset, plain, v]) => {
            window.__mt.setLookPreset(preset);
            if (plain) window.__mt.setLook({ enabled: false });
            window.__mt.setCamera(v.azimuth, v.elevation, v.zoom);
          },
          [id, off === true, view],
        );
        await page.waitForTimeout(350);
        const png = await page.locator('#viewport').screenshot();
        shots.push({ caption: `${label} · ${view.name}`, data: png.toString('base64') });
      }
    }

    const table = stats.lods[TABLE_LEVEL - 1];
    const sheet = await browser.newPage({
      viewport: { width: 300 * LOOKS.length + 20, height: 100 },
    });
    await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
      <h3 style="margin:0 0 8px">${name}: table level, ${table.triangles.toLocaleString()} triangles</h3>
      <div style="display:grid;grid-template-columns:repeat(${LOOKS.length},1fr);gap:6px">
      ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
      </div></body>`);
    await sheet.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await sheet.close();

    const shadeMs = Math.round(stats.timings.find((t) => t.step === 'shade').ms);
    console.log(
      `${name}: shade ${shadeMs} ms on ${stats.lods[0].vertices.toLocaleString()} vertices, total ${Math.round(stats.totalMs)} ms`,
    );
  }
} finally {
  await browser.close();
  server.kill();
}
