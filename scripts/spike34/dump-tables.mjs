// Spike #34. Converts every corpus mini in Node without baking and keeps the table level
// (the mesh the unwrap works on) in out/spike34/tables/, so unwrap variants can be tried
// without repeating the conversion. Also writes how many connected pieces each table level has.
// Usage: node scripts/spike34/dump-tables.mjs [filter]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createServer } from 'vite';
import { CORPUS, corpusFiles } from '../lib/corpus-files.mjs';

const OUT = join('out', 'spike34', 'tables');
mkdirSync(OUT, { recursive: true });
const filter = process.argv[2] ?? '';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { runPipeline, BAKED_LEVEL } = await vite.ssrLoadModule('/src/pipeline/run.ts');
const { connectedPieces } = await vite.ssrLoadModule('/src/pipeline/parts.ts');

const summary = {};
for (const path of corpusFiles().filter((file) => file.includes(filter))) {
  const key = path.slice(0, -'.stl'.length).split(sep).join('/');
  const file = readFileSync(join(CORPUS, path));
  const stl = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const result = await runPipeline(stl, { bake: 0 });
  const table = result.lods[BAKED_LEVEL].mesh;
  const name = key.replaceAll('/', '__');
  for (const field of ['positions', 'normals', 'indices']) {
    const array = table[field];
    writeFileSync(join(OUT, `${name}.${field}`), Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  const { sizes } = connectedPieces(table);
  const triangles = table.indices.length / 3;
  summary[key] = {
    triangles,
    vertices: table.positions.length / 3,
    pieces: sizes.length,
    largestPieceShare: Number((sizes[0] / triangles).toFixed(4)),
    largestPieces: sizes.slice(0, 8),
  };
  console.log(key, JSON.stringify(summary[key]));
}
await vite.close();
if (!filter) writeFileSync(join(OUT, 'pieces.json'), JSON.stringify(summary, null, 2));
