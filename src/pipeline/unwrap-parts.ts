// Spike #34: the unwrap in parts. Islands are found per part (each part can run in its own
// worker), then one packing pass places the islands of all parts in one texture.
// Nothing here is used by the normal path.
import type { ChartOptions, XAtlas } from 'xatlas-wasm';
import { surfaceAreaMm2 } from './bake-policy';
import type { IndexedMesh } from './mesh';
import { cutIntoSlabs, splitByGroup, type MeshPart } from './parts';
import { seamLengthMm } from './seams';
import { ISLAND_PADDING, MAX_CHART_COST, unwrap, unwrapperReady, type Unwrapped } from './unwrap';

/** Share of the texture xatlas aims to fill when it picks the scale itself. */
const EXPECTED_UTILISATION = 0.75;

/** The islands of one part, not yet placed in the shared texture. */
export interface PartIslands {
  /** Two numbers per vertex, in texels at the scale all parts share. */
  uvs: Float32Array;
  /** For every vertex, its index in the part's mesh. */
  xref: Uint32Array;
  indices: Uint32Array;
  charts: number;
  /** Islands by xatlas chart type: planar, ortho, LSCM, piecewise, invalid. */
  chartTypes: number[];
  /** Size of the WebAssembly memory afterwards. It only ever grows, so this is the peak. */
  wasmBytes: number;
  ms: number;
}

const wasmBytesOf = (atlas: XAtlas): number =>
  (atlas as unknown as { _m: { HEAPU8: Uint8Array } })._m.HEAPU8.length;

/**
 * Texels per mm that lets a surface of this area fill a square texture about as far as xatlas
 * would on its own. Every part is unwrapped at this one scale, so that the islands of all
 * parts are in proportion when they are packed together.
 */
export const sharedTexelsPerUnit = (areaMm2: number, resolution: number): number =>
  Math.sqrt((resolution * resolution * EXPECTED_UTILISATION) / areaMm2);

/** Finds the islands of one mesh. The quick packing at the end is only there to get them out. */
export async function findIslands(
  mesh: IndexedMesh,
  options: ChartOptions,
  texelsPerUnit: number,
  onProgress: (percent: number) => void = () => {},
): Promise<PartIslands> {
  const xatlas = await unwrapperReady();
  const start = performance.now();
  const atlas = xatlas.createAtlas();
  try {
    let reported = -1;
    atlas.setProgressCallback((category, progress) => {
      if (category === 1 && progress >= reported + 2) onProgress((reported = progress));
      return true;
    });
    const error = atlas.addMesh({
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
    });
    if (error !== 0) throw new Error(`Unwrap failed: ${xatlas.addMeshErrorString(error)}`);
    atlas.computeCharts(options);
    atlas.packCharts({
      texelsPerUnit,
      resolution: 0,
      padding: 0,
      bilinear: false,
      blockAlign: true,
      rotateCharts: false,
      rotateChartsToAxis: false,
    });
    const out = atlas.getMesh(0);
    const uvs = new Float32Array(out.vertexCount * 2);
    const xref = new Uint32Array(out.vertexCount);
    for (let v = 0; v < out.vertexCount; v++) {
      const vertex = out.vertices[v]!;
      uvs[v * 2] = vertex.uv[0];
      uvs[v * 2 + 1] = vertex.uv[1];
      xref[v] = vertex.xref;
    }
    const chartTypes = [0, 0, 0, 0, 0];
    for (const chart of out.charts) chartTypes[chart.type] = chartTypes[chart.type]! + 1;
    return {
      uvs,
      xref,
      indices: out.indices.slice(),
      charts: out.chartCount,
      chartTypes,
      wasmBytes: wasmBytesOf(atlas),
      ms: performance.now() - start,
    };
  } finally {
    atlas.destroy();
  }
}

export interface PackedParts extends Unwrapped {
  packMs: number;
  packWasmBytes: number;
}

/**
 * Places the islands of all parts in one texture and puts the mesh together again. Triangles
 * come out grouped by part; per-vertex data is carried over from `source`.
 */
