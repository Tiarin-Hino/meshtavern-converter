// The regression run over the local corpus (issue #46). Converts every STL in corpus/ in
// real Chrome (GPU on) and writes to out/corpus/:
//   results.json     triangles, error, sizes and times per level for every mini
//   results.md       the same as tables, the corpus coverage, the size suggestions, the
//                    up directions and the spots of figures on their base files (#70)
//                    checked against scripts/corpus-index.json, and what
//                    changed since the last run
//   <kind>/<name>.png  one comparison sheet per mini: rows = whole mini and close-up, columns = levels
// Sort the corpus into folders named after the kind of mini (see KINDS); files directly in
// corpus/ count as "unsorted".
// Every file stops at the question after the orient step (#92), which is answered as detected,
// or with --up index as scripts/corpus-index.json says (`up`, `rotation`, `baseUp`); the time to
// it is measured. --options "?ask=off" converts without the question, as before #92.
// Usage: npm run corpus -- [--no-bake] [--up detected|index] [--options "?ktx=1"] [--out <folder under out/>]
// Nothing from corpus/ or out/ is ever committed.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer, runnerImport } from 'vite';
import { asDetected, convertAnswering } from './lib/answer-up.mjs';
import { baseFileFor, CORPUS, corpusFiles } from './lib/corpus-files.mjs';
import { loadRecords, scoreAll, scoreReport } from './lib/placements.mjs';

const PORT = 4179;
/**
 * The expected creature size (issue #44), up direction in the file (issue #72) and, for a
 * figure with a base file, the kind of spot it belongs in (`spot`: hole, recess or flat, with
 * an optional `placementNote`; issue #70) per corpus mini, keyed like results.json.
 * Committed; the corpus itself is not. The script only reads it.
 */
const INDEX = 'scripts/corpus-index.json';
/** The kinds the Phase 1 spec asks the corpus to cover; each is a folder under corpus/. */
const KINDS = ['humanoid', 'large-creature', 'quadruped', 'flying', 'mounted', 'swarm', 'terrain'];
const CORPUS_GOAL = [20, 30];
/** The spec allows the largest mini three minutes on the reference laptop; leave room above that. */
const CONVERSION_TIMEOUT_MS = 600_000;
/**
 * Time from picking a file to its question on screen, on the reference laptop: the issue's
 * numbers (#92, design note §8). _(proposal)_ Pairs are reported, not held to it (PM decision).
 */
const QUESTION_BUDGET_MS = 3_000; // an ordinary mini: one figure on a base of up to 32 mm
const QUESTION_BUDGET_LARGEST_MS = 15_000; // the largest corpus file
const VIEWS = [
  { name: 'whole', azimuth: 25, elevation: 12, zoom: 1 },
  { name: 'close-up', azimuth: 25, elevation: 8, zoom: 2.6 },
];

/** The views of a placement sheet (#70): how the figure sits on its base, at full detail. */
const PLACEMENT_VIEWS = [
  { name: 'front low', azimuth: 25, elevation: 8, zoom: 1.3 },
  { name: 'side', azimuth: 115, elevation: 12, zoom: 1.3 },
  { name: 'from above', azimuth: 25, elevation: 55, zoom: 1.3 },
];

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const bake = !args.includes('--no-bake');
const extra = new URLSearchParams(flag('--options') ?? '');
if (!bake) extra.set('bake', 'off');
const address = `http://localhost:${PORT}/?${extra}`;
/** How the questions are answered: as detected, or as the index says. */
const up = flag('--up') ?? 'detected';
if (!['detected', 'index'].includes(up)) throw new Error(`--up ${up}: use detected or index`);
const expected = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};

/**
 * What a mini's questions are answered with (#92): with --up index, the figure's the index's
 * `rotation` or `up`, the base's its `baseUp`; a proposal that already stands that way is
 * confirmed as it is, as a person would, so a pair keeps its registration test.
 */
