/**
 * Marks where two parts meet (issue #93, design note docs/design/patches-where-parts-meet.md
 * §3.1, §5.1–5.2, §5.6): a mark is a patch, an area of a part's surface made by taps and brush
 * dabs recorded as points in its file's coordinates. Two patches that touch are a pair; where two
 * parts meet is one or more pairs. The worker resolves the strokes on the full-detail mesh with
 * the file's search tree, and owns the marks while a question is open (`applyMeetAction`).
 *
 * Deterministic: only + - * / and sqrt on the geometry, so a patch resolves to the same triangles
 * on every machine.
 */
import type { Vec3 } from './base';
import type { TriangleBvh } from './bvh';
import type { IndexedMesh } from './mesh';
import { quarterTurnAxis, TO_Y_UP } from './orient';
import { apply, dot, normalise, type Rotation } from './rotation';

/** Where two parts meet: their pairs, and what the person adjusted at the final view. */
export interface Meeting {
  pairs: PatchPair[];
  /** Along the mean normal of the `on` patches, positive away from the surface. */
  liftMm?: number;
  /** About that normal through the centre of the `on` patches, degrees. */
  turnDeg?: number;
  /** `keep`: the part is never turned. `free`: it is turned to fit. Left out: the least change that fits (§5.4). */
  turn?: 'keep' | 'free';
}

/** A part placed against another: every pair's `on.file` is `onto`, every `of.file` is `part`. */
export interface PartJoint extends Meeting {
  /** The part placed: a figure part that is not the body. */
  part: number;
  /** The part it is placed against: the body or a part already placed. */
  onto: number;
}

/**
 * A tap's surface normal takes the triangles near the point whose normal is within this angle
 * of the nearest triangle's: the other wall of a thin recess and the rim of a hole stay out.
 * _(proposal)_
 */
export const TAP_NORMAL_CONE_DEG = 60;

const CONE_COS = Math.cos((TAP_NORMAL_CONE_DEG * Math.PI) / 180);

