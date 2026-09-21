// Spike #34. Whole conversions in real Chrome (GPU on, window in front) for a handful of
// minis and unwrap variants: step times, the spike's unwrap figures, and one comparison
// sheet per mini with a column per variant. A fresh page per conversion, so no variant
// inherits warm workers from another.
// Usage: npm run build && node scripts/spike34/measure.mjs [--minis a,b] [--variants name=query;...] [--out folder]
// Writes out/spike34/<folder>/results.json, results.md and <mini>.png. Nothing of it is committed.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';
import { CORPUS, corpusFiles } from '../lib/corpus-files.mjs';

const PORT = 4181;
const TIMEOUT_MS = 600_000;
/** The six slowest unwraps of the corpus run of 2026-09-21 and three ordinary minis. */
const MINIS = [
  'SquidlingSwarm_32mm',
  'HillGiant_32mm_FDM',
  '32mm_SirRichardMounted',
  'AbigailMounted_32mm',
  'T-001',
  'TormentedGiant_32mm',
  'MINI-012',
  'FellWarrior_32mm',
  'SoftDagger_32mm',
];
const VARIANTS =
  'today=unwrap=whole;cut8 one worker=unwrap=cut8&workers=1;cut8 eight workers=unwrap=cut8';
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
  { name: 'close-up, back', azimuth: 205, elevation: 8, zoom: 2.6 },
];

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const wanted = (flag('--minis') ?? MINIS.join(',')).split(',');
const variants = (flag('--variants') ?? VARIANTS).split(';').map((entry) => {
  const at = entry.indexOf('=');
  return { name: entry.slice(0, at), query: entry.slice(at + 1) };
});
const OUT = join('out', 'spike34', flag('--out') ?? 'chrome');
mkdirSync(OUT, { recursive: true });
const files = wanted.map((name) => {
  const file = corpusFiles().find((path) => basename(path) === `${name}.stl`);
  if (!file) throw new Error(`${name}.stl is not in corpus/`);
  return { name, file: join(CORPUS, file) };
});

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

