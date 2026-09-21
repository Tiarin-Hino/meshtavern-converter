// The regression run over the local corpus (issue #46). Converts every STL in corpus/ in
// real Chrome (GPU on) and writes to out/corpus/:
//   results.json     triangles, error, sizes and times per level for every mini
//   results.md       the same as tables, the corpus coverage, and what changed since the last run
//   <kind>/<name>.png  one comparison sheet per mini: rows = whole mini and close-up, columns = levels
// Sort the corpus into folders named after the kind of mini (see KINDS); files directly in
// corpus/ count as "unsorted".
// Usage: npm run corpus -- [--no-bake] [--options "?ktx=1"] [--out <folder under out/>]
// Nothing from corpus/ or out/ is ever committed.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { CORPUS, corpusFiles } from './lib/corpus-files.mjs';

const PORT = 4179;
/** The kinds the Phase 1 spec asks the corpus to cover; each is a folder under corpus/. */
const KINDS = ['humanoid', 'large-creature', 'quadruped', 'flying', 'mounted', 'swarm', 'terrain'];
const CORPUS_GOAL = [20, 30];
/** The spec allows the largest mini three minutes on the reference laptop; leave room above that. */
const CONVERSION_TIMEOUT_MS = 600_000;
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
];

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const bake = !args.includes('--no-bake');
const extra = new URLSearchParams(flag('--options') ?? '');
if (bake && !extra.has('bake')) extra.set('bake', 'auto');
const address = `http://localhost:${PORT}/?${extra}`;
const OUT = join('out', flag('--out') ?? 'corpus');

const files = corpusFiles();
if (files.length === 0) throw new Error('No STL files in corpus/');
mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

