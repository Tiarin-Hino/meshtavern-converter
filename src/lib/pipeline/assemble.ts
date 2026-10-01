/**
 * A figure shipped in several files, put together before anything else (issue #93, design notes
 * docs/design/marks-where-parts-meet.md §4.2 and docs/design/patches-where-parts-meet.md §5.5):
 * every part where its file puts it, or where its pairs of patches fit it against a part already
 * placed. The union is one mesh in the body's file frame, the body first, then the other parts in
 * file order; the parts stay separate surfaces, as a figure and its base do after #70.
 */
import type { Vec3 } from './base';
import { TriangleBvh } from './bvh';
import { contactPatches } from './contact';
import { fitMeeting, nudged, type Fit } from './fit';
import {
  MAX_PAIRS,
  resolvePatch,
  summaryOf,
  type Patch,
  type PartJoint,
  type PatchSummary,
} from './marks';
import type { IndexedMesh } from './mesh';
import { ConversionProblem } from './problems';
import { apply, IDENTITY, toMatrix, type Rotation } from './rotation';

/** At most this many files make one mini: a figure's parts and its base. _(proposal, the issue's number)_ */
export const MAX_PARTS = 6;

/** How a figure's parts are put together. */
export interface PartsOptions {
  /** One joint per part that is not where its file puts it; a part without one stays where its file puts it. */
  joints: PartJoint[];
}

/** A pair of patches as resolved, without their triangles. */
export interface PairSummary {
  on: PatchSummary;
  of: PatchSummary;
}

/** One part of a figure as it was put together. */
export interface PartResult {
  file: number;
  /** `files`: where its file puts it. `marked`: a joint. `body`: the body itself. */
  source: 'body' | 'files' | 'marked';
  /** The part's file coordinates to the body's file frame. Identity for `body` and `files`. */
  rotation: Rotation;
  translation: Vec3;
  /** Its joint as resolved, in the body's frame: the pairs as they ended. Only for `marked`. */
  joint?: { onto: number; pairs: PairSummary[]; liftMm: number; turnDeg: number; fit: Fit };
  /** Its triangles in the merged mesh: the figure lists the body first, then the parts in file order, then the base. */
  triangles: number;
}

/** A file's search tree, built once per conversion when a patch is first resolved on it. */
export type TreeOf = (file: number) => TriangleBvh;

/** Search trees built on demand over these meshes, kept. */
export function treesOver(meshes: readonly IndexedMesh[]): TreeOf {
  const trees = new Map<number, TriangleBvh>();
  return (file) => {
    let tree = trees.get(file);
    if (!tree) {
      tree = new TriangleBvh(meshes[file]!);
      trees.set(file, tree);
    }
    return tree;
  };
}

/** A transform: file coordinates to the body's file frame, `rotation · p + translation`. */
interface Transform {
  rotation: Rotation;
  translation: Vec3;
}

const HOLD: Transform = { rotation: IDENTITY, translation: [0, 0, 0] };

const placePoint = ({ rotation, translation }: Transform, p: Vec3): Vec3 => {
  const turned = apply(rotation, p);
  return [turned[0] + translation[0], turned[1] + translation[1], turned[2] + translation[2]];
};

/** A patch summary carried by a transform: its centre placed, its normal turned. */
export const placeSummary = (
  transform: { rotation: Rotation; translation: Vec3 },
  summary: PatchSummary,
): PatchSummary => ({
  ...summaryOf(summary),
  centre: placePoint(transform, summary.centre),
  normal: apply(transform.rotation, summary.normal),
});

/** The pairs of a meeting resolved on their files; a pair with a side that marks nothing is left out. */
export function resolvePairs(
  meshes: readonly IndexedMesh[],
  treeOf: TreeOf,
  pairs: PartJoint['pairs'],
): { on: Patch; of: Patch }[] {
  return pairs
    .slice(0, MAX_PAIRS)
    .map(({ on, of }) => ({
      on: resolvePatch(meshes[on.file]!, treeOf(on.file), on),
      of: resolvePatch(meshes[of.file]!, treeOf(of.file), of),
    }))
    .filter(({ on, of }) => on.triangles.length > 0 && of.triangles.length > 0);
}

/**
 * The transform a joint gives its part (patches design note §5.5): its pairs resolved on their
 * files, the `on` patches carried into the body's frame by `onto`'s transform, the `of` patches
 * as the part's file puts them; the least change that fits (`fitMeeting`, without an up), then
 * the person's lift and turn about the `on` patches' normal. Null when no pair marks anything.
 */
