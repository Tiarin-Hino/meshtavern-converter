// A feedback session (issue #70, design note docs/design/base-file.md §13.2): steps through
// figure + base pairs in the real page, the PM corrects each placement with the page's own
// controls and presses a key, and a record and a sheet are written for every pair.
//
//   npm run feedback -- [--pairs <json>] [--from <key>] [--only <text>] [--redo]
//
// Without --pairs: the corpus pairs (a figure with a -base.stl next to it). With it: a list of
// { key, figure, base }, such as the research's pairs of the library. Pairs with a record are
// skipped unless --redo. Keys: R right (the automatic placement stands), S save placement (the
// orientation, and the move, raise and turn being tried out; Apply is not needed), K skip, N next
// (skip, marked), Escape end. Records: out/feedback/<key>.json, sheets: out/feedback/sheets/;
// both stay on this machine (the library's minis are licensed). Promote a corpus record by hand
// into scripts/corpus-placements.json; `npm run score-placements` scores the code against both.
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { baseFileFor, CORPUS, corpusFiles } from './lib/corpus-files.mjs';
import { installFeedback, recordPath, reviewPair } from './lib/feedback-session.mjs';
import { FEEDBACK_DIR } from './lib/placements.mjs';

const PORT = 4183;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

let pairs;
if (option('--pairs')) {
  const list = JSON.parse(readFileSync(option('--pairs'), 'utf8'));
  pairs = (list.pairs ?? list).map((pair, i) => ({
    key: pair.key ?? `${String(i).padStart(4, '0')}`,
    figure: pair.figure,
    base: pair.base,
  }));
} else {
  pairs = corpusFiles()
    .map((figure) => ({ figure, base: baseFileFor(figure) }))
    .filter((pair) => pair.base)
    .map(({ figure, base }) => ({
      key: figure.slice(0, -'.stl'.length).split(sep).join('/'),
      figure: join(CORPUS, figure),
      base: join(CORPUS, base),
    }));
}
if (option('--only')) pairs = pairs.filter((pair) => pair.key.includes(option('--only')));
if (option('--from')) {
  const at = pairs.findIndex((pair) => pair.key === option('--from'));
  if (at < 0) throw new Error(`No pair ${option('--from')}`);
  pairs = pairs.slice(at);
}
if (!args.includes('--redo'))
  pairs = pairs.filter((pair) => !existsSync(recordPath(FEEDBACK_DIR, pair.key)));
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
  await page.goto(`http://localhost:${PORT}/?dev&bake=off`);
  await page.waitForFunction(() => window.__mt?.state.ready === true);
  await page.bringToFront();
  const nextVerdict = await installFeedback(page);
  for (const [i, pair] of pairs.entries()) {
    const verdict = await reviewPair(page, pair, {
      index: i + 1,
      total: pairs.length,
      commit,
      outDir: FEEDBACK_DIR,
      browser,
      nextVerdict,
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
  }. Records in ${FEEDBACK_DIR}.`,
);
