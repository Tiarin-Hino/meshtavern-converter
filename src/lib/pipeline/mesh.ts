/** Indexed triangle mesh: the common currency of every pipeline step after STL reading. */
export interface IndexedMesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** Unit normal per vertex. Optional: consumers derive normals from the faces when absent. */
  normals?: Float32Array;
  /** Signed curvature per vertex, -1 (crease) to 1 (edge). See shade.ts. */
  cavity?: Float32Array;
  /** Openness per vertex, 0 (buried) to 1 (open). See shade.ts. */
  occlusion?: Float32Array;
  /** Texture coordinates per vertex, 0..1, two numbers each. See unwrap.ts. */
  uvs?: Float32Array;
}

/** Every buffer of a mesh, for handing it between threads without copying. */
export function meshBuffers(mesh: IndexedMesh): ArrayBufferLike[] {
  return [
    mesh.positions,
    mesh.indices,
    mesh.normals,
    mesh.cavity,
    mesh.occlusion,
    mesh.uvs,
  ].flatMap((array) => (array ? [array.buffer] : []));
}

/** Area-weighted vertex normals, the same rule three.js uses. */
export function computeVertexNormals({ positions, indices }: IndexedMesh): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const corner of [a, b, c]) {
      normals[corner] = normals[corner]! + nx;
      normals[corner + 1] = normals[corner + 1]! + ny;
      normals[corner + 2] = normals[corner + 2]! + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] = normals[i]! / length;
    normals[i + 1] = normals[i + 1]! / length;
    normals[i + 2] = normals[i + 2]! / length;
  }
  return normals;
}

export interface WeldResult {
  mesh: IndexedMesh;
  /** Triangles dropped because two or more corners welded into the same vertex, or because they have no area. */
  degenerateTriangles: number;
  /** Triangles dropped because an earlier one has the same three vertices, in whatever order. */
  duplicateTriangles: number;
}

/**
 * Twice the area below which a triangle counts as flat, in mm². Real triangles of a
 * 0.01 mm print detail are a million times larger; this only catches corners that lie
 * on one line.
 */
export const FLAT_TRIANGLE_MM2 = 1e-10;

export interface ValidSoup {
  soup: Float32Array;
  /** Triangles dropped because a coordinate is not a number or infinite. */
  invalidTriangles: number;
}

/** Drops triangles with a coordinate that is NaN or infinite. Returns the input itself when all are valid. */
export function dropInvalidTriangles(soup: Float32Array): ValidSoup {
  let invalid = 0;
  for (let t = 0; t < soup.length; t += 9) {
    for (let i = t; i < t + 9; i++) {
      if (!Number.isFinite(soup[i]!)) {
        invalid++;
        break;
      }
    }
  }
  if (invalid === 0) return { soup, invalidTriangles: 0 };
  const valid = new Float32Array(soup.length - invalid * 9);
  let written = 0;
  for (let t = 0; t < soup.length; t += 9) {
    const triangle = soup.subarray(t, t + 9);
    if (triangle.every(Number.isFinite)) {
      valid.set(triangle, written);
      written += 9;
    }
  }
  return { soup: valid, invalidTriangles: invalid };
}

/**
 * Vertices closer than this (per axis, in mm) are merged. Exported STLs repeat shared
 * vertices bit-exactly, so this only needs to absorb float noise; it is far below
 * anything a printer or a screen can resolve.
 */
export const WELD_TOLERANCE_MM = 1e-4;

const EMPTY = -1;

/**
 * Turns a triangle soup (9 numbers per triangle) into an indexed mesh by merging
 * duplicate vertices. Vertices are snapped to a grid of `tolerance` for comparison only:
 * the output keeps the coordinates of the first vertex seen in each cell. Two vertices
 * closer than the tolerance but on either side of a cell boundary are not merged,
 * which is acceptable for de-duplication.
 *
 * Triangles that end up without area, and repeats of a triangle already kept, are
 * dropped: they add nothing to the surface and upset the simplifier and the unwrapper.
 * The soup must hold finite numbers only (see `dropInvalidTriangles`).
 */
