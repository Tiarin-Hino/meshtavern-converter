// A feedback session (issue #70, design note docs/design/base-file.md §13.2): steps through
// figure + base pairs in the real page, the PM corrects each placement with the page's own
// controls and presses a key, and a record and a sheet are written for every pair.
//
//   npm run feedback -- [--pairs <json>] [--from <key>] [--only <text>] [--redo] [--up ask|detected|index]
//
// Without --pairs: the corpus pairs (a figure with a -base.stl next to it). With it: a list of
// { key, figure, base }, such as the research's pairs of the library. Pairs with a record are
// skipped unless --redo. Keys: R right (the automatic placement stands), S save placement (the
// orientation, and the move, raise and turn being tried out; Apply is not needed), K skip, N next
// (skip, marked), Escape end. Records: out/feedback/<key>.json, sheets: out/feedback/sheets/;
// both stay on this machine (the library's minis are licensed). Promote a corpus record by hand
// into scripts/corpus-placements.json; `npm run score-placements` scores the code against both.
// Every pair stops at the questions after the orient step (#92): --up ask (the default) leaves
// them to the PM on the page; detected confirms the proposals; index answers with the pair's
// `up`, `rotation` and `baseUp` (in a --pairs list, or scripts/corpus-index.json for the corpus).
//
// --mark is the marking session (#93, PM decision 2026-09-30): the corpus minis placed by hand or
// called hard before (the records of scripts/corpus-placements.json that are not `right`, and
// the bat flying/flying-01) and every figure in parts (`<name>-part-<label>.stl`), one after the
// other, every question left to the PM, baked. The PM marks where the parts meet and the figure
// meets its base, adjusts, converts, and presses R or S. At the end the session's records go into
// scripts/corpus-placements.json: `npm run corpus -- --up index` and `npm run score-placements`
// then put those minis together and place them as marked, without asking.
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { baseFileFor, CORPUS, corpusFiles, partFilesFor } from './lib/corpus-files.mjs';
import { installFeedback, recordPath, reviewPair } from './lib/feedback-session.mjs';
import { CORPUS_PLACEMENTS, FEEDBACK_DIR } from './lib/placements.mjs';

/** The bat whose peg goes into the side of its spire: the case the marks were made for (#91, #93). */
const MARK_ALWAYS = ['flying/flying-01'];
const marking = process.argv.includes('--mark');
/** A marking session keeps its records apart from the placement reviews. */
const OUT_DIR = marking ? join(FEEDBACK_DIR, 'marks') : FEEDBACK_DIR;

const INDEX = 'scripts/corpus-index.json';

const PORT = 4183;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const up = option('--up') ?? 'ask';
if (!['ask', 'detected', 'index'].includes(up))
  throw new Error(`--up ${up}: use ask, detected or index`);
/** How a pair's questions are answered with --up index: its own `up`, `rotation` and `baseUp`. */
const answers = ({ up: axis, rotation, baseUp }) => ({
  ...(axis && { up: axis }),
  ...(rotation && { rotation }),
  ...(baseUp && { baseUp }),
});

let pairs;
if (option('--pairs')) {
  const list = JSON.parse(readFileSync(option('--pairs'), 'utf8'));
  pairs = (list.pairs ?? list).map((pair, i) => ({
    key: pair.key ?? `${String(i).padStart(4, '0')}`,
    figure: pair.figure,
    base: pair.base,
    ...answers(pair),
  }));
} else {
  const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
  const recorded = existsSync(CORPUS_PLACEMENTS)
    ? JSON.parse(readFileSync(CORPUS_PLACEMENTS, 'utf8'))
    : {};
  pairs = corpusFiles()
    .map((figure) => ({ figure, base: baseFileFor(figure), parts: partFilesFor(figure) }))
    .filter((pair) => pair.base || pair.parts.length > 0)
    .map(({ figure, base, parts }) => {
      const key = figure.slice(0, -'.stl'.length).split(sep).join('/');
      return {
        key,
        figure: join(CORPUS, figure),
        base: base ? join(CORPUS, base) : null,
        parts: parts.map((part) => join(CORPUS, part)),
        ...answers(index[key] ?? {}),
      };
    })
    // A placement review is about pairs; the marking session about the hard ones and the kits.
    .filter((pair) =>
      marking
        ? pair.parts.length > 0 ||
          MARK_ALWAYS.includes(pair.key) ||
          (recorded[pair.key] && recorded[pair.key].verdict !== 'right')
        : pair.base,
    );
}
if (option('--only')) pairs = pairs.filter((pair) => pair.key.includes(option('--only')));
if (option('--from')) {
  const at = pairs.findIndex((pair) => pair.key === option('--from'));
  if (at < 0) throw new Error(`No pair ${option('--from')}`);
  pairs = pairs.slice(at);
}
if (!args.includes('--redo'))
  pairs = pairs.filter((pair) => !existsSync(recordPath(OUT_DIR, pair.key)));
if (pairs.length === 0) {
  console.log('No pairs left to review (use --redo to review recorded ones again).');
  process.exit(0);
}

execSync('npm run build', { stdio: 'inherit' });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));
const commit = execSync('git describe --always --dirty').toString().trim();
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const counts = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  // The marking session bakes, as the page does for a person (PM decision 2026-09-30).
  await page.goto(`http://localhost:${PORT}/?dev${marking ? '' : '&bake=off'}`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.bringToFront();
  const nextVerdict = await installFeedback(page);
  for (const [i, pair] of pairs.entries()) {
    const verdict = await reviewPair(page, pair, {
      index: i + 1,
      total: pairs.length,
      commit,
      outDir: OUT_DIR,
      browser,
      nextVerdict,
      up: marking ? 'ask' : up,
    });
    if (verdict === 'end') break;
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    console.log(`${pair.key}: ${verdict}`);
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(
  `Recorded: ${
    Object.entries(counts)
      .map(([verdict, n]) => `${n} ${verdict}`)
      .join(', ') || 'nothing'
  }. Records in ${OUT_DIR}.`,
);

// The marking session's results (#93): every mini recorded right or placed goes into the
// committed records, with the choices that put it together and place it again.
if (marking) {
  const committed = existsSync(CORPUS_PLACEMENTS)
    ? JSON.parse(readFileSync(CORPUS_PLACEMENTS, 'utf8'))
    : {};
  let promoted = 0;
  for (const pair of pairs) {
    const path = recordPath(OUT_DIR, pair.key);
    if (!existsSync(path)) continue;
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.verdict !== 'right' && record.verdict !== 'placed') continue;
    committed[pair.key] = {
      verdict: 'placed',
      date: record.date.slice(0, 10),
      orientation: { up: record.orientation.up },
      placed: record.placed && {
        figureCentreMm: record.placed.figureCentreMm.map((mm) => Number(mm.toFixed(2))),
        figureLowestMm: Number(record.placed.figureLowestMm.toFixed(2)),
        yawDeg: Number(record.placed.yawDeg.toFixed(2)),
      },
      choices: record.choices,
      source: `the PM in a marking session (npm run feedback -- --mark, ${record.commit})`,
      note: committed[pair.key]?.note ?? '',
    };
    promoted++;
  }
  const sorted = Object.fromEntries(
    Object.entries(committed).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(CORPUS_PLACEMENTS, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`${promoted} marked minis written to ${CORPUS_PLACEMENTS}.`);
}
