import { apartTranslations, movedBox, type Box, type PartResult } from './assemble';
import { MIN_NORMAL_AGREEMENT } from './bake';
import type { Vec3 } from './base';
import { MAX_GROUPS, type GroupOrigin, type PaintGroups, type PaintRegions } from './brush';
import { TriangleBvh, type SurfaceHit } from './bvh';
import { triangleAdjacency, type TriangleAdjacency } from './fill';
import type { IndexedMesh } from './mesh';
import { REGION_REACH_MM } from './regions';

/**
 * The automatic groups of a mini (issue #139, design note `docs/design/paint-groups.md` §4): the
 * groups a painter starts with, so a shield, a cloak or a base can be hidden or masked in one tap.
 * Made from what a conversion knows, as the fill's ready regions are: the base, the files of a
 * figure in parts, and within each the separate shells. No DOM, no three.js.
 */

/** A separate shell smaller than this stays in its group instead of becoming one of its own. _(proposal)_ */
export const SHELL_MIN_TRIANGLES = 100;

/** What a conversion knows about the mini's parts: pass what the result has. */
export interface GroupSources {
  /** The fill's ready regions (`regionsOf`): where given, the base's triangles are the base group. */
  regions?: PaintRegions | null;
  /** The full-detail mesh, the figure's triangles first: `result.mesh`. */
  source?: IndexedMesh;
  /** The figure's parts in the merged mesh, body first (`result.pair?.parts`): their triangle counts give each file's range. */
  parts?: readonly PartResult[];
  /** How many of `source`'s triangles are the figure's (`result.pair?.figureTriangles`); the rest is the base file's. */
  figureTriangles?: number;
  /** At most this many groups, group 0 included: MAX_GROUPS. For tests. */
  maxGroups?: number;
}

/**
 * The groups of `table` (the table level, `result.baked.mesh`), each rule working on the triangles
 * the rules before it left in group 0, the body:
 *
 * 1. **The base.** With `regions`, the triangles of `regions.base` are the base group. Without,
 *    where `source` has a base file after `figureTriangles`, the triangles rule 2 finds on it.
 * 2. **The files.** With `source` and more than one of `parts`: each triangle goes to the part
 *    under the closest point of `source` to its middle that faces its way (`MIN_NORMAL_AGREEMENT`,
 *    within `REGION_REACH_MM`; tried again without the facing test, and left in group 0 when that
 *    finds nothing too). The body's part is group 0; every other part is a group of its own, in
 *    `parts` order; the base after them.
 * 3. **The shells.** Every group in its connected pieces by the fill's adjacency (edges matched by
 *    position across the unwrap's seams): the largest piece keeps the group, every other piece of
 *    at least `SHELL_MIN_TRIANGLES` becomes a group of its own, largest first. When that would make
 *    more than `maxGroups`, the smallest pieces stay with their group.
 *
 * Without any of `source`, `parts` and `regions` (a single file, no base found) rule 3 alone runs.
 */
export function groupsOf(table: IndexedMesh, about: GroupSources = {}): PaintGroups {
  const triangles = table.indices.length / 3;
  const maxGroups = Math.max(1, Math.min(MAX_GROUPS, about.maxGroups ?? MAX_GROUPS));
  const regions = about.regions ?? null;
  if (regions && regions.base.length !== triangles)
    throw new RangeError('The regions are not this mesh’s: one byte per triangle');
  const of = new Uint8Array(triangles);
  const made: GroupOrigin[] = [{ by: 'body' }];

  const source = about.source;
  const sourceTriangles = source ? source.indices.length / 3 : 0;
  const figureTriangles = Math.min(about.figureTriangles ?? sourceTriangles, sourceTriangles);
  const parts = source && about.parts && about.parts.length > 1 ? about.parts : null;
  const baseFile = source !== undefined && figureTriangles < sourceTriangles;
  // The files' groups first, in parts order, then the base: the same indices with or without regions.
  const partGroup: number[] = [0];
  if (parts)
    for (let k = 1; k < parts.length; k++) {
      partGroup.push(made.length);
      made.push({ by: 'part', file: parts[k]!.file });
    }
  const baseGroup = regions || baseFile ? made.length : -1;
  if (baseGroup >= 0) made.push({ by: 'base' });

  if (regions) for (let t = 0; t < triangles; t++) if (regions.base[t]) of[t] = baseGroup;
  // With regions the base is theirs: the rest is matched against the figure's files only.
  const searched = regions ? figureTriangles : sourceTriangles;
  if (source && (parts || (baseFile && !regions)) && searched > 0)
    assignFiles(table, source, searched, figureTriangles, parts, partGroup, baseGroup, of);

  splitShells(of, made, maxGroups, triangleAdjacency(table));
  return { of, made };
}

