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

type Vec3 = [number, number, number];

/** A wave between -1 and 1 with period 1, smooth at its peaks. */
function wave(x: number): number {
  const saw = Math.abs(x - Math.floor(x) - 0.5) * 4 - 1;
  return saw * (1.5 - 0.5 * saw * saw);
}

/** Appends a triangle, turned so that it faces away from `inside`. */
function pushOutward(soup: number[], a: Vec3, b: Vec3, c: Vec3, inside: Vec3): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const facing =
    (uy * vz - uz * vy) * (a[0] - inside[0]) +
    (uz * vx - ux * vz) * (a[1] - inside[1]) +
    (ux * vy - uy * vx) * (a[2] - inside[2]);
  if (facing >= 0) soup.push(...a, ...b, ...c);
  else soup.push(...a, ...c, ...b);
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

/**
 * A round base standing on z = 0: flat underside, flat top, straight wall.
 * 4 × cells² + 8 × cells triangles.
 */
export function addRoundBase(
  soup: number[],
  centre: [number, number],
  diameterMm: number,
  heightMm: number,
  cells: number,
): void {
  const radius = diameterMm / 2;
  // Squeezes the square grid into a disc: every ring of the grid becomes a circle.
  const onDisc = (i: number, j: number): [number, number] => {
    const u = -1 + (2 * i) / cells;
    const v = -1 + (2 * j) / cells;
    const ring = Math.max(Math.abs(u), Math.abs(v));
    if (ring === 0) return [centre[0], centre[1]];
    const scale = (ring * radius) / Math.sqrt(u * u + v * v);
    return [centre[0] + u * scale, centre[1] + v * scale];
  };
  const inside: Vec3 = [centre[0], centre[1], heightMm / 2];
  for (const z of [0, heightMm]) {
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const [ax, ay] = onDisc(i, j);
        const [bx, by] = onDisc(i + 1, j);
        const [cx, cy] = onDisc(i + 1, j + 1);
        const [dx, dy] = onDisc(i, j + 1);
        pushOutward(soup, [ax, ay, z], [bx, by, z], [cx, cy, z], inside);
        pushOutward(soup, [ax, ay, z], [cx, cy, z], [dx, dy, z], inside);
      }
    }
  }
  // The wall follows the outermost ring of the grid, once around.
  const rim: [number, number][] = [];
  for (let i = 0; i < cells; i++) rim.push(onDisc(i, 0));
  for (let j = 0; j < cells; j++) rim.push(onDisc(cells, j));
  for (let i = cells; i > 0; i--) rim.push(onDisc(i, cells));
  for (let j = cells; j > 0; j--) rim.push(onDisc(0, j));
  for (let k = 0; k < rim.length; k++) {
    const [ax, ay] = rim[k]!;
    const [bx, by] = rim[(k + 1) % rim.length]!;
    pushOutward(soup, [ax, ay, 0], [bx, by, 0], [bx, by, heightMm], inside);
    pushOutward(soup, [ax, ay, 0], [bx, by, heightMm], [ax, ay, heightMm], inside);
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
