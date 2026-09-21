import type { IndexedMesh } from './mesh';

/** Spike #34. A share of a mesh's triangles as a mesh of its own. */
export interface MeshPart {
  mesh: IndexedMesh;
  /** For every vertex of the part, its index in the source mesh. */
  sourceVertex: Uint32Array;
  /** For every triangle of the part, its index in the source mesh. */
  sourceTriangle: Uint32Array;
}

/**
 * Labels every triangle with the connected piece it belongs to. Two triangles are connected
 * when they share a vertex, so run this on a welded mesh. Pieces are numbered from 0 by
 * falling triangle count.
 */
export function connectedPieces({ positions, indices }: IndexedMesh): {
  pieceOfTriangle: Uint32Array;
  /** Triangles per piece, largest first. */
  sizes: number[];
} {
  const parent = new Uint32Array(positions.length / 3);
  for (let v = 0; v < parent.length; v++) parent[v] = v;
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!;
      v = parent[v]!;
    }
    return v;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]!);
    const b = find(indices[t + 1]!);
    const c = find(indices[t + 2]!);
    parent[b] = a;
    parent[c] = a;
  }

  const triangles = indices.length / 3;
  const countOfRoot = new Map<number, number>();
  for (let t = 0; t < triangles; t++) {
    const root = find(indices[t * 3]!);
    countOfRoot.set(root, (countOfRoot.get(root) ?? 0) + 1);
  }
  const ordered = [...countOfRoot].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const pieceOfRoot = new Map(ordered.map(([root], piece) => [root, piece]));
  const pieceOfTriangle = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) pieceOfTriangle[t] = pieceOfRoot.get(find(indices[t * 3]!))!;
  return { pieceOfTriangle, sizes: ordered.map(([, count]) => count) };
}

/**
 * Sorts connected pieces into at most `groups` groups of similar triangle count: the largest
 * piece first, each into the group that is smallest so far. A piece is never cut, so one
 * large piece still decides how long the slowest group takes. Returns the group of every
 * triangle and how many groups are in use.
 */
export function groupPieces(
  pieceOfTriangle: Uint32Array,
  sizes: readonly number[],
  groups: number,
): { groupOfTriangle: Uint32Array; groupSizes: number[] } {
  const groupSizes = new Array<number>(Math.max(1, Math.min(groups, sizes.length))).fill(0);
  const groupOfPiece = sizes.map((size) => {
    const smallest = groupSizes.indexOf(Math.min(...groupSizes));
    groupSizes[smallest] = groupSizes[smallest]! + size;
    return smallest;
  });
  const groupOfTriangle = new Uint32Array(pieceOfTriangle.length);
  for (let t = 0; t < groupOfTriangle.length; t++) {
    groupOfTriangle[t] = groupOfPiece[pieceOfTriangle[t]!]!;
  }
  return { groupOfTriangle, groupSizes };
}

/** One mesh per group, with positions and normals carried over and the way back recorded. */
export function splitByGroup(
  source: IndexedMesh,
  groupOfTriangle: Uint32Array,
  groups: number,
): MeshPart[] {
  const parts: MeshPart[] = [];
  const localOf = new Int32Array(source.positions.length / 3);
  for (let group = 0; group < groups; group++) {
    localOf.fill(-1);
    const sourceVertex: number[] = [];
    const sourceTriangle: number[] = [];
    const indices: number[] = [];
    for (let t = 0; t < groupOfTriangle.length; t++) {
      if (groupOfTriangle[t] !== group) continue;
      sourceTriangle.push(t);
      for (let corner = 0; corner < 3; corner++) {
        const v = source.indices[t * 3 + corner]!;
        if (localOf[v] === -1) {
          localOf[v] = sourceVertex.length;
          sourceVertex.push(v);
        }
        indices.push(localOf[v]!);
      }
    }
    const carry = (values: Float32Array | undefined, width: number): Float32Array | undefined => {
      if (!values) return undefined;
      const carried = new Float32Array(sourceVertex.length * width);
      sourceVertex.forEach((from, to) => {
        for (let k = 0; k < width; k++) carried[to * width + k] = values[from * width + k]!;
      });
      return carried;
    };
    parts.push({
      mesh: {
        positions: carry(source.positions, 3)!,
        normals: carry(source.normals, 3),
        indices: Uint32Array.from(indices),
      },
      sourceVertex: Uint32Array.from(sourceVertex),
      sourceTriangle: Uint32Array.from(sourceTriangle),
    });
  }
  return parts;
}

/**
 * For meshes that are one connected piece: cuts the mesh across its longest axis into `count`
 * slabs of equal triangle count. Every cut becomes a seam, which is the price of this variant.
 */
export function cutIntoSlabs(
  { positions, indices }: IndexedMesh,
  count: number,
): { groupOfTriangle: Uint32Array; groupSizes: number[] } {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    low[i % 3] = Math.min(low[i % 3]!, positions[i]!);
    high[i % 3] = Math.max(high[i % 3]!, positions[i]!);
  }
  const extent = high.map((value, axis) => value - low[axis]!);
  const axis = extent.indexOf(Math.max(...extent));

  const triangles = indices.length / 3;
  const centre = new Float32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    centre[t] =
      positions[indices[t * 3]! * 3 + axis]! +
      positions[indices[t * 3 + 1]! * 3 + axis]! +
      positions[indices[t * 3 + 2]! * 3 + axis]!;
  }
  const order = Uint32Array.from({ length: triangles }, (_, t) => t).sort(
    (a, b) => centre[a]! - centre[b]!,
  );
  const groups = Math.max(1, Math.min(count, triangles));
  const groupOfTriangle = new Uint32Array(triangles);
  const groupSizes = new Array<number>(groups).fill(0);
  order.forEach((t, rank) => {
    const group = Math.min(groups - 1, Math.floor((rank * groups) / triangles));
    groupOfTriangle[t] = group;
    groupSizes[group] = groupSizes[group]! + 1;
  });
  return { groupOfTriangle, groupSizes };
}
