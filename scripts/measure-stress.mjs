// Measures the stress scene in real Chrome (GPU on) with minis from corpus/.
// Runs each case twice: with the normal frame-rate cap and with the cap lifted, which
// shows how much headroom is left.
// Usage: npm run build && node scripts/measure-stress.mjs [file.stl:share ...]
//   no arguments            the first STL in corpus/ fills the whole table
//   small.stl:0.8 big.stl:0.2   a mixed table, 80 % small and 20 % big minis
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4175;
const CASES = [
  { label: '100 minis, LOD by distance', count: 100, lod: null },
  { label: '400 minis, LOD by distance', count: 400, lod: null },
  { label: '100 minis, all close-up level', count: 100, lod: 0 },
  { label: '100 minis, all table level', count: 100, lod: 1 },
];
const first = readdirSync('corpus').find((name) => name.toLowerCase().endsWith('.stl'));
const mix = process.argv.slice(2).map((arg) => {
  const [file, share] = arg.split(':');
  return { file, share: Number(share ?? 1) };
});
if (mix.length === 0 && !first) throw new Error('No STL files in corpus/');
const minis = mix.length > 0 ? mix : [{ file: first, share: 1 }];
mkdirSync(join('out', 'stress'), { recursive: true });

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

try {
  for (const uncapped of [false, true]) {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__mt?.state.ready === true);

    for (const mini of minis) {
      await page.evaluate(() => (window.__mt.state.stats = null));
      await page.setInputFiles('#file', join('corpus', mini.file));
      await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
        timeout: 120_000,
      });
      const lods = await page.evaluate(() => window.__mt.state.stats.lods.map((l) => l.triangles));
      if (!uncapped) console.log(`${mini.file} (share ${mini.share}): levels ${lods.join(' / ')}`);
      await page.evaluate((share) => window.__mt.poolForStress(share), mini.share);
    }
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    console.log(
      `\n${uncapped ? 'Frame-rate cap lifted' : 'Normal (capped by the display)'} · ${renderer}`,
    );

    for (const test of CASES) {
      await page.evaluate(
        ([count, lod]) => window.__mt.startStress(count, lod),
        [test.count, test.lod],
      );
      await page.waitForTimeout(6000);
      const perf = await page.evaluate(() => window.__mt.state.perf);
      console.log(
        `| ${test.label} | ${perf.fps.toFixed(0)} fps | ${perf.frameMs.toFixed(1)} ms | worst ${perf.worstFrameMs.toFixed(0)} ms | CPU ${perf.renderCpuMs.toFixed(1)} ms | ${perf.triangles.toLocaleString()} triangles | ${perf.drawCalls} calls | LODs ${perf.minisPerLod.join('/')} |`,
      );
      if (!uncapped) {
        await page
          .locator('#viewport')
          .screenshot({ path: join('out', 'stress', `${test.count}-${test.lod ?? 'auto'}.png`) });
      }
    }
    await browser.close();
  }
} finally {
  server.kill();
}
