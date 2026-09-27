/**
 * Where a figure is set down on its base file, and the two merged (issue #70, design note
 * docs/design/base-file.md §4). The base's top is read as a height map; a recess, hole or
 * slot is a basin that would hold rain; the basin that fits the figure's lowest points is
 * the spot, else the flattest patch; the figure is dropped until it touches.
 *
 * Deterministic: only + - * / and sqrt on the geometry, so every machine sets the figure in
 * the same place (the regression pair depends on it).
 */
import type { IndexedMesh } from './mesh';

/** Side of a height-map cell. A 50 mm base is 100 × 100 cells. _(proposal)_ */
export const HEIGHTMAP_CELL_MM = 0.5;
/** No side of the height map has more cells: larger bases get larger cells. _(proposal)_ */
export const HEIGHTMAP_MAX_CELLS = 512;

/** The top of a base seen from above, one height per cell. */
export interface HeightMap {
  cellMm: number;
  /** x and z of the centre of cell (0, 0). */
  origin: [number, number];
  columns: number;
  rows: number;
  /** Top height per cell, row-major; NaN outside the base. Through holes are 0. */
  top: Float64Array;
}

/**
 * Barycentric tests on cell centres that lie on a triangle's edge pass within this share of
 * the triangle's projected area, so two triangles sharing the edge both see the centre.
 */
const EDGE_EPS = 1e-9;

/**
 * The base's top as a height map (design note §4.2). The base stands Y-up on y = 0. Every
 * triangle gives the cell centres inside its x/z projection its interpolated height, and
 * every vertex stamps its own cell, keeping the highest per cell: vertical walls project to
 * nothing, and triangles smaller than a cell leave no gaps. Cells nothing touched are
 * outside the base when they connect to the map's border, else through holes at height 0.
 */
export function topHeightMap({ positions, indices }: IndexedMesh): HeightMap {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(maxX >= minX))
    return {
      cellMm: HEIGHTMAP_CELL_MM,
      origin: [0, 0],
      columns: 0,
      rows: 0,
      top: new Float64Array(0),
    };

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cellMm = Math.max(HEIGHTMAP_CELL_MM, Math.max(width, depth) / (HEIGHTMAP_MAX_CELLS - 2));
  // One cell more than the extent needs, centred on the base, so the outline has a margin.
  const columns = Math.floor(width / cellMm) + 2;
  const rows = Math.floor(depth / cellMm) + 2;
  const originX = (minX + maxX) / 2 - ((columns - 1) * cellMm) / 2;
  const originZ = (minZ + maxZ) / 2 - ((rows - 1) * cellMm) / 2;
  const top = new Float64Array(columns * rows).fill(-Infinity);

  const column = (x: number): number => (x - originX) / cellMm;
  const row = (z: number): number => (z - originZ) / cellMm;

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ax = positions[a]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const bz = positions[b + 2]!;
    const cx = positions[c]!;
    const cz = positions[c + 2]!;
    // Twice the signed projected area; a wall seen from above has none.
    const area2 = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (area2 === 0) continue;
    const ay = positions[a + 1]!;
    const by = positions[b + 1]!;
    const cy = positions[c + 1]!;
    const eps = Math.abs(area2) * EDGE_EPS;
    const i0 = Math.max(0, Math.ceil(column(Math.min(ax, bx, cx))));
    const i1 = Math.min(columns - 1, Math.floor(column(Math.max(ax, bx, cx))));
    const j0 = Math.max(0, Math.ceil(row(Math.min(az, bz, cz))));
    const j1 = Math.min(rows - 1, Math.floor(row(Math.max(az, bz, cz))));
    for (let j = j0; j <= j1; j++) {
      const pz = originZ + j * cellMm;
      for (let i = i0; i <= i1; i++) {
        const px = originX + i * cellMm;
        // Weights of b and c, and of a, times the signed area: all of one sign inside.
        let wb = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
        let wc = (bx - ax) * (pz - az) - (px - ax) * (bz - az);
        if (area2 < 0) {
          wb = 0 - wb;
          wc = 0 - wc;
        }
        const wa = Math.abs(area2) - wb - wc;
        if (wa < -eps || wb < -eps || wc < -eps) continue;
        const y = (wa * ay + wb * by + wc * cy) / Math.abs(area2);
        const cell = j * columns + i;
        if (y > top[cell]!) top[cell] = y;
      }
    }
  }
  for (let v = 0; v < positions.length; v += 3) {
    const i = Math.round(column(positions[v]!));
    const j = Math.round(row(positions[v + 2]!));
    if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
    const cell = j * columns + i;
    if (positions[v + 1]! > top[cell]!) top[cell] = positions[v + 1]!;
  }

  // Untouched cells reachable from the border are outside; the rest are holes through the base.
  const stack: number[] = [];
  const outside = (cell: number): void => {
    if (top[cell] === -Infinity) {
      top[cell] = NaN;
      stack.push(cell);
    }
  };
  for (let i = 0; i < columns; i++) {
    outside(i);
    outside((rows - 1) * columns + i);
  }
  for (let j = 0; j < rows; j++) {
    outside(j * columns);
    outside(j * columns + columns - 1);
  }
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const i = cell % columns;
    const j = (cell - i) / columns;
    if (i > 0) outside(cell - 1);
    if (i < columns - 1) outside(cell + 1);
    if (j > 0) outside(cell - columns);
    if (j < rows - 1) outside(cell + columns);
  }
  for (let cell = 0; cell < top.length; cell++) if (top[cell] === -Infinity) top[cell] = 0;

  return { cellMm, origin: [originX, originZ], columns, rows, top };
}
