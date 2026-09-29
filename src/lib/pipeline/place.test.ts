import { describe, expect, it } from 'vitest';
import {
  generateFigure,
  generatePegFigure,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
  generateTabFigure,
  RECESS_BASE,
} from '../../regression/shapes';
import { addRoundBase } from './base';
import { weldVertices, type IndexedMesh } from './mesh';
import { baseOrientation, placeOriented } from './pair';
import {
  chooseSpot,
  contactFootprint,
  findBasins,
  fitOf,
  flattestPatch,
  mergeMeshes,
  placeFigure,
  HEIGHTMAP_CELL_MM,
  RECESS_MIN_AREA_MM2,
  topHeightMap,
  type HeightMap,
} from './place';

/** A Z-up soup as the pipeline leaves it: welded, oriented by its own detection, placed. */
function placed(soup: Float32Array): IndexedMesh {
  const mesh = weldVertices(soup).mesh;
  return placeOriented(mesh, baseOrientation(mesh)).mesh;
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

/** A 20 mm square plate 3 mm thick with a 3.2 mm round hole through it. */
const holeBase = (): Float32Array => generatePlate(20, 3, 0.2, (x, y) => x * x + y * y < 1.6 * 1.6);
/** A 20 mm square plate 3 mm thick with a 2 × 9 mm slot through it, long in the file's y. */
const slotBase = (): Float32Array =>
  generatePlate(20, 3, 0.25, (x, y) => Math.abs(x) < 1 && Math.abs(y) < 4.5);

describe('findBasins', () => {
  it('finds the recess of the recess base, its size and depth', () => {
    const { recessMm, recessDepthMm } = RECESS_BASE;
    const basins = findBasins(topHeightMap(placed(generateRecessBase())));
    expect(basins).toHaveLength(1);
    const { spot } = basins[0]!;
    expect(spot.kind).toBe('recess');
    expect(spot.depthMm).toBe(recessDepthMm);
    expect(spot.centre).toEqual([0, 0]);
    // The rim's vertices stamp the outermost ring of cells: within a cell either way.
    for (const side of spot.sizeMm) expect(Math.abs(side - recessMm)).toBeLessThanOrEqual(1);
  });

  it('finds a hole through the base, as deep as the base is tall', () => {
    const basins = findBasins(topHeightMap(placed(holeBase())));
    expect(basins.map((b) => b.spot.kind)).toEqual(['hole']);
    expect(basins[0]!.spot.depthMm).toBe(3);
    for (const side of basins[0]!.spot.sizeMm) expect(Math.abs(side - 3.2)).toBeLessThanOrEqual(1);
  });

  it('keeps sculpted texture shallower than a recess out', () => {
    const rippled = plate(30, 0.25, (x, z) => 3 + 0.1 * Math.sin(x * 2) * Math.cos(z * 1.7));
    expect(findBasins(topHeightMap(rippled))).toEqual([]);
  });

  it('drops basins smaller than a peg hole', () => {
    // One cell deep, 1 mm² at most: under RECESS_MIN_AREA_MM2.
    const pit = plate(20, 0.25, (x, z) => (Math.abs(x) < 0.4 && Math.abs(z) < 0.4 ? 1 : 3));
    expect(RECESS_MIN_AREA_MM2).toBeGreaterThan(1);
    expect(findBasins(topHeightMap(pit))).toEqual([]);
  });
});

describe('contactFootprint', () => {
  it('finds the lowest part of a figure without a base', () => {
    const contact = contactFootprint(placed(generateFigure(false)).positions);
    expect(contact.points.length).toBeGreaterThan(10);
    // The rounded underside of the body, not the whole body.
    for (const side of contact.sizeMm) {
      expect(side).toBeGreaterThan(1);
      expect(side).toBeLessThan(4);
    }
  });

  it('finds the end of a peg, the puddle, the tab', () => {
    const peg = contactFootprint(placed(generatePegFigure(2)).positions);
    expect(peg.sizeMm.map((v) => v.toFixed(2))).toEqual(['3.00', '3.00']);
    const puddle = contactFootprint(placed(generatePuddleFigure(12)).positions);
    expect(puddle.sizeMm.map((v) => v.toFixed(2))).toEqual(['12.00', '12.00']);
    const tab = contactFootprint(placed(generateTabFigure(2)).positions);
    expect(tab.sizeMm.map((v) => v.toFixed(2))).toEqual(['8.00', '1.50']);
  });
});

describe('fitOf', () => {
  it('scores the design note examples', () => {
    expect(fitOf([3, 3], [3.2, 3.2])).toBeCloseTo(0.88, 2);
    expect(fitOf([12, 8], [16, 12])).toBeCloseTo(0.5, 2);
    expect(fitOf([12, 8], [2, 3])).toBeCloseTo(0.06, 2);
    expect(fitOf([3, 3], [20, 20])).toBeCloseTo(0.02, 2);
    // Sorted before comparing: a turned slot fits as well.
    expect(fitOf([8, 1.5], [2, 9])).toBe(fitOf([1.5, 8], [9, 2]));
    expect(fitOf([0, 3], [3, 3])).toBe(0);
  });
});

describe('chooseSpot', () => {
  const choose = (figure: Float32Array, base: Float32Array) => {
    const map = topHeightMap(placed(base));
    return chooseSpot(map, findBasins(map), contactFootprint(placed(figure).positions));
  };

  it('sets a puddle in the recess', () => {
    const { spot, basin, candidates } = choose(generatePuddleFigure(12), generateRecessBase());
    expect(spot.kind).toBe('recess');
    expect(spot.fit).toBeGreaterThan(0.8);
    expect(basin).not.toBeNull();
    expect(candidates).toEqual([spot]);
  });

  it('sets a peg in the hole and a tab in the slot', () => {
    expect(choose(generatePegFigure(2), holeBase()).spot).toMatchObject({ kind: 'hole' });
    const slot = choose(generateTabFigure(2), slotBase()).spot;
    expect(slot.kind).toBe('hole');
    expect(slot.fit).toBeGreaterThan(0.8);
  });

  it('takes the flattest patch when no basin fits: a peg over a wide recess', () => {
    const { spot, basin, candidates } = choose(generatePegFigure(2), generateRecessBase());
    expect(spot).toMatchObject({ kind: 'flat', depthMm: 0, fit: 0 });
    expect(basin).toBeNull();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fit).toBeLessThan(0.25);
  });

  it('takes the deeper of two basins that fit about as well', () => {
    const twoPits = plate(30, 0.25, (x, z) => {
      if (Math.abs(x + 7) < 2 && Math.abs(z) < 2) return 2;
      if (Math.abs(x - 7) < 2 && Math.abs(z) < 2) return 1;
      return 3;
    });
    const map = topHeightMap(twoPits);
    const basins = findBasins(map);
    expect(basins).toHaveLength(2);
    const contact = {
      centre: [0, 0] as [number, number],
      sizeMm: [4, 4] as [number, number],
      points: [],
    };
    const { spot, candidates } = chooseSpot(map, basins, contact);
    expect(spot.depthMm).toBe(2);
    expect(spot.centre[0]).toBeGreaterThan(0);
    expect(candidates).toHaveLength(2);
  });
});

