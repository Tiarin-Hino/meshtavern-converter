import type { FillSeed, PaintRegions, StepGroups } from './brush';
import type { TriangleBvh } from './bvh';
import type { IndexedMesh } from './mesh';
import { PAINT_REACH_MM } from './paint';

/**
 * The fill (issue #127, design note `docs/design/painting-engine.md` §7.1): a connected region of
 * the table level's triangles, flooded from a seed across shared edges and bounded where the
 * surface folds. Two signals, because the table level has two kinds of crease: a sharp fold
 * between a few large triangles (the angle between their faces sees it) and a soft crease the
 * sculpt had (the vertices' cavity sees it; between two small triangles the angle does not).
 */

/** An edge whose faces meet at more than this angle bounds a fill at tolerance 0. _(proposal)_ */
export const FILL_ANGLE_DEG = 40;
/**
 * An edge whose two vertices both have a raw cavity below this bounds a fill at tolerance 0
 * (a 20° fold measures about 0.17 raw). _(proposal)_
 */
export const FILL_CREASE_CAVITY = -0.1;
/**
 * A picked fill replayed (#197) starts from its recorded triangle when its recorded point lies
 * on it within this, in mm; else from the triangle closest to the point. _(proposal)_
 */
export const SEED_ON_TRIANGLE_MM = 0.05;

/**
 * The triangle a picked fill starts from on `mesh` (#197): its own `triangle` when `point` lies on
 * it within SEED_ON_TRIANGLE_MM (always, on the mesh it was picked on), else the triangle whose
 * surface is closest to `point` (another reduction of the same mini numbers its triangles
 * otherwise), and -1 when no surface is within PAINT_REACH_MM. With `groups` (the mesh's group of
 * each triangle and the step's record, #139, #180) the point is where the mini was drawn: a group
 * apart is met with its offset taken off, and a hidden group is never the seed.
 */
export function seedTriangle(
  tree: TriangleBvh,
  seed: { triangle: number; point: readonly [number, number, number] },
  groups?: { of: Uint8Array; record?: StepGroups },
): number {
  const [x, y, z] = seed.point;
  const hidden = new Set(groups?.record?.hidden);
  const offsets = new Map((groups?.record?.apart ?? []).map((a) => [a.group, a.offset]));
  const shown = (t: number): boolean => !groups || !hidden.has(groups.of[t]!);
  const own = seed.triangle;
  // A triangle the mesh does not have is Infinity away (`distanceSquaredTo`).
  if (shown(own)) {
    const [dx, dy, dz] = (groups && offsets.get(groups.of[own]!)) ?? [0, 0, 0];
    if (tree.distanceSquaredTo(own, x - dx, y - dy, z - dz) <= SEED_ON_TRIANGLE_MM ** 2) return own;
  }
  // Once per offset the step drew groups at, among the shown triangles drawn at it; nearest wins.
  const classes = new Map<string, readonly number[]>([['0,0,0', [0, 0, 0]]]);
  for (const offset of offsets.values()) classes.set(offset.join(','), offset);
  const hit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: 0 };
  let best = -1;
  let reach = PAINT_REACH_MM ** 2;
  for (const [key, [dx, dy, dz]] of classes) {
    const accept = (t: number): boolean =>
      shown(t) && (!groups || (offsets.get(groups.of[t]!)?.join(',') ?? '0,0,0') === key);
    tree.closest(hit, x - dx!, y - dy!, z - dz!, reach, null, -1, accept);
    if (hit.triangle >= 0) {
      best = hit.triangle;
      reach = hit.distanceSquared;
    }
  }
  return best;
}

/**
 * Which triangles share an edge with which, across the unwrap's seams: the table level's
 * vertices are split where the atlas cuts, so edges are matched by their corners' positions.
 * Triangle t's neighbours are `neighbours[start[t] .. start[t + 1])`, each with the shared
 * edge's two corners (`edgeA`, `edgeB`, vertex indices of t) for the cavity bound.
 */
export interface TriangleAdjacency {
  start: Uint32Array;
  neighbours: Uint32Array;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  /** Unit face normal per triangle, three numbers each. */
  faceNormals: Float32Array;
}

