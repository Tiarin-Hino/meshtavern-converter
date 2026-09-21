// Spike #34. Tries unwrap variants in Node on table levels kept by dump-tables.mjs. One
// process, one core: parts run one after the other, and the time several workers would need
// is projected as slowest part + packing. Real workers are measured in Chrome (measure.mjs).
// Usage: node scripts/spike34/sweep.mjs <mini filter> <variant,variant,...> [resolution]
// Variants: base | parts<N> | cut<N> | <name>=<json chart options> | parts<N>+<json>
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const TABLES = join('out', 'spike34', 'tables');
const [filter = '', variantList = 'base', resolutionArg = '2048'] = process.argv.slice(2);
const resolution = Number(resolutionArg);
mkdirSync(join('out', 'spike34'), { recursive: true });
const LOG = join('out', 'spike34', 'sweep.jsonl');

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
const { unwrap, unwrapperReady, MAX_CHART_COST } =
  await vite.ssrLoadModule('/src/pipeline/unwrap.ts');
const { connectedPieces, groupPieces, splitByGroup, cutIntoSlabs } =
  await vite.ssrLoadModule('/src/pipeline/parts.ts');
const { findIslands, packParts, sharedTexelsPerUnit } = await vite.ssrLoadModule(
  '/src/pipeline/unwrap-parts.ts',
);
const { surfaceAreaMm2 } = await vite.ssrLoadModule('/src/pipeline/bake-policy.ts');
const { seamLengthMm } = await vite.ssrLoadModule('/src/pipeline/seams.ts');
await unwrapperReady();

const load = (name, field, Type) => {
  const file = readFileSync(join(TABLES, `${name}.${field}`));
  return new Type(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};
const names = [
  ...new Set(
    readdirSync(TABLES)
      .filter((f) => f.endsWith('.indices'))
      .map((f) => f.slice(0, -8)),
  ),
].filter((n) => n.includes(filter));
const round = (n, d = 0) => Number(n.toFixed(d));

for (const name of names) {
  const mesh = {
    positions: load(name, 'positions', Float32Array),
    normals: load(name, 'normals', Float32Array),
    indices: load(name, 'indices', Uint32Array),
  };
  for (const variant of variantList.split(';')) {
    const [kind, json] = variant.includes('=') ? variant.split('=') : variant.split('+');
    const options = { maxCost: MAX_CHART_COST, ...(json ? JSON.parse(json) : {}) };
    const split = /^(parts|cut)(\d+)$/.exec(kind);
    const row = { mini: name, variant, resolution };
    const start = performance.now();
    let result;
    if (!split) {
      result = await unwrap(mesh, resolution, () => {}, options);
      row.ms = round(performance.now() - start);
    } else {
      const count = Number(split[2]);
      let grouping;
      if (split[1] === 'parts') {
        const pieces = connectedPieces(mesh);
        grouping = groupPieces(pieces.pieceOfTriangle, pieces.sizes, count);
      } else grouping = cutIntoSlabs(mesh, count);
      const parts = splitByGroup(mesh, grouping.groupOfTriangle, grouping.groupSizes.length);
      row.splitMs = round(performance.now() - start);
      const scale = sharedTexelsPerUnit(surfaceAreaMm2(mesh), resolution);
      const islands = [];
      for (const part of parts) islands.push(await findIslands(part.mesh, options, scale));
      result = await packParts(mesh, parts, islands, resolution);
      row.partTriangles = grouping.groupSizes;
      row.partMs = islands.map((i) => round(i.ms));
      row.packMs = round(result.packMs);
      row.serialMs = round(performance.now() - start);
      // What several workers would need: the split, the slowest part, the packing.
      row.ms = round(row.splitMs + Math.max(...row.partMs) + row.packMs);
      row.partWasmMb = islands.map((i) => round(i.wasmBytes / 2 ** 20));
      row.packWasmMb = round(result.packWasmBytes / 2 ** 20);
      row.chartTypes = islands.reduce(
        (sum, i) => sum.map((n, k) => n + i.chartTypes[k]),
        [0, 0, 0, 0, 0],
      );
    }
    row.charts = result.charts;
    row.utilisation = round(result.utilisation, 4);
    row.vertices = result.mesh.positions.length / 3;
    row.seamMm = round(seamLengthMm(result.mesh));
    console.log(JSON.stringify(row));
    appendFileSync(LOG, JSON.stringify(row) + '\n');
  }
}
await vite.close();