describe('flattestPatch', () => {
  it('takes the window nearest the centre among equally flat ones', () => {
    const map = topHeightMap(plate(20, 0.5, () => 3));
    const spot = flattestPatch(map, [4, 2]);
    expect(spot.kind).toBe('flat');
    expect(Math.hypot(...spot.centre)).toBeLessThanOrEqual(map.cellMm);
    expect(spot.sizeMm).toEqual([4, 2]);
  });

  it('finds the one flat plateau of a sculpted top', () => {
    const rocky = plate(30, 0.25, (x, z) =>
      Math.abs(x - 8) < 3 && Math.abs(z + 6) < 3
        ? 4
        : 3 + 0.8 * Math.sin(x * 1.3) * Math.cos(z * 1.1),
    );
    const spot = flattestPatch(topHeightMap(rocky), [4, 4]);
    expect(Math.abs(spot.centre[0] - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(spot.centre[1] + 6)).toBeLessThanOrEqual(1);
  });

  it('falls back to the centre when the figure is wider than the base', () => {
    const map = topHeightMap(placed(generateRecessBase()));
    expect(flattestPatch(map, [60, 60]).centre).toEqual([0, 0]);
  });
});

/** Sets a Z-up figure on a Z-up base the way the place step does. */
function set(figureSoup: Float32Array, base: Float32Array | IndexedMesh, options = {}) {
  const figure = placed(figureSoup);
  const map = topHeightMap(base instanceof Float32Array ? placed(base) : base);
  const contact = contactFootprint(figure.positions);
  const choice = chooseSpot(map, findBasins(map), contact);
  const result = placeFigure(figure, map, choice, contact, options);
  return { ...result, figure, contact };
}

function lowest(positions: Float32Array): number {
  let low = Infinity;
  for (let i = 1; i < positions.length; i += 3) if (positions[i]! < low) low = positions[i]!;
  return low;
}

/** Centre of the x/z bounding box of the given vertices. */
function centreOf(positions: Float32Array, points: number[]): [number, number] {
  const xs = points.map((p) => positions[p * 3]!);
  const zs = points.map((p) => positions[p * 3 + 2]!);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

describe('placeFigure', () => {
  it('sets a puddle on the recess floor, centred on the recess', () => {
    const { heightMm, recessDepthMm } = RECESS_BASE;
    const { positions, placement, contact } = set(generatePuddleFigure(12), generateRecessBase());
    expect(placement).toMatchObject({ method: 'detected', yawDeg: 0 });
    expect(placement.offsetMm).toEqual([0, 0, heightMm - recessDepthMm]);
    expect(lowest(positions)).toBe(heightMm - recessDepthMm);
    const [x, z] = centreOf(positions, contact.points);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(Math.abs(z)).toBeLessThan(1e-6);
  });

  it('puts a long peg on the floor of a hole through the base, a short one hangs from the feet', () => {
    // The body starts 0.5 mm below the top of the peg: 3.5 mm above the tip of a 4 mm peg.
    expect(lowest(set(generatePegFigure(4), holeBase()).positions)).toBe(0);
    const short = set(generatePegFigure(2), holeBase());
    expect(short.placement.spot.kind).toBe('hole');
    expect(lowest(short.positions)).toBeGreaterThan(0.3);
    expect(lowest(short.positions)).toBeLessThan(1.5);
  });

  it('puts a peg on the floor of a blind hole deeper than the peg is long', () => {
    const blind = plate(20, 0.2, (x, z) => (x * x + z * z < 1.6 * 1.6 ? 1 : 4));
    const { positions, placement } = set(generatePegFigure(4), blind);
    expect(placement.spot.kind).toBe('hole');
    expect(lowest(positions)).toBe(1);
  });

  it('turns a tab into its slot, and leaves a round peg as it is', () => {
    const tab = set(generateTabFigure(2), slotBase());
    expect(Math.abs(Math.abs(tab.placement.yawDeg) - 90)).toBeLessThan(1);
    expect(set(generatePegFigure(2), holeBase()).placement.yawDeg).toBe(0);
  });

  it('moves, raises and turns by exactly what the user gave, and says so', () => {
    const detected = set(generatePuddleFigure(12), generateRecessBase());
    const manual = set(generatePuddleFigure(12), generateRecessBase(), {
      moveMm: [2, -1],
      liftMm: 0.5,
      turnDeg: 15,
    });
    const [x, z, lift] = detected.placement.offsetMm;
    expect(manual.placement.method).toBe('manual');
    expect(manual.placement.offsetMm[0]).toBe(x + 2);
    expect(manual.placement.offsetMm[1]).toBe(z - 1);
    expect(manual.placement.yawDeg).toBeCloseTo(15, 9);
    // Raised by 0.5 mm from where it dropped: a sink of the same size gives it back.
    const sunk = set(generatePuddleFigure(12), generateRecessBase(), { liftMm: -0.5 });
    expect(sunk.placement.offsetMm[2]).toBeCloseTo(lift - 0.5, 6);
    expect(sunk.placement.method).toBe('manual');
  });
});

describe('mergeMeshes', () => {
  it('lists the first mesh first and offsets the indices of the second', () => {
    const a = plate(2, 1, () => 1);
    const b = plate(2, 1, () => 2);
    const merged = mergeMeshes(a, b);
    expect(merged.positions.length).toBe(a.positions.length + b.positions.length);
    expect([...merged.indices.subarray(0, a.indices.length)]).toEqual([...a.indices]);
    expect(merged.indices[a.indices.length]).toBe(b.indices[0]! + a.positions.length / 3);
  });
});