/** A group pulled apart: its offset from where the mini's own coordinates put it, in mm (#180). */
export interface GroupApart {
  group: number;
  offset: Vec3;
}

/**
 * The groups pulled apart to paint each on its own (issue #180, design note
 * `docs/design/paint-groups.md` §9): the apart rule of the parts question (`apartTranslations`,
 * #93) over the groups' boxes instead of the files'. Group 0, the body, stays; every other group
 * that comes within the gap of the body's box moves along the line from the body's middle to its
 * own by `APART_SHARE` of the body's largest side (at least `APART_MIN_GAP_MM`), further while it
 * lands on a group moved before it. The groups moved, in their order, with their offsets in the
 * mesh's coordinates; a group the rule leaves in place (clear of the body already, or without a
 * triangle) is not listed. `only` names the groups to move, in that order, the others left where
 * they are; those of them in `apart` are kept clear of at their offsets, as groups moved before:
 * for pulling one group apart on its own beside those already apart. Group 0 in `only` is ignored.
 */
export function groupsApart(
  table: IndexedMesh,
  groups: PaintGroups,
  only?: readonly number[],
  apart: readonly GroupApart[] = [],
): GroupApart[] {
  const triangles = table.indices.length / 3;
  if (groups.of.length !== triangles)
    throw new RangeError('The groups are not this mesh’s: one byte per triangle');
  const count = groups.made.length;
  const boxes: (Box | null)[] = Array.from({ length: count }, () => null);
  const { positions, indices } = table;
  for (let t = 0; t < triangles; t++) {
    const group = groups.of[t]!;
    const box = (boxes[group] ??= {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    });
    for (let corner = 0; corner < 3; corner++) {
      const v = indices[t * 3 + corner]! * 3;
      for (let k = 0; k < 3; k++) {
        const value = positions[v + k]!;
        if (value < box.min[k]!) box.min[k] = value;
        if (value > box.max[k]!) box.max[k] = value;
      }
    }
  }
  const body = boxes[0];
  if (!body) return [];
  const moved = (only ?? boxes.map((_, group) => group)).filter(
    (group, k, list) =>
      Number.isInteger(group) &&
      group > 0 &&
      group < count &&
      boxes[group] &&
      list.indexOf(group) === k,
  );
  // With `only`, the groups already apart and not named stay where they are drawn, and the moved
  // ones clear them as they clear those moved before them.
  const fixed: Box[] = [];
  if (only)
    for (const { group, offset } of apart) {
      const box = boxes[group];
      if (box && group > 0 && !moved.includes(group)) fixed.push(movedBox(box, offset));
    }
  const translations = apartTranslations([body, ...moved.map((group) => boxes[group]!)], fixed);
  const out: GroupApart[] = [];
  moved.forEach((group, k) => {
    const offset = translations[k + 1]!;
    if (offset.some((value) => value !== 0)) out.push({ group, offset });
  });
  return out;
}

