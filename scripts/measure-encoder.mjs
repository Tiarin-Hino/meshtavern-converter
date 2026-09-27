// Times one build of the Basis Universal encoder, cold and warm, on generated detail textures
// (issue #38, design note docs/design/own-basis-encoder-build.md, section 6).
//
//   node scripts/measure-encoder.mjs <file.wasm> [--runs N]
//
// The .wasm is one of our builds (wasm/basis-encoder/ or a variant under out/basis-encoder/). The
// before column, ktx2-encoder 0.6.0, was measured with this script before #38 removed the package:
// docs/journal/2026-09-27-own-basis-encoder-build.md. For every texture and run: a fresh instance, one encode
// (cold), the same encode again (warm). Settings are the pipeline's: UASTC effort 0, Zstandard,
// mipmaps, linear. The output's size and SHA-256 show whether two builds write the same files.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const runs = Number(option('--runs') ?? 1);
const [target] = args;
if (!target) {
  console.error('usage: node scripts/measure-encoder.mjs <file.wasm> [--runs N]');
  process.exit(2);
}

const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { gradientTexture, noiseTexture } = await load('./src/regression/textures.ts');
const { DETAIL_EFFORT, detailOptions } = await load('./src/lib/pipeline/compress.ts');

/** A fresh encoder of the target: `(rgba, size) => Promise<Uint8Array>`. */
async function freshEncoder() {
  const { instantiateBasisEncoder } = await load('./src/lib/pipeline/basis-encoder.ts');
  const encoder = await instantiateBasisEncoder(readFileSync(target));
  return async (rgba, size) => encoder.encodeKtx2(rgba, size, size, detailOptions(DETAIL_EFFORT));
}

const textures = [
  { name: 'gradient 1024', size: 1024, rgba: gradientTexture(1024) },
  { name: 'noise 1024', size: 1024, rgba: noiseTexture(1024) },
  { name: 'gradient 2048', size: 2048, rgba: gradientTexture(2048) },
  { name: 'noise 2048', size: 2048, rgba: noiseTexture(2048) },
];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const time = async (run) => {
  const start = performance.now();
  const result = await run();
  return { ms: performance.now() - start, result };
};

console.log(`${target}, ${runs} run(s), Node ${process.versions.node}`);
const totals = { cold: 0, warm: 0 };
for (const { name, size, rgba } of textures) {
  const cold = [];
  const warm = [];
  let output;
  for (let run = 0; run < runs; run++) {
    // The cold number includes compiling and instantiating the module, as a first conversion does.
    const first = await time(async () => (await freshEncoder())(rgba, size));
    const encode = await freshEncoder();
    await encode(rgba, size);
    const second = await time(() => encode(rgba, size));
    cold.push(first.ms);
    warm.push(second.ms);
    output = second.result;
  }
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  totals.cold += mean(cold);
  totals.warm += mean(warm);
  console.log(
    `${name.padEnd(14)} cold ${mean(cold).toFixed(0).padStart(6)} ms  warm ${mean(warm)
      .toFixed(0)
      .padStart(6)} ms  ${String(output.byteLength).padStart(9)} bytes  sha256 ${sha(output)}`,
  );
}
console.log(
  `total          cold ${totals.cold.toFixed(0).padStart(6)} ms  warm ${totals.warm.toFixed(0).padStart(6)} ms`,
);