function pickFor(key) {
  if (up === 'detected') return asDetected;
  const entry = expected[key] ?? {};
  return (question) => {
    if (question.role === 'base')
      return entry.baseUp && entry.baseUp !== question.orientation.up ? { up: entry.baseUp } : {};
    if (entry.rotation) return { rotation: entry.rotation };
    return entry.up && entry.up !== question.orientation.up ? { up: entry.up } : {};
  };
}
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
/** The longest the page may stand still during a conversion, in ms (Phase 1 spec, story 2). */
const MAX_STALL_MS = 100;
const minis = {};
let machine;
const HIDE_OVERLAY = '#panel, #levels { display: none }';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto(address);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  // The panel and the level chips lie over the canvas: hidden, so the sheets show the mini alone.
  await page.addStyleTag({ content: HIDE_OVERLAY });
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
    // A figure with its base file next to it (#70) is converted as a pair; the key stays the figure's.
    const base = baseFileFor(path);
    if (base) {
      mini.baseFile = base.split(sep).join('/');
      mini.baseStlBytes = statSync(join(CORPUS, base)).size;
    }

    await page.evaluate(() => Object.assign(window.__mt.state, { stats: null, error: null }));
    await page.setInputFiles('#file', base ? [file, join(CORPUS, base)] : file);
    try {
      await convertAnswering(page, pickFor(key), CONVERSION_TIMEOUT_MS);
    } catch {
      mini.error = `did not finish within ${CONVERSION_TIMEOUT_MS / 1000} s`;
      console.log(`${key}: ${mini.error}`);
      // The page is still converting; start over with a fresh one for the next mini.
      await page.goto(address);
      await page.waitForFunction(() => window.__mt?.state.ready === true);
      await page.addStyleTag({ content: HIDE_OVERLAY });
      continue;
    }
    const { stats, baked, error, longestFrameGapMs, questionMs } = await page.evaluate(
      () => window.__mt.state,
    );
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
      duplicateTriangles: stats.duplicateTriangles,
      invalidTriangles: stats.invalidTriangles,
      sizeMm: stats.sizeMm.map((mm) => round(mm, 2)),
      up: stats.up,
      upMethod: stats.upMethod,
      // The questions after the orient step (#92), confirmed in this order.
      asked: stats.asked.map((asked) => ({ role: asked.role, tries: asked.tries })),
      orientation: {
        confidence: round(stats.orientation.confidence, 3),
        tiltDeg: round(stats.orientation.tiltDeg, 1),
        setDownDeg: round(stats.orientation.setDownDeg, 1),
        rotation: stats.orientation.rotation.map((value) => round(value, 5)),
      },
      sizing: {
        units: stats.sizing.units,
        size: stats.sizing.size,
        footprintSquares: stats.sizing.footprintSquares,
        base: stats.sizing.base && {
          shape: stats.sizing.base.shape,
          diameterMm: round(stats.sizing.base.diameterMm, 2),
          footprintMm: stats.sizing.base.footprintMm.map((mm) => round(mm, 2)),
          coverage: round(stats.sizing.base.coverage, 3),
        },
        baseDiameterMm: round(stats.sizing.baseDiameterMm, 2),
        suggestedFrom: stats.sizing.suggestedFrom,
        warnings: stats.sizing.warnings.map((warning) => warning.kind),
      },
      bakeSkipped: stats.bakeSkipped ?? null,
      ...(stats.pair && { pair: pairFigures(stats.pair) }),
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
        /** The same texture, uncompressed, as it would be without KTX2: 4 bytes a texel. */
        rawBytes: baked.resolution ** 2 * 4,
      },
      // Everything that depends on the machine sits under `times` and is left out of comparisons.
      times: {
        steps: Object.fromEntries(stats.timings.map((timing) => [timing.step, round(timing.ms)])),
        totalMs: round(stats.totalMs),
        compactEncodeMs: exported.map((row) => round(row.encodeMs)),
        ktx2EncodeMs: baked?.ktx2EncodeMs == null ? null : round(baked.ktx2EncodeMs),
        longestFrameGapMs: round(longestFrameGapMs),
        questionMs: questionMs === null ? null : round(questionMs),
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
            // The table level shows its baked maps unless told otherwise.
            window.__mt.showLevel(c.level);
            if (c.level === 2) window.__mt.showBaked(c.baked === true);
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
      <h3 style="margin:0 0 8px">${key}${mini.pair ? ` on ${basename(mini.baseFile, '.stl')}, ${spotWords(mini.pair.spot)}` : ''}: ${stats.triangles.toLocaleString()} triangles, ${mini.sizeMm.join(' × ')} mm, up ${stats.up} (${stats.upMethod}${stats.orientation.tiltDeg > 0 ? `, tilted ${round(stats.orientation.tiltDeg, 1)}°` : ''}), ${stats.sizing.size} (${stats.sizing.footprintSquares}×${stats.sizing.footprintSquares})</h3>
      <div style="display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:6px">
      ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
      </div></body>`);
    mkdirSync(dirname(join(OUT, `${key}.png`)), { recursive: true });
    await sheet.screenshot({ path: join(OUT, `${key}.png`), fullPage: true });
    await sheet.close();
    if (mini.pair) await placementSheet(page, browser, key, mini);
    console.log(`${key}: ${stats.triangles.toLocaleString()} triangles, ${mini.times.totalMs} ms`);
  }
} finally {
  await browser.close();
  server.kill();
}

/** What results.json keeps of a pair (#70): the roles, the spot, where the figure went, the other basins. */
function pairFigures(pair) {
  const spot = (s) => ({
    kind: s.kind,
    centre: s.centre.map((mm) => round(mm, 2)),
    sizeMm: s.sizeMm.map((mm) => round(mm, 2)),
    depthMm: round(s.depthMm, 2),
    fit: round(s.fit, 3),
    ...(s.centred && { centred: true }),
  });
  return {
    baseFile: pair.pairing.baseFile,
    method: pair.pairing.method,
    warnings: pair.pairing.warnings,
    spot: spot(pair.placement.spot),
    offsetMm: pair.placement.offsetMm.map((mm) => round(mm, 2)),
    yawDeg: round(pair.placement.yawDeg, 1),
    placement: pair.placement.method,
    candidates: pair.placement.candidates.map(spot),
  };
}

/** "set in the hole", "set on the flattest patch", "set where the files put it". */
function spotWords(spot) {
  if (spot.centred) return 'set over the middle of the base';
  if (spot.kind === 'registered') return 'set where the files put it';
  return spot.kind === 'flat' ? 'set on the flattest patch' : `set in the ${spot.kind}`;
}

/** Writes `<key>-placement.png`: the pair at full detail from three sides, one column per run. */
async function placementSheet(page, browser, key, mini) {
  const shots = [];
  for (const view of PLACEMENT_VIEWS) {
    await page.evaluate((v) => {
      window.__mt.showLevel(0);
      window.__mt.setCamera(v.azimuth, v.elevation, v.zoom);
    }, view);
    await page.waitForTimeout(350);
    const png = await page.locator('#viewport').screenshot();
    shots.push({ caption: view.name, data: png.toString('base64') });
  }
  const sheet = await browser.newPage({ viewport: { width: 1100, height: 100 } });
  await sheet.setContent(`<body style="margin:10px;background:#111;color:#ddd;font:14px system-ui">
    <h3 style="margin:0 0 8px">${key} on ${basename(mini.baseFile, '.stl')}: ${spotWords(mini.pair.spot)}, lift ${mini.pair.offsetMm[2]} mm, up ${mini.up} (${mini.upMethod})</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
    ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${s.data}" style="width:100%;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}
    </div></body>`);
  await sheet.screenshot({ path: join(OUT, `${key}-placement.png`), fullPage: true });
  await sheet.close();
}

// The recorded placements (#70, design note §13): scored in Node with the placement-only path.
let placementScores = null;
if (Object.values(minis).some((mini) => mini.baseFile)) {
  const { placePairOnly } = (await runnerImport('./src/lib/dev.ts', { logLevel: 'silent' })).module;
  const read = (path) => {
    const bytes = readFileSync(path);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  const corpusPair = (key) => {
    const mini = minis[key];
    return mini?.baseFile
      ? { figure: join(CORPUS, `${key}.stl`), base: join(CORPUS, mini.baseFile) }
      : null;
  };
  placementScores = scoreAll(
    loadRecords({ feedback: false }),
    corpusPair,
    (figure, base, options) => placePairOnly(read(figure), read(base), options),
  );
}

const results = {
  date: new Date().toISOString(),
  commit: execSync('git describe --always --dirty').toString().trim(),
  options: extra.size > 0 ? `?${extra}` : 'none',
  up,
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

/** The size suggestions against the committed index: a mismatch is reported, not fatal. */
function sizeReport() {
  if (!existsSync(INDEX)) return `No ${INDEX}: nothing to check the suggestions against.`;
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const measured = (m) =>
    m.sizing.base
      ? `base ${m.sizing.base.diameterMm} mm ${m.sizing.base.shape}`
      : `no base (figure ${Math.max(m.sizeMm[0], m.sizeMm[2])} mm across)`;
  const listed = converted.filter(([key]) => index[key]?.size);
  const matches = listed.filter(([key, m]) => m.sizing.size === index[key].size);
  const mismatches = listed.filter(([key, m]) => m.sizing.size !== index[key].size);
  const unlisted = converted.filter(([key]) => !index[key]?.size).map(([key]) => key);
  const stale = Object.keys(index).filter((key) => !(key in minis));
  return [
    `${matches.length} of ${listed.length} suggestions match ${INDEX}.`,
    mismatches.length === 0
      ? 'No mismatches.'
      : table(
          ['Mini', 'Suggested', 'Expected', 'Measured', 'Up', 'Note'],
          mismatches.map(
            ([key, m]) =>
              `| ${key} | ${m.sizing.size} | ${index[key].size} | ${measured(m)} | ${m.up} (${m.upMethod}) | ${index[key].note ?? ''} |`,
          ),
        ),
    `Minis not in the index: ${unlisted.join(', ') || 'none'}.`,
    ...(stale.length > 0 ? [`In the index but not in the corpus: ${stale.join(', ')}.`] : []),
    table(
      ['Mini', 'Suggested', 'Measured', 'Units', 'Warnings'],
      converted.map(
        ([key, m]) =>
          `| ${key} | ${m.sizing.size} (${m.sizing.footprintSquares}×${m.sizing.footprintSquares}) | ${measured(m)} | ${m.sizing.units} | ${m.sizing.warnings.join(', ') || 'none'} |`,
      ),
    ),
  ].join('\n\n');
}
/** The pairs (#70): the spot found against the kind the index expects, with the runners-up. */
function pairReport() {
  const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
  const pairs = converted.filter(([, m]) => m.pair);
  const withBase = Object.entries(minis).filter(([, m]) => m.baseFile);
  if (withBase.length === 0) return 'No figure has a base file next to it (`<name>-base.stl`).';
  const size = (s) => `${s.sizeMm.join(' × ')} mm`;
  const found = (p) => (p.spot.centred ? 'centred' : p.spot.kind);
  const matches = pairs.filter(([key, m]) => index[key]?.spot === found(m.pair));
  return [
    `${pairs.length} of ${withBase.length} pairs converted; the spot matches the index for ${matches.length}.`,
    '',
    table(
      [
        'Figure',
        'Base file',
        'Spot found',
        'Expected',
        'Size',
        'Depth',
        'Fit',
        'At (x, z)',
        'Lift',
        'Turn',
        'Warnings',
        'Other basins',
      ],
      pairs.map(([key, m]) => {
        const p = m.pair;
        const others = p.candidates
          .filter((c) => c.kind !== p.spot.kind || c.centre.join() !== p.spot.centre.join())
          .slice(0, 3)
          .map((c) => `${c.kind} ${size(c)}, fit ${c.fit}`)
          .join('; ');
        return `| ${key} | ${m.baseFile} (file ${p.baseFile + 1}, ${p.method}) | ${found(p)} | ${index[key]?.spot ?? '?'} | ${size(p.spot)} | ${p.spot.depthMm} mm | ${p.spot.fit} | ${p.offsetMm[0]}, ${p.offsetMm[1]} | ${p.offsetMm[2]} mm | ${p.yawDeg}° | ${p.warnings.join(', ') || 'none'} | ${others || 'none'} |`;
      }),
    ),
    ...pairs
      .filter(([key]) => index[key]?.placementNote)
      .map(([key]) => `- ${key}: ${index[key].placementNote}`),
  ].join('\n');
}

/**
 * Time from picking the files to the question on screen (#92, design note §8): single files
 * against the budgets, the largest file against its own; pairs reported.
 */
function questionReport() {
  const timed = converted.filter(([, m]) => m.times.questionMs != null);
  if (timed.length === 0) return 'Nothing was asked (`--options "?ask=off"`).';
  const singles = timed.filter(([, m]) => !m.pair);
  const largest = singles.reduce(
    (most, row) => (most === null || row[1].stlBytes > most[1].stlBytes ? row : most),
    null,
  )?.[0];
  const budgetOf = ([key, m]) =>
    m.pair ? null : key === largest ? QUESTION_BUDGET_LARGEST_MS : QUESTION_BUDGET_MS;
  const over = singles.filter((row) => row[1].times.questionMs > budgetOf(row));
  const steps = (m) =>
    ['read', 'weld', 'orient'].reduce((sum, step) => sum + (m.times.steps[step] ?? 0), 0);
  return [
    `${singles.length - over.length} of ${singles.length} single files reached the question within the budget (${QUESTION_BUDGET_MS / 1000} s, the largest file ${QUESTION_BUDGET_LARGEST_MS / 1000} s). The budgets are the reference laptop's; this run is ${results.machine.cpu}. Pairs are reported, not held to a budget (PM decision on PR #94).`,
    table(
      [
        'Mini',
        'Source triangles',
        'Time to the question',
        'Budget',
        'Read + weld + orient',
        'Questions (tries)',
      ],
      timed.map((row) => {
        const [key, m] = row;
        const budget = budgetOf(row);
        const within =
          budget === null
            ? 'reported'
            : `${budget.toLocaleString()} ms${m.times.questionMs > budget ? ' **over**' : ''}`;
        const asked = m.asked.map((a) => `${a.role} ${a.tries}`).join(', ') || 'none';
        return `| ${key} | ${m.sourceTriangles.toLocaleString()} | ${m.times.questionMs.toLocaleString()} ms | ${within} | ${steps(m).toLocaleString()} ms | ${asked} |`;
      }),
    ),
  ].join('\n\n');
}

