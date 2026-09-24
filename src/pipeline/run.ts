import { bake, type BakedMaps } from './bake';
import { detailResolutionFor, surfaceAreaMm2 } from './bake-policy';
import { compressDetail, DETAIL_EFFORT } from './compress';
import type { IndexedMesh } from './mesh';
import { computeVertexNormals, dropInvalidTriangles, weldVertices } from './mesh';
import { checkFits } from './memory';
import { detectUpAxis, orientAndPlace, type UpAxis, type UpDetection } from './orient';
import { shade } from './shade';
import { sizeMini, type Sizing, type SizingOptions } from './size';
import { chainLods, LOD_SPECS, simplifierReady, simplifyToSpec, type Lod } from './simplify';
import { unwrap } from './unwrap';
import { ConversionProblem, isOutOfMemory } from './problems';
import { readStlTriangles, sniffStl, type StlFormat } from './stl';

export const STEPS = ['read', 'weld', 'orient', 'size', 'simplify', 'shade', 'levels'] as const;
/** The steps that turn the table level into a baked mini. They run unless baking is switched off. */
export const BAKE_STEPS = ['unwrap', 'bake', 'compress'] as const;
export type BakeStepName = (typeof BAKE_STEPS)[number];
export type StepName = (typeof STEPS)[number] | BakeStepName;

/** Index into `ConversionResult.lods` of the level that gets baked maps: the table level. */
export const BAKED_LEVEL = 1;

export interface Progress {
  /** The step that is about to run. */
  step: StepName;
  /** Share of steps already finished, 0–100. */
  percent: number;
  /** For long steps that can tell: how far this step itself is, 0–100. */
  stepPercent?: number;
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
  /** Dropped: corners welded together, or no area. */
  degenerateTriangles: number;
  /** Dropped: the same three corners as a triangle kept before. */
  duplicateTriangles: number;
  /** Dropped: a coordinate that is not a number or infinite. */
  invalidTriangles: number;
  /** Width, height and depth in scene mm, after any change of units or scale. */
  sizeMm: [number, number, number];
  /** Units, base, creature size and footprint: what the table needs to place the mini. */
  sizing: Sizing;
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
  /** Set when baking was wanted but the mini keeps the per-vertex look instead, and why. */
  bakeSkipped: BakeSkipped | null;
}

export type BakeSkipped =
  /** The texture the size policy chose is larger than the device can hold. */
  | { reason: 'device'; resolution: number; maxTextureSize: number }
  /** 'transcode' is the page's part: turning the KTX2 file into a GPU texture. */
  | { reason: 'failed'; step: BakeStepName | 'transcode'; message: string };

/** Figures of a bake, without the texture itself. */
export type BakeFigures = Omit<BakedMaps, 'detail'>;

export interface Baked {
  /** The table level with texture coordinates; more vertices than the level itself, because UV islands split them. */
  mesh: IndexedMesh;
  maps: BakeFigures;
  /** The detail texture as a KTX2 file (UASTC + Zstandard): the only copy that is kept. */
  ktx2: Uint8Array | null;
  /** Development only (compression switched off): the raw RGBA texture. Null otherwise. */
  detail: Uint8Array | null;
  /** Surface area of the table level, which decides the texture size when that is left to the policy. */
  tableAreaMm2: number;
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
  /** The same object as `stats.sizing`. */
  sizing: Sizing;
  stats: ConversionStats;
}

