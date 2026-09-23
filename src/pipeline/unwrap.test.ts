import { beforeAll, describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';
import { shade } from './shade';
import { cutIntoSlabs } from './slabs';
import { SLAB_COUNT, unwrap, WHOLE_UNWRAP_BELOW, type Unwrapped } from './unwrap';

const RESOLUTION = 512;

/** A shaded bumpy sheet: every vertex has a normal, a cavity and an occlusion value. */
function shadedSheet(quadsPerSide: number): IndexedMesh {
  const mesh = weldVertices(generateBumpySheet(quadsPerSide)).mesh;
  mesh.normals = computeVertexNormals(mesh);
  shade(mesh);
  return mesh;
}

/** For every vertex of the unwrapped mesh, the source vertex at the same place. */
function sourceVertexOf(source: IndexedMesh, unwrapped: IndexedMesh): Uint32Array {
  const key = (p: Float32Array, v: number): string => `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
  const byPlace = new Map<string, number>();
  for (let v = 0; v < source.positions.length / 3; v++) byPlace.set(key(source.positions, v), v);
  return Uint32Array.from({ length: unwrapped.positions.length / 3 }, (_, v) => {
    const from = byPlace.get(key(unwrapped.positions, v));
    if (from === undefined) throw new Error(`vertex ${v} is nowhere in the source`);
    return from;
  });
}

/** A triangle as its source vertices, turned so the lowest comes first: winding is kept. */
function triangleKeys(indices: Uint32Array, vertexOf: (v: number) => number): string[] {
  const keys: string[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [0, 1, 2].map((c) => vertexOf(indices[t + c]!));
    const first = corners.indexOf(Math.min(...corners));
    keys.push([0, 1, 2].map((c) => corners[(first + c) % 3]).join(','));
  }
  return keys.sort();
}

/** Texture area per mm² of surface over a run of triangles. */
function texelDensity(mesh: IndexedMesh, from: number, to: number): number {
  const { positions: p, uvs: u, indices } = mesh;
  let uvArea = 0;
  let area = 0;
  for (let t = from; t < to; t++) {
    const [a, b, c] = [0, 1, 2].map((corner) => indices[t * 3 + corner]!) as [
      number,
      number,
      number,
    ];
    uvArea += Math.abs(
      (u![b * 2]! - u![a * 2]!) * (u![c * 2 + 1]! - u![a * 2 + 1]!) -
        (u![c * 2]! - u![a * 2]!) * (u![b * 2 + 1]! - u![a * 2 + 1]!),
    );
    const e1 = [0, 1, 2].map((k) => p[b * 3 + k]! - p[a * 3 + k]!) as [number, number, number];
    const e2 = [0, 1, 2].map((k) => p[c * 3 + k]! - p[a * 3 + k]!) as [number, number, number];
    area += Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    );
  }
  return uvArea / area;
}

describe('unwrap in slabs', () => {
  // 66 × 66 quads: 8,712 triangles, just above the size that gets cut.
  let source: IndexedMesh;
  let result: Unwrapped;
  beforeAll(async () => {
    source = shadedSheet(66);
    result = await unwrap(source, RESOLUTION);
  }, 60_000);

  it('cuts a mesh at or above the threshold into the named number of slabs', () => {
    expect(source.indices.length / 3).toBeGreaterThanOrEqual(WHOLE_UNWRAP_BELOW);
    expect(result.slabs).toBe(SLAB_COUNT);
    expect(result.charts).toBeGreaterThanOrEqual(SLAB_COUNT);
  });

  it('gives back every triangle exactly once, with its winding', () => {
    const vertexOf = sourceVertexOf(source, result.mesh);
    expect(triangleKeys(result.mesh.indices, (v) => vertexOf[v]!)).toEqual(
      triangleKeys(source.indices, (v) => v),
    );
  });

  it('carries the per-vertex data over', () => {
    const vertexOf = sourceVertexOf(source, result.mesh);
    const { normals, cavity, occlusion } = result.mesh;
    expect(normals!.length).toBe(result.mesh.positions.length);
    vertexOf.forEach((from, v) => {
      for (let k = 0; k < 3; k++) expect(normals![v * 3 + k]).toBe(source.normals![from * 3 + k]);
      expect(cavity![v]).toBe(source.cavity![from]);
      expect(occlusion![v]).toBe(source.occlusion![from]);
    });
  });

  it('keeps every texture coordinate inside the texture', () => {
    const { uvs, positions } = result.mesh;
    expect(uvs!.length).toBe((positions.length / 3) * 2);
    expect(Math.min(...uvs!)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uvs!)).toBeLessThanOrEqual(1);
  });

  it('gives every slab the same texture area per mm²', () => {
    // Triangles come back grouped by slab, in the order of the cut.
    const { groupSizes } = cutIntoSlabs(source, SLAB_COUNT);
    let from = 0;
    const densities = groupSizes.map((size) => texelDensity(result.mesh, from, (from += size)));
    const mean = densities.reduce((sum, d) => sum + d, 0) / densities.length;
    for (const density of densities) {
      expect(density / mean).toBeGreaterThan(0.9);
      expect(density / mean).toBeLessThan(1.1);
    }
  });
});

describe('unwrap of a small mesh', () => {
  it('unwraps a mesh below the threshold whole', async () => {
    const source = shadedSheet(40);
    expect(source.indices.length / 3).toBeLessThan(WHOLE_UNWRAP_BELOW);
    const { mesh, slabs } = await unwrap(source, RESOLUTION);
    expect(slabs).toBe(1);
    const vertexOf = sourceVertexOf(source, mesh);
    expect(triangleKeys(mesh.indices, (v) => vertexOf[v]!)).toEqual(
      triangleKeys(source.indices, (v) => v),
    );
  });
});
