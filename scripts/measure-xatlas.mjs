// Times one build of our xatlas module, cold and warm, on the table levels that take longest to
// unwrap (issue #33, design note docs/design/own-xatlas-build.md, section 6).
//
//   node scripts/measure-xatlas.mjs <file.wasm> [--runs N] [--files a.stl,b.stl]
//
// For every mesh and run: a fresh instance, one unwrap (cold), the same unwrap again (warm).
// Meshes: the generated `figure` of the regression net, then the three slowest unwraps of the
// last corpus run (out/corpus/results.json) when corpus/ is present, or the files given.
// Add `node --no-liftoff` to see whether V8's tiering explains the cold start.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { CORPUS } from './lib/corpus-files.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const runs = Number(option('--runs') ?? 1);
const files = option('--files')?.split(',');
const [wasmPath] = args;
if (!wasmPath) {
  console.error(
    'usage: node scripts/measure-xatlas.mjs <file.wasm> [--runs N] [--files a.stl,b.stl]',
  );
  process.exit(2);
}

const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { instantiateXatlas } = await load('./src/lib/pipeline/xatlas.ts');
const { unwrap } = await load('./src/lib/pipeline/unwrap.ts');
const { runPipeline, BAKED_LEVEL } = await load('./src/lib/pipeline/run.ts');
const { detailResolutionFor, surfaceAreaMm2 } = await load('./src/lib/pipeline/bake-policy.ts');
const { generateFigure } = await load('./src/regression/shapes.ts');
const { encodeBinaryStl } = await load('./src/lib/pipeline/stl.ts');

/** The table level of an STL, as the pipeline hands it to the unwrap. */
async function tableLevel(stl) {
  const result = await runPipeline(stl, { bake: 0 });
  const mesh = result.lods[BAKED_LEVEL].mesh;
  return { mesh, resolution: detailResolutionFor(surfaceAreaMm2(mesh)) };
}

const slowestInCorpus = () => {
  const results = join('out', 'corpus', 'results.json');
  if (!existsSync(CORPUS) || !existsSync(results)) return [];
  const { minis } = JSON.parse(readFileSync(results, 'utf8'));
  return Object.entries(minis)
    .filter(([, mini]) => mini.times?.steps?.unwrap)
    .sort(([, a], [, b]) => b.times.steps.unwrap - a.times.steps.unwrap)
    .slice(0, 3)
    .map(([name]) => `${name}.stl`);
};

const meshes = [{ name: 'figure (generated)', stl: () => encodeBinaryStl(generateFigure(true)) }];
for (const file of files ?? slowestInCorpus()) {
  const path = existsSync(file) ? file : join(CORPUS, file);
  const bytes = readFileSync(path);
  meshes.push({
    name: file,
    stl: () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

const wasm = readFileSync(wasmPath);
const time = async (run) => {
  const start = performance.now();
  const result = await run();
  return { ms: performance.now() - start, result };
};

console.log(
  `${wasmPath}: ${wasm.byteLength} bytes; node ${process.version} ${process.execArgv.join(' ')}`,
);
console.log('| mesh | triangles | run | cold s | warm s | cold/warm | charts | heap MB |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const { name, stl } of meshes) {
  const { mesh, resolution } = await tableLevel(stl());
  for (let run = 1; run <= runs; run++) {
    const xatlas = await instantiateXatlas(wasm);
    const cold = await time(() => unwrap(mesh, resolution, undefined, xatlas));
    const warm = await time(() => unwrap(mesh, resolution, undefined, xatlas));
    if (cold.result.charts !== warm.result.charts)
      throw new Error(`${name}: charts differ between runs`);
    const heapMb = xatlas.exports.memory.buffer.byteLength / 2 ** 20;
    console.log(
      `| ${name} | ${mesh.indices.length / 3} | ${run} | ${(cold.ms / 1000).toFixed(2)} | ` +
        `${(warm.ms / 1000).toFixed(2)} | ${(cold.ms / warm.ms).toFixed(2)} | ${cold.result.charts} | ${heapMb.toFixed(0)} |`,
    );
  }
}
