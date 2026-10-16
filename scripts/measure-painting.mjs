// Measures the painting engine (#127, design note docs/design/painting-engine.md §11, §13 step 9)
// in real Chrome with the GPU on: the time of `open`, the engine's frame counter for strokes of the
// largest brush across the whole canvas with every brush that strokes (the flat brush also at the
// default size; the hobby brushes since #128, the airbrush sprayed from above; the dry brush also
// at 2 mm since #133, whose stroke measures its reference under the first dab; the lift since #137,
// over the strokes of the others), the intervals
// between frames, and the GPU process's memory with the view open against without. One fresh
// browser per mini.
// Usage, after `npm run build`:
//   node scripts/measure-painting.mjs                     the generated figure and large-01 with its base
//   node scripts/measure-painting.mjs corpus/x/a.stl …    other minis (a base file beside one is added)
// The memory figures need Windows or Linux (they come from the operating system).
import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const PORT = 4183;
const MB = 1024 ** 2;
const VIEWPORT = { width: 1920, height: 1080 };
/** Strokes per brush: the counter's figures of each. */
const STROKES = 3;
/** Pointer samples a stroke across the canvas has: one a frame, as a pointer at 60 Hz. */
const SAMPLES = 120;
/** The brushes measured: each tool that strokes at the largest size, the flat brush and the dry brush also at the default. */
const RUNS = [
  { tool: 'flat', sizeMm: 16 },
  { tool: 'flat', sizeMm: 2 },
  { tool: 'wash', sizeMm: 16 },
  { tool: 'ink', sizeMm: 16 },
  { tool: 'dry', sizeMm: 16 },
  { tool: 'dry', sizeMm: 2 },
  { tool: 'airbrush', sizeMm: 16, direction: [0, 1, 0] },
  // Last, over what the others painted: each takes away the newest step under its start (#137).
  { tool: 'lift', sizeMm: 16 },
];

/** The generated figure on its base (src/regression/shapes.ts), as an STL in a temporary folder. */
async function generatedFigure(folder) {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const { generateFigure } = await vite.ssrLoadModule('/src/regression/shapes.ts');
    const { encodeBinaryStl } = await vite.ssrLoadModule('/src/lib/dev.ts');
    const path = join(folder, 'generated-figure.stl');
    writeFileSync(path, Buffer.from(encodeBinaryStl(generateFigure(true))));
    return path;
  } finally {
    await vite.close();
  }
}