export function jointTransform(
  meshes: readonly IndexedMesh[],
  treeOf: TreeOf,
  ontoTransform: Transform,
  joint: PartJoint,
): { transform: Transform; pairs: PairSummary[]; fit: Fit } | null {
  const resolved = resolvePairs(meshes, treeOf, joint.pairs);
  if (resolved.length === 0) return null;
  const pairs = resolved.map(({ on, of }) => ({
    on: placeSummary(ontoTransform, on),
    of: summaryOf(of),
  }));
  const fitted = fitMeeting(pairs, joint.turn ? { turn: joint.turn } : {});
  const transform = nudged(fitted, pairs, joint.liftMm ?? 0, joint.turnDeg ?? 0);
  return {
    transform: { rotation: transform.rotation, translation: transform.translation },
    pairs: pairs.map(({ on, of }) => ({ on, of: placeSummary(transform, of) })),
    fit: fitted.fit,
  };
}

/** A part's positions carried into the body's frame. */
function transformed(positions: Float32Array, { rotation, translation }: Transform): Float32Array {
  const m = toMatrix(rotation);
  const [tx, ty, tz] = translation;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    out[i] = m[0]! * x + m[1]! * y + m[2]! * z + tx;
    out[i + 1] = m[3]! * x + m[4]! * y + m[5]! * z + ty;
    out[i + 2] = m[6]! * x + m[7]! * y + m[8]! * z + tz;
  }
  return out;
}

/**
 * The figure put together from its parts (design note §4.2, patches §5.5). The body
 * (`figureFiles[0]`) stays in its file frame; a part without a joint keeps its file coordinates,
 * bit for bit; a part with one goes where its pairs fit it against its `onto`, which is resolved
 * first whatever the order of the joints (a cycle, or a joint naming a file that is not a figure
 * part, is a bug of the caller: `unexpected`). A joint whose pairs mark nothing leaves its part
 * where its file puts it. The union lists the body, then the other parts in file order.
 *
 * @param meshes Every file's welded mesh, by file index; the base's, if any, is not read.
 * @param figureFiles The figure's parts by file index, the body first.
 * @param treeOf The files' search trees, kept by the caller across answers.
 */
export function assembleFigure(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
  joints: readonly PartJoint[],
  treeOf: TreeOf = treesOver(meshes),
): { mesh: IndexedMesh; parts: PartResult[] } {
  const body = figureFiles[0]!;
  const isPart = (file: number): boolean => figureFiles.includes(file) && file !== body;
  const byPart = new Map<number, PartJoint>();
  for (const joint of joints) {
    if (
      !isPart(joint.part) ||
      !figureFiles.includes(joint.onto) ||
      joint.onto === joint.part ||
      joint.pairs.some(({ on, of }) => on.file !== joint.onto || of.file !== joint.part)
    ) {
      const sides = joint.pairs.map(({ on, of }) => `${on.file}/${of.file}`).join(', ');
      throw new ConversionProblem(
        'unexpected',
        `a joint of file ${joint.part} onto ${joint.onto} with pairs on ${sides}`,
      );
    }
    byPart.set(joint.part, joint);
  }

  const transforms = new Map<number, Transform>([[body, HOLD]]);
  const resolved = new Map<number, PartResult['joint']>();
  const resolving = new Set<number>();
  const transformOf = (file: number): Transform => {
    const known = transforms.get(file);
    if (known) return known;
    const joint = byPart.get(file);
    if (!joint) {
      transforms.set(file, HOLD);
      return HOLD;
    }
    if (resolving.has(file))
      throw new ConversionProblem('unexpected', `the joints of files ${[...resolving]} go round`);
    resolving.add(file);
    const onto = transformOf(joint.onto);
    const placed = jointTransform(meshes, treeOf, onto, joint);
    resolving.delete(file);
    if (!placed) {
      transforms.set(file, HOLD);
      return HOLD;
    }
    transforms.set(file, placed.transform);
    resolved.set(file, {
      onto: joint.onto,
      pairs: placed.pairs,
      liftMm: joint.liftMm ?? 0,
      turnDeg: joint.turnDeg ?? 0,
      fit: placed.fit,
    });
    return placed.transform;
  };

  let vertexCount = 0;
  let indexCount = 0;
  for (const file of figureFiles) {
    vertexCount += meshes[file]!.positions.length;
    indexCount += meshes[file]!.indices.length;
  }
  const positions = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  const parts: PartResult[] = [];
  let at = 0;
  let atIndex = 0;
  for (const file of figureFiles) {
    const mesh = meshes[file]!;
    const transform = transformOf(file);
    const joint = resolved.get(file);
    positions.set(joint ? transformed(mesh.positions, transform) : mesh.positions, at);
    const offset = at / 3;
    for (let i = 0; i < mesh.indices.length; i++) indices[atIndex + i] = mesh.indices[i]! + offset;
    at += mesh.positions.length;
    atIndex += mesh.indices.length;
    parts.push({
      file,
      source: file === body ? 'body' : joint ? 'marked' : 'files',
      rotation: transform.rotation,
      translation: transform.translation,
      ...(joint && { joint }),
      triangles: mesh.indices.length / 3,
    });
  }
  return { mesh: { positions, indices }, parts };
}