const round = (value, digits = 0) => Number(value.toFixed(digits));
const minis = {};
let machine;
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto(address);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  machine = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
      browser: window.navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown',
    };
  });

  for (const path of files) {
    const file = join(CORPUS, path);
    const key = path.slice(0, -'.stl'.length).split(sep).join('/');
    const kind = path.includes(sep) ? path.split(sep)[0] : 'unsorted';
    const mini = { kind, stlBytes: statSync(file).size };
    minis[key] = mini;

    await page.evaluate(() => Object.assign(window.__mt.state, { stats: null, error: null }));
    await page.setInputFiles('#file', file);
    try {
      await page.waitForFunction(
        () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
        null,
        { timeout: CONVERSION_TIMEOUT_MS },
      );
    } catch {
      mini.error = `did not finish within ${CONVERSION_TIMEOUT_MS / 1000} s`;
      console.log(`${key}: ${mini.error}`);
      // The page is still converting; start over with a fresh one for the next mini.
      await page.goto(address);
      await page.waitForFunction(() => window.__mt?.state.ready === true);
      continue;
    }
    const { stats, baked, error, longestFrameGapMs } = await page.evaluate(() => window.__mt.state);
    if (!stats) {
      mini.error = error;
      console.log(`${key}: could not be converted: ${error}`);
      continue;
    }

    // Exports every level, then opens each compressed file again to prove that it loads.
    const exported = await page.evaluate(async (count) => {
      const out = [];
      for (let level = 1; level <= count; level++) {
        const plain = await window.__mt.exportGlb(level, false);
        const start = performance.now();
        const compact = await window.__mt.exportGlb(level, true);
        out.push({ plain: plain.byteLength, encodeMs: performance.now() - start, compact });
      }
      for (const row of out) {
        await window.__mt.loadGlb(row.compact);
        row.reopened = window.__mt.state.imported?.triangles ?? 0;
        row.compact = row.compact.byteLength;
      }
      return out;
    }, stats.lods.length);

    Object.assign(mini, {
      sourceTriangles: stats.sourceTriangles,
      triangles: stats.triangles,
      degenerateTriangles: stats.degenerateTriangles,
      sizeMm: stats.sizeMm.map((mm) => round(mm, 2)),
      up: stats.up,
      upMethod: stats.upMethod,
      levels: stats.lods.map((lod, i) => ({
        name: lod.name,
        decidedBy: lod.decidedBy,
        triangles: lod.triangles,
        vertices: lod.vertices,
        errorMm: round(lod.errorMm, 4),
        glbBytes: exported[i].plain,
        compactGlbBytes: exported[i].compact,
        reopens: exported[i].reopened === lod.triangles,
      })),
      baked: baked && {
        resolution: baked.resolution,
        vertices: baked.vertices,
        charts: baked.charts,
        utilisation: round(baked.utilisation, 4),
        coverage: round(baked.coverage, 4),
        fallback: round(baked.fallback, 4),
        ktx2Bytes: baked.ktx2Bytes,
      },
      // Everything that depends on the machine sits under `times` and is left out of comparisons.
      times: {
        steps: Object.fromEntries(stats.timings.map((timing) => [timing.step, round(timing.ms)])),
        totalMs: round(stats.totalMs),
        compactEncodeMs: exported.map((row) => round(row.encodeMs)),
        ktx2EncodeMs: baked?.ktx2EncodeMs == null ? null : round(baked.ktx2EncodeMs),
        longestFrameGapMs: round(longestFrameGapMs),
        peakBufferMb: round(stats.peakBufferBytes / 1048576),
      },
    });

    // The comparison sheet. Column 0 is the full sculpt; a baked table level gets its own column.
    const columns = [{ label: 'Full', level: 0 }];
    stats.lods.forEach((lod, i) => {
      const label = `${lod.name} ${Math.round(lod.triangles / 1000)}k (${lod.decidedBy})`;
      columns.push({ label, level: i + 1 });
      if (baked && lod.name === 'table') {
        columns.push({ label: `table, baked ${baked.resolution} px`, level: i + 1, baked: true });
      }
    });
    await page.evaluate(() => window.__mt.showLevel(0));
    const shots = [];
    for (const view of VIEWS) {
      for (const column of columns) {
        await page.evaluate(
          ([c, v]) => {
            if (c.baked) window.__mt.showBaked(true);
            else window.__mt.showLevel(c.level);
            window.__mt.setCamera(v.azimuth, v.elevation, v.zoom);
          },
          [column, view],
        );
        await page.waitForTimeout(350);
        const png = await page.locator('#viewport').screenshot();
        shots.push({ caption: `${column.label} · ${view.name}`, data: png.toString('base64') });
      }
    }
    const sheet = await browser.newPage({
      viewport: { width: 380 * columns.length + 20, height: 100 },
    });
    await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
      <h3 style="margin:0 0 8px">${key}: ${stats.triangles.toLocaleString()} triangles, ${mini.sizeMm.join(' × ')} mm, up ${stats.up} (${stats.upMethod})</h3>
      <div style="display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:6px">
      ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
      </div></body>`);
    mkdirSync(dirname(join(OUT, `${key}.png`)), { recursive: true });
    await sheet.screenshot({ path: join(OUT, `${key}.png`), fullPage: true });
    await sheet.close();
    console.log(`${key}: ${stats.triangles.toLocaleString()} triangles, ${mini.times.totalMs} ms`);
  }
} finally {
  await browser.close();
  server.kill();
}

const results = {
  date: new Date().toISOString(),
  commit: execSync('git describe --always --dirty').toString().trim(),
  options: extra.size > 0 ? `?${extra}` : 'none',
  machine: {
    ...machine,
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    memoryGb: round(totalmem() / 2 ** 30),
  },
  minis,
};

// What moved since the last run, by the same rules as the CI baseline.
const RESULTS = join(OUT, 'results.json');
let changes = null;
let previous = null;
if (existsSync(RESULTS)) {
  previous = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const { compareFigures } = await vite.ssrLoadModule('/src/regression/compare.ts');
  await vite.close();
  const withoutTimes = (all) =>
    Object.fromEntries(
      Object.entries(all).map(([key, mini]) => {
        const figures = { ...mini };
        delete figures.times;
        return [key, figures];
      }),
    );
  changes = compareFigures(withoutTimes(previous.minis), withoutTimes(minis));
  writeFileSync(join(OUT, 'results.previous.json'), JSON.stringify(previous, null, 2));
}
writeFileSync(RESULTS, JSON.stringify(results, null, 2));

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString()} KB`;
const converted = Object.entries(minis).filter(([, mini]) => !mini.error);
const failed = Object.entries(minis).filter(([, mini]) => mini.error);
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows].join('\n');

