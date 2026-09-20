// Measures the stress scene in real Chrome (GPU on) with the first STL in corpus/.
// Runs each case twice: with the normal frame-rate cap and with the cap lifted, which
// shows how much headroom is left. Usage: npm run build && node scripts/measure-stress.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4175;
const CASES = [
  { label: '100 minis, LOD by distance', count: 100, lod: null },
  { label: '400 minis, LOD by distance', count: 400, lod: null },
  { label: '100 minis, all 50k', count: 100, lod: 0 },
  { label: '400 minis, all 50k', count: 400, lod: 0 },
];
const file = readdirSync('corpus').find((name) => name.toLowerCase().endsWith('.stl'));
if (!file) throw new Error('No STL files in corpus/');
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
    await page.setInputFiles('#file', join('corpus', file));
    await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
      timeout: 120_000,
    });
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    console.log(
      `\n${uncapped ? 'Frame-rate cap lifted' : 'Normal (capped by the display)'} · ${file} · ${renderer}`,
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
      if (!uncapped)
        await page
          .locator('#viewport')
          .screenshot({ path: join('out', 'stress', `${test.count}-${test.lod ?? 'auto'}.png`) });
    }
    await browser.close();
  }
} finally {
  server.kill();
}
