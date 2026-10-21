import { beforeAll, describe, expect, it } from 'vitest';
import { generateFigure } from '../../regression/shapes';
import type { IndexedMesh } from './mesh';
import { DEFAULT_LOOK, CAVITY_GAIN, paintFromBytes, parseHexColour, pointColour } from './look';
import {
  PAINT_REACH_MM,
  paintAtVertices,
  paintedTexture,
  paintWhere,
  type Albedo,
  type ShadedTexels,
} from './paint';
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

describe('paintedTexture (#167)', () => {
  // Four texels by one: bare and owned, painted and owned, painted half and owned, not owned.
  const surface: ShadedTexels = {
    cavity: Float32Array.from([0.4, -0.6, 0.2, 0.9]),
    occlusion: Float32Array.from([0.8, 0.5, 1, 0.3]),
    owned: Uint8Array.from([1, 1, 1, 0]),
  };
  const albedo: Albedo = {
    width: 4,
    height: 1,
    data: Uint8Array.from([0, 0, 0, 0, 200, 40, 30, 255, 30, 160, 60, 128, 255, 0, 0, 255]),
  };
  const toSrgb = (value: number): number =>
    Math.round(
      Math.max(
        0,
        Math.min(1, value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055),
      ) * 255,
    );
  const expected = (texel: number, paint: number[] | null): number[] => [
    ...pointColour(
      parseHexColour(DEFAULT_LOOK.base),
      DEFAULT_LOOK,
      surface.occlusion[texel]!,
      surface.cavity[texel]! / CAVITY_GAIN,
      paint,
    ).map(toSrgb),
    255,
  ];
  const texel = (out: Albedo, k: number): number[] => [...out.data.subarray(k * 4, k * 4 + 4)];

  it('is the look over the paint where the surface is owned, the coat under the look where bare', () => {
    const out = paintedTexture(surface, DEFAULT_LOOK, albedo);
    expect([out.width, out.height]).toEqual([4, 1]);
    expect(texel(out, 0)).toEqual(expected(0, null));
    expect(texel(out, 1)).toEqual(expected(1, paintFromBytes(albedo.data, 4)));
    expect(texel(out, 2)).toEqual(expected(2, paintFromBytes(albedo.data, 8)));
  });

  it('gives an unowned texel the base coat, opaque, whatever the paint there', () => {
    const out = paintedTexture(surface, DEFAULT_LOOK, albedo);
    expect(texel(out, 3)).toEqual([...parseHexColour(DEFAULT_LOOK.base).map(toSrgb), 255]);
  });

  it('with the look disabled, gives the coat and the paint only', () => {
    const out = paintedTexture(surface, { ...DEFAULT_LOOK, enabled: false }, albedo);
    expect(texel(out, 0)).toEqual([...parseHexColour(DEFAULT_LOOK.base).map(toSrgb), 255]);
    expect(texel(out, 1)).toEqual([200, 40, 30, 255]);
  });

  it('refuses a surface of another size', () => {
    const wider: Albedo = { width: 8, height: 1, data: new Uint8Array(32) };
    expect(() => paintedTexture(surface, DEFAULT_LOOK, wider)).toThrow(RangeError);
  });
});
