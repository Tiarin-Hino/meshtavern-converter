import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { DEFAULT_LOOK, parseHexColour, vertexColours } from './look';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';
import { computeCavity, computeOcclusion, shade } from './shade';

/** A flat square grid in the x-z plane at height `y`, facing up or down. */
function plate(x0: number, x1: number, z0: number, z1: number, y: number, up: boolean): number[] {
  const soup: number[] = [];
  const step = 1;
  for (let x = x0; x < x1; x += step) {
    for (let z = z0; z < z1; z += step) {
      const quad = [x, y, z, x, y, z + step, x + step, y, z + step, x + step, y, z];
      const order = up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const corner of order) soup.push(...quad.slice(corner * 3, corner * 3 + 3));
    }
  }
  return soup;
}

function meshOf(soup: number[]): IndexedMesh {
  const mesh: IndexedMesh = weldVertices(new Float32Array(soup)).mesh;
  mesh.normals = computeVertexNormals(mesh);
  return mesh;
}

function vertexAt(mesh: IndexedMesh, x: number, y: number, z: number): number {
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    if (
      mesh.positions[v * 3] === x &&
      mesh.positions[v * 3 + 1] === y &&
      mesh.positions[v * 3 + 2] === z
    )
      return v;
  }
  throw new Error(`No vertex at ${x}, ${y}, ${z}`);
}

describe('computeOcclusion', () => {
  // A 20 × 20 mm floor plate at y = 1, with a ceiling 1 mm above its left half. Rays reach
  // 15 % of the largest dimension, 3 mm here.
  const room = meshOf([...plate(0, 20, 0, 20, 1, true), ...plate(0, 10, 0, 20, 2, false)]);
  const occlusion = computeOcclusion(room);

  it('darkens what lies under cover and leaves open ground alone', () => {
    expect(occlusion[vertexAt(room, 4, 1, 10)]).toBeLessThan(0.5);
    expect(occlusion[vertexAt(room, 17, 1, 10)]).toBeGreaterThan(0.95);
  });

  it('treats the table under the mini as solid', () => {
    // A small foot on the table and a wide plate facing down just above it: nothing but
    // the table is there to shadow the plate.
    const low = meshOf([...plate(0, 2, 0, 2, 0, false), ...plate(0, 20, 0, 20, 0.75, false)]);
    const values = computeOcclusion(low);
    expect(values[vertexAt(low, 10, 0.75, 10)]).toBeLessThan(0.4);
  });

  it('stays within 0 and 1 and handles an empty mesh', () => {
    expect(Math.min(...occlusion)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...occlusion)).toBeLessThanOrEqual(1);
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(computeOcclusion(empty).length).toBe(0);
  });
});

describe('computeCavity', () => {
  // Bumps 4 mm high on a sheet facing +z: crests are edges, troughs are creases.
  const sheet = meshOf(Array.from(generateBumpySheet(60)));
  const cavity = computeCavity(sheet);
  let crest = 0;
  let trough = 0;
  for (let v = 0; v < cavity.length; v++) {
    if (sheet.positions[v * 3 + 2]! > sheet.positions[crest * 3 + 2]!) crest = v;
    if (sheet.positions[v * 3 + 2]! < sheet.positions[trough * 3 + 2]!) trough = v;
  }

  it('is positive on a crest and negative in a trough', () => {
    expect(cavity[crest]).toBeGreaterThan(0);
    expect(cavity[trough]).toBeLessThan(0);
  });

  it('is zero on a flat surface', () => {
    const flat = meshOf(plate(0, 6, 0, 6, 1, true));
    expect(computeCavity(flat)[vertexAt(flat, 3, 1, 3)]).toBeCloseTo(0, 6);
  });
});

describe('vertexColours', () => {
  const sheet = meshOf(Array.from(generateBumpySheet(20)));
  shade(sheet);

  it('gives the flat base coat when the look is off or the mesh has no shading data', () => {
    const base = parseHexColour(DEFAULT_LOOK.base);
    const off = vertexColours(sheet, { ...DEFAULT_LOOK, enabled: false });
    expect(Array.from(off.slice(0, 3))).toEqual(base.map((c) => Math.fround(c)));
    const bare = { positions: sheet.positions, indices: sheet.indices };
    expect(Array.from(vertexColours(bare, DEFAULT_LOOK).slice(0, 3))).toEqual(
      Array.from(off.slice(0, 3)),
    );
  });

  it('darkens creases and lightens edges relative to the base coat', () => {
    const colours = vertexColours(sheet, DEFAULT_LOOK);
    const base = parseHexColour(DEFAULT_LOOK.base)[0];
    const reds = Array.from({ length: colours.length / 3 }, (_, v) => colours[v * 3]!);
    expect(Math.min(...reds)).toBeLessThan(base);
    expect(Math.max(...reds)).toBeGreaterThan(base);
    expect(Math.min(...reds)).toBeGreaterThan(0);
    expect(Math.max(...reds)).toBeLessThanOrEqual(1);
  });

  it('rejects a malformed colour', () => {
    expect(() => parseHexColour('grey')).toThrow();
  });
});