/** The up directions against the committed index (issue #72): every mismatch and every tilt. */
function orientationReport() {
  if (!existsSync(INDEX)) return `No ${INDEX}: nothing to check the up directions against.`;
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const listed = converted.filter(([key]) => index[key]?.up);
  const mismatches = listed.filter(([key, m]) => m.up !== index[key].up);
  const unlisted = converted.filter(([key]) => !index[key]?.up).map(([key]) => key);
  const row = ([key, m]) =>
    `| ${key} | ${m.up} | ${index[key]?.up ?? '?'} | ${m.upMethod} | ${m.orientation.confidence} | ${m.orientation.tiltDeg}° | ${m.orientation.setDownDeg}° | ${index[key]?.upNote ?? ''} |`;
  const head = ['Mini', 'Up', 'Expected', 'Method', 'Confidence', 'Tilt', 'Set down', 'Note'];
  return [
    `${listed.length - mismatches.length} of ${listed.length} minis stand on the up direction in ${INDEX}.`,
    mismatches.length === 0 ? 'No mismatches.' : table(head, mismatches.map(row)),
    `Minis without an expected up direction: ${unlisted.join(', ') || 'none'}.`,
    table(head, converted.map(row)),
  ].join('\n\n');
}
const missing = KINDS.filter((kind) => !kinds.includes(kind));

