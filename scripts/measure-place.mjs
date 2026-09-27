// Times the place step of a figure on its base file (issue #70, design note
// docs/design/base-file.md §4.6), in Node.
//
//   node scripts/measure-place.mjs [<figure.stl> [<base.stl>]] [--runs N] [--full]
//
// Without files: the corpus pair with the most triangles (a figure with a `-base.stl` next to
// it). Without a base file: the generated recess base, refined to about a million triangles,
// the size of a large sculpted base. The files are read, welded and oriented once, then
// `placeOnBase`, the whole place step as run.ts calls it, is timed per run against
// PLACE_BUDGET_MS. `--full` runs the whole pipeline instead and prints every step's time.
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
const full = args.includes('--full') && args.splice(args.indexOf('--full'), 1).length > 0;

const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { runPipeline } = await load('./src/lib/pipeline/run.ts');
const { encodeBinaryStl } = await load('./src/lib/pipeline/stl.ts');
const { addRecessBase, RECESS_BASE } = await load('./src/regression/shapes.ts');
const { PLACE_BUDGET_MS, placeOnBase } = await load('./src/lib/pipeline/place.ts');
const { readStlTriangles } = await load('./src/lib/pipeline/stl.ts');
const { weldVertices, dropInvalidTriangles } = await load('./src/lib/pipeline/mesh.ts');
const { coverageFor, orientAndPlace } = await load('./src/lib/pipeline/orient.ts');
const { detectPairFile, guessRoles, shapeOfDetection } = await load('./src/lib/pipeline/pair.ts');

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
const verdict = (ms) => (ms <= PLACE_BUDGET_MS ? 'within' : 'OVER');
if (full) {
  for (let run = 1; run <= runs; run++) {
    const { stats } = await runPipeline(figureStl(), { bake: 0, secondStl: baseStl() });
    const times = stats.timings.map((t) => `${t.step} ${Math.round(t.ms)}`).join(', ');
    const place = stats.timings.find((t) => t.step === 'place').ms;
    console.log(`run ${run}: ${stats.sourceTriangles} triangles; ${times} ms`);
    console.log(
      `  place ${place.toFixed(0)} ms, ${verdict(place)} the ${PLACE_BUDGET_MS} ms budget`,
    );
  }
} else {
  // What run.ts does before the place step, once.
  const meshes = [figureStl(), baseStl()].map(
    (stl) => weldVertices(dropInvalidTriangles(readStlTriangles(stl)).soup).mesh,
  );
  const detections = meshes.map((mesh) => detectPairFile(mesh));
  const pairing = guessRoles([shapeOfDetection(detections[0]), shapeOfDetection(detections[1])]);
  const [figure, base] = [1 - pairing.baseFile, pairing.baseFile].map((k) => {
    const { orientation } = detections[k];
    return orientAndPlace(
      meshes[k],
      orientation.rotation,
      coverageFor(detections[k], orientation.up),
    );
  });
  const triangles = (figure.mesh.indices.length + base.mesh.indices.length) / 3;
  console.log(`${triangles} triangles after welding; base is file ${pairing.baseFile + 1}`);
  for (let run = 1; run <= runs; run++) {
    const start = performance.now();
    const { pair } = placeOnBase(figure, base, pairing);
    const ms = performance.now() - start;
    console.log(
      `run ${run}: place ${ms.toFixed(0)} ms, ${verdict(ms)} the ${PLACE_BUDGET_MS} ms budget`,
    );
    if (run === 1) console.log(`  ${JSON.stringify(pair.placement.spot)}`);
  }
}
