import { MeshoptSimplifier, type SimplifierFlags } from 'meshoptimizer';
import type { IndexedMesh } from './mesh';

export interface LodSpec {
  name: 'close' | 'table' | 'far';
  /** Reduce until the mesh deviates this far from the source surface... */
  maxErrorMm: number;
  /** ...but never keep fewer triangles than this (if the source has them)... */
  minTriangles: number;
  /** ...and never more than this, whatever the error: the cap protects frame rate. */
  maxTriangles: number;
}

/**
 * Levels of detail, highest first. Triangle count is a poor measure of detail (it mostly
 * reflects export settings), so each level is defined by how far it may deviate from the
 * sculpt. Simple minis land on the floor, detailed ones get more, the cap bounds the cost.
 * Provisional until the Phase 0 write-up (issue #14) fixes the numbers.
 */
export const LOD_SPECS: readonly LodSpec[] = [
  { name: 'close', maxErrorMm: 0.02, minTriangles: 50_000, maxTriangles: 200_000 },
  { name: 'table', maxErrorMm: 0.05, minTriangles: 15_000, maxTriangles: 60_000 },
  { name: 'far', maxErrorMm: 0.2, minTriangles: 4_000, maxTriangles: 20_000 },
];

/**
 * Prune drops tiny floating components (common in generated and scanned sculpts), which
 * otherwise eat the budget because a closed component cannot shrink below a few triangles.
 * ErrorAbsolute makes error limits and results plain millimetres.
 */
const FLAGS: SimplifierFlags[] = ['Prune', 'ErrorAbsolute'];
const NO_ERROR_LIMIT = Number.MAX_VALUE;

/**
 * When above zero and the mesh carries normals, the final reduction also protects places
 * where the surface direction changes (creases, folds, facial features). Costs one more
 * simplifier run per level. 0 switches it off.
 */
export const NORMAL_WEIGHT: number = 0.5;

export interface Lod {
  mesh: IndexedMesh;
  name: LodSpec['name'];
  triangles: number;
  /** Estimated largest deviation of the surface from the original sculpt, in mm. */
  errorMm: number;
  /** What fixed the triangle count: the error limit, the floor, the cap, or a small source. */
  decidedBy: 'error' | 'floor' | 'cap' | 'source';
}

/** Resolves once the WebAssembly simplifier is compiled. Must be awaited before simplifying. */
export const simplifierReady = (): Promise<void> => MeshoptSimplifier.ready;

/** Drops vertices no triangle uses and renumbers the indices. Normals follow their vertices. */
function compact(source: IndexedMesh, indices: Uint32Array): IndexedMesh {
  const { positions, normals } = source;
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices);
  const compacted = new Float32Array(vertexCount * 3);
  const compactedNormals = normals ? new Float32Array(vertexCount * 3) : undefined;
  for (let old = 0; old < remap.length; old++) {
    const target = remap[old]!;
    if (target === 0xffffffff) continue;
    for (let axis = 0; axis < 3; axis++) {
      compacted[target * 3 + axis] = positions[old * 3 + axis]!;
      if (normals && compactedNormals) {
        compactedNormals[target * 3 + axis] = normals[old * 3 + axis]!;
      }
    }
  }
  return { positions: compacted, indices, normals: compactedNormals };
}

/** Geometry-only reduction; the returned error is a surface deviation in mm. */
function reduce(
  mesh: IndexedMesh,
  targetTriangles: number,
  maxErrorMm: number,
): [Uint32Array, number] {
  return MeshoptSimplifier.simplify(
    mesh.indices,
    mesh.positions,
    3,
    targetTriangles * 3,
    maxErrorMm,
    FLAGS,
  );
}

/** Reduction to a fixed count that also weighs shading. Its error mixes units, so it is not reported. */
function reduceKeepingCreases(mesh: IndexedMesh, targetTriangles: number): Uint32Array {
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices,
    mesh.positions,
    3,
    mesh.normals!,
    3,
    [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT],
    null,
    targetTriangles * 3,
    NO_ERROR_LIMIT,
    FLAGS,
  );
  return indices;
}

/**
 * Builds one level from `mesh`. `errorSoFarMm` is the deviation `mesh` already has from
 * the original sculpt, so that chained levels stay within their limit overall.
 */
export function simplifyToSpec(mesh: IndexedMesh, spec: LodSpec, errorSoFarMm = 0): Lod {
  const sourceTriangles = mesh.indices.length / 3;
  if (sourceTriangles <= spec.minTriangles) {
    return {
      mesh: compact(mesh, mesh.indices.slice()),
      name: spec.name,
      triangles: sourceTriangles,
      errorMm: errorSoFarMm,
      decidedBy: 'source',
    };
  }

  // Aim for the floor, but stop early once the error limit is reached.
  const allowance = spec.maxErrorMm - errorSoFarMm;
  let [indices, error]: [Uint32Array, number] =
    allowance > 0 ? reduce(mesh, spec.minTriangles, allowance) : [mesh.indices, 0];
  // The simplifier lands within a few triangles of its target, never exactly on it.
  let decidedBy: Lod['decidedBy'] =
    indices.length / 3 <= spec.minTriangles * 1.02 ? 'floor' : 'error';

  if (indices.length / 3 > spec.maxTriangles) {
    [indices, error] = reduce(mesh, spec.maxTriangles, NO_ERROR_LIMIT);
    decidedBy = 'cap';
  }
  if (NORMAL_WEIGHT > 0 && mesh.normals && indices.length < mesh.indices.length) {
    indices = reduceKeepingCreases(mesh, indices.length / 3);
  }

  return {
    mesh: compact(mesh, indices),
    name: spec.name,
    triangles: indices.length / 3,
    errorMm: errorSoFarMm + error,
    decidedBy,
  };
}

/**
 * Builds every level. Each is simplified from the previous one, which is much faster than
 * starting from the source each time; errors are added up, so every reported figure is an
 * estimate against the original sculpt.
 */
export function buildLods(mesh: IndexedMesh, specs: readonly LodSpec[] = LOD_SPECS): Lod[] {
  const lods: Lod[] = [];
  let source = mesh;
  let errorSoFar = 0;
  for (const spec of specs) {
    const lod = simplifyToSpec(source, spec, errorSoFar);
    lods.push(lod);
    source = lod.mesh;
    errorSoFar = lod.errorMm;
  }
  return lods;
}
