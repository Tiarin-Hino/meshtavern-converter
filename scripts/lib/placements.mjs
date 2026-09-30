// The PM's recorded placements of figures on their base files, and the score of the current
// code against them (issue #70, design note docs/design/base-file.md §13). Records of corpus
// pairs are committed in scripts/corpus-placements.json, keyed like the corpus index; records
// made with `npm run feedback` land in out/feedback/ and are promoted by hand.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CORPUS_PLACEMENTS = 'scripts/corpus-placements.json';
export const FEEDBACK_DIR = join('out', 'feedback');
/**
 * A placement matches its record when the figure's box centre lands within this distance of the
 * recorded one and the axis is the same. The PM's two hand placements of §12 sit at 5 and 11 mm
 * from the centred box. _(proposal)_
 */
export const PLACEMENT_MATCH_MM = 12;

/** The committed records, and those under out/feedback/ that are not skipped, by key; feedback wins. */
export function loadRecords({ feedback = true } = {}) {
  const records = existsSync(CORPUS_PLACEMENTS)
    ? JSON.parse(readFileSync(CORPUS_PLACEMENTS, 'utf8'))
    : {};
  if (feedback && existsSync(FEEDBACK_DIR)) {
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() && entry.name !== 'sheets'
          ? walk(join(dir, entry.name))
          : entry.name.endsWith('.json')
            ? [join(dir, entry.name)]
            : [],
      );
    for (const file of walk(FEEDBACK_DIR)) {
      const record = JSON.parse(readFileSync(file, 'utf8'));
      if (record.verdict === 'right' || record.verdict === 'placed') records[record.key] = record;
    }
  }
  return records;
}

/**
 * The figure's box centre (x, z) and lowest point in the base's frame, from a placement of
 * `placePairOnly`: the merged mesh lists the figure's vertices first.
 */
export function figureFigures({ mesh, pair }) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (let v = 0; v < pair.figureVertices; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (y < minY) minY = y;
  }
  return {
    figureCentreMm: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    figureLowestMm: minY,
    yawDeg: pair.placement.yawDeg,
  };
}

/**
 * One record against the current code. `auto` is the placement as the pipeline makes it;
 * `withAxis` the same pair with the record's axis given, so the position is scored even when
 * the axis is wrong (the axis is scored on its own).
 */
export function score(record, auto, withAxis) {
  const axis = auto.orientation.up === record.orientation.up;
  const got = figureFigures(withAxis);
  if (!record.placed)
    return { axis, dPositionMm: null, dLiftMm: null, dTurnDeg: null, match: null, got };
  const [x, z] = got.figureCentreMm;
  const [rx, rz] = record.placed.figureCentreMm;
  const dPositionMm = Math.hypot(x - rx, z - rz);
  return {
    axis,
    dPositionMm,
    dLiftMm: got.figureLowestMm - record.placed.figureLowestMm,
    dTurnDeg: got.yawDeg - (record.placed.yawDeg ?? 0),
    match: axis && dPositionMm <= PLACEMENT_MATCH_MM,
    got,
  };
}

/**
 * Scores every record whose figure and base can be found: `files(key)` gives their paths or
 * null. `place(figurePath, basePath, options)` is `placePairOnly` over the two files.
 */
export function scoreAll(records, files, place) {
  const rows = [];
  for (const [key, record] of Object.entries(records)) {
    const pair = files(key, record);
    if (!pair) continue;
    try {
      // A base the PM stood another way at its question (#92) stands that way here too.
      const baseOrientation = record.choices?.baseOrientation;
      const options = baseOrientation ? { baseOrientation } : {};
      const auto = place(pair.figure, pair.base, options);
      const withAxis =
        auto.orientation.up === record.orientation.up
          ? auto
          : place(pair.figure, pair.base, {
              ...options,
              orientation: { up: record.orientation.up },
            });
      rows.push({ key, record, auto, ...score(record, auto, withAxis) });
    } catch (error) {
      rows.push({ key, record, error: String(error.code ?? error.message) });
    }
  }
  return rows;
}

const round = (value) => (value === null || value === undefined ? '–' : value.toFixed(1));

/** The summary line and the table of the Base files section, as Markdown. */
export function scoreReport(rows) {
  const scored = rows.filter((row) => row.match !== null && row.match !== undefined);
  const matches = scored.filter((row) => row.match).length;
  const table = [
    '| Pair | Verdict | Axis (auto / record) | Δ position | Δ lift | Δ turn | Spot |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) =>
      row.error
        ? `| ${row.key} | ${row.record.verdict} | error: ${row.error} | | | | |`
        : `| ${row.key} | ${row.record.verdict} | ${row.auto.orientation.up} / ${row.record.orientation.up}${row.axis ? '' : ' ✗'} | ${round(row.dPositionMm)} mm | ${round(row.dLiftMm)} mm | ${round(row.dTurnDeg)}° | ${row.auto.pair.placement.spot.centred ? 'centred' : row.auto.pair.placement.spot.kind} |`,
    ),
  ];
  return [
    `${matches} of ${scored.length} recorded pairs within ${PLACEMENT_MATCH_MM} mm and the right axis; ${rows.filter((row) => !row.error && row.axis).length} of ${rows.filter((row) => !row.error).length} on the right axis. Position, lift and turn are measured with the record's axis.`,
    '',
    ...table,
  ].join('\n');
}
