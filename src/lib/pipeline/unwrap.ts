import type { XAtlasModule } from 'xatlas-wasm';
import { generateBumpySheet } from './generate';
import { weldVertices, type IndexedMesh } from './mesh';
import { cutIntoSlabs, splitByGroup, type MeshPart } from './slabs';

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
  /** Number of slabs the mesh was unwrapped in; 1 when it was unwrapped whole. */
  slabs: number;
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
 * The table level is cut into this many slabs, unwrapped as meshes of one atlas. xatlas's time
 * grows roughly with the square of the mesh it is given, so eight slabs take a fraction of the
 * time of the whole (spike #34: 2.3–4.7 s instead of 7.5–85.6 s). The price is one seam along
 * every cut: 6–26 % more islands, 5–12 % more seam length. 16 slabs save one more second at
 * twice the seam cost.
 */
export const SLAB_COUNT = 8;

/**
 * Meshes with fewer triangles are unwrapped whole. Measured on five corpus minis reduced to
 * 500–15,000 triangles (Node, one core): below about 2,000 the slabs are no faster at all and
 * add 40–70 % islands; at 8,000 they save 0.15–0.4 s. Table levels have at least 15,000
 * triangles unless the file itself has fewer, so this only spares small files a seam cost.
 */
export const WHOLE_UNWRAP_BELOW = 8_000;

/**
 * Gives a mesh texture coordinates with xatlas. `resolution` is the texture size the
 * island padding is planned for; the coordinates themselves are normalised to 0..1.
 * A mesh of `WHOLE_UNWRAP_BELOW` triangles or more is cut into `SLAB_COUNT` slabs that are
 * handed to xatlas as meshes of one atlas: islands are found per slab and packed together, at
 * one scale. Triangles come back grouped by slab.
 */
export async function unwrap(
  source: IndexedMesh,
  resolution: number,
  /** Called with 0..100 as the unwrap advances. Finding the islands is nearly all of the time. */
  onProgress: (percent: number) => void = () => {},
): Promise<Unwrapped> {
  const parts = partsToUnwrap(source);
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
    for (const part of parts) {
      const error = atlas.addMesh({
        positions: part.mesh.positions,
        normals: part.mesh.normals,
        indices: part.mesh.indices,
        meshCountHint: parts.length,
      });
      if (error !== 0) throw new Error(`Unwrap failed: ${xatlas.addMeshErrorString(error)}`);
    }
    atlas.generate(
      { maxCost: MAX_CHART_COST },
      { resolution, padding: ISLAND_PADDING, bilinear: true, blockAlign: true },
    );

    let count = 0;
    let indexCount = 0;
    const outs = parts.map((_, p) => {
      const out = atlas.getMesh(p);
      count += out.vertexCount;
      indexCount += out.indices.length;
      return out;
    });
    const sourceVertex = new Uint32Array(count);
    const uvs = new Float32Array(count * 2);
    const indices = new Uint32Array(indexCount);
    let vertex = 0;
    let index = 0;
    outs.forEach((out, p) => {
      const offset = vertex;
      for (const { xref, uv } of out.vertices) {
        sourceVertex[vertex] = parts[p]!.sourceVertex[xref]!;
        uvs[vertex * 2] = uv[0] / atlas.width;
        uvs[vertex * 2 + 1] = uv[1] / atlas.height;
        vertex++;
      }
      for (const local of out.indices) indices[index++] = offset + local;
    });
    const carry = (values: Float32Array | undefined, width: number): Float32Array | undefined => {
      if (!values) return undefined;
      const carried = new Float32Array(count * width);
      for (let v = 0; v < count; v++) {
        const from = sourceVertex[v]! * width;
        for (let k = 0; k < width; k++) carried[v * width + k] = values[from + k]!;
      }
      return carried;
    };
    return {
      mesh: {
        positions: carry(source.positions, 3)!,
        indices,
        normals: carry(source.normals, 3),
        cavity: carry(source.cavity, 1),
        occlusion: carry(source.occlusion, 1),
        uvs,
      },
      charts: atlas.chartCount,
      utilisation: atlas.getUtilization(0),
      slabs: parts.length,
    };
  } finally {
    atlas.destroy();
  }
}

/** The slabs a mesh is unwrapped in: the whole mesh as one when it is too small to cut. */
function partsToUnwrap(source: IndexedMesh): Pick<MeshPart, 'mesh' | 'sourceVertex'>[] {
  if (source.indices.length / 3 < WHOLE_UNWRAP_BELOW) {
    const vertices = source.positions.length / 3;
    return [{ mesh: source, sourceVertex: Uint32Array.from({ length: vertices }, (_, v) => v) }];
  }
  const { groupOfTriangle, groupSizes } = cutIntoSlabs(source, SLAB_COUNT);
  return splitByGroup(source, groupOfTriangle, groupSizes.length);
}
