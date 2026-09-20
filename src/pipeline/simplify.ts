import { MeshoptSimplifier, type SimplifierFlags } from 'meshoptimizer';
import type { IndexedMesh } from './mesh';

/**
 * Triangle budgets per level of detail, highest first. 50k is the close-up / painting
 * mesh, 15k the normal table view, 4k the far view. Provisional until the Phase 0
 * write-up (issue #14) fixes them.
 */
export const LOD_TRIANGLE_BUDGETS = [50_000, 15_000, 4_000] as const;

/**
 * Relative error ceiling handed to the simplifier. 1 means "no ceiling": hitting the
 * triangle budget matters more than fidelity, because the budget is what keeps 100 minis
 * on screen. The error actually incurred is reported per LOD.
 */
const TARGET_ERROR = 1;

/**
 * Prune drops tiny floating components (common in generated and scanned sculpts), which
 * otherwise eat the budget because a closed component cannot shrink below a few triangles.
 */
const FLAGS: SimplifierFlags[] = ['Prune'];

/**
 * How strongly the simplifier protects places where the surface direction changes
 * (creases, folds, facial features) when the mesh carries normals.
 */
const NORMAL_WEIGHT = 0.5;

export interface Lod {
  mesh: IndexedMesh;
  targetTriangles: number;
  triangles: number;
  /** Simplifier's estimate of the largest deviation from the source surface, in mm. */
  errorMm: number;
}

/** Resolves once the WebAssembly simplifier is compiled. Must be awaited before `simplifyToBudget`. */
export const simplifierReady = (): Promise<void> => MeshoptSimplifier.ready;

/** Drops vertices no triangle uses and renumbers the indices. */
function compact(source: IndexedMesh, indices: Uint32Array): IndexedMesh {
  const { positions, normals } = source;
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices);
  const compacted = new Float32Array(vertexCount * 3);
  const compactedNormals = normals ? new Float32Array(vertexCount * 3) : undefined;
  for (let old = 0; old < remap.length; old++) {
    const target = remap[old]!;
    if (target === 0xffffffff) continue;
    compacted[target * 3] = positions[old * 3]!;
    compacted[target * 3 + 1] = positions[old * 3 + 1]!;
    compacted[target * 3 + 2] = positions[old * 3 + 2]!;
    if (normals && compactedNormals) {
      compactedNormals[target * 3] = normals[old * 3]!;
      compactedNormals[target * 3 + 1] = normals[old * 3 + 1]!;
      compactedNormals[target * 3 + 2] = normals[old * 3 + 2]!;
    }
  }
  return { positions: compacted, indices, normals: compactedNormals };
}

/**
 * Reduces a mesh to at most `targetTriangles` where its topology allows. Meshes already
 * under the budget are returned as a compacted copy with zero error.
 */
export function simplifyToBudget(mesh: IndexedMesh, targetTriangles: number): Lod {
  const sourceTriangles = mesh.indices.length / 3;
  if (sourceTriangles <= targetTriangles) {
    return {
      mesh: compact(mesh, mesh.indices.slice()),
      targetTriangles,
      triangles: sourceTriangles,
      errorMm: 0,
    };
  }
  const [indices, relativeError] = mesh.normals
    ? MeshoptSimplifier.simplifyWithAttributes(
        mesh.indices,
        mesh.positions,
        3,
        mesh.normals,
        3,
        [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT],
        null,
        targetTriangles * 3,
        TARGET_ERROR,
        FLAGS,
      )
    : MeshoptSimplifier.simplify(
        mesh.indices,
        mesh.positions,
        3,
        targetTriangles * 3,
        TARGET_ERROR,
        FLAGS,
      );
  return {
    mesh: compact(mesh, indices),
    targetTriangles,
    triangles: indices.length / 3,
    errorMm: relativeError * MeshoptSimplifier.getScale(mesh.positions, 3),
  };
}

/**
 * Builds every LOD. Each level is simplified from the previous one: about as good as
 * starting from the source every time, and much faster. Reported errors are accumulated
 * so each stays an estimate against the source mesh.
 */
export function buildLods(
  mesh: IndexedMesh,
  budgets: readonly number[] = LOD_TRIANGLE_BUDGETS,
): Lod[] {
  const lods: Lod[] = [];
  let source = mesh;
  let accumulatedError = 0;
  for (const budget of budgets) {
    const lod = simplifyToBudget(source, budget);
    accumulatedError += lod.errorMm;
    lods.push({ ...lod, errorMm: accumulatedError });
    source = lod.mesh;
  }
  return lods;
}