/** The working set now, in bytes, of every Chrome process of this profile, by process type. */
function memory(profile) {
  if (process.platform !== 'win32') {
    const out = {};
    for (const pid of execFileSync('pgrep', ['-f', profile]).toString().trim().split('\n')) {
      const commandLine = execFileSync('cat', [`/proc/${pid}/cmdline`])
        .toString()
        .replaceAll('\0', ' ');
      const type = commandLine.match(/--type=(\S+)/)?.[1] ?? 'browser';
      const rss = execFileSync('cat', [`/proc/${pid}/status`])
        .toString()
        .match(/VmRSS:\s+(\d+)/)?.[1];
      out[type] = (out[type] ?? 0) + Number(rss ?? 0) * 1024;
    }
    return out;
  }
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | ' +
    'Select-Object CommandLine,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress';
  const rows = [JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', script]))].flat();
  const out = {};
  for (const row of rows.filter((r) => r.CommandLine?.includes(profile))) {
    const type = row.CommandLine.match(/--type=(\S+)/)?.[1] ?? 'browser';
    out[type] =
      (out[type] ?? 0) + Math.max(Number(row.WorkingSetSize), Number(row.PrivatePageCount));
  }
  return out;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const scratch = mkdtempSync(join(tmpdir(), 'mt-paint-'));
const files = process.argv.slice(2);
if (files.length === 0) {
  files.push(await generatedFigure(scratch));
  files.push('corpus/large-creature/large-01.stl');
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

try {
  for (const file of files) {
    const profile = mkdtempSync(join(scratch, 'profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      viewport: VIEWPORT,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`http://localhost:${PORT}/?dev&ask=off`);
      await page.waitForFunction(() => window.__mt?.state.ready === true);
      // The panel lies beside the canvas: hidden, so the painting view is as wide as the window.
      await page.addStyleTag({ content: '#panel, #levels, #dev-tools { display: none }' });
      const base = file.replace(/\.stl$/i, '-base.stl');
      await page.setInputFiles('#file', existsSync(base) ? [file, base] : [file]);
      await page.waitForFunction(() => window.__mt.state.stats && !window.__mt.state.busy, null, {
        timeout: 600_000,
      });
      const { triangles, resolution } = await page.evaluate(() => ({
        triangles: window.__mt.state.stats.lods[1].triangles,
        resolution: window.__mt.state.baked?.resolution ?? null,
      }));
      await page.waitForTimeout(2000);
      const without = memory(profile);
      const openMs = await page.evaluate(async () => {
        const start = performance.now();
        await window.__mt.painting.open();
        return performance.now() - start;
      });
      const renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
      console.log(
        `\n${file} · table level ${triangles.toLocaleString()} triangles · detail ${resolution} px · ${renderer}`,
      );
      console.log(`open: ${openMs.toFixed(0)} ms`);

      for (const { tool, sizeMm, direction = null } of RUNS) {
        const rows = [];
        for (let stroke = 0; stroke < STROKES; stroke++) {
          const result = await page.evaluate(
            async ({ tool, sizeMm, direction, samples, stroke }) => {
              const view = window.__mt.painting.view();
              view.setTool(tool);
              view.setBrush({ sizeMm, hardness: 0.8, opacity: 1, direction });
              view.setColour(['#b03030', '#30b030', '#3030b0'][stroke % 3]);
              view.setCamera(34 + stroke * 40, 22, 1);
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const canvas = document.querySelector('#paint-view canvas');
              const { width, height } = canvas.getBoundingClientRect();
              // Across the whole canvas, through its middle, a little wavy.
              const path = Array.from({ length: samples }, (_, k) => [
                (width * k) / (samples - 1),
                height * (0.5 + 0.08 * Math.sin(k / 6)),
              ]);
              const intervals = [];
              let last = performance.now();
              let running = true;
              const tick = (now) => {
                intervals.push(now - last);
                last = now;
                if (running) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
              await view.strokeAt(path);
              running = false;
              const dabs = view.history().at(-1)?.dabs?.length ?? 0;
              return {
                perf: view.state.perf,
                intervals: intervals.slice(1),
                dabs: dabs / 4,
                lift: tool === 'lift' ? view.state.lift : null,
              };
            },
            { tool, sizeMm, direction, samples: SAMPLES, stroke },
          );
          rows.push(result);
        }
        for (const [k, { perf, intervals, dabs, lift }] of rows.entries())
          console.log(
            `${tool} ${sizeMm} mm, stroke ${k + 1}${lift ? ` (${JSON.stringify(lift)})` : ''}: ${dabs} dabs · counter ${perf.frames} frames, median ${perf.medianMs.toFixed(1)} ms, worst ${perf.worstMs.toFixed(1)} ms, ${perf.slow} slow · between frames median ${median(intervals).toFixed(1)} ms, worst ${Math.max(...intervals).toFixed(1)} ms`,
          );
      }
      await page.waitForTimeout(1000);
      const open = memory(profile);
      const delta = (type) => ((open[type] ?? 0) - (without[type] ?? 0)) / MB;
      console.log(
        `memory, view open minus closed: GPU process ${delta('gpu-process').toFixed(0)} MB (${((open['gpu-process'] ?? 0) / MB).toFixed(0)} MB in all), page ${delta('renderer').toFixed(0)} MB`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}
