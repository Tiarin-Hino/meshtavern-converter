import type { IndexedMesh } from './mesh';

/** A share of a mesh's triangles as a mesh of its own. */
export interface MeshPart {
  mesh: IndexedMesh;
  /** For every vertex of the part, its index in the source mesh. */
  sourceVertex: Uint32Array;
  /** For every triangle of the part, its index in the source mesh. */
  sourceTriangle: Uint32Array;
}

/**
 * Cuts a mesh across its longest side into `count` slabs of equal triangle count, by where
 * each triangle's centre lies. Returns the slab of every triangle and the triangles per slab.
 * Every cut becomes a seam once the slabs are unwrapped apart.
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
