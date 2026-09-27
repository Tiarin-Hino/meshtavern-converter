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
import { restingPoints } from './stance';

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

/**
 * Water at least this deep makes a basin: a printable recess is 0.5–2 mm deep and a layer
 * 0.2 mm, so layer texture and sculpted scratches stay out. _(proposal)_
 */
export const RECESS_MIN_DEPTH_MM = 0.4;
/** Basins smaller than this are dropped: a 1.6 mm peg hole. _(proposal)_ */
export const RECESS_MIN_AREA_MM2 = 2;
/** A basin deeper than this, or one through the base, is called a hole; the name is for the user. _(proposal)_ */
export const HOLE_MIN_DEPTH_MM = 2;
/**
 * The figure's contact footprint is its vertices within this band of its lowest point: the
 * larger of `CONTACT_BAND_MIN_MM` and `CONTACT_BAND_SHARE` of its height, so 0.9 mm on a
 * 30 mm figure, 3 mm on a 100 mm dragon. _(both proposals)_
 */
export const CONTACT_BAND_MIN_MM = 0.5;
export const CONTACT_BAND_SHARE = 0.03;
/** The best basin is the spot when it fits at least this well: half the size in each direction. _(proposal)_ */
export const RECESS_MIN_FIT = 0.25;
/** Among basins within this fit of the best, the deeper one wins. _(proposal)_ */
export const FIT_TIE = 0.05;
/** Among patches within this height range of the flattest, the one nearest the centre wins. _(proposal)_ */
export const FLAT_PATCH_TIE_MM = 0.2;
/** The window searched for the flattest patch is at least this many cells a side. */
export const FLAT_PATCH_MIN_CELLS = 3;

export type SpotKind = 'hole' | 'recess' | 'flat';

export interface Spot {
  kind: SpotKind;
  /** Centre of the spot on the base, scene x and z, base file units. */
  centre: [number, number];
  /** Extent of the spot: the basin's bounding box, or the window of the flattest patch. */
  sizeMm: [number, number];
  /** Rim height minus floor height of the basin; 0 for a flat patch. */
  depthMm: number;
  /** How well the figure's contact footprint fits the spot, 0–1 (§4.4); 0 for a flat patch. */
  fit: number;
}

/** A basin with the cells it is made of, which the alignment of a slot needs (§4.5). */
export interface Basin {
  spot: Spot;
  /** Indices into `HeightMap.top`. */
  cells: Uint32Array;
}

/**
 * Every region of the top that would hold rain (design note §4.3): the flood of the
 * trapping-rain-water problem, from the outline's edge in, lowest level first, ties by cell
 * index so every machine visits the cells in the same order. Cells with water at least
 * `RECESS_MIN_DEPTH_MM` deep form basins by 4-connectivity; those under
 * `RECESS_MIN_AREA_MM2` are dropped. In the order of their first cell; `fit` is 0 here.
 */
