/**
 * Generated stand-ins for minis, for the regression baseline (issue #46). Real minis are
 * licensed and never enter the repo, so CI watches the pipeline's numbers on these instead.
 *
 * Everything here uses only + - * / and sqrt, which give the same bits on every machine.
 * No sin, cos or pow: their last digit may differ between JavaScript engines, and the
 * baseline compares triangle counts exactly.
 *
 * All shapes are Z-up triangle soups in mm, like a print STL, and repeat shared corners
 * exactly so that welding joins them.
 */

import { addRoundBase, pushOutward, type Vec3 } from '../lib/dev';

/** A wave between -1 and 1 with period 1, smooth at its peaks. */
function wave(x: number): number {
  const saw = Math.abs(x - Math.floor(x) - 0.5) * 4 - 1;
  return saw * (1.5 - 0.5 * saw * saw);
}

/**
 * A closed lumpy ellipsoid: the six faces of a cube, `cells` × `cells` quads each, pushed
 * onto a sphere, dented by `bump` (a share of the radius) and stretched to `radii`.
 * 12 × cells² triangles.
 */
export function addBlob(
  soup: number[],
  centre: Vec3,
  radii: Vec3,
  cells: number,
  bump: number,
): void {
  const point = (x: number, y: number, z: number): Vec3 => {
    const length = Math.sqrt(x * x + y * y + z * z);
    const dx = x / length;
    const dy = y / length;
    const dz = z / length;
    const r = 1 + bump * wave(dx * 3.5) * wave(dy * 2.5 + 0.3) * wave(dz * 3 + 0.1);
    return [
      centre[0] + dx * r * radii[0],
      centre[1] + dy * r * radii[1],
      centre[2] + dz * r * radii[2],
    ];
  };
  const at = (i: number): number => -1 + (2 * i) / cells;
  // Each cube face: the fixed axis and its side, then the two axes that run across it.
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-1, 1]) {
      const corner = (i: number, j: number): Vec3 => {
        const cube: Vec3 = [0, 0, 0];
        cube[axis] = side;
        cube[(axis + 1) % 3] = at(i);
        cube[(axis + 2) % 3] = at(j);
        return point(cube[0], cube[1], cube[2]);
      };
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const a = corner(i, j);
          const b = corner(i + 1, j);
          const c = corner(i + 1, j + 1);
          const d = corner(i, j + 1);
          pushOutward(soup, a, b, c, centre);
          pushOutward(soup, a, c, d, centre);
        }
      }
    }
  }
}

const BASE_HEIGHT_MM = 3;

/**
 * A standing figure of overlapping closed parts (body, head, two arms), about 30 mm tall,
 * like the separate shells many print files are made of. About 100,000 triangles;
 * with a 25 mm round base about 115,000.
 */
export function generateFigure(withBase: boolean): Float32Array {
  const soup: number[] = [];
  const floor = withBase ? BASE_HEIGHT_MM : 0;
  if (withBase) addRoundBase(soup, [0, 0], 25, BASE_HEIGHT_MM, 60);
  addBlob(soup, [0, 0, floor + 11], [5, 4, 11.5], 70, 0.12);
  addBlob(soup, [0, 0.5, floor + 25], [3.5, 3.5, 4], 40, 0.08);
  addBlob(soup, [-6, 0, floor + 15], [2, 2, 6], 30, 0.1);
  addBlob(soup, [6, 1, floor + 16], [2, 2.5, 6], 30, 0.1);
  return new Float32Array(soup);
}

/** Twelve small creatures of different sizes on one 50 mm base. About 95,000 triangles. */
export function generateSwarm(): Float32Array {
  const soup: number[] = [];
  addRoundBase(soup, [0, 0], 50, BASE_HEIGHT_MM, 60);
  for (let k = 0; k < 12; k++) {
    const x = ((k % 4) - 1.5) * 9;
    const y = (Math.floor(k / 4) - 1) * 11;
    const size = 2.5 + (k % 3) * 0.75;
    addBlob(soup, [x, y, BASE_HEIGHT_MM + size * 1.2], [size, size * 1.25, size * 1.5], 24, 0.15);
  }
  return new Float32Array(soup);
}

/**
 * A smooth terrain piece without a base, 40 mm across. Nearly all of its 97,200 triangles
 * are redundant, so the levels land on their triangle floors.
 */
export function generateBoulder(): Float32Array {
  const soup: number[] = [];
  addBlob(soup, [0, 0, 9], [20, 14, 9], 90, 0);
  return new Float32Array(soup);
}

/** The same soup as a sculpting tool would write it: Y-up instead of Z-up. */
export function toYUp(soupZUp: Float32Array): Float32Array {
  const out = new Float32Array(soupZUp.length);
  for (let i = 0; i < soupZUp.length; i += 3) {
    out[i] = soupZUp[i]!;
    out[i + 1] = soupZUp[i + 2]!;
    out[i + 2] = 0 - soupZUp[i + 1]!;
  }
  return out;
}

