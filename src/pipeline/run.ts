import type { IndexedMesh } from './mesh';
import { weldVertices } from './mesh';
import { detectUpAxis, orientAndPlace, type UpAxis, type UpDetection } from './orient';
import { buildLods, simplifierReady, type Lod } from './simplify';
import { detectStlFormat, readStlTriangles, type StlFormat } from './stl';

export const STEPS = ['read', 'weld', 'orient', 'simplify'] as const;
export type StepName = (typeof STEPS)[number];

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
  targetTriangles: number;
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

export interface ConversionResult {
  /** The welded, oriented source mesh at full detail. */
  mesh: IndexedMesh;
  /** Reduced versions, highest detail first. */
  lods: Lod[];
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
): Promise<ConversionResult> {
  // Compiling the WebAssembly simplifier is a one-off cost and not part of any step.
  await simplifierReady();

  const timings: StepTiming[] = [];
  let peakBufferBytes = 0;
  let peakHeapBytes = heapBytes();

  const run = <T>(step: StepName, work: () => T, liveBytes: (result: T) => number): T => {
    onProgress({ step, percent: Math.round((timings.length / STEPS.length) * 100) });
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
  const lods = run(
    'simplify',
    () => buildLods(placed.mesh),
    // The simplifier copies the mesh into WebAssembly memory while it works.
    (l) => meshBytes(placed.mesh) * 2 + l.reduce((sum, lod) => sum + meshBytes(lod.mesh), 0),
  );

  return {
    mesh: placed.mesh,
    lods,
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
        targetTriangles: lod.targetTriangles,
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