export function findBasins(map: HeightMap): Basin[] {
  const { columns, rows, top, cellMm, origin } = map;
  const count = columns * rows;
  const level = new Float64Array(count);
  const visited = new Uint8Array(count);
  const heap = new MinHeap(count);
  const inside = (cell: number): boolean => !Number.isNaN(top[cell]!);

  for (let cell = 0; cell < count; cell++) {
    if (!inside(cell)) continue;
    const i = cell % columns;
    const j = (cell - i) / columns;
    const edge =
      i === 0 ||
      j === 0 ||
      i === columns - 1 ||
      j === rows - 1 ||
      !inside(cell - 1) ||
      !inside(cell + 1) ||
      !inside(cell - columns) ||
      !inside(cell + columns);
    if (!edge) continue;
    level[cell] = top[cell]!;
    visited[cell] = 1;
    heap.push(top[cell]!, cell);
  }
  while (heap.size > 0) {
    const cell = heap.pop();
    const current = level[cell]!;
    const i = cell % columns;
    const visit = (next: number): void => {
      if (visited[next] || !inside(next)) return;
      visited[next] = 1;
      const standing = top[next]! > current ? top[next]! : current;
      level[next] = standing;
      heap.push(standing, next);
    };
    if (i > 0) visit(cell - 1);
    if (i < columns - 1) visit(cell + 1);
    if (cell >= columns) visit(cell - columns);
    if (cell + columns < count) visit(cell + columns);
  }

  const wet = (cell: number): boolean =>
    inside(cell) && level[cell]! - top[cell]! >= RECESS_MIN_DEPTH_MM;
  const taken = new Uint8Array(count);
  const basins: Basin[] = [];
  for (let first = 0; first < count; first++) {
    if (taken[first] || !wet(first)) continue;
    const cells: number[] = [first];
    taken[first] = 1;
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k]!;
      const i = cell % columns;
      const neighbours = [
        i > 0 ? cell - 1 : -1,
        i < columns - 1 ? cell + 1 : -1,
        cell - columns,
        cell + columns,
      ];
      for (const next of neighbours) {
        if (next < 0 || next >= count || taken[next] || !wet(next)) continue;
        taken[next] = 1;
        cells.push(next);
      }
    }
    if (cells.length * cellMm * cellMm < RECESS_MIN_AREA_MM2) continue;
    let i0 = Infinity;
    let i1 = -Infinity;
    let j0 = Infinity;
    let j1 = -Infinity;
    let floor = Infinity;
    let rim = -Infinity;
    let through = false;
    for (const cell of cells) {
      const i = cell % columns;
      const j = (cell - i) / columns;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (top[cell]! < floor) floor = top[cell]!;
      if (level[cell]! > rim) rim = level[cell]!;
      // Through holes are the only cells inside the outline at the height of the floor.
      if (top[cell] === 0) through = true;
    }
    const depthMm = rim - floor;
    basins.push({
      spot: {
        kind: through || depthMm > HOLE_MIN_DEPTH_MM ? 'hole' : 'recess',
        centre: [origin[0] + ((i0 + i1) / 2) * cellMm, origin[1] + ((j0 + j1) / 2) * cellMm],
        sizeMm: [(i1 - i0 + 1) * cellMm, (j1 - j0 + 1) * cellMm],
        depthMm,
        fit: 0,
      },
      cells: Uint32Array.from(cells),
    });
  }
  return basins;
}

/** A binary heap of cells keyed by level, then by cell index: the flood's queue. */
class MinHeap {
  private readonly levels: Float64Array;
  private readonly cells: Uint32Array;
  size = 0;

  constructor(capacity: number) {
    this.levels = new Float64Array(capacity);
    this.cells = new Uint32Array(capacity);
  }

  private less(a: number, b: number): boolean {
    const la = this.levels[a]!;
    const lb = this.levels[b]!;
    return la < lb || (la === lb && this.cells[a]! < this.cells[b]!);
  }

  private swap(a: number, b: number): void {
    const level = this.levels[a]!;
    const cell = this.cells[a]!;
    this.levels[a] = this.levels[b]!;
    this.cells[a] = this.cells[b]!;
    this.levels[b] = level;
    this.cells[b] = cell;
  }

  push(level: number, cell: number): void {
    let k = this.size++;
    this.levels[k] = level;
    this.cells[k] = cell;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(k, parent)) break;
      this.swap(k, parent);
      k = parent;
    }
  }

  /** Removes the lowest entry and returns its cell. */
  pop(): number {
    const cell = this.cells[0]!;
    const last = --this.size;
    this.levels[0] = this.levels[last]!;
    this.cells[0] = this.cells[last]!;
    let k = 0;
    for (;;) {
      const left = k * 2 + 1;
      const right = left + 1;
      let least = k;
      if (left < this.size && this.less(left, least)) least = left;
      if (right < this.size && this.less(right, least)) least = right;
      if (least === k) break;
      this.swap(k, least);
      k = least;
    }
    return cell;
  }
}