export async function packParts(
  source: IndexedMesh,
  parts: readonly MeshPart[],
  islands: readonly PartIslands[],
  resolution: number,
): Promise<PackedParts> {
  const xatlas = await unwrapperReady();
  const start = performance.now();
  const atlas = xatlas.createAtlas();
  try {
    for (const part of islands) {
      const error = atlas.addUvMesh({ uvs: part.uvs, indices: part.indices });
      if (error !== 0) throw new Error(`Packing failed: ${xatlas.addMeshErrorString(error)}`);
    }
    atlas.computeCharts();
    atlas.packCharts({ resolution, padding: ISLAND_PADDING, bilinear: true, blockAlign: true });

    const sourceVertex: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    islands.forEach((part, p) => {
      const out = atlas.getMesh(p);
      const offset = sourceVertex.length;
      for (const vertex of out.vertices) {
        sourceVertex.push(parts[p]!.sourceVertex[part.xref[vertex.xref]!]!);
        uvs.push(vertex.uv[0] / atlas.width, vertex.uv[1] / atlas.height);
      }
      for (const index of out.indices) indices.push(offset + index);
    });
    const carry = (values: Float32Array | undefined, width: number): Float32Array | undefined => {
      if (!values) return undefined;
      const carried = new Float32Array(sourceVertex.length * width);
      sourceVertex.forEach((from, to) => {
        for (let k = 0; k < width; k++) carried[to * width + k] = values[from * width + k]!;
      });
      return carried;
    };
    return {
      mesh: {
        positions: carry(source.positions, 3)!,
        indices: Uint32Array.from(indices),
        normals: carry(source.normals, 3),
        cavity: carry(source.cavity, 1),
        occlusion: carry(source.occlusion, 1),
        uvs: Float32Array.from(uvs),
      },
      charts: atlas.chartCount,
      utilisation: atlas.getUtilization(0),
      packMs: performance.now() - start,
      packWasmBytes: wasmBytesOf(atlas),
    };
  } finally {
    atlas.destroy();
  }
}

/** Development option of the spike: how the table level is unwrapped instead of the normal way. */
export interface UnwrapVariant {
  /** Number of slabs a mesh is cut into; 0 keeps the normal unwrap (with `chart`, if given). */
  cut: number;
  /** Other settings for finding the islands; the normal ones where left out. */
  chart?: ChartOptions;
  /** Workers to find islands in. Fewer than slabs is fine: slabs queue up. */
  workers?: number;
}

/** Finds the islands of several meshes, in whatever order and on whatever threads it likes. */
export type IslandFinder = (
  meshes: IndexedMesh[],
  options: ChartOptions,
  texelsPerUnit: number,
  onProgress: (percent: number) => void,
) => Promise<PartIslands[]>;

/** One after the other on this thread: what Node and the tests use. */
export const findIslandsHere: IslandFinder = async (meshes, options, texelsPerUnit) => {
  const islands: PartIslands[] = [];
  for (const mesh of meshes) islands.push(await findIslands(mesh, options, texelsPerUnit));
  return islands;
};

/** What the spike wants to know about an unwrap, whichever way it ran. */
export interface UnwrapFigures {
  variant: UnwrapVariant;
  seamMm: number;
  splitMs?: number;
  /** Per slab: time inside its worker and that worker's WebAssembly memory. */
  partMs?: number[];
  partWasmBytes?: number[];
  /** From handing out the slabs until the last one is back: includes queueing and copying. */
  islandsMs?: number;
  packMs?: number;
  packWasmBytes?: number;
  chartTypes?: number[];
}

export async function unwrapInParts(
  source: IndexedMesh,
  resolution: number,
  variant: UnwrapVariant,
  finder: IslandFinder,
  onProgress: (percent: number) => void = () => {},
): Promise<Unwrapped & { figures: UnwrapFigures }> {
  const options = { maxCost: MAX_CHART_COST, ...variant.chart };
  if (variant.cut < 1) {
    const whole = await unwrap(source, resolution, onProgress, options);
    return { ...whole, figures: { variant, seamMm: seamLengthMm(whole.mesh) } };
  }
  const start = performance.now();
  const { groupOfTriangle, groupSizes } = cutIntoSlabs(source, variant.cut);
  const parts = splitByGroup(source, groupOfTriangle, groupSizes.length);
  const splitMs = performance.now() - start;
  const islands = await finder(
    parts.map((part) => part.mesh),
    options,
    sharedTexelsPerUnit(surfaceAreaMm2(source), resolution),
    onProgress,
  );
  const islandsMs = performance.now() - start - splitMs;
  const packed = await packParts(source, parts, islands, resolution);
  return {
    ...packed,
    figures: {
      variant,
      seamMm: seamLengthMm(packed.mesh),
      splitMs,
      partMs: islands.map((part) => part.ms),
      partWasmBytes: islands.map((part) => part.wasmBytes),
      islandsMs,
      packMs: packed.packMs,
      packWasmBytes: packed.packWasmBytes,
      chartTypes: islands.reduce(
        (sum, part) => sum.map((count, type) => count + part.chartTypes[type]!),
        [0, 0, 0, 0, 0],
      ),
    },
  };
}