/** A figure of one file: its body, where its file puts it. */
export const wholePart = (file: number, mesh: IndexedMesh): PartResult => ({
  file,
  source: 'body',
  rotation: IDENTITY,
  translation: [0, 0, 0],
  triangles: mesh.indices.length / 3,
});

/** At the parts question the parts are laid this share of the body's largest side apart... _(proposal)_ */
export const APART_SHARE = 0.15;
/** ...and at least this far. _(proposal)_ */
export const APART_MIN_GAP_MM = 10;
/** A part that lands on one moved before it is moved a gap further, at most this many times. */
const APART_MAX_STEPS = 50;

/** Where a part its file puts in place touches another, as pairs of patches in their files' coordinates. */
export interface ProposedJoint {
  part: number;
  onto: number;
  pairs: { on: Patch; of: Patch }[];
}

/**
 * Where each part touches the others where the files put them (patches §5.3): for each part
 * other than the body, `contactPatches` against every other part; the part it touches with the
 * largest area is its `onto`. A part that touches nothing gets none: it lies apart.
 *
 * @param meshes Every file's welded mesh, by file index.
 * @param figureFiles The figure's parts by file index, the body first.
 */
export function proposedJoints(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
  treeOf: TreeOf = treesOver(meshes),
): ProposedJoint[] {
  const proposals: ProposedJoint[] = [];
  /** The parts proposed so far, each onto its neighbour: a proposal never makes two parts hang on each other. */
  const ontoOf = new Map<number, number>();
  const goesRound = (part: number, onto: number): boolean => {
    for (let at: number | undefined = onto; at !== undefined; at = ontoOf.get(at))
      if (at === part) return true;
    return false;
  };
  for (const part of figureFiles.slice(1)) {
    let best: ProposedJoint | null = null;
    let bestArea = 0;
    for (const onto of figureFiles) {
      if (onto === part) continue;
      const pairs = contactPatches(
        { file: onto, mesh: meshes[onto]!, tree: treeOf(onto) },
        { file: part, mesh: meshes[part]!, positions: meshes[part]!.positions },
      );
      const area = pairs.reduce((sum, pair) => sum + pair.of.areaMm2, 0);
      if (area > bestArea) {
        bestArea = area;
        best = { part, onto, pairs };
      }
    }
    if (best && !goesRound(best.part, best.onto)) {
      ontoOf.set(best.part, best.onto);
      proposals.push(best);
    }
  }
  return proposals;
}

/** The box of a mesh's vertices, moved by `by`. */
function boxOfMesh(positions: Float32Array, by: Vec3 = [0, 0, 0]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k]! < min[k]!) min[k] = positions[i + k]!;
      if (positions[i + k]! > max[k]!) max[k] = positions[i + k]!;
    }
  }
  return {
    min: [min[0] + by[0], min[1] + by[1], min[2] + by[2]],
    max: [max[0] + by[0], max[1] + by[1], max[2] + by[2]],
  };
}

const overlap = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, gap: number): boolean =>
  [0, 1, 2].every((k) => a.min[k]! < b.max[k]! + gap && b.min[k]! < a.max[k]! + gap);