/** A triangle's normal times twice its area, from its winding. */
function areaNormal(positions: Float32Array, indices: Uint32Array, t: number): Vec3 {
  const a = indices[t * 3]! * 3;
  const b = indices[t * 3 + 1]! * 3;
  const c = indices[t * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uy = positions[b + 1]! - positions[a + 1]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vy = positions[c + 1]! - positions[a + 1]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * A direction or a point turned by a rotation; a quarter turn swaps and negates exactly, as
 * `orientAndPlace` turns the mesh, so a patch on an axis-aligned face keeps an exact normal.
 */
export function turnVector(rotation: Rotation, v: Vec3): Vec3 {
  const axis = quarterTurnAxis(rotation);
  return axis ? TO_Y_UP[axis](v[0], v[1], v[2]) : apply(rotation, v);
}

/** One thing a person did on a part's surface, in that file's coordinates. */
export type Stroke =
  /** A tap: the surface around this point that faces the same way (§5.2). */
  | { tap: Vec3 }
  /** A dab of the brush: every triangle within the radius that faces the way the surface does at the point. */
  | { brush: Vec3; radiusMm: number }
  /** A dab of the eraser: every triangle of the patch within the radius. */
  | { erase: Vec3; radiusMm: number };

/** A patch as the person made it: what is recorded. */
export interface PatchPick {
  file: number;
  strokes: Stroke[];
}

/** A resolved patch without its triangles, in the frame stated where it is used. */
export interface PatchSummary {
  file: number;
  areaMm2: number;
  /** Area-weighted centre and mean normal. */
  centre: Vec3;
  normal: Vec3;
  /** |Σ area × normal| / Σ area: 1 for a flat patch, towards 0 for one that wraps around. */
  flatness: number;
}

/** A patch as resolved on its file's welded mesh, file coordinates. */
export interface Patch extends PatchSummary {
  /** Triangle indices into the welded mesh, ascending. */
  triangles: Uint32Array;
}

/** Two patches that touch: `on` the part in place (the base, the body), `of` the part that goes there. */
export interface PatchPair {
  on: PatchPick;
  of: PatchPick;
}

/**
 * One tap once the file's tree exists: the ray, the growth and the summary, on an ordinary corpus
 * mini, development PC, Node. `scripts/measure-fit.mjs` measures it. _(proposal)_
 */
export const PICK_BUDGET_MS = 20;
/** At most this many pairs where two parts meet; more are ignored. _(proposal)_ */
export const MAX_PAIRS = 4;

/**
 * How many pairs a meet question takes: `MAX_PAIRS` where the figure meets its base, and as many
 * for each part at the parts question, whose pairs are one list over all its joints.
 */
export const pairsAllowed = (about: 'parts' | 'base', figureParts: number): number =>
  about === 'base' ? MAX_PAIRS : MAX_PAIRS * Math.max(1, figureParts - 1);
/** At most this many strokes make a patch; more are ignored. _(proposal)_ */
export const MAX_STROKES = 400;
/** A tap's surface normal: the triangles within this distance of the point... _(proposal)_ */
export const TAP_NORMAL_RADIUS_MM = 1;
/** A tap takes triangles whose centroid lies within this distance of the point... _(proposal)_ */
export const TAP_REACH_MM = 3;
/** ...whose normal is within this angle of the surface's normal at the point... _(proposal)_ */
export const TAP_CONE_DEG = 30;
/** ...and within this angle of the triangle it is reached from, across a shared edge. _(proposal)_ */
export const TAP_CREASE_DEG = 40;

const TAP_CONE_COS = Math.cos((TAP_CONE_DEG * Math.PI) / 180);
const TAP_CREASE_COS = Math.cos((TAP_CREASE_DEG * Math.PI) / 180);

const unitNormal = (positions: Float32Array, indices: Uint32Array, t: number): Vec3 =>
  normalise(areaNormal(positions, indices, t));

/**
 * The surface's normal at a point (§5.2 step 2): the area-weighted mean of the triangles whose
 * centroid lies within `TAP_NORMAL_RADIUS_MM` and whose normal is within `TAP_NORMAL_CONE_DEG`
 * of the nearest triangle's, the nearest always among them. Null for a mesh without triangles.
 */
function surfaceAt(
  mesh: IndexedMesh,
  tree: TriangleBvh,
  point: Vec3,
): { seed: number; normal: Vec3 } | null {
  const hit = tree.closest(
    { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity },
    point[0],
    point[1],
    point[2],
    Infinity,
  );
  const seed = hit.triangle;
  if (seed < 0) return null;
  const { positions, indices } = mesh;
  const own = unitNormal(positions, indices, seed);
  const near: number[] = [];
  tree.within(point[0], point[1], point[2], TAP_NORMAL_RADIUS_MM, (t) => near.push(t));
  near.sort((a, b) => a - b);
  const seedArea = areaNormal(positions, indices, seed);
  let sx = seedArea[0];
  let sy = seedArea[1];
  let sz = seedArea[2];
  for (const t of near) {
    if (t === seed) continue;
    const n = areaNormal(positions, indices, t);
    const length = Math.sqrt(dot(n, n));
    if (length > 0 && dot(n, own) >= CONE_COS * length) {
      sx += n[0];
      sy += n[1];
      sz += n[2];
    }
  }
  const normal = normalise([sx, sy, sz]);
  return { seed, normal: dot(normal, normal) > 0 ? normal : own };
}

/** Which triangles use each vertex, and a mark per triangle for a walk: built once per mesh. */
interface SurfaceIndex {
  /** `list[offsets[v]]` to `list[offsets[v + 1]]`: the triangles that use vertex `v`. */
  offsets: Uint32Array;
  list: Uint32Array;
  /** The walk a triangle was last taken by. */
  stamp: Uint32Array;
  walk: number;
}

const surfaceIndexes = new WeakMap<IndexedMesh, SurfaceIndex>();

/**
 * The vertex-to-triangle index of a mesh, built on its first tap and kept with it: a tap walks
 * from triangle to triangle through it, so its cost follows the patch it takes, not everything
 * within reach (61 000 triangles within 3 mm on a dense 1.25 M-triangle sculpt).
 */
/** Releases a mesh's tap index: the pipeline drops it with the trees, before the size step. */
export function dropSurfaceIndex(mesh: IndexedMesh): void {
  surfaceIndexes.delete(mesh);
}

export function surfaceIndexOf(mesh: IndexedMesh): SurfaceIndex {
  const known = surfaceIndexes.get(mesh);
  if (known) return known;
  const { positions, indices } = mesh;
  const vertices = positions.length / 3;
  const offsets = new Uint32Array(vertices + 1);
  for (let i = 0; i < indices.length; i++) offsets[indices[i]! + 1]!++;
  for (let v = 0; v < vertices; v++) offsets[v + 1]! += offsets[v]!;
  const list = new Uint32Array(indices.length);
  const fill = offsets.slice(0, vertices);
  for (let i = 0; i < indices.length; i++) list[fill[indices[i]!]!++] = (i / 3) | 0;
  const index = {
    offsets,
    list,
    stamp: new Uint32Array(indices.length / 3),
    walk: 0,
  };
  surfaceIndexes.set(mesh, index);
  return index;
}

/**
 * The triangles a tap takes (§5.2): from the nearest, across shared edges, those whose centroid
 * lies within reach and that face the same way. A triangle refused from one neighbour may still
 * join from another: the result is the closure, whatever the order of the walk.
 */
function tapTriangles(mesh: IndexedMesh, tree: TriangleBvh, point: Vec3): number[] {
  const surface = surfaceAt(mesh, tree, point);
  if (!surface) return [];
  const { positions, indices } = mesh;
  const index = surfaceIndexOf(mesh);
  if (index.walk === 0xffffffff) {
    index.stamp.fill(0);
    index.walk = 0;
  }
  const walk = ++index.walk;
  const [px, py, pz] = point;
  const reach2 = TAP_REACH_MM * TAP_REACH_MM;
  const withinReach = (t: number): boolean => {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const gx = (positions[a]! + positions[b]! + positions[c]!) / 3 - px;
    const gy = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3 - py;
    const gz = (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3 - pz;
    return gx * gx + gy * gy + gz * gz <= reach2;
  };
  const uses = (t: number, v: number): boolean =>
    indices[t * 3] === v || indices[t * 3 + 1] === v || indices[t * 3 + 2] === v;
  const taken = [surface.seed];
  index.stamp[surface.seed] = walk;
  for (let at = 0; at < taken.length; at++) {
    const from = taken[at]!;
    const fromNormal = unitNormal(positions, indices, from);
    for (let k = 0; k < 3; k++) {
      const a = indices[from * 3 + k]!;
      const b = indices[from * 3 + ((k + 1) % 3)]!;
      // The triangles across edge a–b: those of vertex a that use b too.
      for (let i = index.offsets[a]!; i < index.offsets[a + 1]!; i++) {
        const next = index.list[i]!;
        if (next === from || index.stamp[next] === walk || !uses(next, b)) continue;
        if (!withinReach(next)) continue;
        const n = unitNormal(positions, indices, next);
        if (dot(n, surface.normal) < TAP_CONE_COS || dot(n, fromNormal) < TAP_CREASE_COS) continue;
        index.stamp[next] = walk;
        taken.push(next);
      }
    }
  }
  return taken;
}

/** Applies one stroke to a patch's triangles (§5.1): a brush drag costs one stroke at a time. */
export function applyStroke(
  mesh: IndexedMesh,
  tree: TriangleBvh,
  set: Set<number>,
  stroke: Stroke,
): void {
  if ('tap' in stroke) {
    for (const t of tapTriangles(mesh, tree, stroke.tap)) set.add(t);
    return;
  }
  if ('erase' in stroke) {
    const [x, y, z] = stroke.erase;
    tree.within(x, y, z, stroke.radiusMm, (t) => set.delete(t));
    return;
  }
  const surface = surfaceAt(mesh, tree, stroke.brush);
  if (!surface) return;
  const { positions, indices } = mesh;
  const [x, y, z] = stroke.brush;
  // Facing the way the surface does: the other side of a thin wall stays out.
  tree.within(x, y, z, stroke.radiusMm, (t) => {
    if (dot(areaNormal(positions, indices, t), surface.normal) > 0) set.add(t);
  });
}

/** Area, centre, mean normal and flatness of a set of triangles (§3.1), in the mesh's coordinates. */
export function summarise(file: number, mesh: IndexedMesh, triangles: Uint32Array): Patch {
  const { positions, indices } = mesh;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const t of triangles) {
    const n = areaNormal(positions, indices, t);
    const twice = Math.sqrt(dot(n, n));
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    twiceArea += twice;
    cx += (twice * (positions[a]! + positions[b]! + positions[c]!)) / 3;
    cy += (twice * (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!)) / 3;
    cz += (twice * (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!)) / 3;
    nx += n[0];
    ny += n[1];
    nz += n[2];
  }
  const sum: Vec3 = [nx, ny, nz];
  return {
    file,
    triangles,
    areaMm2: twiceArea / 2,
    centre: twiceArea > 0 ? [cx / twiceArea, cy / twiceArea, cz / twiceArea] : [0, 0, 0],
    normal: normalise(sum),
    flatness: twiceArea > 0 ? Math.sqrt(dot(sum, sum)) / twiceArea : 0,
  };
}

/** A patch resolved on its file's welded mesh (§5.1): the strokes in order, at most `MAX_STROKES`. */
export function resolvePatch(mesh: IndexedMesh, tree: TriangleBvh, pick: PatchPick): Patch {
  const set = new Set<number>();
  for (const stroke of pick.strokes.slice(0, MAX_STROKES)) applyStroke(mesh, tree, set, stroke);
  return summarise(pick.file, mesh, Uint32Array.from([...set].sort((a, b) => a - b)));
}

/**
 * A proposed patch made editable (PM decision 2026-10-01, after the rework): brush dabs that
 * cover it, so it is recorded as strokes like any patch. Greedy over its triangles in ascending
 * order, a dab at each triangle's centroid not yet within a dab's radius of another. The radius
 * grows with the area so a large contact stays within `MAX_STROKES`; the brush may take a rim
 * of up to one radius around the patch.
 */
export function strokesCovering(mesh: IndexedMesh, tree: TriangleBvh, patch: Patch): Stroke[] {
  const radiusMm = Math.min(
    COVER_MAX_RADIUS_MM,
    Math.max(COVER_MIN_RADIUS_MM, Math.sqrt(patch.areaMm2 / (COVER_SHARE * MAX_STROKES))),
  );
  const { positions, indices } = mesh;
  const inPatch = new Set(patch.triangles);
  const covered = new Set<number>();
  const strokes: Stroke[] = [];
  for (const t of patch.triangles) {
    if (covered.has(t)) continue;
    if (strokes.length >= MAX_STROKES) break;
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const centre: Vec3 = [
      (positions[a]! + positions[b]! + positions[c]!) / 3,
      (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3,
      (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3,
    ];
    strokes.push({ brush: centre, radiusMm });
    covered.add(t);
    tree.within(centre[0], centre[1], centre[2], radiusMm, (u) => {
      if (inPatch.has(u)) covered.add(u);
    });
  }
  return strokes;
}

/** A proposal's patch is covered by dabs at least this wide... _(proposal)_ */
export const COVER_MIN_RADIUS_MM = 0.75;
/** ...and at most this wide... _(proposal)_ */
export const COVER_MAX_RADIUS_MM = 3;
/** ...so that a patch takes about this share of `MAX_STROKES` dabs. _(proposal)_ */
export const COVER_SHARE = 0.4;

/** A patch without its triangles. */
export const summaryOf = ({
  file,
  areaMm2,
  centre,
  normal,
  flatness,
}: PatchSummary): PatchSummary => ({ file, areaMm2, centre, normal, flatness });
/** A pair while it is marked: a side not marked yet is null. */
export interface DraftPair {
  on: PatchPick | null;
  of: PatchPick | null;
}

/** What the person adjusted of one part at the final view: the figure's body at the base question. */
export interface Nudge {
  part: number;
  liftMm: number;
  turnDeg: number;
  turn?: 'keep' | 'free';
}

/** The person's marks at a meet question. */
export interface MeetDraft {
  pairs: DraftPair[];
  nudges: Nudge[];
}

/** A meet question's state, owned by the worker (§5.6). */
export interface MeetState {
  stage: 'pairs' | 'fitted';
  /** The person's marks; null while the proposal stands. */
  draft: MeetDraft | null;
  /** The base question: the automatic placement's lift and turn (#70), nudged at the final view. */
  automatic: { liftMm: number; turnDeg: number; nudged: boolean };
  /** Earlier drafts, the last first out: one per marking action. */
  history: (MeetDraft | null)[];
}

/** Who is who at a meet question. */
export interface MeetContext {
  about: 'parts' | 'base';
  baseFile: number | null;
  /** The figure's parts, the body first. */
  figureFiles: readonly number[];
}

/** A point on a file a finger hit. */
export interface Hit {
  file: number;
  point: Vec3;
}

/** What a finger did at the pairs stop, its targets resolved to files (null where it missed) (§5.6). */
export type MarkingAction =
  | { do: 'tap'; hit: Hit | null; pair: number }
  | {
      do: 'brush';
      hits: (Hit | null)[];
      pair: number;
      radiusMm: number;
      erase?: boolean;
    }
  | { do: 'clear'; pair?: number }
  | { do: 'undo' }
  | { do: 'set'; marks: Meeting | PartJoint[] | null }
  | {
      do: 'nudge';
      part?: number;
      liftMm?: number;
      turnDeg?: number;
      turn?: 'keep' | 'free' | null;
    };

/** Why an action did not do what it asked. */
export type MeetNote = 'missed' | 'full' | 'one-part';

/** At most this many earlier drafts are kept for Undo. */
export const UNDO_DEPTH = 50;

/** A meet question's state before anything was done: the marks the conversion came with, at the pairs stop. */
export function startMeeting(
  marks: Meeting | PartJoint[] | null,
  automatic: { liftMm?: number; turnDeg?: number },
  context: MeetContext,
): MeetState {
  return {
    stage: 'pairs',
    draft: draftOf(marks, context),
    automatic: {
      liftMm: automatic.liftMm ?? 0,
      turnDeg: automatic.turnDeg ?? 0,
      nudged: false,
    },
    history: [],
  };
}

/** Whether both sides of a pair are marked. */
export const complete = (pair: DraftPair): pair is PatchPair =>
  pair.on !== null && pair.of !== null;

const copyPick = (pick: PatchPick | null): PatchPick | null =>
  pick && { file: pick.file, strokes: pick.strokes.slice() };

function copyDraft(draft: MeetDraft): MeetDraft {
  return {
    pairs: draft.pairs.map((pair) => ({
      on: copyPick(pair.on),
      of: copyPick(pair.of),
    })),
    nudges: draft.nudges.map((nudge) => ({ ...nudge })),
  };
}

/** A recorded meeting or joints as a draft: null (the proposal) for none. */
export function draftOf(
  marks: Meeting | PartJoint[] | null,
  context: MeetContext,
): MeetDraft | null {
  if (marks === null) return null;
  const nudgeOf = (part: number, meeting: Meeting): Nudge[] =>
    meeting.liftMm || meeting.turnDeg || meeting.turn
      ? [
          {
            part,
            liftMm: meeting.liftMm ?? 0,
            turnDeg: meeting.turnDeg ?? 0,
            ...(meeting.turn && { turn: meeting.turn }),
          },
        ]
      : [];
  if (Array.isArray(marks)) {
    if (marks.length === 0) return null;
    return copyDraft({
      pairs: marks.flatMap((joint) => joint.pairs.slice(0, MAX_PAIRS)),
      nudges: marks.flatMap((joint) => nudgeOf(joint.part, joint)),
    });
  }
  if (marks.pairs.length === 0) return null;
  return copyDraft({
    pairs: marks.pairs.slice(0, MAX_PAIRS),
    nudges: nudgeOf(context.figureFiles[0]!, marks),
  });
}

/** A meeting's lift, turn and turn mode from a nudge, only what is set. */
function nudgeFields(nudge: Nudge | undefined): Pick<Meeting, 'liftMm' | 'turnDeg' | 'turn'> {
  if (!nudge) return {};
  return {
    ...(nudge.liftMm !== 0 && { liftMm: nudge.liftMm }),
    ...(nudge.turnDeg !== 0 && { turnDeg: nudge.turnDeg }),
    ...(nudge.turn && { turn: nudge.turn }),
  };
}

/**
 * The marks of a draft as recorded (§3.1): the base question's meeting, or the parts' joints (a
 * part's pairs grouped, in the order its first pair was marked). Pairs with a side not marked are
 * left out. Null while the proposal stands; for the base, also when no pair is complete.
 */
export function marksOf(
  draft: MeetDraft | null,
  context: MeetContext,
): Meeting | PartJoint[] | null {
  if (!draft) return null;
  const pairs = draft.pairs.filter(complete);
  if (context.about === 'base') {
    if (pairs.length === 0) return null;
    const body = context.figureFiles[0]!;
    return {
      pairs,
      ...nudgeFields(draft.nudges.find((nudge) => nudge.part === body)),
    };
  }
  const joints: PartJoint[] = [];
  for (const pair of pairs) {
    const part = pair.of.file;
    const joint = joints.find((entry) => entry.part === part);
    if (joint) joint.pairs.push(pair);
    else
      joints.push({
        part,
        onto: pair.on.file,
        pairs: [pair],
        ...nudgeFields(draft.nudges.find((nudge) => nudge.part === part)),
      });
  }
  return joints;
}

/** Where each part is placed against, from the complete pairs other than `except`. */
function ontoOf(draft: MeetDraft, except: number): Map<number, number> {
  const onto = new Map<number, number>();
  draft.pairs.forEach((pair, k) => {
    if (k !== except && complete(pair)) onto.set(pair.of.file, pair.on.file);
  });
  return onto;
}

/**
 * Puts a stroke on the side of pair `k` that `file` belongs to (§5.6, without a mode): the side
 * already on that file; else a free side (the base and a part in place are `on`, a figure part
 * and a part not yet placed are `of`). Refused when both sides are on other files (`full`), or
 * when it would give a part a second part to meet or make two parts hang on each other
 * (`one-part`). Changes `draft` only when it returns null.
 */
function addStroke(
  draft: MeetDraft,
  k: number,
  file: number,
  stroke: Stroke,
  context: MeetContext,
): MeetNote | null {
  if (k >= pairsAllowed(context.about, context.figureFiles.length)) return 'full';
  const index = Math.min(k, draft.pairs.length);
  const existing = draft.pairs[index];
  const pair: DraftPair = existing
    ? { on: copyPick(existing.on), of: copyPick(existing.of) }
    : { on: null, of: null };
  const keep = (): null => {
    draft.pairs[index] = pair;
    return null;
  };
  const add = (pick: PatchPick): null => {
    if (pick.strokes.length < MAX_STROKES) pick.strokes.push(stroke);
    return keep();
  };
  if (pair.on?.file === file) return add(pair.on);
  if (pair.of?.file === file) return add(pair.of);
  // An eraser only takes away from a side already marked.
  if ('erase' in stroke) return 'missed';
  const body = context.figureFiles[0]!;
  const side: PatchPick = { file, strokes: [stroke] };
  if (context.about === 'base') {
    if (file === context.baseFile) {
      if (pair.on) return 'full';
      pair.on = side;
    } else if (context.figureFiles.includes(file)) {
      if (pair.of) return 'full';
      pair.of = side;
    } else return 'missed';
    return keep();
  }
  if (!context.figureFiles.includes(file)) return 'missed';
  if (pair.on && pair.of) return 'full';
  const placed = ontoOf(draft, index);
  if (pair.on) pair.of = side;
  else if (pair.of) pair.on = side;
  else if (file === body || placed.has(file)) pair.on = side;
  else pair.of = side;
  if (complete(pair)) {
    // The body never moves: it is the side in place.
    if (pair.of.file === body) [pair.on, pair.of] = [pair.of, pair.on];
    const part = pair.of!.file;
    const onto = pair.on!.file;
    const already = placed.get(part);
    let goesRound = false;
    for (let at: number | undefined = onto; at !== undefined; at = placed.get(at)) {
      if (at === part) {
        goesRound = true;
        break;
      }
    }
    if ((already !== undefined && already !== onto) || goesRound) return 'one-part';
  }
  return keep();
}

/**
 * One marking action applied to a meet question's state (§5.6): pure, the state given is not
 * changed. To edit a proposal the caller seeds it as a draft first (`strokesCovering`, PM
 * decision 2026-10-01), so this function only sees a draft or none: on none, a tap starts the
 * person's own marks. `clear` without a pair brings the proposal back; `undo` takes back one
 * action. Returns the new state and why the action did not do what it asked, if it did not.
 */
export function applyMeetAction(
  state: MeetState,
  action: MarkingAction,
  context: MeetContext,
): { state: MeetState; note: MeetNote | null } {
  const remember = (draft: MeetDraft | null): MeetState => ({
    ...state,
    draft,
    history: [state.draft, ...state.history].slice(0, UNDO_DEPTH),
  });
  const fresh = (): MeetDraft => (state.draft ? copyDraft(state.draft) : { pairs: [], nudges: [] });
  switch (action.do) {
    case 'tap': {
      if (!action.hit) return { state, note: 'missed' };
      const draft = fresh();
      const note = addStroke(
        draft,
        action.pair,
        action.hit.file,
        { tap: action.hit.point },
        context,
      );
      return note ? { state, note } : { state: remember(draft), note: null };
    }
    case 'brush': {
      const hits = action.hits.filter((hit): hit is Hit => hit !== null);
      if (hits.length === 0) return { state, note: 'missed' };
      // One drag paints one part: the one it started on.
      const file = hits[0]!.file;
      const draft = fresh();
      let note: MeetNote | null = null;
      let changed = false;
      for (const hit of hits) {
        if (hit.file !== file) continue;
        const stroke: Stroke = action.erase
          ? { erase: hit.point, radiusMm: action.radiusMm }
          : { brush: hit.point, radiusMm: action.radiusMm };
        const refused = addStroke(draft, action.pair, file, stroke, context);
        if (!refused) changed = true;
        // A dab beside the patch is not worth a word while others land.
        else if (refused !== 'missed' || !note) note = refused;
      }
      return changed ? { state: remember(draft), note } : { state, note: note ?? 'missed' };
    }
    case 'clear': {
      if (action.pair === undefined) {
        if (!state.draft) return { state, note: null };
        return { state: remember(null), note: null };
      }
      if (!state.draft?.pairs[action.pair]) return { state, note: null };
      const draft = copyDraft(state.draft);
      draft.pairs.splice(action.pair, 1);
      return { state: remember(draft), note: null };
    }
    case 'undo': {
      if (state.history.length === 0) return { state, note: null };
      const [draft, ...history] = state.history;
      return { state: { ...state, draft: draft ?? null, history }, note: null };
    }
    case 'set':
      return { state: remember(draftOf(action.marks, context)), note: null };
    case 'nudge': {
      if (!state.draft || !state.draft.pairs.some(complete)) {
        // The automatic placement: #70's lift and turn about the vertical (base only).
        if (context.about !== 'base') return { state, note: null };
        const { automatic } = state;
        return {
          state: {
            ...state,
            automatic: {
              liftMm: automatic.liftMm + (action.liftMm ?? 0),
              turnDeg: automatic.turnDeg + (action.turnDeg ?? 0),
              nudged: true,
            },
          },
          note: null,
        };
      }
      const part =
        context.about === 'base'
          ? context.figureFiles[0]!
          : (action.part ?? state.draft.pairs.filter(complete).at(-1)!.of.file);
      const draft = copyDraft(state.draft);
      let nudge = draft.nudges.find((entry) => entry.part === part);
      if (!nudge) {
        nudge = { part, liftMm: 0, turnDeg: 0 };
        draft.nudges.push(nudge);
      }
      nudge.liftMm += action.liftMm ?? 0;
      nudge.turnDeg += action.turnDeg ?? 0;
      if (action.turn === null) delete nudge.turn;
      else if (action.turn) nudge.turn = action.turn;
      return { state: { ...state, draft }, note: null };
    }
  }
}
