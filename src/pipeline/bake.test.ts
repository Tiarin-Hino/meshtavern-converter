import { beforeAll, describe, expect, it } from 'vitest';
import { bake, type BakedMaps } from './bake';
import { generateBumpySheet } from './generate';
import { DEFAULT_LOOK, textureColours } from './look';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';
import { shade } from './shade';
import { simplifierReady, simplifyToSpec } from './simplify';
import { unwrap, type Unwrapped } from './unwrap';

const RESOLUTION = 256;
// The "sculpt": 150 × 150 quads, 45,000 triangles, bumps 4 mm high on a sheet facing +z.
const sculpt: IndexedMesh = weldVertices(generateBumpySheet(150)).mesh;
sculpt.normals = computeVertexNormals(sculpt);

let unwrapped: Unwrapped;
let maps: BakedMaps;

beforeAll(async () => {
  await simplifierReady();
  const reduced = simplifyToSpec(sculpt, {
    name: 'table',
    maxErrorMm: 10,
    minTriangles: 1500,
    maxTriangles: 3000,
  }).mesh;
  shade(reduced);
  unwrapped = await unwrap(reduced, RESOLUTION);
  maps = bake(unwrapped.mesh, sculpt, RESOLUTION);
}, 120_000);

describe('unwrap', () => {
  it('gives every vertex texture coordinates inside the texture', () => {
    const { uvs, positions } = unwrapped.mesh;
    expect(uvs!.length).toBe((positions.length / 3) * 2);
    expect(Math.min(...uvs!)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uvs!)).toBeLessThanOrEqual(1);
    expect(unwrapped.charts).toBeGreaterThan(0);
  });

  it('keeps the surface and carries the per-vertex data along', () => {
    const { mesh } = unwrapped;
    expect(mesh.indices.length / 3).toBeGreaterThan(1400);
    expect(mesh.normals!.length).toBe(mesh.positions.length);
    expect(mesh.occlusion!.length).toBe(mesh.positions.length / 3);
  });
});

describe('bake', () => {
  it('fills the islands and finds the sculpt almost everywhere', () => {
    expect(maps.coverage).toBeGreaterThan(0.3);
    expect(maps.fallback).toBeLessThan(0.05);
  });

  it('stores unit normals that face the way the sheet does', () => {
    let lengthError = 0;
    let facing = 0;
    let count = 0;
    for (let texel = 0; texel < RESOLUTION * RESOLUTION; texel++) {
      const x = (maps.normal[texel * 4]! / 255) * 2 - 1;
      const y = (maps.normal[texel * 4 + 1]! / 255) * 2 - 1;
      const z = (maps.normal[texel * 4 + 2]! / 255) * 2 - 1;
      if (x === -1 && y === -1 && z === -1) continue; // never-filled texel
      lengthError = Math.max(lengthError, Math.abs(Math.hypot(x, y, z) - 1));
      facing += z;
      count++;
    }
    expect(lengthError).toBeLessThan(0.02);
    // The bumps are steep (slopes up to about 60°), so the average is well below 1.
    expect(facing / count).toBeGreaterThan(0.5);
  });

  it('records detail the reduced mesh lost: the normal map varies more than a flat sheet would', () => {
    const xs = new Set<number>();
    for (let texel = 0; texel < RESOLUTION * RESOLUTION; texel += 7)
      xs.add(maps.normal[texel * 4]!);
    expect(xs.size).toBeGreaterThan(30);
    expect(Math.min(...maps.cavity)).toBeLessThan(127);
    expect(Math.max(...maps.cavity)).toBeGreaterThan(128);
  });

  it('refuses a mesh without texture coordinates', () => {
    expect(() => bake(sculpt, sculpt, 64)).toThrow();
  });
});

describe('textureColours', () => {
  it('turns the baked maps into an opaque colour texture that reacts to the look', () => {
    const on = textureColours(maps.occlusion, maps.cavity, DEFAULT_LOOK);
    const off = textureColours(maps.occlusion, maps.cavity, { ...DEFAULT_LOOK, enabled: false });
    expect(on.length).toBe(RESOLUTION * RESOLUTION * 4);
    expect(on[3]).toBe(255);
    expect(new Set(off.filter((_, i) => i % 4 === 0)).size).toBe(1);
    expect(new Set(on.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(5);
  });
});
