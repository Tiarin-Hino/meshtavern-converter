// Scores the current placement code against the PM's recorded placements (issue #70, design
// note docs/design/base-file.md §13.3), in Node, without Chrome: read, weld, orient and place
// only, so the corpus takes about a minute.
//
//   npm run score-placements -- [--pairs <json>] [--no-feedback]
//
// Records: scripts/corpus-placements.json (committed, corpus pairs) and out/feedback/ (made with
// `npm run feedback`, left out with --no-feedback). A corpus record finds its files under
// corpus/; a feedback record carries its paths. `--pairs` adds a list of { key, figure, base }
// for records whose files are elsewhere (the PM's library).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { baseFileFor, CORPUS, partFilesFor } from './lib/corpus-files.mjs';
import { loadRecords, scoreAll, scoreReport } from './lib/placements.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const pairsFile = option('--pairs');
const listed = new Map(
  (pairsFile ? (JSON.parse(readFileSync(pairsFile, 'utf8')).pairs ?? []) : []).map((pair) => [
    pair.key,
    pair,
  ]),
);

const { placePairOnly } = (await runnerImport('./src/lib/dev.ts', { logLevel: 'silent' })).module;
const read = (path) => {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

/** Where a record's files are: the list, the record itself, or the corpus (with a kit's parts, #93). */
function filesOf(key, record) {
  if (listed.has(key)) return listed.get(key);
  if (record.figureFile && record.baseFile && existsSync(record.figureFile))
    return { figure: record.figureFile, base: record.baseFile, parts: record.partFiles ?? [] };
  const figure = `${key}.stl`;
  const base = existsSync(join(CORPUS, figure)) ? baseFileFor(figure) : null;
  const parts = partFilesFor(figure).map((part) => join(CORPUS, part));
  return base ? { figure: join(CORPUS, figure), base: join(CORPUS, base), parts } : null;
}

const records = loadRecords({ feedback: !args.includes('--no-feedback') });
const start = performance.now();
const rows = scoreAll(records, filesOf, ({ figure, base, parts = [] }, options) =>
  placePairOnly(read(figure), read(base), { ...options, moreStl: parts.map(read) }),
);
console.log(scoreReport(rows));
console.log(
  `\n${rows.length} records scored in ${((performance.now() - start) / 1000).toFixed(0)} s.`,
);
