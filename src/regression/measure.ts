import { generateBumpySheet } from '../pipeline/generate';
import { encodeGlb, glbEncoderReady } from '../pipeline/glb';
import { DEFAULT_LOOK } from '../pipeline/look';
import { runPipeline, type ConversionStats, type LodStats } from '../pipeline/run';
import { encodeBinaryStl } from '../pipeline/stl';
import { generateBoulder, generateFigure, generateSwarm, toYUp } from './shapes';

/** One generated mesh the baseline watches. */
export interface RegressionCase {
  name: string;
  soup: () => Float32Array;
  /** Texture size for baked detail maps; 0 for none. Unwrapping is slow, so only one case bakes. */
  bake: number;
}

/** Bumpy-sheet size below the close level's floor, so the "small source" path stays covered. */
const SHEET_QUADS_PER_SIDE = 150;
const BAKE_RESOLUTION = 512;

export const REGRESSION_CASES: readonly RegressionCase[] = [
  { name: 'sheet', soup: () => generateBumpySheet(SHEET_QUADS_PER_SIDE), bake: 0 },
  { name: 'figure', soup: () => generateFigure(true), bake: BAKE_RESOLUTION },
  { name: 'figure-y-up', soup: () => toYUp(generateFigure(true)), bake: 0 },
  { name: 'figure-no-base', soup: () => generateFigure(false), bake: 0 },
  { name: 'swarm', soup: generateSwarm, bake: 0 },
  { name: 'boulder', soup: generateBoulder, bake: 0 },
];

export interface LevelFigures extends LodStats {
  /** Size of the exported file, plain and compressed. */
  glbBytes: number;
  compactGlbBytes: number;
}

/**
 * What the baseline records for one mesh. No times: they depend on the machine, and CI
 * runners prove nothing about speed. Times live in the corpus results (scripts/corpus.mjs).
 */
export interface CaseFigures extends Pick<
  ConversionStats,
  | 'sourceTriangles'
  | 'triangles'
  | 'vertices'
  | 'degenerateTriangles'
  | 'sizeMm'
  | 'up'
  | 'upMethod'
> {
  levels: LevelFigures[];
  baked?: {
    resolution: number;
    vertices: number;
    charts: number;
    utilisation: number;
    coverage: number;
    fallback: number;
  };
}

export type Figures = Record<string, CaseFigures>;

/** Converts one generated mesh the way the worker does and collects its figures. */
export async function measureCase(testCase: RegressionCase): Promise<CaseFigures> {
  await glbEncoderReady();
  const stl = encodeBinaryStl(testCase.soup());
  const { lods, baked, stats } = await runPipeline(stl, { bake: testCase.bake });
  const glb = (level: number, compact: boolean): number =>
    encodeGlb(lods[level]!.mesh, { name: testCase.name, look: DEFAULT_LOOK, compact }).byteLength;
  return {
    sourceTriangles: stats.sourceTriangles,
    triangles: stats.triangles,
    vertices: stats.vertices,
    degenerateTriangles: stats.degenerateTriangles,
    sizeMm: stats.sizeMm,
    up: stats.up,
    upMethod: stats.upMethod,
    levels: stats.lods.map((lod, level) => ({
      ...lod,
      glbBytes: glb(level, false),
      compactGlbBytes: glb(level, true),
    })),
    baked: baked && {
      resolution: baked.maps.resolution,
      vertices: baked.mesh.positions.length / 3,
      charts: baked.charts,
      utilisation: baked.utilisation,
      coverage: baked.maps.coverage,
      fallback: baked.maps.fallback,
    },
  };
}