/** Rule 2: every triangle still in group 0 to the group of the file under its middle. */
function assignFiles(
  table: IndexedMesh,
  source: IndexedMesh,
  searched: number,
  figureTriangles: number,
  parts: readonly PartResult[] | null,
  partGroup: readonly number[],
  baseGroup: number,
  of: Uint8Array,
): void {
  const tree = new TriangleBvh({
    positions: source.positions,
    indices: source.indices.subarray(0, searched * 3),
    normals: source.normals,
  });
  // Each part's last triangle + 1, body first: the figure's files in the merged mesh.
  const ends: number[] = [];
  let end = 0;
  for (const part of parts ?? [{ triangles: figureTriangles }]) ends.push((end += part.triangles));
  const groupOfSource = (t: number): number => {
    if (t >= figureTriangles) return baseGroup;
    for (let k = 0; k < ends.length; k++) if (t < ends[k]!) return partGroup[k] ?? 0;
    return 0;
  };
  const { positions, indices } = table;
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
  const facing = { nx: 0, ny: 0, nz: 0, minAgreement: MIN_NORMAL_AGREEMENT };
  const reach = REGION_REACH_MM * REGION_REACH_MM;
  let hint = -1;
  for (let t = 0; t < of.length; t++) {
    if (of[t] !== 0) continue;
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const x = (positions[a]! + positions[b]! + positions[c]!) / 3;
    const y = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3;
    const z = (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0 && source.normals) {
      facing.nx = nx / length;
      facing.ny = ny / length;
      facing.nz = nz / length;
      tree.closest(hit, x, y, z, reach, facing, hint);
    } else hit.triangle = -1;
    if (hit.triangle < 0) tree.closest(hit, x, y, z, reach, null, hint);
    if (hit.triangle < 0) continue;
    hint = hit.triangle;
    of[t] = groupOfSource(hit.triangle);
  }
}

/** Rule 3: every group's separate shells of at least SHELL_MIN_TRIANGLES as groups of their own. */
function splitShells(
  of: Uint8Array,
  made: GroupOrigin[],
  maxGroups: number,
  { start, neighbours }: TriangleAdjacency,
): void {
  const triangles = of.length;
  // Each triangle's piece: connected across shared edges within its group.
  const piece = new Int32Array(triangles).fill(-1);
  const pieces: { group: number; triangles: number[] }[] = [];
  const queue = new Uint32Array(triangles);
  for (let seed = 0; seed < triangles; seed++) {
    if (piece[seed] !== -1) continue;
    const index = pieces.length;
    const group = of[seed]!;
    const members: number[] = [];
    let head = 0;
    let tail = 0;
    piece[seed] = index;
    queue[tail++] = seed;
    while (head < tail) {
      const t = queue[head++]!;
      members.push(t);
      for (let k = start[t]!; k < start[t + 1]!; k++) {
        const n = neighbours[k]!;
        if (piece[n] !== -1 || of[n] !== group) continue;
        piece[n] = index;
        queue[tail++] = n;
      }
    }
    pieces.push({ group, triangles: members });
  }
  // The candidates: every piece but its group's largest, big enough; largest first, ties by their first triangle.
  const largest = new Map<number, number>();
  pieces.forEach(({ group, triangles: members }, index) => {
    const best = largest.get(group);
    if (best === undefined || members.length > pieces[best]!.triangles.length)
      largest.set(group, index);
  });
  const bySize = (a: number, b: number): number =>
    pieces[b]!.triangles.length - pieces[a]!.triangles.length ||
    pieces[a]!.triangles[0]! - pieces[b]!.triangles[0]!;
  const candidates = pieces
    .map((_, index) => index)
    .filter(
      (index) =>
        largest.get(pieces[index]!.group) !== index &&
        pieces[index]!.triangles.length >= SHELL_MIN_TRIANGLES,
    )
    .sort(bySize);
  const room = Math.max(0, maxGroups - made.length);
  const kept = new Set(candidates.slice(0, room));
  // In the groups' order, each group's shells largest first.
  const groups = made.length;
  for (let group = 0; group < groups; group++)
    for (const index of candidates) {
      if (!kept.has(index) || pieces[index]!.group !== group) continue;
      const shell = made.length;
      made.push({ by: 'shell', of: group });
      for (const t of pieces[index]!.triangles) of[t] = shell;
    }
}
