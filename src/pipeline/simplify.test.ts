import { beforeAll, describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { weldVertices } from './mesh';
import { buildLods, simplifierReady, simplifyToBudget } from './simplify';

// 100 × 100 quads: 20,000 triangles, 50 mm wide, bumps 4 mm high.
const sheet = weldVertices(generateBumpySheet(100)).mesh;

beforeAll(simplifierReady);

describe('simplifyToBudget', () => {
  it('reduces a mesh to the triangle budget', () => {
    const lod = simplifyToBudget(sheet, 2000);
    expect(lod.triangles).toBeLessThanOrEqual(2000);
    expect(lod.triangles).toBeGreaterThan(1500);
    expect(lod.mesh.indices.length).toBe(lod.triangles * 3);
  });

  it('reports an error that is small against the 4 mm bumps', () => {
    const { errorMm } = simplifyToBudget(sheet, 2000);
    expect(errorMm).toBeGreaterThan(0);
    expect(errorMm).toBeLessThan(0.5);
  });

  it('keeps only vertices that are still used, with valid indices', () => {
    const { mesh } = simplifyToBudget(sheet, 2000);
    const vertexCount = mesh.positions.length / 3;
    expect(vertexCount).toBeLessThan(sheet.positions.length / 3);
    expect(new Set(mesh.indices).size).toBe(vertexCount);
    expect(mesh.indices.reduce((max, index) => Math.max(max, index), 0)).toBe(vertexCount - 1);
  });

  it('stays inside the bounds of the source mesh', () => {
    const { mesh } = simplifyToBudget(sheet, 2000);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i]).toBeLessThanOrEqual(50);
    }
  });

  it('returns a mesh already under the budget unchanged, without sharing its buffers', () => {
    const lod = simplifyToBudget(sheet, 50_000);
    expect(lod.triangles).toBe(20_000);
    expect(lod.errorMm).toBe(0);
    expect(lod.mesh.indices.buffer).not.toBe(sheet.indices.buffer);
    expect(lod.mesh.positions.buffer).not.toBe(sheet.positions.buffer);
  });

  it('does not modify its input', () => {
    const before = sheet.indices.slice();
    simplifyToBudget(sheet, 2000);
    expect(sheet.indices).toEqual(before);
  });
});

describe('buildLods', () => {
  it('builds one LOD per budget, each smaller and with a growing error', () => {
    const lods = buildLods(sheet, [8000, 2000, 500]);
    expect(lods.map((lod) => lod.targetTriangles)).toEqual([8000, 2000, 500]);
    expect(lods[0]!.triangles).toBeGreaterThan(lods[1]!.triangles);
    expect(lods[1]!.triangles).toBeGreaterThan(lods[2]!.triangles);
    expect(lods[2]!.errorMm).toBeGreaterThan(lods[0]!.errorMm);
  });
});
