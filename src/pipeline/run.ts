import { bake, type BakedMaps } from './bake';
import type { IndexedMesh } from './mesh';
import { computeVertexNormals, weldVertices } from './mesh';
import { detectUpAxis, orientAndPlace, type UpAxis, type UpDetection } from './orient';
import { shade } from './shade';
import { chainLods, LOD_SPECS, simplifierReady, simplifyToSpec, type Lod } from './simplify';
import { unwrap } from './unwrap';
import { detectStlFormat, readStlTriangles, type StlFormat } from './stl';

export const STEPS = ['read', 'weld', 'orient', 'simplify', 'shade', 'levels'] as const;
/** Extra steps when baked detail maps are requested (spike, issue #10). */
export const BAKE_STEPS = ['unwrap', 'bake'] as const;
export type StepName = (typeof STEPS)[number] | (typeof BAKE_STEPS)[number];

/** Index into `ConversionResult.lods` of the level that gets baked maps: the table level. */
export const BAKED_LEVEL = 1;

export interface Progress {
  /** The step that is about to run. */
  step: StepName;
  /** Share of steps already finished, 0–100. */
  percent: number;
}

export interface StepTiming {
  step: StepName;
  ms: number;
}

export interface LodStats {
  name: Lod['name'];
  decidedBy: Lod['decidedBy'];
  triangles: number;
  vertices: number;
  errorMm: number;
}

export interface ConversionStats {
  format: StlFormat;
  sourceTriangles: number;
  triangles: number;
  vertices: number;
  degenerateTriangles: number;
  sizeMm: [number, number, number];
  /** Which way was taken as up in the file, and how that was decided. */
  up: UpAxis;
  upMethod: UpDetection['method'] | 'manual';
  lods: LodStats[];
  timings: StepTiming[];
  totalMs: number;
  /** Largest sum of pipeline buffers alive at once: a lower bound for the memory a conversion needs. */
  peakBufferBytes: number;
  /** Largest JS heap size seen between steps. Null where the browser does not expose it. */
  peakHeapBytes: number | null;
}

export interface Baked {
  /** The table level with texture coordinates; more vertices than the level itself, because UV islands split them. */
  mesh: IndexedMesh;
  maps: BakedMaps;
  charts: number;
  utilisation: number;
}

export interface ConversionResult {
  /** The welded, oriented source mesh at full detail. */
  mesh: IndexedMesh;
  /** Reduced versions, highest detail first. */
  lods: Lod[];
  /** Only when baking was requested. */
  baked?: Baked;
  stats: ConversionStats;
}

function heapBytes(): number | null {
  // Non-standard and Chromium-only; most browsers do not expose it inside workers.
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

const meshBytes = (mesh: IndexedMesh): number =>
  mesh.positions.byteLength + mesh.indices.byteLength;

/** Runs every pipeline step on one STL. DOM-free, so it works in a worker and in Node. */
export async function runPipeline(
  stl: ArrayBuffer,
  onProgress: (progress: Progress) => void = () => {},
  /** Overrides up-axis detection, for when the guess is wrong. */
  forcedUp: UpAxis | null = null,
  /** Texture size for baked detail maps on the table level; 0 skips unwrapping and baking. */
  bakeResolution = 0,
): Promise<ConversionResult> {
  const stepCount = STEPS.length + (bakeResolution > 0 ? BAKE_STEPS.length : 0);
  // Compiling the WebAssembly simplifier is a one-off cost and not part of any step.
  await simplifierReady();

  const timings: StepTiming[] = [];
  let peakBufferBytes = 0;
  let peakHeapBytes = heapBytes();

  const run = <T>(step: StepName, work: () => T, liveBytes: (result: T) => number): T => {
    onProgress({ step, percent: Math.round((timings.length / stepCount) * 100) });
    const start = performance.now();
    const result = work();
    timings.push({ step, ms: performance.now() - start });
    peakBufferBytes = Math.max(peakBufferBytes, liveBytes(result));
    const heap = heapBytes();
    if (heap !== null) peakHeapBytes = Math.max(peakHeapBytes ?? 0, heap);
    return result;
  };

  const format = detectStlFormat(stl);
  const soup = run(
    'read',
    () => readStlTriangles(stl),
    (s) => stl.byteLength + s.byteLength,
  );
  // While welding, the soup, the hash table and the per-corner scratch arrays coexist:
  // roughly three more soup-sized allocations.
  const welded = run(
    'weld',
    () => weldVertices(soup),
    (w) => stl.byteLength + soup.byteLength * 4 + meshBytes(w.mesh),
  );
  const placed = run(
    'orient',
    () => {
      const detection = detectUpAxis(welded.mesh);
      const up = forcedUp ?? detection.up;
      return { ...orientAndPlace(welded.mesh, up), up, detection };
    },
    (p) => stl.byteLength + soup.byteLength + meshBytes(welded.mesh) + p.mesh.positions.byteLength,
  );
  const close = run(
    'simplify',
    () => {
      // Every LOD keeps the shading of the full sculpt at the vertices that survive.
      placed.mesh.normals = computeVertexNormals(placed.mesh);
      return simplifyToSpec(placed.mesh, LOD_SPECS[0]!);
    },
    // The simplifier copies the mesh into WebAssembly memory while it works.
    (lod) => meshBytes(placed.mesh) * 2 + meshBytes(lod.mesh),
  );
  // Shade the highest level only: the lower ones are made of its vertices and inherit the result.
  run(
    'shade',
    () => shade(close.mesh),
    // The occlusion grid is at most 160 voxels a side, one byte each.
    () => meshBytes(placed.mesh) + meshBytes(close.mesh) + 160 ** 3,
  );
  const lods = run(
    'levels',
    () => [close, ...chainLods(close, LOD_SPECS.slice(1))],
    (l) => meshBytes(placed.mesh) + l.reduce((sum, lod) => sum + meshBytes(lod.mesh), 0),
  );

  let baked: Baked | undefined;
  if (bakeResolution > 0) {
    // xatlas is asynchronous to load, so this step is timed by hand.
    onProgress({ step: 'unwrap', percent: Math.round((timings.length / stepCount) * 100) });
    const start = performance.now();
    const unwrapped = await unwrap(lods[BAKED_LEVEL]!.mesh, bakeResolution);
    timings.push({ step: 'unwrap', ms: performance.now() - start });
    const maps = run(
      'bake',
      () => bake(unwrapped.mesh, placed.mesh, bakeResolution),
      // Normal map (4 bytes a texel), cavity and occlusion (1 each), plus the sculpt's grid.
      (m) => meshBytes(placed.mesh) * 2 + m.resolution ** 2 * 6,
    );
    baked = {
      mesh: unwrapped.mesh,
      maps,
      charts: unwrapped.charts,
      utilisation: unwrapped.utilisation,
    };
  }

  return {
    mesh: placed.mesh,
    lods,
    baked,
    stats: {
      format,
      sourceTriangles: soup.length / 9,
      triangles: placed.mesh.indices.length / 3,
      vertices: placed.mesh.positions.length / 3,
      degenerateTriangles: welded.degenerateTriangles,
      sizeMm: placed.sizeMm,
      up: placed.up,
      upMethod: forcedUp ? 'manual' : placed.detection.method,
      lods: lods.map((lod) => ({
        name: lod.name,
        decidedBy: lod.decidedBy,
        triangles: lod.triangles,
        vertices: lod.mesh.positions.length / 3,
        errorMm: lod.errorMm,
      })),
      timings,
      totalMs: timings.reduce((sum, timing) => sum + timing.ms, 0),
      peakBufferBytes,
      peakHeapBytes,
    },
  };
}
