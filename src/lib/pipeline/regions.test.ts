import { beforeAll, describe, expect, it } from 'vitest';
import {
  RECESS_BASE,
  generateFigure,
  generatePuddleFigure,
  generateRecessBase,
} from '../../regression/shapes';
import type { IndexedMesh } from './mesh';
import { REGION_BAND_MM, REGION_REACH_MM, regionsOf } from './regions';
import { runPipeline, type ConversionResult } from './run';
import { encodeBinaryStl } from './stl';

/** The generated figure's own base: a 25 mm disc, 3 mm high. */
const DISC_TOP_MM = 3;

const convert = (stl: Float32Array, options: Parameters<typeof runPipeline>[1] = {}) =>
  runPipeline(encodeBinaryStl(stl), { bake: 256, compress: null, ...options });

const regionsOfResult = (result: ConversionResult) =>
  regionsOf(result.baked!.mesh, {
    source: result.mesh,
    figureTriangles: result.pair?.figureTriangles,
    sizing: result.sizing,
    kind: result.kind,
  });

/** Triangle t's centroid, and the y of its face normal. */
function centroid(mesh: IndexedMesh, t: number): [number, number, number] {
  const c = [0, 0, 0];
  for (let corner = 0; corner < 3; corner++)
    for (let axis = 0; axis < 3; axis++)
      c[axis]! += mesh.positions[mesh.indices[t * 3 + corner]! * 3 + axis]! / 3;
  return c as [number, number, number];
}
function upness(mesh: IndexedMesh, t: number): number {
  const p = (corner: number, axis: number): number =>
    mesh.positions[mesh.indices[t * 3 + corner]! * 3 + axis]!;
  const u = [0, 1, 2].map((axis) => p(1, axis) - p(0, axis));
  const v = [0, 1, 2].map((axis) => p(2, axis) - p(0, axis));
  const n = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  return n[1]! / (Math.hypot(n[0]!, n[1]!, n[2]!) || 1);
}
const highest = ({ positions }: IndexedMesh): number => {
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!);
  return top;
};

describe('regionsOf', () => {
  let pair: ConversionResult;
  let disc: ConversionResult;
  beforeAll(async () => {
    pair = await convert(generatePuddleFigure(12), {
      secondStl: encodeBinaryStl(generateRecessBase()),
    });
    disc = await convert(generateFigure(true));
  }, 240_000);

  it('marks the base file’s surface of a pair, and nothing of the figure’s top half', () => {
    const regions = regionsOfResult(pair)!;
    expect(regions.method).toBe('pair');
    const table = pair.baked!.mesh;
    expect(regions.base.length).toBe(table.indices.length / 3);
    const top = RECESS_BASE.heightMm;
    const half = highest(table) / 2;
    let rim = 0;
    for (let t = 0; t < regions.base.length; t++) {
      const [x, y, z] = centroid(table, t);
      if (regions.base[t]) expect(y).toBeLessThanOrEqual(top + REGION_REACH_MM);
      if (y > half) expect(regions.base[t]).toBe(0);
      // The base's top outside the recess, and its outer wall: the base's.
      const r = Math.hypot(x, z);
      if (
        r > RECESS_BASE.recessMm / 2 + 1 &&
        r < RECESS_BASE.diameterMm / 2 - 0.5 &&
        Math.abs(y - top) < 0.05
      ) {
        expect(regions.base[t]).toBe(1);
        rim++;
      }
    }
    expect(rim).toBeGreaterThan(50);
  });

  it('marks the converter’s plain base', async () => {
    const result = await convert(generateFigure(false), { sizing: { plainBase: true } });
    const regions = regionsOfResult(result)!;
    expect(regions.method).toBe('plain');
    const table = result.baked!.mesh;
    const height = result.sizing.plainBase!.heightMm;
    let marked = 0;
    for (let t = 0; t < regions.base.length; t++) {
      const [, y] = centroid(table, t);
      if (regions.base[t]) {
        marked++;
        expect(y).toBeLessThanOrEqual(height + REGION_BAND_MM);
      } else expect(y).toBeGreaterThan(height - 0.5);
    }
    expect(marked).toBeGreaterThan(50);
  }, 120_000);

  it('finds the top of a base in the file at its height', () => {
    expect(disc.kind.reason).toBe('base-top');
    const regions = regionsOfResult(disc)!;
    expect(regions.method).toBe('disc');
    const table = disc.baked!.mesh;
    let top = 0;
    for (let t = 0; t < regions.base.length; t++) {
      const [x, y, z] = centroid(table, t);
      if (regions.base[t]) expect(y).toBeLessThanOrEqual(DISC_TOP_MM + REGION_BAND_MM);
      else expect(y > DISC_TOP_MM - 0.5 || Math.hypot(x, z) < 3).toBe(true);
      if (upness(table, t) > 0.99 && Math.abs(y - DISC_TOP_MM) < 0.01 && Math.hypot(x, z) > 3) {
        expect(regions.base[t]).toBe(1);
        top++;
      }
    }
    expect(top).toBeGreaterThan(20);
  });

  it('finds none on a figure without a base', async () => {
    const result = await convert(generateFigure(false));
    expect(result.sizing.base).toBeNull();
    expect(result.sizing.plainBase).toBeNull();
    expect(regionsOfResult(result)).toBeNull();
  }, 120_000);
});
