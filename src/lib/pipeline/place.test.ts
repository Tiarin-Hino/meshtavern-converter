import { describe, expect, it } from 'vitest';
import { generateRecessBase, RECESS_BASE } from '../../regression/shapes';
import { addRoundBase } from './base';
import { weldVertices, type IndexedMesh } from './mesh';
import { coverageFor, orientAndPlace, resolveOrientation } from './orient';
import { HEIGHTMAP_CELL_MM, topHeightMap, type HeightMap } from './place';

/** A Z-up soup as the pipeline leaves it: welded, oriented by its own detection, placed. */
function placed(soup: Float32Array): IndexedMesh {
  const mesh = weldVertices(soup).mesh;
  const detection = resolveOrientation(mesh, {});
  const { orientation } = detection;
  return orientAndPlace(mesh, orientation.rotation, coverageFor(detection, orientation.up)).mesh;
}

function roundBase(diameterMm: number, heightMm: number): Float32Array {
  const soup: number[] = [];
  addRoundBase(soup, [0, 0], diameterMm, heightMm, 32);
  return new Float32Array(soup);
}

/**
 * A square plate, Y-up, centred on the origin: its top at `height(x, z)` and its underside
 * on y = 0, one quad per `stepMm`, left out where `height` gives null at a corner. No walls:
 * the height map reads the top only.
 */
function plate(
  sideMm: number,
  stepMm: number,
  height: (x: number, z: number) => number | null,
): IndexedMesh {
  const soup: number[] = [];
  const n = Math.round(sideMm / stepMm);
  const at = (k: number): number => -sideMm / 2 + k * stepMm;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const corners = [
        [at(i), at(j)],
        [at(i + 1), at(j)],
        [at(i + 1), at(j + 1)],
        [at(i), at(j + 1)],
      ] as const;
      const heights = corners.map(([x, z]) => height(x, z));
      if (heights.some((h) => h === null)) continue;
      const [a, b, c, d] = corners.map(([x, z], k) => [x, heights[k]!, z]);
      const [ea, eb, ec, ed] = corners.map(([x, z]) => [x, 0, z]);
      soup.push(...a!, ...c!, ...b!, ...a!, ...d!, ...c!);
      soup.push(...ea!, ...eb!, ...ec!, ...ea!, ...ec!, ...ed!);
    }
  }
  return weldVertices(new Float32Array(soup)).mesh;
}

/** The height at scene x, z: the cell whose centre is nearest. */
function heightAt(map: HeightMap, x: number, z: number): number {
  const i = Math.round((x - map.origin[0]) / map.cellMm);
  const j = Math.round((z - map.origin[1]) / map.cellMm);
  return map.top[j * map.columns + i]!;
}

function insideCells(map: HeightMap): number[] {
  return [...map.top].filter((h) => !Number.isNaN(h));
}

describe('topHeightMap', () => {
  it('reads a flat disc as one height inside and nothing outside', () => {
    const map = topHeightMap(placed(roundBase(32, 4)));
    expect(map.cellMm).toBe(HEIGHTMAP_CELL_MM);
    expect(map.columns).toBeGreaterThanOrEqual(64);
    expect(heightAt(map, 0, 0)).toBe(4);
    expect(heightAt(map, 15, 0)).toBe(4);
    expect(heightAt(map, 15, 15)).toBeNaN();
    const inside = insideCells(map);
    expect(new Set(inside)).toEqual(new Set([4]));
    // The disc's area in cells, within the outline's one-cell band.
    const area = inside.length * map.cellMm ** 2;
    expect(area).toBeGreaterThan(Math.PI * 15.5 ** 2);
    expect(area).toBeLessThan(Math.PI * 16.5 ** 2);
  });

  it('puts a hole through the base at the floor', () => {
    const map = topHeightMap(
      plate(20, 0.5, (x, z) => (Math.abs(x) < 2 && Math.abs(z) < 2 ? null : 3)),
    );
    expect(heightAt(map, 0, 0)).toBe(0);
    expect(heightAt(map, 1, -1)).toBe(0);
    expect(heightAt(map, 5, 5)).toBe(3);
    expect(heightAt(map, -9.5, 9.5)).toBe(3);
  });

  it('reads the recess base as its rim and its floor', () => {
    const { heightMm, recessMm, recessDepthMm } = RECESS_BASE;
    const map = topHeightMap(placed(generateRecessBase()));
    expect(heightAt(map, 0, 0)).toBe(heightMm - recessDepthMm);
    expect(heightAt(map, recessMm / 2 - 1, 0)).toBe(heightMm - recessDepthMm);
    expect(heightAt(map, recessMm / 2 + 1, 0)).toBe(heightMm);
    expect(heightAt(map, 0, 12)).toBe(heightMm);
  });

  it('interpolates a tilted plate within a cell of error', () => {
    const slope = 0.1;
    const map = topHeightMap(plate(20, 2, (x) => 2 + slope * x));
    for (const [x, z] of [
      [0, 0],
      [-7.3, 4.1],
      [8.8, -8.8],
    ] as const) {
      const cellX = map.origin[0] + Math.round((x - map.origin[0]) / map.cellMm) * map.cellMm;
      expect(Math.abs(heightAt(map, x, z) - (2 + slope * cellX))).toBeLessThanOrEqual(
        slope * map.cellMm,
      );
    }
  });

  it('leaves no gaps under triangles smaller than a cell', () => {
    const map = topHeightMap(plate(10, 0.1, () => 1));
    const inside = insideCells(map);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((h) => h === 1)).toBe(true);
  });

  it('grows the cells on a large base so no side has more than the limit', () => {
    const map = topHeightMap(placed(roundBase(400, 5)));
    expect(map.columns).toBeLessThanOrEqual(512);
    expect(map.cellMm).toBeGreaterThan(HEIGHTMAP_CELL_MM);
  });
});