const md = `# Corpus results

${results.date} · commit ${results.commit} · options \`${results.options}\` · questions answered ${up === 'index' ? 'as the index says' : 'as detected'}
${results.machine.gpu} · ${results.machine.cpu} · ${results.machine.memoryGb} GB · ${results.machine.browser}

## Corpus coverage

- ${files.length} minis; the goal is ${CORPUS_GOAL.join('–')}.
- By kind (the folder under corpus/): ${count(kinds)}.
- Kinds still missing: ${missing.join(', ') || 'none'}.
- Up direction taken from the file: ${count(converted.map(([, mini]) => mini.up))}.
- Flat base found: ${count(converted.map(([, mini]) => (mini.upMethod === 'base' ? 'yes' : 'no')))}.

## Orientation

${orientationReport()}

## Time to the question

${questionReport()}

## Size suggestions

${sizeReport()}

## Base files

${pairReport()}

${placementScores === null ? '' : `### Against the recorded placements (scripts/corpus-placements.json)\n\n${scoreReport(placementScores)}\n`}
## Changes since the last run

${
  changes === null
    ? 'No earlier results to compare with.'
    : changes.length === 0
      ? `None (times aside), compared with ${previous.date}, commit ${previous.commit}.`
      : `Compared with ${previous.date}, commit ${previous.commit} (kept as results.previous.json):\n\n${changes.map((change) => `- ${change}`).join('\n')}`
}

## Minis

${(() => {
  const skipped = converted.filter(([, m]) => m.bakeSkipped);
  const stalled = converted.filter(([, m]) => m.times.longestFrameGapMs > MAX_STALL_MS);
  return [
    skipped.length === 0
      ? 'Every mini that should be baked is baked.'
      : `Not baked, per-vertex look instead: ${skipped.map(([key, m]) => `${key} (${m.bakeSkipped.reason === 'device' ? 'texture too large for the device' : `${m.bakeSkipped.step} failed: ${m.bakeSkipped.message}`})`).join('; ')}.`,
    stalled.length === 0
      ? `No page stall over the ${MAX_STALL_MS} ms limit.`
      : `**Page stalls over the ${MAX_STALL_MS} ms limit:** ${stalled.map(([key, m]) => `${key} (${m.times.longestFrameGapMs} ms)`).join(', ')}.`,
  ].join(' ');
})()}

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
