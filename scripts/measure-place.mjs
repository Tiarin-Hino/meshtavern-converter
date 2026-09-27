// Times the place step of a figure on its base file (issue #70, design note
// docs/design/base-file.md §4.6), in Node.
//
//   node scripts/measure-place.mjs [<figure.stl> [<base.stl>]] [--runs N]
//
// Without files: the corpus pair with the most triangles (a figure with a `-base.stl` next to
// it). Without a base file: the generated recess base, refined to about a million triangles,
// the size of a large sculpted base. Prints each step's time per run; the place step is the one
// with a budget (PLACE_BUDGET_MS in place.ts).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { baseFileFor, corpusFiles, CORPUS } from './lib/corpus-files.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const runs = Number(option('--runs') ?? 3);

const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { runPipeline } = await load('./src/lib/pipeline/run.ts');
const { encodeBinaryStl } = await load('./src/lib/pipeline/stl.ts');
const { addRecessBase, RECESS_BASE } = await load('./src/regression/shapes.ts');
const { PLACE_BUDGET_MS } = await load('./src/lib/pipeline/place.ts');

const toBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

let [figurePath, basePath] = args;
if (!figurePath) {
  const pairs = corpusFiles()
    .map((figure) => ({ figure, base: baseFileFor(figure) }))
    .filter((pair) => pair.base);
  const size = (pair) =>
    statSync(join(CORPUS, pair.figure)).size + statSync(join(CORPUS, pair.base)).size;
  const largest = pairs.sort((a, b) => size(b) - size(a))[0];
  if (!largest) {
    console.error('No corpus pair found: give a figure file (and a base file).');
    process.exit(2);
  }
  figurePath = join(CORPUS, largest.figure);
  basePath = join(CORPUS, largest.base);
}

const figureStl = () => toBuffer(readFileSync(figurePath));
let baseStl;
if (basePath) baseStl = () => toBuffer(readFileSync(basePath));
else {
  const soup = [];
  const { diameterMm, heightMm, recessMm, recessDepthMm } = RECESS_BASE;
  addRecessBase(soup, diameterMm, heightMm, 496, recessMm, recessDepthMm);
  const bytes = encodeBinaryStl(new Float32Array(soup));
  baseStl = () => bytes.slice(0);
}

console.log(`figure ${figurePath}`);
console.log(`base   ${basePath ?? 'generated recess base'}`);
for (let run = 1; run <= runs; run++) {
  const { stats } = await runPipeline(figureStl(), { bake: 0, secondStl: baseStl() });
  const times = stats.timings.map((t) => `${t.step} ${Math.round(t.ms)}`).join(', ');
  const place = stats.timings.find((t) => t.step === 'place').ms;
  const verdict = place <= PLACE_BUDGET_MS ? 'within' : 'OVER';
  console.log(`run ${run}: ${stats.sourceTriangles} triangles; ${times} ms`);
  console.log(`  place ${place.toFixed(0)} ms, ${verdict} the ${PLACE_BUDGET_MS} ms budget`);
  if (run === 1) console.log(`  ${JSON.stringify(stats.pair.placement.spot)}`);
}
