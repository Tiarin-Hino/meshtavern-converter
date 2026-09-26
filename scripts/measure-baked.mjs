// Spike, issue #30: what baked minis cost on a full table. Real Chrome, GPU on, frame-rate
// cap lifted so differences show. Every mini owns its texture, as different minis would.
// Usage: npm run build && node scripts/measure-baked.mjs [resolution ...] [-- file.stl:share ...]
//   node scripts/measure-baked.mjs 512 1024 2048
//   node scripts/measure-baked.mjs 1024 -- humanoid/MINI-014.stl:0.8 large-creature/large-02.stl:0.2
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { corpusFiles } from './lib/corpus-files.mjs';

const PORT = 4180;
const split = process.argv.indexOf('--');
const sizes = (split < 0 ? process.argv.slice(2) : process.argv.slice(2, split)).map(Number);
const mix = (split < 0 ? [] : process.argv.slice(split + 1)).map((arg) => {
  const [file, share] = arg.split(':');
  return { file, share: Number(share ?? 1) };
});
const first = corpusFiles()[0];
const minis = mix.length > 0 ? mix : [{ file: first, share: 1 }];
const resolutions = sizes.length > 0 ? sizes : [1024];
mkdirSync(join('out', 'stress'), { recursive: true });

// count, forced level (1 = table, null = by distance), texture budget in MB (0 = no baked minis)
const CASES = [
  { label: '100 minis, all table level, per-vertex look', count: 100, lod: 1, budget: 0 },
  { label: '100 minis, all table level, baked', count: 100, lod: 1, budget: Infinity },
  { label: '100 minis, all table level, baked within 128 MB', count: 100, lod: 1, budget: 128 },
  { label: '100 minis, LOD by distance, baked', count: 100, lod: null, budget: Infinity },
  { label: '400 minis, LOD by distance, baked', count: 400, lod: null, budget: Infinity },
];

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

try {
  for (const resolution of resolutions) {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
    await page.goto(`http://localhost:${PORT}/?bake=${resolution}&ktx=${process.env.KTX ?? 'off'}`);
    await page.waitForFunction(() => window.__mt?.state.ready === true);
    for (const mini of minis) {
      await page.evaluate(() => (window.__mt.state.stats = null));
      await page.setInputFiles('#file', join('corpus', mini.file));
      await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
        timeout: 600_000,
      });
      if (minis.length > 1)
        await page.evaluate((share) => window.__mt.poolForStress(share), mini.share);
    }
    console.log(
      `\n${resolution} px detail textures · ${minis.map((m) => `${m.file} ×${m.share}`).join(', ')}`,
    );
    console.log(
      '| Case | fps (cap lifted) | Worst frame | CPU per frame | Triangles | Baked minis | Texture memory |',
    );
    console.log('| --- | --- | --- | --- | --- | --- | --- |');

    for (const test of CASES) {
      await page.evaluate(
        ([count, lod, budget]) => window.__mt.startStress(count, lod, budget ?? Infinity),
        // JSON cannot carry Infinity; null stands for "no limit".
        [test.count, test.lod, Number.isFinite(test.budget) ? test.budget : null],
      );
      await page.waitForTimeout(7000);
      const perf = await page.evaluate(() => window.__mt.state.perf);
      console.log(
        `| ${test.label} | ${perf.fps.toFixed(0)} | ${perf.worstFrameMs.toFixed(0)} ms | ${perf.renderCpuMs.toFixed(1)} ms | ${perf.triangles.toLocaleString()} | ${perf.bakedMinis} | ${Math.round(perf.textureBytes / 1048576)} MB |`,
      );
      if (test.label.endsWith('table level, baked')) {
        await page
          .locator('#viewport')
          .screenshot({ path: join('out', 'stress', `baked-${resolution}.png`) });
      }
    }
    await browser.close();
  }
} finally {
  server.kill();
}
