// Times a tap at a meet question as the worker answers it (issue #93, design note
// docs/design/patches-where-parts-meet.md §4, §8), in Node: the file's search tree built once,
// then for each tap the ray against the tree and the patch it marks.
//
//   node scripts/measure-pick.mjs [<file.stl> ...] [--runs N]
//
// Without files: the ordinary corpus mini of the stop rule (`humanoid/M-001a`, 1.25 M triangles)
// and the largest corpus figure (`large-creature/large-01`, 5.6 M). Rays come straight down and
// straight in from the front over a grid across each file's box; the ones that hit are tapped.
// Tree times against TREE_BUDGET_MS_PER_M, taps (ray and patch) against PICK_BUDGET_MS.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { CORPUS } from './lib/corpus-files.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const runs = Number(option('--runs') ?? 20);
const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { TriangleBvh, TREE_BUDGET_MS_PER_M } = await load('./src/lib/pipeline/bvh.ts');
const { PICK_BUDGET_MS, resolvePatch } = await load('./src/lib/pipeline/marks.ts');
const { readStlTriangles } = await load('./src/lib/pipeline/stl.ts');
const { dropInvalidTriangles, weldVertices } = await load('./src/lib/pipeline/mesh.ts');

const files = args.length
  ? args
  : [join(CORPUS, 'humanoid', 'M-001a.stl'), join(CORPUS, 'large-creature', 'large-01.stl')].filter(
      (file) => existsSync(file),
    );
if (files.length === 0) throw new Error('No files: give an STL, or keep the corpus in corpus/.');

const toBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const verdict = (ok) => (ok ? 'within' : 'OVER');

for (const file of files) {
  const mesh = weldVertices(
    dropInvalidTriangles(readStlTriangles(toBuffer(readFileSync(file)))).soup,
  ).mesh;
  const triangles = mesh.indices.length / 3;
  let start = performance.now();
  const tree = new TriangleBvh(mesh);
  const treeMs = performance.now() - start;
  const perM = (treeMs / triangles) * 1e6;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  const side = Math.ceil(Math.sqrt(runs));
  const taps = [];
  for (const axis of [2, 1]) {
    for (let j = 1; j <= side && taps.length < runs * 2; j++)
      for (let i = 1; i <= side && taps.length < runs * 2; i++) {
        const [a, b] = [0, 1, 2].filter((k) => k !== axis);
        const origin = [0, 0, 0];
        origin[a] = min[a] + ((max[a] - min[a]) * i) / (side + 1);
        origin[b] = min[b] + ((max[b] - min[b]) * j) / (side + 1);
        origin[axis] = max[axis] + 10;
        const direction = [0, 0, 0];
        direction[axis] = -1;
        start = performance.now();
        const hit = tree.raycast(origin, direction);
        if (!hit) continue;
        const point = origin.map((v, k) => v + direction[k] * hit.t);
        const patch = resolvePatch(mesh, tree, { file: 0, strokes: [{ tap: point }] });
        taps.push({ ms: performance.now() - start, areaMm2: patch.areaMm2 });
      }
  }
  const worst = Math.max(...taps.map((tap) => tap.ms));
  const mean = taps.reduce((sum, tap) => sum + tap.ms, 0) / taps.length;
  console.log(
    `${file}: ${triangles.toLocaleString()} triangles; tree ${treeMs.toFixed(0)} ms ` +
      `(${perM.toFixed(0)} ms per million, ${verdict(perM <= TREE_BUDGET_MS_PER_M)} ${TREE_BUDGET_MS_PER_M}); ` +
      `${taps.length} taps: mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ` +
      `${verdict(worst <= PICK_BUDGET_MS)} ${PICK_BUDGET_MS} ms; mean patch ` +
      `${(taps.reduce((sum, tap) => sum + tap.areaMm2, 0) / taps.length).toFixed(1)} mm²`,
  );
}
