import { beforeAll, describe, expect, it } from 'vitest';
import { generateFigure } from '../../regression/shapes';
import type { IndexedMesh } from './mesh';
import { PAINT_REACH_MM, paintAtVertices, paintWhere, type Albedo } from './paint';
import { BAKED_LEVEL, runPipeline, type ConversionResult } from './run';
import { encodeBinaryStl } from './stl';

const RED = [255, 0, 0, 255] as const;
/** Vertices this close to the painted half's edge may go either way: a texel is about 0.1 mm. */
const EDGE_MM = 0.5;
const PAINT_SIZE = 512;

let result: ConversionResult;
let table: IndexedMesh;
let paint: Albedo;

beforeAll(async () => {
  result = await runPipeline(encodeBinaryStl(generateFigure(true)), { bake: 256, compress: null });
  table = result.baked!.mesh;
  // The generated figure stands on its base with x = 0 through its middle: paint the +x half red.
  paint = paintWhere(table, PAINT_SIZE, (x) => x > 0, RED);
}, 120_000);

/** The paint per vertex, split by which side of x = 0 the vertex is on. */
function sides(mesh: IndexedMesh, colours: Uint8Array): { painted: number[][]; bare: number[][] } {
  const painted: number[][] = [];
  const bare: number[][] = [];
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const x = mesh.positions[v * 3]!;
    const colour = [...colours.subarray(v * 4, v * 4 + 4)];
    if (x > EDGE_MM) painted.push(colour);
    else if (x < -EDGE_MM) bare.push(colour);
  }
  return { painted, bare };
}

describe('paintAtVertices', () => {
  it('gives the far and close levels red on the painted half and nothing on the other', () => {
    expect(result.baked).toBeDefined();
    expect(result.lods[BAKED_LEVEL]!.mesh.uvs).toBeUndefined();
    for (const level of [0, 2]) {
      const mesh = result.lods[level]!.mesh;
      expect(mesh.uvs).toBeUndefined();
      const { painted, bare } = sides(mesh, paintAtVertices(mesh, table, paint));
      expect(painted.length).toBeGreaterThan(1000);
      expect(bare.length).toBeGreaterThan(1000);
      for (const colour of painted) expect(colour).toEqual([...RED]);
      for (const colour of bare) expect(colour).toEqual([0, 0, 0, 0]);
    }
  });

  it('gives the table level its own texels back', () => {
    const { painted, bare } = sides(table, paintAtVertices(table, table, paint));
    for (const colour of painted) expect(colour).toEqual([...RED]);
    for (const colour of bare) expect(colour).toEqual([0, 0, 0, 0]);
  });

  it('reaches PAINT_REACH_MM off the table level, and no farther', () => {
    // The top of the figure's head: painted where x > 0, nothing above it but air.
    let top = 0;
    for (let v = 0; v < table.positions.length / 3; v++)
      if (
        table.positions[v * 3]! > EDGE_MM &&
        table.positions[v * 3 + 1]! > table.positions[top * 3 + 1]!
      )
        top = v;
    const [x, y, z] = table.positions.subarray(top * 3, top * 3 + 3);
    const off: IndexedMesh = {
      positions: new Float32Array([
        x!,
        y! + PAINT_REACH_MM / 2,
        z!,
        x!,
        y! + PAINT_REACH_MM * 2,
        z!,
      ]),
      indices: new Uint32Array(0),
    };
    const colours = paintAtVertices(off, table, paint);
    expect([...colours.subarray(0, 4)]).toEqual([...RED]);
    expect([...colours.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it('refuses a table level without texture coordinates and a texture of the wrong size', () => {
    const level = result.lods[2]!.mesh;
    expect(() => paintAtVertices(level, level, paint)).toThrow();
    expect(() =>
      paintAtVertices(level, table, { width: 4, height: 4, data: new Uint8Array(4) }),
    ).toThrow(RangeError);
  });
});

describe('paintWhere', () => {
  it('paints the islands where asked and leaves the gutter bare', () => {
    let red = 0;
    let bare = 0;
    for (let texel = 0; texel < PAINT_SIZE * PAINT_SIZE; texel++) {
      const alpha = paint.data[texel * 4 + 3]!;
      if (alpha === 255) red++;
      else if (alpha === 0) bare++;
    }
    expect(red + bare).toBe(PAINT_SIZE * PAINT_SIZE);
    // About half of the islands, which cover well under the whole texture.
    expect(red).toBeGreaterThan(PAINT_SIZE * PAINT_SIZE * 0.1);
    expect(bare).toBeGreaterThan(red);
  });
});