/** Where the figure touches the floor: its lowest vertices. */
export interface Contact {
  /** Centre of their x/z bounding box. */
  centre: [number, number];
  /** Extent of their x/z bounding box. */
  sizeMm: [number, number];
  /** Indices of the vertices. */
  points: number[];
}

/**
 * The figure's contact footprint (design note §4.4): the x/z bounding box of the vertices
 * within the contact band of its lowest point. On feet or a puddle, the soles; on a peg or a
 * tab, its end, because it reaches lower than the feet. The figure stands Y-up.
 */
export function contactFootprint(positions: Float32Array): Contact {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!;
    if (y < low) low = y;
    if (y > high) high = y;
  }
  const band = Math.max(CONTACT_BAND_MIN_MM, CONTACT_BAND_SHARE * (high - low));
  const points = restingPoints(positions, [0, 1, 0], band, 'mm');
  if (points.length === 0) return { centre: [0, 0], sizeMm: [0, 0], points };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const x = positions[p * 3]!;
    const z = positions[p * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    centre: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    sizeMm: [maxX - minX, maxZ - minZ],
    points,
  };
}

/**
 * How well a contact footprint fits a basin, both as extents: with both sorted longer first
 * and r the ratio of contact to basin per side, the product of min(r, 1/r). 1 is a perfect
 * fit; a 3 mm peg over a 3.2 mm hole is 0.88, feet 12 × 8 mm in a 16 × 12 mm recess 0.5.
 */
export function fitOf(contact: [number, number], basin: [number, number]): number {
  const c = contact[0] >= contact[1] ? contact : [contact[1], contact[0]];
  const b = basin[0] >= basin[1] ? basin : [basin[1], basin[0]];
  let fit = 1;
  for (let k = 0; k < 2; k++) {
    if (!(c[k]! > 0 && b[k]! > 0)) return 0;
    const r = c[k]! / b[k]!;
    fit *= r < 1 ? r : 1 / r;
  }
  return fit;
}

export interface Choice {
  spot: Spot;
  /** The basin chosen, or null for a flat patch. */
  basin: Basin | null;
  /** Every basin considered, the chosen one first, then by fit. */
  candidates: Spot[];
}

/**
 * Where the figure goes (design note §4.4): the basin that fits its contact footprint best,
 * when it fits at least `RECESS_MIN_FIT`, the deeper among those within `FIT_TIE` of the
 * best; otherwise the flattest patch of the top the size of the footprint.
 */
export function chooseSpot(map: HeightMap, basins: Basin[], contact: Contact): Choice {
  const byFit = basins
    .map((basin, order) => ({
      basin: { ...basin, spot: { ...basin.spot, fit: fitOf(contact.sizeMm, basin.spot.sizeMm) } },
      order,
    }))
    .sort((a, b) => b.basin.spot.fit - a.basin.spot.fit || a.order - b.order)
    .map(({ basin }) => basin);
  const best = byFit[0]?.spot.fit ?? 0;
  if (best >= RECESS_MIN_FIT) {
    let chosen = byFit[0]!;
    for (const basin of byFit) {
      if (basin.spot.fit < best - FIT_TIE) break;
      if (basin.spot.depthMm > chosen.spot.depthMm) chosen = basin;
    }
    return {
      spot: chosen.spot,
      basin: chosen,
      candidates: [chosen, ...byFit.filter((basin) => basin !== chosen)].map((b) => b.spot),
    };
  }
  return {
    spot: flattestPatch(map, contact.sizeMm),
    basin: null,
    candidates: byFit.map((basin) => basin.spot),
  };
}

/**
 * The window the size of `sizeMm` (at least `FLAT_PATCH_MIN_CELLS` a side, at most the map)
 * with the smallest height range, all inside the outline; among those within
 * `FLAT_PATCH_TIE_MM` of it, the one nearest the base's centre. Sliding minimum and maximum
 * along rows, then columns, so the search stays linear in the cells whatever the window.
 * When no window lies wholly inside the outline (a figure wider than its base), the base's
 * centre.
 */