function heapBytes(): number | null {
  // Non-standard and Chromium-only; most browsers do not expose it inside workers.
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

const meshBytes = (mesh: IndexedMesh): number =>
  mesh.positions.byteLength + mesh.indices.byteLength;

export interface PipelineOptions {
  onProgress?: (progress: Progress) => void;
  /** Overrides up-axis detection, for when the guess is wrong. */
  forcedUp?: UpAxis | null;
  /** Units, size, scale and plain base as the user chose them; the rest is guessed. */
  sizing?: SizingOptions;
  /**
   * Texture size for baked detail maps on the table level: 'auto' (the default) picks one
   * from the mini's surface area (see bake-policy.ts). A size in texels, or 0 to skip
   * baking, is for development.
   */
  bake?: number | 'auto';
  /** UASTC effort for the KTX2 file. Null keeps the raw texture instead: development only. */
  compress?: number | null;
  /** Largest texture the device can hold, when known. A mini that needs more keeps the per-vertex look. */
  maxTextureSize?: number;
  /**
   * Memory the conversion may use, from what the device reports (see memory.ts). A file
   * whose estimate is larger is refused before anything is read. Unset: no check.
   */
  memoryBudgetBytes?: number;
}

/**
 * Runs every pipeline step on one STL. DOM-free, so it works in a worker and in Node.
 * A file that cannot become a mini throws a `ConversionProblem` (see problems.ts).
 */
export async function runPipeline(
  stl: ArrayBuffer,
  {
    onProgress = () => {},
    forcedUp = null,
    sizing: sizingOptions = {},
    bake: bakeRequest = 'auto',
    compress = DETAIL_EFFORT,
    maxTextureSize,
    memoryBudgetBytes,
  }: PipelineOptions = {},
): Promise<ConversionResult> {
  const format = sniffStl(new Uint8Array(stl), stl.byteLength);
  if (memoryBudgetBytes !== undefined) checkFits(stl.byteLength, format, memoryBudgetBytes);

  const bakeSteps = BAKE_STEPS.filter((step) => step !== 'compress' || compress !== null);
  const stepCount = STEPS.length + (bakeRequest !== 0 ? bakeSteps.length : 0);
  // Compiling the WebAssembly simplifier is a one-off cost and not part of any step.
  await simplifierReady();

  const timings: StepTiming[] = [];
  let peakBufferBytes = 0;
  let peakHeapBytes = heapBytes();

  /** Announces a step; the function it returns records the step's time and memory when called. */
  const begin = (step: StepName): (<T>(result: T, liveBytes: number) => T) => {
    onProgress({ step, percent: Math.round((timings.length / stepCount) * 100) });
    const start = performance.now();
    return (result, liveBytes) => {
      timings.push({ step, ms: performance.now() - start });
      peakBufferBytes = Math.max(peakBufferBytes, liveBytes);
      const heap = heapBytes();
      if (heap !== null) peakHeapBytes = Math.max(peakHeapBytes ?? 0, heap);
      return result;
    };
  };
  const run = <T>(step: StepName, work: () => T, liveBytes: (result: T) => number): T => {
    const end = begin(step);
    const result = work();
    return end(result, liveBytes(result));
  };

  const { soup, invalidTriangles } = run(
    'read',
    () => dropInvalidTriangles(readStlTriangles(stl)),
    (s) => stl.byteLength + s.soup.byteLength * 2,
  );
  // While welding, the soup, the hash table and the per-corner scratch arrays coexist:
  // roughly three more soup-sized allocations.
  const welded = run(
    'weld',
    () => weldVertices(soup),
    (w) => stl.byteLength + soup.byteLength * 4 + meshBytes(w.mesh),
  );
  if (welded.mesh.indices.length === 0) {
    throw new ConversionProblem(
      'no-surface',
      `${soup.length / 9 + invalidTriangles} triangles, none usable`,
    );
  }
  const oriented = run(
    'orient',
    () => {
      const detection = detectUpAxis(welded.mesh);
      const up = forcedUp ?? detection.up;
      return { ...orientAndPlace(welded.mesh, up), up, detection };
    },
    (p) => stl.byteLength + soup.byteLength + meshBytes(welded.mesh) + p.mesh.positions.byteLength,
  );
  const placed = run(
    'size',
    () => sizeMini(oriented, sizingOptions),
    // A scaled mesh is a copy; the oriented one is dropped once this step is done.
    (s) =>
      stl.byteLength +
      meshBytes(oriented.mesh) +
      (s.mesh === oriented.mesh ? 0 : meshBytes(s.mesh)),
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
  let bakeSkipped: BakeSkipped | null = null;
  if (bakeRequest !== 0) {
    const table = lods[BAKED_LEVEL]!.mesh;
    const tableAreaMm2 = surfaceAreaMm2(table);
    const resolution = bakeRequest === 'auto' ? detailResolutionFor(tableAreaMm2) : bakeRequest;
    if (maxTextureSize !== undefined && resolution > maxTextureSize) {
      bakeSkipped = { reason: 'device', resolution, maxTextureSize };
    } else {
      // A mini with the per-vertex look is better than no mini: a failing step is not an error.
      let step: BakeStepName = 'unwrap';
      try {
        const overall = Math.round((timings.length / stepCount) * 100);
        const unwrapEnd = begin('unwrap');
        const unwrapProgress = (stepPercent: number): void =>
          onProgress({ step: 'unwrap', percent: overall, stepPercent });
        const unwrapped = unwrapEnd(
          await unwrap(table, resolution, unwrapProgress),
          meshBytes(placed.mesh) + meshBytes(table) * 3,
        );
        step = 'bake';
        const { detail, ...maps } = run(
          'bake',
          () => bake(unwrapped.mesh, placed.mesh, resolution),
          // The detail texture (4 bytes a texel), the rasteriser's mask (1) and the search tree.
          (m) => meshBytes(placed.mesh) + m.resolution ** 2 * 5 + m.bvhBytes,
        );
        let ktx2: Uint8Array | null = null;
        if (compress !== null) {
          step = 'compress';
          const compressEnd = begin('compress');
          ktx2 = compressEnd(
            await compressDetail(detail, resolution, compress),
            // The texture, the encoder's copy of it and its output buffer with mipmaps.
            meshBytes(placed.mesh) + resolution ** 2 * 14,
          );
        }
        baked = {
          tableAreaMm2,
          mesh: unwrapped.mesh,
          maps,
          ktx2,
          // Once compressed, the raw texture is dropped here and never leaves the pipeline.
          detail: ktx2 ? null : detail,
          charts: unwrapped.charts,
          utilisation: unwrapped.utilisation,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Out of memory is not a baking problem: the worker must end it and start afresh.
        if (isOutOfMemory(error)) throw new ConversionProblem('out-of-memory', message);
        bakeSkipped = { reason: 'failed', step, message };
      }
    }
  }

  return {
    mesh: placed.mesh,
    lods,
    baked,
    sizing: placed.sizing,
    stats: {
      format,
      sourceTriangles: soup.length / 9 + invalidTriangles,
      triangles: placed.mesh.indices.length / 3,
      vertices: placed.mesh.positions.length / 3,
      degenerateTriangles: welded.degenerateTriangles,
      duplicateTriangles: welded.duplicateTriangles,
      invalidTriangles,
      sizeMm: placed.sizeMm,
      sizing: placed.sizing,
      up: oriented.up,
      upMethod: forcedUp ? 'manual' : oriented.detection.method,
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
      bakeSkipped,
    },
  };
}