const count = (values) => {
  const seen = new Map();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen].map(([value, times]) => `${value}: ${times}`).join(', ') || 'none';
};
const kinds = Object.values(minis).map((mini) => mini.kind);
const missing = KINDS.filter((kind) => !kinds.includes(kind));

const md = `# Corpus results

${results.date} · commit ${results.commit} · options \`${results.options}\`
${results.machine.gpu} · ${results.machine.cpu} · ${results.machine.memoryGb} GB · ${results.machine.browser}

## Corpus coverage

- ${files.length} minis; the goal is ${CORPUS_GOAL.join('–')}.
- By kind (the folder under corpus/): ${count(kinds)}.
- Kinds still missing: ${missing.join(', ') || 'none'}.
- Up direction taken from the file: ${count(converted.map(([, mini]) => mini.up))}.
- Flat base found: ${count(converted.map(([, mini]) => (mini.upMethod === 'base' ? 'yes' : 'no')))}.

## Changes since the last run

${
  changes === null
    ? 'No earlier results to compare with.'
    : changes.length === 0
      ? `None (times aside), compared with ${previous.date}, commit ${previous.commit}.`
      : `Compared with ${previous.date}, commit ${previous.commit} (kept as results.previous.json):\n\n${changes.map((change) => `- ${change}`).join('\n')}`
}

## Minis

${table(
  [
    'Mini',
    'Kind',
    'STL',
    'Source triangles',
    'Size (mm)',
    'Up',
    'Texture',
    'Whole conversion',
    'Longest stall',
  ],
  converted.map(
    ([key, m]) =>
      `| ${key} | ${m.kind} | ${kb(m.stlBytes)} | ${m.sourceTriangles.toLocaleString()} | ${m.sizeMm.join(' × ')} | ${m.up} (${m.upMethod}) | ${m.baked ? `${m.baked.resolution} px${m.baked.ktx2Bytes ? `, ${kb(m.baked.ktx2Bytes)}` : ''}` : 'none'} | ${m.times.totalMs.toLocaleString()} ms | ${m.times.longestFrameGapMs} ms |`,
  ),
)}

## Levels

${table(
  [
    'Mini',
    'Level',
    'Triangles',
    'Decided by',
    'Error',
    'Plain GLB',
    'Compressed GLB',
    'Encode',
    'Re-opens',
  ],
  converted.flatMap(([key, m]) =>
    m.levels.map(
      (level, i) =>
        `| ${key} | ${level.name} | ${level.triangles.toLocaleString()} | ${level.decidedBy} | ±${level.errorMm.toFixed(2)} mm | ${kb(level.glbBytes)} | ${kb(level.compactGlbBytes)} | ${m.times.compactEncodeMs[i]} ms | ${level.reopens ? 'yes' : 'NO'} |`,
    ),
  ),
)}

## Time per step (ms)

${table(
  ['Mini', ...new Set(converted.flatMap(([, m]) => Object.keys(m.times.steps)))],
  converted.map(
    ([key, m], _i, all) =>
      `| ${key} | ${[...new Set(all.flatMap(([, other]) => Object.keys(other.times.steps)))].map((step) => m.times.steps[step]?.toLocaleString() ?? '').join(' | ')} |`,
  ),
)}
${failed.length === 0 ? '' : `\n## Could not be converted\n\n${failed.map(([key, mini]) => `- ${key}: ${mini.error}`).join('\n')}\n`}`;
writeFileSync(join(OUT, 'results.md'), md);
console.log(
  `\n${basename(OUT)}: ${converted.length} converted, ${failed.length} failed${changes?.length ? `, ${changes.length} figures changed since the last run` : ''}. See ${join(OUT, 'results.md')}`,
);