export function flattestPatch(map: HeightMap, sizeMm: [number, number]): Spot {
  const { columns, rows, top, cellMm, origin } = map;
  const w = Math.min(columns, Math.max(FLAT_PATCH_MIN_CELLS, Math.ceil(sizeMm[0] / cellMm)));
  const h = Math.min(rows, Math.max(FLAT_PATCH_MIN_CELLS, Math.ceil(sizeMm[1] / cellMm)));
  const spot = (centre: [number, number]): Spot => ({
    kind: 'flat',
    centre,
    sizeMm: [w * cellMm, h * cellMm],
    depthMm: 0,
    fit: 0,
  });
  if (w <= 0 || h <= 0) return spot([0, 0]);

  // Outside cells count as missing; a window with any is skipped.
  const missing = new Float64Array(top.length);
  const values = new Float64Array(top.length);
  for (let cell = 0; cell < top.length; cell++) {
    const outside = Number.isNaN(top[cell]!);
    missing[cell] = outside ? 1 : 0;
    values[cell] = outside ? 0 : top[cell]!;
  }
  const across = columns - w + 1;
  const down = rows - h + 1;
  const windows = (grid: Float64Array, max: boolean): Float64Array =>
    slideColumns(slideRows(grid, columns, rows, w, max), across, rows, h, max);
  const low = windows(values, false);
  const high = windows(values, true);
  const outside = windows(missing, true);

  let least = Infinity;
  for (let k = 0; k < across * down; k++)
    if (outside[k] === 0 && high[k]! - low[k]! < least) least = high[k]! - low[k]!;
  if (least === Infinity) return spot([0, 0]);
  let nearest = Infinity;
  let centre: [number, number] = [0, 0];
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const k = j * across + i;
      if (outside[k] !== 0 || high[k]! - low[k]! > least + FLAT_PATCH_TIE_MM) continue;
      const x = origin[0] + (i + (w - 1) / 2) * cellMm;
      const z = origin[1] + (j + (h - 1) / 2) * cellMm;
      const distance2 = x * x + z * z;
      if (distance2 < nearest) {
        nearest = distance2;
        centre = [x, z];
      }
    }
  }
  return spot(centre);
}

/**
 * The minimum or maximum over a window of `size` sliding along a line of `length` values,
 * read through `at` (a monotonic queue: linear whatever the window), written through `put`
 * for every start from 0 to `length - size`.
 */
function slideLine(
  length: number,
  size: number,
  max: boolean,
  at: (k: number) => number,
  put: (start: number, value: number) => void,
  queue: Int32Array,
): void {
  let head = 0;
  let tail = 0;
  for (let k = 0; k < length; k++) {
    const value = at(k);
    while (tail > head && (max ? at(queue[tail - 1]!) <= value : at(queue[tail - 1]!) >= value))
      tail--;
    queue[tail++] = k;
    if (queue[head]! <= k - size) head++;
    if (k >= size - 1) put(k - size + 1, at(queue[head]!));
  }
}

/** Sliding extremes of `size` along every row: `columns - size + 1` columns out. */
function slideRows(
  grid: Float64Array,
  columns: number,
  rows: number,
  size: number,
  max: boolean,
): Float64Array {
  const across = columns - size + 1;
  const out = new Float64Array(across * rows);
  const queue = new Int32Array(columns);
  for (let j = 0; j < rows; j++) {
    slideLine(
      columns,
      size,
      max,
      (k) => grid[j * columns + k]!,
      (start, value) => (out[j * across + start] = value),
      queue,
    );
  }
  return out;
}

/** Sliding extremes of `size` along every column: `rows - size + 1` rows out. */
function slideColumns(
  grid: Float64Array,
  columns: number,
  rows: number,
  size: number,
  max: boolean,
): Float64Array {
  const out = new Float64Array(columns * (rows - size + 1));
  const queue = new Int32Array(rows);
  for (let i = 0; i < columns; i++) {
    slideLine(
      rows,
      size,
      max,
      (k) => grid[k * columns + i]!,
      (start, value) => (out[start * columns + i] = value),
      queue,
    );
  }
  return out;
}
