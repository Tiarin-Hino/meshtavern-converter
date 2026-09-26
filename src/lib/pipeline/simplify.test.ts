import { beforeAll, describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';
import { buildLods, simplifierReady, simplifyToSpec, type LodSpec } from './simplify';

// 200 × 200 quads: 80,000 triangles, 50 mm wide, smooth bumps 4 mm high. It needs about
// 3k triangles to stay within 0.2 mm, 16k for 0.05 mm and 49k for 0.02 mm.
const sheet: IndexedMesh = weldVertices(generateBumpySheet(200)).mesh;
sheet.normals = computeVertexNormals(sheet);

const spec = (maxErrorMm: number, minTriangles: number, maxTriangles: number): LodSpec => ({
  name: 'table',
  maxErrorMm,
  minTriangles,
  maxTriangles,
});

beforeAll(simplifierReady);

describe('simplifyToSpec', () => {
  it('goes down to the floor when the error limit is generous', () => {
    const lod = simplifyToSpec(sheet, spec(1, 2000, 10_000));
    expect(lod.decidedBy).toBe('floor');
    expect(lod.triangles).toBeLessThanOrEqual(2000);
    expect(lod.triangles).toBeGreaterThan(1900);
    expect(lod.errorMm).toBeLessThan(1);
  });

  it('stops above the floor when the error limit is reached first', () => {
    const lod = simplifyToSpec(sheet, spec(0.05, 500, 60_000));
    expect(lod.decidedBy).toBe('error');
    expect(lod.triangles).toBeGreaterThan(10_000);
    expect(lod.triangles).toBeLessThan(25_000);
    expect(lod.errorMm).toBeLessThanOrEqual(0.05);
  });

  it('never exceeds the cap, even if that breaks the error limit', () => {
    const lod = simplifyToSpec(sheet, spec(0.0001, 500, 3000));
    expect(lod.decidedBy).toBe('cap');
    expect(lod.triangles).toBeLessThanOrEqual(3000);
    expect(lod.errorMm).toBeGreaterThan(0.0001);
  });

  it('leaves a mesh already under the floor alone, without sharing its buffers', () => {
    const lod = simplifyToSpec(sheet, spec(0.02, 100_000, 200_000));
    expect(lod.decidedBy).toBe('source');
    expect(lod.triangles).toBe(80_000);
    expect(lod.errorMm).toBe(0);
    expect(lod.mesh.indices.buffer).not.toBe(sheet.indices.buffer);
    expect(lod.mesh.positions.buffer).not.toBe(sheet.positions.buffer);
  });

  it('counts the error a chained source already has against the limit', () => {
    const fresh = simplifyToSpec(sheet, spec(0.05, 500, 79_000));
    const chained = simplifyToSpec(sheet, spec(0.05, 500, 79_000), 0.03);
    expect(chained.triangles).toBeGreaterThan(fresh.triangles);
    expect(chained.errorMm).toBeLessThanOrEqual(0.05);
  });

  it('keeps only vertices that are still used, with valid indices', () => {
    const { mesh } = simplifyToSpec(sheet, spec(1, 2000, 10_000));
    const vertexCount = mesh.positions.length / 3;
    expect(vertexCount).toBeLessThan(sheet.positions.length / 3);
    expect(new Set(mesh.indices).size).toBe(vertexCount);
    expect(mesh.indices.reduce((max, index) => Math.max(max, index), 0)).toBe(vertexCount - 1);
  });

  it('carries the source normals to the vertices that survive', () => {
    const { mesh } = simplifyToSpec(sheet, spec(1, 2000, 10_000));
    expect(mesh.normals?.length).toBe(mesh.positions.length);
    // The sheet faces +z, and every carried normal is still a unit vector doing so.
    for (let i = 0; i < mesh.normals!.length; i += 3) {
      expect(
        Math.hypot(mesh.normals![i]!, mesh.normals![i + 1]!, mesh.normals![i + 2]!),
      ).toBeCloseTo(1, 4);
      expect(mesh.normals![i + 2]).toBeGreaterThan(0);
    }
  });

  it('works on a mesh without normals', () => {
    const bare = { positions: sheet.positions, indices: sheet.indices };
    const lod = simplifyToSpec(bare, spec(1, 2000, 10_000));
    expect(lod.mesh.normals).toBeUndefined();
    expect(lod.triangles).toBeLessThanOrEqual(2000);
  });

  it('does not modify its input', () => {
    const before = sheet.indices.slice();
    simplifyToSpec(sheet, spec(1, 2000, 10_000));
    expect(sheet.indices).toEqual(before);
  });
});

describe('buildLods', () => {
  it('builds one level per spec, each smaller, with errors adding up', () => {
    const lods = buildLods(sheet, [
      { name: 'close', maxErrorMm: 1, minTriangles: 8000, maxTriangles: 79_000 },
      { name: 'table', maxErrorMm: 1, minTriangles: 2000, maxTriangles: 79_000 },
      { name: 'far', maxErrorMm: 1, minTriangles: 500, maxTriangles: 79_000 },
    ]);
    expect(lods.map((lod) => lod.name)).toEqual(['close', 'table', 'far']);
    expect(lods[0]!.triangles).toBeGreaterThan(lods[1]!.triangles);
    expect(lods[1]!.triangles).toBeGreaterThan(lods[2]!.triangles);
    expect(lods[2]!.errorMm).toBeGreaterThan(lods[1]!.errorMm);
    expect(lods[1]!.errorMm).toBeGreaterThan(lods[0]!.errorMm);
  });
});
