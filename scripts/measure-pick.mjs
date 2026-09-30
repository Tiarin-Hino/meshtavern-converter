// Times a tap's raycast at a question (issue #93, design note
// docs/design/marks-where-parts-meet.md §8): three.js tests every triangle of the meshes shown,
// no search tree. In real Chrome, GPU on, as the corpus run does.
//
//   node scripts/measure-pick.mjs [<file.stl> [<base.stl>]] [--runs N]
//
// Without files: the ordinary corpus mini the stop rule names (`humanoid/M-001a`, 1.25 M
// triangles) at its up question, then the largest corpus pair (`large-creature/large-01`, a
// 5.6 M-triangle figure on its base) at its meet question, both meshes shown. A tap at the
// middle of the canvas, where the mini is, is timed against PICK_BUDGET_MS.
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { runnerImport } from 'vite';
import { CORPUS } from './lib/corpus-files.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const runs = Number(option('--runs') ?? 5);
const { PICK_BUDGET_MS } = (await runnerImport('./src/page/page-state.ts', { logLevel: 'silent' }))
  .module;

const cases = args.length
  ? [{ files: args }]
  : [
      { files: [join(CORPUS, 'humanoid', 'M-001a.stl')] },
      {
        files: [
          join(CORPUS, 'large-creature', 'large-01.stl'),
          join(CORPUS, 'large-creature', 'large-01-base.stl'),
        ],
      },
    ].filter(({ files }) => files.every((file) => existsSync(file)));
if (cases.length === 0) throw new Error('No files: give an STL, or keep the corpus in corpus/.');

const PORT = 4185;
execSync('npm run build', { stdio: 'ignore' });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  for (const { files } of cases) {
    await page.goto(`http://localhost:${PORT}/?bake=off`);
    await page.waitForFunction(() => window.__mt?.state.ready === true);
    await page.setInputFiles('#file', files);
    // A pair is taken to its meet question: base and figure shown together.
    for (;;) {
      await page.waitForFunction(() => window.__mt.state.question !== null, null, {
        timeout: 600_000,
      });
      const question = await page.evaluate(() => window.__mt.state.question);
      if (files.length === 1 || question.kind === 'meet') break;
      const serial = question.serial;
      await page.evaluate(() => window.__mt.confirmUp());
      await page.waitForFunction((s) => (window.__mt.state.question?.serial ?? 0) > s, serial, {
        timeout: 600_000,
      });
    }
    await page.waitForTimeout(1000);
    const box = await page.locator('#viewport').boundingBox();
    // Taps over a grid of the canvas's left part (the panel covers the right): the ones that hit.
    const hits = await page.evaluate(
      ([width, height, most]) => {
        const out = [];
        for (let j = 1; j < 10 && out.length < most; j++)
          for (let i = 1; i < 10 && out.length < most; i++) {
            const start = performance.now();
            const pick = window.__mt.pickAt((width * 0.72 * i) / 10, (height * j) / 10);
            const ms = performance.now() - start;
            if (pick) out.push({ ms, file: pick.file });
          }
        return out;
      },
      [box.width, box.height, runs],
    );
    const shown = await page.evaluate(() => (window.__mt.state.question?.shown ?? []).length);
    const worst = Math.max(...hits.map((hit) => hit.ms));
    console.log(
      `${files.join(' + ')}: ${shown} meshes shown; ${hits.length} taps that hit: ` +
        `${hits.map((hit) => `${hit.ms.toFixed(0)} ms (file ${hit.file})`).join(', ')}; ` +
        `${worst <= PICK_BUDGET_MS ? 'within' : 'OVER'} the ${PICK_BUDGET_MS} ms budget`,
    );
    await page.evaluate(() => window.__mt.cancel());
  }
} finally {
  await browser.close();
  server.kill();
}