/**
 * A long, low creature on four legs without a base, Z-up: body, head and four legs, about
 * 36 mm long and 18 mm tall. The paws stand in one plane. About 38,000 triangles.
 */
export function generateQuadruped(): Float32Array {
  const soup: number[] = [];
  addBlob(soup, [0, 0, 11], [15, 5, 5], 40, 0.08);
  addBlob(soup, [17, 0, 14.5], [4, 3.5, 3.5], 24, 0.08);
  for (const x of [-10, 10]) {
    for (const y of [-3.5, 3.5]) addBlob(soup, [x, y, 4.5], [1.8, 1.8, 4.5], 16, 0);
  }
  return new Float32Array(soup);
}

/**
 * The figure without a base, stored tilted about the file's x axis by the 3-4-5 turn
 * (cos 0.8, sin 0.6, about 36.9°): a print file that is not in any convention. A rational
 * turn keeps the bits the same on every machine.
 */
export function generateTiltedFigure(): Float32Array {
  const soup = generateFigure(false);
  for (let i = 0; i < soup.length; i += 3) {
    const y = soup[i + 1]!;
    const z = soup[i + 2]!;
    soup[i + 1] = 0.8 * y - 0.6 * z;
    soup[i + 2] = 0.6 * y + 0.8 * z;
  }
  return soup;
}

/**
 * A round base, Z-up on z = 0, with a round recess in the middle of its top: the grid of
 * `addRoundBase` squeezed into a disc, the rings inside `recessMm` lowered by `recessDepthMm`
 * and joined to the rest by a wall. `recessMm` must fall on a ring: a multiple of
 * `diameterMm / cells`. 4 × cells² + 8 × cells + 16 × ring triangles.
 */
export function addRecessBase(
  soup: number[],
  diameterMm: number,
  heightMm: number,
  cells: number,
  recessMm: number,
  recessDepthMm: number,
): void {
  const radius = diameterMm / 2;
  const half = cells / 2;
  const recessRing = Math.round((recessMm / diameterMm) * half);
  const onDisc = (i: number, j: number): [number, number] => {
    const u = -1 + (2 * i) / cells;
    const v = -1 + (2 * j) / cells;
    const ring = Math.max(Math.abs(u), Math.abs(v));
    if (ring === 0) return [0, 0];
    const scale = (ring * radius) / Math.sqrt(u * u + v * v);
    return [u * scale, v * scale];
  };
  const ringOf = (i: number, j: number): number => Math.max(Math.abs(i - half), Math.abs(j - half));
  const inside: Vec3 = [0, 0, (heightMm - recessDepthMm) / 2];
  const floor = heightMm - recessDepthMm;
  for (const bottom of [true, false]) {
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const inRecess =
          Math.max(ringOf(i, j), ringOf(i + 1, j), ringOf(i + 1, j + 1), ringOf(i, j + 1)) <=
          recessRing;
        const z = bottom ? 0 : inRecess ? floor : heightMm;
        const [ax, ay] = onDisc(i, j);
        const [bx, by] = onDisc(i + 1, j);
        const [cx, cy] = onDisc(i + 1, j + 1);
        const [dx, dy] = onDisc(i, j + 1);
        pushOutward(soup, [ax, ay, z], [bx, by, z], [cx, cy, z], inside);
        pushOutward(soup, [ax, ay, z], [cx, cy, z], [dx, dy, z], inside);
      }
    }
  }
  const loop = (ring: number): [number, number][] => {
    const lo = half - ring;
    const hi = half + ring;
    const points: [number, number][] = [];
    for (let i = lo; i < hi; i++) points.push(onDisc(i, lo));
    for (let j = lo; j < hi; j++) points.push(onDisc(hi, j));
    for (let i = hi; i > lo; i--) points.push(onDisc(i, hi));
    for (let j = hi; j > lo; j--) points.push(onDisc(lo, j));
    return points;
  };
  // The outer wall faces away from the axis; the recess wall faces towards it.
  const wall = (points: [number, number][], from: number, to: number, outward: boolean): void => {
    for (let k = 0; k < points.length; k++) {
      const [ax, ay] = points[k]!;
      const [bx, by] = points[(k + 1) % points.length]!;
      const side = outward ? 0.5 : 1.5;
      const solid: Vec3 = [((ax + bx) / 2) * side, ((ay + by) / 2) * side, (from + to) / 2];
      pushOutward(soup, [ax, ay, from], [bx, by, from], [bx, by, to], solid);
      pushOutward(soup, [ax, ay, from], [bx, by, to], [ax, ay, to], solid);
    }
  };
  wall(loop(half), 0, heightMm, true);
  wall(loop(recessRing), floor, heightMm, false);
}

