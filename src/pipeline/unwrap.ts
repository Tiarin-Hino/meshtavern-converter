import type { XAtlasModule } from 'xatlas-wasm';
import type { IndexedMesh } from './mesh';

/** Texels left empty around every UV island, so neighbouring islands do not bleed into each other. */
const ISLAND_PADDING = 3;

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
  (module ??= import('xatlas-wasm').then((xatlas) => xatlas.default()));

/**
 * Gives a mesh texture coordinates with xatlas. `resolution` is the texture size the
 * island padding is planned for; the coordinates themselves are normalised to 0..1.
 */
export async function unwrap(source: IndexedMesh, resolution: number): Promise<Unwrapped> {
  const xatlas = await unwrapperReady();
  const atlas = xatlas.createAtlas();
  try {
    const error = atlas.addMesh({
      positions: source.positions,
      normals: source.normals,
      indices: source.indices,
    });
    if (error !== 0) throw new Error(`Unwrap failed: ${xatlas.addMeshErrorString(error)}`);
    atlas.generate({}, { resolution, padding: ISLAND_PADDING, bilinear: true, blockAlign: true });

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