/** The adjacency of `mesh`'s triangles: built once when a mini is opened for painting. */
export function triangleAdjacency({ positions, indices }: IndexedMesh): TriangleAdjacency {
  const triangles = indices.length / 3;
  // One id per position: the unwrap repeats a vertex's position bit for bit where it splits it.
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const ids = new Map<string, number>();
  const welded = new Uint32Array(positions.length / 3);
  for (let v = 0; v < welded.length; v++) {
    const key = `${bits[v * 3]},${bits[v * 3 + 1]},${bits[v * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    welded[v] = id;
  }
  // The triangles of every edge, keyed by its two welded corners.
  const edges = new Map<number, number[]>();
  const keyOf = (a: number, b: number): number => (a < b ? a * ids.size + b : b * ids.size + a);
  for (let t = 0; t < triangles; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const key = keyOf(
        welded[indices[t * 3 + corner]!]!,
        welded[indices[t * 3 + ((corner + 1) % 3)]!]!,
      );
      const list = edges.get(key);
      if (list) list.push(t, corner);
      else edges.set(key, [t, corner]);
    }
  }
  const counts = new Uint32Array(triangles + 1);
  for (const list of edges.values())
    for (let k = 0; k < list.length; k += 2) counts[list[k]! + 1]! += list.length / 2 - 1;
  for (let t = 0; t < triangles; t++) counts[t + 1]! += counts[t]!;
  const start = counts;
  const total = start[triangles]!;
  const neighbours = new Uint32Array(total);
  const edgeA = new Uint32Array(total);
  const edgeB = new Uint32Array(total);
  const cursor = start.slice(0, triangles);
  for (const list of edges.values()) {
    for (let k = 0; k < list.length; k += 2) {
      const t = list[k]!;
      const corner = list[k + 1]!;
      for (let j = 0; j < list.length; j += 2) {
        if (j === k) continue;
        const at = cursor[t]!++;
        neighbours[at] = list[j]!;
        edgeA[at] = indices[t * 3 + corner]!;
        edgeB[at] = indices[t * 3 + ((corner + 1) % 3)]!;
      }
    }
  }
  const faceNormals = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    faceNormals[t * 3] = nx / length;
    faceNormals[t * 3 + 1] = ny / length;
    faceNormals[t * 3 + 2] = nz / length;
  }
  return { start, neighbours, edgeA, edgeB, faceNormals };
}

export interface FillOptions {
  /** 0 strict … 1 loose: the angle bound is `FILL_ANGLE_DEG × (1 + tolerance)`, the crease bound `FILL_CREASE_CAVITY × (1 + tolerance)`. */
  tolerance: number;
  /** The ready regions (§7.2), for a `base` or `figure` seed. */
  regions?: PaintRegions | null;
  /** Built once per mini (`triangleAdjacency`); made here when left out. */
  adjacency?: TriangleAdjacency;
  /**
   * The mask's cut (#138, design note `docs/design/paint-mask.md` §5): a byte a triangle, non-zero
   * where the mask covers the triangle's middle. A cut triangle bounds a picked fill: it is never
   * entered, and a seed on one fills nothing. Ready regions take no cut.
   */
  cut?: Uint8Array | null;
  /**
   * The hidden groups (#139, design note `docs/design/paint-groups.md` §6.2): a byte a triangle,
   * non-zero where its group is hidden. A hidden triangle bounds a picked fill as a cut one does.
   */
  hidden?: Uint8Array | null;
  /**
   * The groups pulled apart (#139): a byte a triangle, the class of its group's offset (0 at none,
   * k for the k-th distinct offset). A picked fill never crosses from one class to another.
   */
  apart?: Uint8Array | null;
  /** A byte a triangle, the group it is in (#139): for `within` and a `group` seed. */
  groupOf?: Uint8Array | null;
  /** The group a picked fill may not leave (#139, the group fill): a seed in another fills nothing. */
  within?: number | null;
  /**
   * The fold and the crease bound the flood (§7.1): true unless false. The group fill floods all
   * that is connected (#139): its bounds are the cut, the hidden and pulled-apart groups and
   * `within`, and `tolerance` is unused.
   */
  folds?: boolean;
}

/**
 * The triangles a fill covers, in ascending order. A `picked` seed floods from its triangle
 * across every shared edge that is not a bound: an edge is a bound when the angle between its
 * two faces exceeds the angle bound, or when both its corners' cavity (`mesh.cavity`, raw) lies
 * below the crease bound (unless `folds` is false), and a triangle the mask cuts (#138), that is
 * hidden, pulled apart from the seed's or outside `within` (#139) is never entered; a seed on one
 * fills nothing. A `base` or `figure` seed takes the ready region's triangles, no flood; it needs
 * `regions`, and a mini without them is refused. A `group` seed takes the group's triangles, no
 * flood; it needs `groupOf` (#139).
 */
export function fillRegion(mesh: IndexedMesh, seed: FillSeed, options: FillOptions): Uint32Array {
  const triangles = mesh.indices.length / 3;
  const perTriangle = (bytes: Uint8Array | null | undefined, name: string): Uint8Array | null => {
    if (bytes && bytes.length !== triangles)
      throw new RangeError(`The ${name} is not this mesh’s: one byte per triangle`);
    return bytes ?? null;
  };
  const groupOf = perTriangle(options.groupOf, 'group map');
  if (seed.kind === 'group') {
    if (!groupOf) throw new RangeError('This mini has no groups to fill');
    const region: number[] = [];
    for (let t = 0; t < triangles; t++) if (groupOf[t] === seed.group) region.push(t);
    return Uint32Array.from(region);
  }
  if (seed.kind !== 'picked') {
    const base = options.regions?.base;
    if (!base) throw new RangeError('This mini has no ready regions to fill');
    if (base.length !== triangles) throw new RangeError('The regions are not this mesh’s');
    const wanted = seed.kind === 'base' ? 1 : 0;
    const region: number[] = [];
    for (let t = 0; t < triangles; t++) if (base[t] === wanted) region.push(t);
    return Uint32Array.from(region);
  }
  if (!(seed.triangle >= 0 && seed.triangle < triangles))
    throw new RangeError(`No triangle ${seed.triangle} to fill from`);
  const cut = perTriangle(options.cut, 'cut');
  const hidden = perTriangle(options.hidden, 'hidden map');
  const apart = perTriangle(options.apart, 'apart map');
  const within = options.within ?? null;
  if (within !== null && !groupOf) throw new RangeError('A fill within a group needs the groups');
  // Where a picked flood may not go: cut, hidden, another offset class, another group.
  const seedClass = apart?.[seed.triangle] ?? 0;
  const closed = (t: number): boolean =>
    !!cut?.[t] ||
    !!hidden?.[t] ||
    (apart !== null && apart[t] !== seedClass) ||
    (within !== null && groupOf![t] !== within);
  if (closed(seed.triangle)) return new Uint32Array(0);
  const folds = options.folds ?? true;
  const { start, neighbours, edgeA, edgeB, faceNormals } =
    options.adjacency ?? triangleAdjacency(mesh);
  const tolerance = Math.max(0, Math.min(1, options.tolerance));
  const minCos = Math.cos(Math.min(180, FILL_ANGLE_DEG * (1 + tolerance)) * (Math.PI / 180));
  const crease = FILL_CREASE_CAVITY * (1 + tolerance);
  const cavity = mesh.cavity;
  const inside = new Uint8Array(triangles);
  const queue = new Uint32Array(triangles);
  let head = 0;
  let tail = 0;
  inside[seed.triangle] = 1;
  queue[tail++] = seed.triangle;
  while (head < tail) {
    const t = queue[head++]!;
    for (let k = start[t]!; k < start[t + 1]!; k++) {
      const n = neighbours[k]!;
      if (inside[n] || closed(n)) continue;
      if (!folds) {
        inside[n] = 1;
        queue[tail++] = n;
        continue;
      }
      const cos =
        faceNormals[t * 3]! * faceNormals[n * 3]! +
        faceNormals[t * 3 + 1]! * faceNormals[n * 3 + 1]! +
        faceNormals[t * 3 + 2]! * faceNormals[n * 3 + 2]!;
      if (cos < minCos) continue;
      if (cavity && cavity[edgeA[k]!]! < crease && cavity[edgeB[k]!]! < crease) continue;
      inside[n] = 1;
      queue[tail++] = n;
    }
  }
  const region = new Uint32Array(tail);
  let written = 0;
  for (let t = 0; t < triangles; t++) if (inside[t]) region[written++] = t;
  return region;
}