export function weldVertices(soup: Float32Array, tolerance = WELD_TOLERANCE_MM): WeldResult {
  if (soup.length % 9 !== 0) throw new Error('Expected 9 numbers per triangle');
  if (!(tolerance > 0)) throw new Error('Tolerance must be positive');

  const cornerCount = soup.length / 3;
  // Open-addressing hash table over grid cells; at most half full.
  let tableSize = 16;
  while (tableSize < cornerCount * 2) tableSize *= 2;
  const mask = tableSize - 1;
  const table = new Int32Array(tableSize).fill(EMPTY);

  const cells = new Int32Array(cornerCount * 3);
  const positions = new Float32Array(cornerCount * 3);
  const remap = new Uint32Array(cornerCount);
  let vertexCount = 0;

  for (let corner = 0; corner < cornerCount; corner++) {
    const x = soup[corner * 3]!;
    const y = soup[corner * 3 + 1]!;
    const z = soup[corner * 3 + 2]!;
    const cx = Math.round(x / tolerance) | 0;
    const cy = Math.round(y / tolerance) | 0;
    const cz = Math.round(z / tolerance) | 0;

    let slot = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & mask;
    for (;;) {
      const candidate = table[slot]!;
      if (candidate === EMPTY) {
        table[slot] = vertexCount;
        cells[vertexCount * 3] = cx;
        cells[vertexCount * 3 + 1] = cy;
        cells[vertexCount * 3 + 2] = cz;
        positions[vertexCount * 3] = x;
        positions[vertexCount * 3 + 1] = y;
        positions[vertexCount * 3 + 2] = z;
        remap[corner] = vertexCount++;
        break;
      }
      if (
        cells[candidate * 3] === cx &&
        cells[candidate * 3 + 1] === cy &&
        cells[candidate * 3 + 2] === cz
      ) {
        remap[corner] = candidate;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }

  const indices = new Uint32Array(cornerCount);
  const area2 = (a: number, b: number, c: number): number => {
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  // Triangles kept so far, by their sorted corners; the per-corner table is reused.
  const triangleSlots = table.fill(EMPTY);
  let written = 0;
  let degenerate = 0;
  let duplicates = 0;
  for (let corner = 0; corner < cornerCount; corner += 3) {
    const a = remap[corner]!;
    const b = remap[corner + 1]!;
    const c = remap[corner + 2]!;
    if (a === b || b === c || a === c || area2(a, b, c) < FLAT_TRIANGLE_MM2) {
      degenerate++;
      continue;
    }
    const low = Math.min(a, b, c);
    const high = Math.max(a, b, c);
    const middle = a + b + c - low - high;
    let slot =
      (Math.imul(low, 73856093) ^ Math.imul(middle, 19349663) ^ Math.imul(high, 83492791)) & mask;
    let duplicate = false;
    for (;;) {
      const kept = triangleSlots[slot]!;
      if (kept === EMPTY) {
        triangleSlots[slot] = written;
        break;
      }
      const [p, q, r] = [indices[kept]!, indices[kept + 1]!, indices[kept + 2]!];
      if (
        Math.min(p, q, r) === low &&
        Math.max(p, q, r) === high &&
        p + q + r - Math.min(p, q, r) - Math.max(p, q, r) === middle
      ) {
        duplicate = true;
        break;
      }
      slot = (slot + 1) & mask;
    }
    if (duplicate) {
      duplicates++;
      continue;
    }
    indices[written++] = a;
    indices[written++] = b;
    indices[written++] = c;
  }

  return {
    mesh: { positions: positions.slice(0, vertexCount * 3), indices: indices.slice(0, written) },
    degenerateTriangles: degenerate,
    duplicateTriangles: duplicates,
  };
}