const round = (value, digits = 0) => Number(value.toFixed(digits));
const mb = (bytes) => round(bytes / 2 ** 20);
const results = [];
let machine;
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  for (const { name, file } of files) {
    const columns = [];
    for (const variant of variants) {
      const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
      await page.goto(`http://localhost:${PORT}/?${variant.query}`);
      await page.bringToFront();
      await page.waitForFunction(() => window.__mt?.state.ready === true);
      machine ??= await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
          browser: window.navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown',
          threads: window.navigator.hardwareConcurrency,
        };
      });
      await page.setInputFiles('#file', file);
      await page.waitForFunction(
        () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
        null,
        { timeout: TIMEOUT_MS },
      );
      const { stats, baked, error, longestFrameGapMs } = await page.evaluate(
        () => window.__mt.state,
      );
      if (!stats || !baked)
        throw new Error(`${name}, ${variant.name}: ${error ?? JSON.stringify(stats.bakeSkipped)}`);
      const steps = Object.fromEntries(
        stats.timings.map((timing) => [timing.step, round(timing.ms)]),
      );
      const figures = stats.unwrapFigures ?? {};
      const row = {
        mini: name,
        variant: variant.name,
        query: variant.query,
        resolution: baked.resolution,
        unwrapMs: steps.unwrap,
        totalMs: round(stats.totalMs),
        // Steps no variant touches: when these move between variants, the machine moved.
        untouchedMs: steps.weld + steps.simplify + steps.shade,
        steps,
        charts: baked.charts,
        utilisation: round(baked.utilisation, 4),
        coverage: round(baked.coverage, 4),
        vertices: baked.vertices,
        seamMm: round(figures.seamMm ?? 0),
        workers: figures.variant
          ? Math.min(figures.variant.workers ?? figures.variant.cut, figures.variant.cut)
          : 0,
        splitMs: figures.splitMs == null ? null : round(figures.splitMs),
        islandsMs: figures.islandsMs == null ? null : round(figures.islandsMs),
        partMs: figures.partMs?.map((ms) => round(ms)) ?? null,
        packMs: figures.packMs == null ? null : round(figures.packMs),
        partWasmMb: figures.partWasmBytes?.map(mb) ?? null,
        packWasmMb: figures.packWasmBytes == null ? null : mb(figures.packWasmBytes),
        chartTypes: figures.chartTypes ?? null,
        ktx2Bytes: baked.ktx2Bytes,
        longestFrameGapMs: round(longestFrameGapMs),
      };
      results.push(row);
      console.log(JSON.stringify(row));

      const shots = [];
      for (const view of VIEWS) {
        await page.evaluate((v) => {
          window.__mt.showLevel(2);
          window.__mt.showBaked(true);
          window.__mt.setCamera(v.azimuth, v.elevation, v.zoom);
        }, view);
        await page.waitForTimeout(350);
        shots.push((await page.locator('#viewport').screenshot()).toString('base64'));
      }
      columns.push({
        caption: `${variant.name}: unwrap ${(row.unwrapMs / 1000).toFixed(1)} s, ${row.charts} islands, seams ${row.seamMm} mm, texture used ${Math.round(row.utilisation * 100)} %`,
        shots,
      });
      await page.close();
    }
    const sheet = await browser.newPage({
      viewport: { width: 380 * columns.length + 20, height: 100 },
    });
    await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:13px system-ui">
      <h3 style="margin:0 0 8px">${name}: table level, baked, per unwrap variant</h3>
      <div style="display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:6px">
      ${columns.map((c) => `<div>${c.caption}</div>`).join('')}
      ${VIEWS.map((_, v) => columns.map((c) => `<img src="data:image/png;base64,${c.shots[v]}" style="width:100%;display:block">`).join('')).join('')}
      </div></body>`);
    await sheet.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await sheet.close();
  }
} finally {
  await browser.close();
  server.kill();
  const about = {
    date: new Date().toISOString(),
    machine: {
      ...machine,
      cpu: cpus()[0]?.model.trim() ?? 'unknown',
      memoryGb: round(totalmem() / 2 ** 30),
    },
  };
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ ...about, results }, null, 2));
  const head = [
    'Mini',
    'Variant',
    'Texture',
    'Unwrap',
    'Whole conversion',
    'Untouched steps',
    'Islands',
    'Seams',
    'Texture used',
    'Slowest slab',
    'Packing',
    'Memory per worker',
    'Memory, all workers + packing',
    'Longest stall',
  ];
  const lines = results.map((r) =>
    [
      r.mini,
      r.variant,
      `${r.resolution} px`,
      `${(r.unwrapMs / 1000).toFixed(1)} s`,
      `${(r.totalMs / 1000).toFixed(1)} s`,
      `${(r.untouchedMs / 1000).toFixed(1)} s`,
      r.charts,
      `${r.seamMm} mm`,
      `${Math.round(r.utilisation * 100)} %`,
      r.partMs ? `${(Math.max(...r.partMs) / 1000).toFixed(1)} s` : '',
      r.packMs == null ? '' : `${(r.packMs / 1000).toFixed(1)} s`,
      r.partWasmMb ? `${Math.max(...r.partWasmMb)} MB` : '',
      // A worker's memory only grows, and one worker may take several slabs: count workers, not slabs.
      r.partWasmMb ? `${r.workers * Math.max(...r.partWasmMb) + r.packWasmMb} MB` : '',
      `${r.longestFrameGapMs} ms`,
    ].join(' | '),
  );
  writeFileSync(
    join(OUT, 'results.md'),
    `# Spike #34, real Chrome\n\n${about.date} · ${about.machine.gpu} · ${about.machine.cpu} (${about.machine.threads} threads) · ${about.machine.memoryGb} GB · ${about.machine.browser}\n\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${lines.map((line) => `| ${line} |`).join('\n')}\n`,
  );
}
