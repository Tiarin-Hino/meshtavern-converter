import type { ChartOptions, XAtlasModule } from 'xatlas-wasm';
import { generateBumpySheet } from './generate';
import { weldVertices, type IndexedMesh } from './mesh';

/** Texels left empty around every UV island, so neighbouring islands do not bleed into each other. */
export const ISLAND_PADDING = 3;

/**
 * How much distortion an island may accumulate before xatlas starts a new one (its default
 * is 2). Measured on a 60k-triangle detailed sculpt: 8 makes finding the islands about 40 %
 * faster and gives slightly fewer of them; going higher changes nothing.
 */
export const MAX_CHART_COST = 8;

export interface Unwrapped {
  /**
   * The same surface with texture coordinates. Vertices on island borders are duplicated,
   * so this mesh has more vertices than its source; all per-vertex data is carried over.
   */
  mesh: IndexedMesh;
  /** Number of UV islands. Organic sculpts give thousands. */
  charts: number;
  /** Share of the texture that is covered by islands, 0..1. */
  utilisation: number;
}

let module: Promise<XAtlasModule> | null = null;

/**
 * Resolves once the WebAssembly unwrapper is compiled. Imported on first use only, so
 * conversions without baking never download it (about 290 KB).
 */
export const unwrapperReady = (): Promise<XAtlasModule> =>
  (module ??= import('xatlas-wasm').then(async (imported) => {
    const xatlas = await imported.default();
    warmUp(xatlas);
    return xatlas;
  }));

/**
 * The first unwrap a fresh WebAssembly instance runs is two to three times slower than
 * later ones (measured: 111 s cold against 40 s warm for the same mesh). A small throwaway
 * unwrap, well under a second, takes that penalty instead of the user's mini.
 */
function warmUp(xatlas: XAtlasModule): void {
  const sheet = weldVertices(generateBumpySheet(70)).mesh;
  const atlas = xatlas.createAtlas();
  try {
    atlas.addMesh({ positions: sheet.positions, indices: sheet.indices });
    atlas.generate({}, { resolution: 512 });
  } finally {
    atlas.destroy();
  }
}

/**
 * Gives a mesh texture coordinates with xatlas. `resolution` is the texture size the
 * island padding is planned for; the coordinates themselves are normalised to 0..1.
 */
export async function unwrap(
  source: IndexedMesh,
  resolution: number,
  /** Called with 0..100 as the unwrap advances. Finding the islands is nearly all of the time. */
  onProgress: (percent: number) => void = () => {},
  /** Spike #34 only: other settings for finding the islands. */
  chartOptions: ChartOptions = { maxCost: MAX_CHART_COST },
): Promise<Unwrapped> {
  const xatlas = await unwrapperReady();
  const atlas = xatlas.createAtlas();
  try {
    let reported = -1;
    atlas.setProgressCallback((category, progress) => {
      // Stages: add mesh, compute charts, pack charts, build output. Only the second is slow.
      const percent = category < 1 ? 0 : category > 1 ? 100 : Math.round(progress);
      if (percent >= reported + 2 || (percent === 100 && reported !== 100)) {
        reported = percent;
        onProgress(percent);
      }
      return true;
    });
    const error = atlas.addMesh({
      positions: source.positions,
      normals: source.normals,
      indices: source.indices,
    });
    if (error !== 0) throw new Error(`Unwrap failed: ${xatlas.addMeshErrorString(error)}`);
    atlas.generate(chartOptions, {
      resolution,
      padding: ISLAND_PADDING,
      bilinear: true,
      blockAlign: true,
    });

    const out = atlas.getMesh(0);
    const count = out.vertexCount;
    const carry = (values: Float32Array | undefined, width: number): Float32Array | undefined => {
      if (!values) return undefined;
      const carried = new Float32Array(count * width);
      for (let v = 0; v < count; v++) {
        const from = out.vertices[v]!.xref * width;
        for (let k = 0; k < width; k++) carried[v * width + k] = values[from + k]!;
      }
      return carried;
    };
    const uvs = new Float32Array(count * 2);
    for (let v = 0; v < count; v++) {
      uvs[v * 2] = out.vertices[v]!.uv[0] / atlas.width;
      uvs[v * 2 + 1] = out.vertices[v]!.uv[1] / atlas.height;
    }
    return {
      mesh: {
        positions: carry(source.positions, 3)!,
        indices: out.indices.slice(),
        normals: carry(source.normals, 3),
        cavity: carry(source.cavity, 1),
        occlusion: carry(source.occlusion, 1),
        uvs,
      },
      charts: atlas.chartCount,
      utilisation: atlas.getUtilization(0),
    };
  } finally {
    atlas.destroy();
  }
}
