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