/**
 * The parts laid apart for marking (#93, PM decision 2026-10-01: shown separately, as a figure
 * beside its base): each part whose box comes within the gap of the body's is moved along the
 * line from the middle of the body's box to the middle of its own, just far enough that its box
 * clears the body's and those of the parts moved before it by `APART_SHARE` of the body's largest
 * side (at least `APART_MIN_GAP_MM`). The body and parts already apart stay. The direction keeps
 * where a part belongs (a wing to its side, a tail behind), so the connectors face each other.
 * Translations in the body's file frame.
 */
export function pulledApart(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
): { file: number; translation: Vec3 }[] {
  const body = boxOfMesh(meshes[figureFiles[0]!]!.positions);
  const side = Math.max(...[0, 1, 2].map((k) => body.max[k]! - body.min[k]!));
  const gap = Math.max(APART_MIN_GAP_MM, APART_SHARE * side);
  const middle = (box: { min: Vec3; max: Vec3 }): Vec3 => [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const placed = [body];
  return figureFiles.map((file, k) => {
    const own = boxOfMesh(meshes[file]!.positions);
    if (k === 0 || !overlap(own, body, gap)) {
      if (k > 0) placed.push(own);
      return { file, translation: [0, 0, 0] };
    }
    const from = middle(body);
    const to = middle(own);
    const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const away: Vec3 = length > 0 ? [d[0] / length, d[1] / length, d[2] / length] : [1, 0, 0];
    // The least move along `away` that clears the body's box on some axis.
    let t = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const a = away[axis]!;
      if (a > 1e-9) t = Math.min(t, (body.max[axis]! + gap - own.min[axis]!) / a);
      if (a < -1e-9) t = Math.min(t, (body.min[axis]! - gap - own.max[axis]!) / a);
    }
    if (!Number.isFinite(t) || t < 0) t = 0;
    const at = (s: number): Vec3 => [away[0] * s, away[1] * s, away[2] * s];
    // Further, a gap at a time, while it lands on a part moved before it.
    for (let step = 0; step < APART_MAX_STEPS; step++) {
      const moved = boxOfMesh(meshes[file]!.positions, at(t));
      if (!placed.some((other) => overlap(moved, other, gap))) break;
      t += gap;
    }
    const translation = at(t);
    placed.push(boxOfMesh(meshes[file]!.positions, translation));
    return { file, translation };
  });
}

/**
 * A part file centred on the origin within this... _(proposal)_
 */
export const PRINT_CENTRE_MM = 2;
/** ...and resting on the origin's plane within this is laid out for print, on a plate of its own. _(proposal)_ */
export const PRINT_FLOOR_MM = 0.5;

/**
 * Whether a figure's part files are laid out for print, each on a plate of its own (#93, found on
 * the PM's kit `large-04`, 2026-10-01): every file centred on the origin across two axes and
 * resting on the origin's plane along the third, the same axis for all. Such files say nothing
 * about where the parts go: they all overlap at the origin. Parts exported in place share the
 * assembled figure's frame, and at least one of them (a wing, a raised head) is off the middle.
 */
export function laidOutForPrint(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
): boolean {
  if (figureFiles.length < 2) return false;
  const boxes = figureFiles.map((file) => boxOfMesh(meshes[file]!.positions));
  return [0, 1, 2].some((floor) =>
    boxes.every(
      ({ min, max }) =>
        Math.abs(min[floor]!) <= PRINT_FLOOR_MM &&
        [0, 1, 2].every((k) => k === floor || Math.abs((min[k]! + max[k]!) / 2) <= PRINT_CENTRE_MM),
    ),
  );
}

/**
 * Parts laid out for print, laid side by side for marking (#93): the body first, each next part
 * to its right along x, a gap apart (as in `pulledApart`), every part on the body's floor and
 * against its back across the other two axes. Translations in the body's file frame.
 */
export function laidInARow(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
): { file: number; translation: Vec3 }[] {
  const body = boxOfMesh(meshes[figureFiles[0]!]!.positions);
  const side = Math.max(...[0, 1, 2].map((k) => body.max[k]! - body.min[k]!));
  const gap = Math.max(APART_MIN_GAP_MM, APART_SHARE * side);
  let right = body.max[0];
  return figureFiles.map((file, k) => {
    if (k === 0) return { file, translation: [0, 0, 0] };
    const own = boxOfMesh(meshes[file]!.positions);
    const translation: Vec3 = [
      right + gap - own.min[0],
      body.min[1] - own.min[1],
      body.min[2] - own.min[2],
    ];
    right = own.max[0] + translation[0];
    return { file, translation };
  });
}
