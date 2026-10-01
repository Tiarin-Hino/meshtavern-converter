// Measures the patches where the parts meet (issue #93, design note
// docs/design/patches-where-parts-meet.md §2, §8, §9), in Node: the prototype of the design pass
// made permanent.
//
//   node scripts/measure-fit.mjs [name-filter]
//
// For every corpus pair (a figure with `<name>-base.stl` next to it): the automatic placement
// (`placePairOnly`), the contact patches it gives (`contactPatches`, what the pairs stop
// proposes) and their time; the fit from those patches with the figure moved away, against the
// placement they came from, at the corners of the figure's box (`FIT_CHECK_MM`); a tap at each
// contact piece's centre, its area and how far its centre is from the piece's; the trees', taps'
// and fit's times against their budgets. Ends with the stop rules of the note's §13.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { baseFileFor, corpusFiles, CORPUS } from './lib/corpus-files.mjs';

const filter = process.argv[2];
const load = async (path) => (await runnerImport(path, { logLevel: 'silent' })).module;
const { placePairOnly } = await load('./src/lib/pipeline/run.ts');
const { TriangleBvh, TREE_BUDGET_MS_PER_M } = await load('./src/lib/pipeline/bvh.ts');
const { contactPatches, PROPOSAL_BUDGET_MS } = await load('./src/lib/pipeline/contact.ts');
const { fitMeeting, FIT_BUDGET_MS, FIT_CHECK_MM } = await load('./src/lib/pipeline/fit.ts');
const { PICK_BUDGET_MS, resolvePatch } = await load('./src/lib/pipeline/marks.ts');
const { apply } = await load('./src/lib/pipeline/rotation.ts');

/** The figure moved this far away before the fit puts it back: across, up and back. */
const AWAY = [20, 5, -10];
/** The stop rule's worst case for one pair (§13). */
const WORST_MM = 2.5;

const toBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const read = (file) => toBuffer(readFileSync(join(CORPUS, file)));
const round = (v, digits = 2) => Number(v.toFixed(digits));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const timed = (work) => {
  const start = performance.now();
  const result = work();
  return [result, performance.now() - start];
};

/** The corners of a box of positions. */
function corners(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  return Array.from({ length: 8 }, (_, c) => [
    c & 1 ? max[0] : min[0],
    c & 2 ? max[1] : min[1],
    c & 4 ? max[2] : min[2],
  ]);
}

const pairs = corpusFiles()
  .filter((figure) => !filter || figure.includes(filter))
  .map((figure) => ({ figure, base: baseFileFor(figure) }))
  .filter((pair) => pair.base);
if (pairs.length === 0) {
  console.error('No corpus pair found.');
  process.exit(2);
}

const rows = [];
for (const { figure, base } of pairs) {
  const placed = placePairOnly(read(figure), read(base));
  const { mesh, pair } = placed;
  const fv = pair.figureVertices;
  const ft = pair.figureTriangles;
  const figureMesh = {
    positions: mesh.positions.slice(0, fv * 3),
    indices: mesh.indices.slice(0, ft * 3),
  };
  const baseMesh = {
    positions: mesh.positions.slice(fv * 3),
    indices: mesh.indices.slice(ft * 3).map((i) => i - fv),
  };
  const [baseTree, baseTreeMs] = timed(() => new TriangleBvh(baseMesh));
  const [figureTree, figureTreeMs] = timed(() => new TriangleBvh(figureMesh));
  const triangles = (baseMesh.indices.length + figureMesh.indices.length) / 3;
  const treeMsPerM = ((baseTreeMs + figureTreeMs) / triangles) * 1e6;
  const [found, proposalMs] = timed(() =>
    contactPatches(
      { file: 1, mesh: baseMesh, tree: baseTree },
      { file: 0, mesh: figureMesh, positions: figureMesh.positions },
    ),
  );
  const row = {
    key: figure,
    triangles,
    spot: pair.placement.spot.kind,
    pieces: found.length,
    areasMm2: found.map((p) => round(p.of.areaMm2, 1)),
    proposalMs: round(proposalMs, 0),
    treeMsPerM: round(treeMsPerM, 0),
  };
  if (found.length > 0) {
    // The figure moved away; the fit from its patches alone puts it back.
    const away = found.map(({ on, of }) => ({
      on,
      of: {
        ...of,
        centre: [of.centre[0] + AWAY[0], of.centre[1] + AWAY[1], of.centre[2] + AWAY[2]],
      },
    }));
    const [fitted, fitMs] = timed(() => fitMeeting(away, { up: [0, 1, 0] }));
    const offMm = Math.max(
      ...corners(figureMesh.positions).map((corner) => {
        const moved = [corner[0] + AWAY[0], corner[1] + AWAY[1], corner[2] + AWAY[2]];
        const back = apply(fitted.rotation, moved);
        return distance(
          [
            back[0] + fitted.translation[0],
            back[1] + fitted.translation[1],
            back[2] + fitted.translation[2],
          ],
          corner,
        );
      }),
    );
    // A tap at each piece's centre, on the figure.
    const taps = found.map(({ of }) => {
      const [tapped, ms] = timed(() =>
        resolvePatch(figureMesh, figureTree, { file: 0, strokes: [{ tap: of.centre }] }),
      );
      return { ms, areaMm2: tapped.areaMm2, offMm: distance(tapped.centre, of.centre) };
    });
    Object.assign(row, {
      kept: fitted.fit.kept,
      fitOffMm: round(offMm),
      fitMs: round(fitMs, 2),
      tapMs: round(Math.max(...taps.map((t) => t.ms)), 1),
      tapAreasMm2: taps.map((t) => round(t.areaMm2, 1)),
      tapOffMm: taps.map((t) => round(t.offMm)),
    });
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}

const verdict = (ok) => (ok ? 'within' : 'OVER');
const measured = rows.filter((row) => row.fitOffMm !== undefined);
const over = measured.filter((row) => row.fitOffMm > FIT_CHECK_MM);
const worst = Math.max(...measured.map((row) => row.fitOffMm));
console.log('');
console.log(`${rows.length} pairs, ${measured.length} with contact.`);
console.log(
  `fit from the contact patches: ${over.length} over ${FIT_CHECK_MM} mm (stop at more than two), worst ${round(worst)} mm (stop above ${WORST_MM} mm)`,
);
const most = (key) => Math.max(...rows.map((row) => row[key] ?? 0));
console.log(
  `trees: up to ${most('treeMsPerM')} ms per million triangles, ${verdict(most('treeMsPerM') <= TREE_BUDGET_MS_PER_M)} ${TREE_BUDGET_MS_PER_M}`,
);
console.log(
  `proposal: up to ${most('proposalMs')} ms, ${verdict(most('proposalMs') <= PROPOSAL_BUDGET_MS)} ${PROPOSAL_BUDGET_MS}`,
);
console.log(
  `taps: up to ${most('tapMs')} ms, ${verdict(most('tapMs') <= PICK_BUDGET_MS)} ${PICK_BUDGET_MS}`,
);
console.log(
  `fit: up to ${most('fitMs')} ms, ${verdict(most('fitMs') <= FIT_BUDGET_MS)} ${FIT_BUDGET_MS}`,
);
const stop = over.length > 2 || worst > WORST_MM;
console.log(stop ? 'STOP: the fit misses (§13): ask on the PR.' : 'The fit holds.');
