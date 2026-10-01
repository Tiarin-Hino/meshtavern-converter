/**
 * Where two parts touch, as pairs of patches (#93, design note
 * docs/design/patches-where-parts-meet.md §5.3): what the converter proposes at the pairs stop,
 * read from the placement it would make without marks. Pieces of the other part that lie within
 * a small gap of the part in place, and the surface of the part in place under each piece.
 */
import { TriangleBvh, type SurfaceHit } from './bvh';
import { MAX_PAIRS, summarise, type Patch } from './marks';
import type { IndexedMesh } from './mesh';

/** Contact is looked for within the first of these gaps that finds any. _(proposal)_ */
export const CONTACT_GAPS_MM = [0.5, 1, 2] as const;
/** A piece of contact smaller than this is left out. _(proposal)_ */
export const CONTACT_MIN_AREA_MM2 = 1;
/** `contactPatches` on the largest corpus pair, development PC, Node. _(proposal)_ */
export const PROPOSAL_BUDGET_MS = 1500;

/** Twice a triangle's area. */
function twiceArea(positions: Float32Array, indices: Uint32Array, t: number): number {
  const a = indices[t * 3]! * 3;
  const b = indices[t * 3 + 1]! * 3;
  const c = indices[t * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uy = positions[b + 1]! - positions[a + 1]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vy = positions[c + 1]! - positions[a + 1]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  return Math.sqrt(x * x + y * y + z * z);
}

/** The box of some positions grown by `by`, or of the vertices of some triangles. */
function boxOf(positions: Float32Array, by: number): Float64Array {
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]!;
      if (value < box[k]!) box[k] = value;
      if (value > box[3 + k]!) box[3 + k] = value;
    }
  }
  for (let k = 0; k < 3; k++) {
    box[k] = box[k]! - by;
    box[3 + k] = box[3 + k]! + by;
  }
  return box;
}

const inBox = (box: Float64Array, x: number, y: number, z: number): boolean =>
  x >= box[0]! && x <= box[3]! && y >= box[1]! && y <= box[4]! && z >= box[2]! && z <= box[5]!;

/** Squared distance from every vertex to a surface, up to `limit`² (Infinity beyond, or outside `box`). */
function vertexDistances(
  positions: Float32Array,
  tree: TriangleBvh,
  box: Float64Array,
  limit: number,
): Float64Array {
  const out = new Float64Array(positions.length / 3).fill(Infinity);
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: 0 };
  let hint = -1;
  for (let v = 0; v < out.length; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (!inBox(box, x, y, z)) continue;
    tree.closest(hit, x, y, z, limit * limit, null, hint);
    if (hit.triangle >= 0) {
      out[v] = hit.distanceSquared;
      hint = hit.triangle;
    }
  }
  return out;
}

/** The triangles whose three vertices lie within `gap`. */
function nearTriangles(indices: Uint32Array, d2: Float64Array, gap: number): number[] {
  const g2 = gap * gap;
  const out: number[] = [];
  for (let t = 0; t < indices.length / 3; t++) {
    if (
      d2[indices[t * 3]!]! <= g2 &&
      d2[indices[t * 3 + 1]!]! <= g2 &&
      d2[indices[t * 3 + 2]!]! <= g2
    )
      out.push(t);
  }
  return out;
}

/** Triangles in pieces connected through shared vertices, each piece ascending, pieces by their lowest triangle. */
function pieces(indices: Uint32Array, triangles: readonly number[]): number[][] {
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let root = v;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    let at = v;
    while (at !== root) {
      const next = parent.get(at)!;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  for (const t of triangles) {
    for (let k = 0; k < 3; k++)
      if (!parent.has(indices[t * 3 + k]!)) parent.set(indices[t * 3 + k]!, indices[t * 3 + k]!);
    const a = find(indices[t * 3]!);
    for (let k = 1; k < 3; k++) {
      const b = find(indices[t * 3 + k]!);
      if (a !== b) parent.set(b < a ? a : b, b < a ? b : a);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (const t of triangles) {
    const root = find(indices[t * 3]!);
    const list = byRoot.get(root);
    if (list) list.push(t);
    else byRoot.set(root, [t]);
  }
  return [...byRoot.values()];
}

/**
 * Where two parts touch, as pairs of patches, largest first (§5.3): for the first gap of
 * `CONTACT_GAPS_MM` that yields a pair, the triangles of `other` whose three vertices lie within
 * the gap of `inPlace`'s surface, in pieces connected through shared vertices, pieces under
 * `CONTACT_MIN_AREA_MM2` dropped and the `MAX_PAIRS` largest kept; for each piece, the triangles
 * of `inPlace` whose three vertices lie within the gap of the piece. Empty when they do not touch.
 *
 * @param inPlace The part in place: its file, welded mesh and search tree, its own frame.
 * @param other The part that goes there: its file and welded mesh, and its vertices where it is
 *   placed, in `inPlace`'s frame. The `of` patches are summarised in its file coordinates.
 */
export function contactPatches(
  inPlace: { file: number; mesh: IndexedMesh; tree: TriangleBvh },
  other: { file: number; mesh: IndexedMesh; positions: Float32Array },
): { on: Patch; of: Patch }[] {
  const widest = CONTACT_GAPS_MM[CONTACT_GAPS_MM.length - 1]!;
  const otherD2 = vertexDistances(
    other.positions,
    inPlace.tree,
    boxOf(inPlace.mesh.positions, widest),
    widest,
  );
  const { indices } = other.mesh;
  for (const gap of CONTACT_GAPS_MM) {
    const found = pieces(indices, nearTriangles(indices, otherD2, gap))
      .map((piece) => ({
        piece,
        area: piece.reduce((sum, t) => sum + twiceArea(other.positions, indices, t), 0) / 2,
      }))
      .filter(({ area }) => area >= CONTACT_MIN_AREA_MM2)
      // Largest first; equal areas by their lowest triangle.
      .sort((a, b) => b.area - a.area || a.piece[0]! - b.piece[0]!)
      .slice(0, MAX_PAIRS);
    const pairs: { on: Patch; of: Patch }[] = [];
    for (const { piece } of found) {
      const pieceMesh: IndexedMesh = {
        positions: other.positions,
        indices: Uint32Array.from(
          piece.flatMap((t) => [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!]),
        ),
      };
      const pieceTree = new TriangleBvh(pieceMesh);
      const pieceBox = new Float64Array([
        Infinity,
        Infinity,
        Infinity,
        -Infinity,
        -Infinity,
        -Infinity,
      ]);
      for (const v of pieceMesh.indices) {
        for (let k = 0; k < 3; k++) {
          const value = other.positions[v * 3 + k]!;
          if (value < pieceBox[k]!) pieceBox[k] = value;
          if (value > pieceBox[3 + k]!) pieceBox[3 + k] = value;
        }
      }
      for (let k = 0; k < 3; k++) {
        pieceBox[k] = pieceBox[k]! - gap;
        pieceBox[3 + k] = pieceBox[3 + k]! + gap;
      }
      const onD2 = vertexDistances(inPlace.mesh.positions, pieceTree, pieceBox, gap);
      const on = nearTriangles(inPlace.mesh.indices, onD2, gap);
      if (on.length === 0) continue;
      pairs.push({
        on: summarise(inPlace.file, inPlace.mesh, Uint32Array.from(on)),
        of: summarise(other.file, other.mesh, Uint32Array.from(piece.sort((a, b) => a - b))),
      });
    }
    if (pairs.length > 0) return pairs;
  }
  return [];
}