/** Size of the recess base the regression pair and the page's generated pair stand on. */
export const RECESS_BASE = { diameterMm: 32, heightMm: 4, recessMm: 14, recessDepthMm: 1 };

/**
 * A 32 mm round base 4 mm tall with a 14 mm round recess 1 mm deep, Z-up: the base file of
 * the regression pair (issue #70). 17,120 triangles.
 */
export function generateRecessBase(): Float32Array {
  const soup: number[] = [];
  const { diameterMm, heightMm, recessMm, recessDepthMm } = RECESS_BASE;
  addRecessBase(soup, diameterMm, heightMm, 64, recessMm, recessDepthMm);
  return new Float32Array(soup);
}

/** A closed box between two corners, Z-up. 12 triangles. */
export function addBox(soup: number[], from: Vec3, to: Vec3): void {
  const inside: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  const corner = (k: number): Vec3 => [
    k & 1 ? to[0] : from[0],
    k & 2 ? to[1] : from[1],
    k & 4 ? to[2] : from[2],
  ];
  // Each face as four corners by bit pattern, in order around it.
  for (const [a, b, c, d] of [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ] as const) {
    pushOutward(soup, corner(a), corner(b), corner(c), inside);
    pushOutward(soup, corner(a), corner(c), corner(d), inside);
  }
}

/**
 * A square plate, Z-up on z = 0, with an opening through it where `open(x, y)` holds at a
 * quad's centre: top, underside and outer walls, the opening's walls left out (the height
 * map reads tops only). For the unit tests of #70, not the baseline.
 */
export function generatePlate(
  sideMm: number,
  heightMm: number,
  stepMm: number,
  open: (x: number, y: number) => boolean,
): Float32Array {
  const soup: number[] = [];
  const n = Math.round(sideMm / stepMm);
  const at = (k: number): number => -sideMm / 2 + k * stepMm;
  const inside: Vec3 = [0, 0, heightMm / 2];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (open((at(i) + at(i + 1)) / 2, (at(j) + at(j + 1)) / 2)) continue;
      for (const z of [0, heightMm]) {
        pushOutward(
          soup,
          [at(i), at(j), z],
          [at(i + 1), at(j), z],
          [at(i + 1), at(j + 1), z],
          [(at(i) + at(i + 1)) / 2, (at(j) + at(j + 1)) / 2, heightMm / 2],
        );
        pushOutward(
          soup,
          [at(i), at(j), z],
          [at(i + 1), at(j + 1), z],
          [at(i), at(j + 1), z],
          [(at(i) + at(i + 1)) / 2, (at(j) + at(j + 1)) / 2, heightMm / 2],
        );
      }
    }
  }
  const half = sideMm / 2;
  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k]!;
    const [bx, by] = corners[(k + 1) % 4]!;
    pushOutward(soup, [ax, ay, 0], [bx, by, 0], [bx, by, heightMm], inside);
    pushOutward(soup, [ax, ay, 0], [bx, by, heightMm], [ax, ay, heightMm], inside);
  }
  return new Float32Array(soup);
}

/**
 * The figure without a base, standing on something under its body: `under` adds that
 * something to the soup, from z = 0 up to `heightMm`, and the figure is lifted so its body's
 * lowest point is at that height. Z-up.
 */
function figureStandingOn(heightMm: number, under: (soup: number[]) => void): Float32Array {
  const figure = generateFigure(false);
  let low = Infinity;
  for (let i = 2; i < figure.length; i += 3) if (figure[i]! < low) low = figure[i]!;
  // Half a millimetre into the body, so the two parts overlap like a printed peg.
  const lift = heightMm - 0.5 - low;
  for (let i = 2; i < figure.length; i += 3) figure[i] = figure[i]! + lift;
  const soup: number[] = [];
  under(soup);
  const joined = new Float32Array(soup.length + figure.length);
  joined.set(soup);
  joined.set(figure, soup.length);
  return joined;
}

/** The figure on a 3 mm peg `lengthMm` long. Z-up. */
export function generatePegFigure(lengthMm: number): Float32Array {
  return figureStandingOn(lengthMm, (soup) => addRoundBase(soup, [0, 0], 3, lengthMm, 8));
}

/** The figure on a tab 8 mm long in x, 1.5 mm wide, `lengthMm` tall. Z-up. */
export function generateTabFigure(lengthMm: number): Float32Array {
  return figureStandingOn(lengthMm, (soup) => addBox(soup, [-4, -0.75, 0], [4, 0.75, lengthMm]));
}

/** The figure on a thin puddle: a disc `diameterMm` across, 0.8 mm tall. Z-up. */
export function generatePuddleFigure(diameterMm: number): Float32Array {
  return figureStandingOn(0.8, (soup) => addRoundBase(soup, [0, 0], diameterMm, 0.8, 16));
}
