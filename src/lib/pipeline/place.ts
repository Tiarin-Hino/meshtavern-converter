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
import { turnPositions, type Orientation, type PlacedMesh } from './orient';
import type { Rotation } from './rotation';
import type { Pairing } from './pair';
import { restingPoints } from './stance';

/**
 * The place step on the largest realistic pair (a 5.6 M-triangle figure on a 1 M-triangle
 * base) should take no longer, on the development PC. `scripts/measure-place.mjs` measures
 * it. _(proposal)_
 */
export const PLACE_BUDGET_MS = 300;

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
 * Water at least this deep makes a basin. The design guessed 0.4 mm (a printable recess is
 * 0.5–2 mm deep, a layer 0.2 mm); the foot recesses of the corpus bases are 0.3–0.5 mm deep,
 * so 0.4 missed most of them (2026-09-27, corpus pairs, PR #89). _(proposal)_
 */
export const RECESS_MIN_DEPTH_MM = 0.25;
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
/**
 * A basin is a seat for this figure when it fits at least this well (`fitOf`: half the size in
 * each direction)... The note's §4.3 proposed 0.5; its §4.4 keeps the build's 0.25, and the
 * corpus agrees: at 0.5 `humanoid-03` leaves the spot the sheets called right (PR #89). On a
 * sculpted top the flood also finds the gaps between cobbles, hence the second test. _(proposal)_
 */
export const SEAT_MIN_FIT = 0.25;
/**
 * ...and fills at least this share of its bounding box: a seat is compact, a crevice between
 * cobbles is thin and winding. On the pairs looked at, seats score 0.6–0.87, crevices at most
 * 0.36 (design note §12). _(proposal)_
 */
export const SEAT_BBOX_FILL = 0.4;
/** Among basins within this fit of the best, the deeper one wins. _(proposal)_ */
export const FIT_TIE = 0.05;
/** Among patches within this height range of the flattest, the one nearest the centre wins. _(proposal)_ */
export const FLAT_PATCH_TIE_MM = 0.2;
/** The window searched for the flattest patch is at least this many cells a side. */
export const FLAT_PATCH_MIN_CELLS = 3;

/** hole and recess: a seat won. flat: the flattest patch. registered: the files' own placement. */
export type SpotKind = 'hole' | 'recess' | 'flat' | 'registered';

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
  /** The centre guard moved the figure's box over the middle of the base (§4.4). */
  centred?: boolean;
}

/** A basin with the cells it is made of, which the alignment of a slot needs (§4.5). */
export interface Basin {
  spot: Spot;
  /** Indices into `HeightMap.top`. */
  cells: Uint32Array;
  /** Its cells over the cells of its bounding box: compact seats fill much of it (§4.3). */
  bboxFill: number;
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
      bboxFill: cells.length / ((i1 - i0 + 1) * (j1 - j0 + 1)),
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
  /** A registered pair: the height the files give the figure, kept unless the user moves or turns it. */
  keepLiftMm?: number;
}

/**
 * Where the figure goes (design note §4.3, §4.4): the seat that fits its contact footprint
 * best (a basin with a fit of at least `SEAT_MIN_FIT` that fills `SEAT_BBOX_FILL` of its
 * bounding box), the deeper among those within `FIT_TIE` of the best; otherwise the flattest
 * patch of the top the size of the footprint. Every basin stays in `candidates` with its fit.
 */
export function chooseSpot(map: HeightMap, basins: Basin[], contact: Contact): Choice {
  const byFit = basins
    .map((basin, order) => ({
      basin: { ...basin, spot: { ...basin.spot, fit: fitOf(contact.sizeMm, basin.spot.sizeMm) } },
      order,
    }))
    .sort((a, b) => b.basin.spot.fit - a.basin.spot.fit || a.order - b.order)
    .map(({ basin }) => basin);
  const seats = byFit.filter(
    (basin) => basin.spot.fit >= SEAT_MIN_FIT && basin.bboxFill >= SEAT_BBOX_FILL,
  );
  const best = seats[0]?.spot.fit ?? 0;
  if (seats.length > 0) {
    let chosen = seats[0]!;
    for (const basin of seats) {
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

/**
 * A vertex is dropped onto the lowest top in this many cells around its own: the fit
 * tolerance, without which a peg the size of its hole would sit on the rim. _(proposal)_
 */
export const DROP_NEIGHBOURHOOD = 1;
/**
 * A basin and a contact footprint whose long axis is at least this many times the short
 * one are aligned: a tab is turned into its slot. _(proposal)_
 */
export const ELONGATED_ASPECT = 1.3;

/** What the user changed about the placement, all relative to the detection (design note §3). */
export interface PlacementOptions {
  /** Moves the figure from the detected spot, scene x and z, base file units. */
  moveMm?: [number, number];
  /** Raises (positive) or sinks the figure from the drop height. */
  liftMm?: number;
  /** Turns the figure about the vertical, on top of any alignment the detection applied (§4.5). */
  turnDeg?: number;
}

export interface Placement {
  spot: Spot;
  /** The figure's contact footprint that was matched: its extent in x and z. */
  contactMm: [number, number];
  /** Where the figure ended up: its contact centre relative to the base's origin (x, z), and its lift above y = 0. */
  offsetMm: [number, number, number];
  /**
   * The turn about the vertical applied to the figure, degrees, in the sense of a three.js
   * `rotation.y`: counter-clockwise seen from above.
   */
  yawDeg: number;
  /** `detected`: the heuristic alone. `manual`: the user moved, turned, raised or lowered it. */
  method: 'detected' | 'manual';
  /** Every basin that was considered, best first, for the corpus report and tuning. */
  candidates: Spot[];
}

export interface PairResult {
  pairing: Pairing;
  placement: Placement;
  /** The merged full-detail mesh lists the figure's vertices and triangles first: the page splits it there for the preview (§6). */
  figureVertices: number;
  figureTriangles: number;
  /** How the base file stands: its detection, or the user's choice (#92). */
  baseOrientation: Orientation;
}

/**
 * The long axis of a set of x/z points: the major eigenvector of their covariance, in closed
 * form with one sqrt, and how elongated they are (the square root of the eigenvalues' ratio,
 * the ratio of the spreads). Infinity for points on a line.
 */
export function principalAxis(
  count: number,
  point: (k: number) => [number, number],
): { axis: [number, number]; elongation: number } {
  let mx = 0;
  let mz = 0;
  for (let k = 0; k < count; k++) {
    const [x, z] = point(k);
    mx += x;
    mz += z;
  }
  mx /= count;
  mz /= count;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let k = 0; k < count; k++) {
    const [x, z] = point(k);
    sxx += (x - mx) * (x - mx);
    szz += (z - mz) * (z - mz);
    sxz += (x - mx) * (z - mz);
  }
  const mean = (sxx + szz) / 2;
  const spread = Math.sqrt(((sxx - szz) / 2) * ((sxx - szz) / 2) + sxz * sxz);
  const major = mean + spread;
  const minor = mean - spread;
  const elongation = minor > 0 ? Math.sqrt(major / minor) : major > 0 ? Infinity : 1;
  // Two forms of the same eigenvector; the longer one is the better conditioned.
  const a: [number, number] = [sxz, major - sxx];
  const b: [number, number] = [major - szz, sxz];
  let [ux, uz] = a[0] * a[0] + a[1] * a[1] >= b[0] * b[0] + b[1] * b[1] ? a : b;
  const length = Math.sqrt(ux * ux + uz * uz);
  if (length === 0) return { axis: sxx >= szz ? [1, 0] : [0, 1], elongation };
  ux /= length;
  uz /= length;
  return { axis: [ux, uz], elongation };
}

/**
 * Sets the figure on its base (design note §4.5), in this order, all about the figure's
 * contact centre: turned so a long contact footprint lies along a long basin (never more
 * than 90°), then by the user's turn; moved onto the spot's centre plus the user's move; set
 * at the height where, on the spot and before the user's turn, it first touches the top (or
 * the floor beside the base); then raised or sunk by the user's lift. Returns new positions for the figure; the input is
 * left untouched.
 *
 * @param figure The figure, Y-up on y = 0 (after its own `orientAndPlace`).
 * @param map The base's top.
 * @param choice Where it goes (`chooseSpot`).
 * @param contact The figure's contact footprint (`contactFootprint`).
 */
export function placeFigure(
  figure: IndexedMesh,
  map: HeightMap,
  choice: Choice,
  contact: Contact,
  options: PlacementOptions = {},
): { positions: Float32Array; placement: Placement } {
  const source = figure.positions;
  const { spot, basin } = choice;

  // Alignment, as the cosine and sine of a turn that takes x towards z.
  let c = 1;
  let s = 0;
  if (basin && contact.points.length >= 2) {
    const { columns, cellMm, origin } = map;
    const cells = basin.cells;
    const hole = principalAxis(cells.length, (k) => {
      const i = cells[k]! % columns;
      const j = (cells[k]! - i) / columns;
      return [origin[0] + i * cellMm, origin[1] + j * cellMm];
    });
    const feet = principalAxis(contact.points.length, (k) => {
      const p = contact.points[k]! * 3;
      return [source[p]!, source[p + 2]!];
    });
    if (hole.elongation >= ELONGATED_ASPECT && feet.elongation >= ELONGATED_ASPECT) {
      let [vx, vz] = hole.axis;
      const [ux, uz] = feet.axis;
      // Axes have no direction: the smaller of the two turns.
      if (ux * vx + uz * vz < 0) {
        vx = 0 - vx;
        vz = 0 - vz;
      }
      c = ux * vx + uz * vz;
      s = ux * vz - uz * vx;
    }
  }
  const [alignC, alignS] = [c, s];
  const turnDeg = options.turnDeg ?? 0;
  if (turnDeg !== 0) {
    // A three.js rotation.y by θ turns x towards -z: sine -sin θ in the sense used here.
    const theta = (turnDeg * Math.PI) / 180;
    const tc = Math.cos(theta);
    const ts = 0 - Math.sin(theta);
    const nc = c * tc - s * ts;
    s = s * tc + c * ts;
    c = nc;
  }

  const move = options.moveMm ?? [0, 0];
  const [cx, cz] = contact.centre;
  const tx = spot.centre[0] + move[0];
  const tz = spot.centre[1] + move[1];
  const placeAt = (x: number, z: number, cos: number, sin: number): Float32Array => {
    const out = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 3) {
      const dx = source[i]! - cx;
      const dz = source[i + 2]! - cz;
      out[i] = x + cos * dx - sin * dz;
      out[i + 1] = source[i + 1]!;
      out[i + 2] = z + sin * dx + cos * dz;
    }
    return out;
  };
  const positions = placeAt(tx, tz, c, s);

  // The height is the detected spot's, moved or turned or not: the page previews a move and a
  // turn at that height, and Apply keeps what it showed. A registered figure keeps the files'.
  const moved = move[0] !== 0 || move[1] !== 0 || turnDeg !== 0;
  const drop =
    choice.keepLiftMm ??
    dropHeight(moved ? placeAt(spot.centre[0], spot.centre[1], alignC, alignS) : positions, map);
  const lift = drop + (options.liftMm ?? 0);
  if (lift !== 0) for (let i = 1; i < positions.length; i += 3) positions[i] = positions[i]! + lift;

  const manual = moved || (options.liftMm ?? 0) !== 0;
  return {
    positions,
    placement: {
      spot,
      contactMm: contact.sizeMm,
      offsetMm: [tx, tz, lift],
      yawDeg: s === 0 && c > 0 ? 0 : (0 - Math.atan2(s, c) * 180) / Math.PI,
      method: manual ? 'manual' : 'detected',
      candidates: choice.candidates,
    },
  };
}

/**
 * How far a figure standing on y = 0 must rise to rest on the top: the largest of the
 * lowest top around each vertex minus its height, and never below the floor. Vertices
 * over cells outside the base do not constrain.
 */
export function dropHeight(positions: Float32Array, map: HeightMap): number {
  const { columns, rows, top, cellMm, origin } = map;
  const reach = DROP_NEIGHBOURHOOD;
  // The lowest top around each cell, once, so each vertex reads one number: NaN outside.
  const lowestAround = new Float64Array(top.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const cell = j * columns + i;
      if (Number.isNaN(top[cell]!)) {
        lowestAround[cell] = NaN;
        continue;
      }
      let lowest = Infinity;
      for (let jj = Math.max(0, j - reach); jj <= Math.min(rows - 1, j + reach); jj++) {
        for (let ii = Math.max(0, i - reach); ii <= Math.min(columns - 1, i + reach); ii++) {
          const h = top[jj * columns + ii]!;
          if (h < lowest) lowest = h;
        }
      }
      lowestAround[cell] = lowest;
    }
  }
  let lift = 0;
  for (let v = 0; v < positions.length; v += 3) {
    const i = Math.round((positions[v]! - origin[0]) / cellMm);
    const j = Math.round((positions[v + 2]! - origin[1]) / cellMm);
    if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
    // NaN outside the base: the comparison fails and the vertex does not constrain.
    const rise = lowestAround[j * columns + i]! - positions[v + 1]!;
    if (rise > lift) lift = rise;
  }
  return lift;
}

/**
 * A figure within this distance of resting on the base where its file puts it, in the base's
 * frame, was exported registered with it. The build's survey: 13 of 40 library pairs that stand
 * the same way up (design note §4.4). _(proposal)_
 */
export const REGISTERED_TOLERANCE_MM = 0.3;

/** The two files as welded, and how the base was turned: what the registration test reads. */
export interface PairFiles {
  figure: IndexedMesh;
  base: IndexedMesh;
  baseRotation: Rotation;
}

/**
 * The registration test (design note §4.4): the figure turned by the base's rotation and shifted
 * the way the base was placed, then dropped straight down from its own x and z. When the drop
 * lands within `REGISTERED_TOLERANCE_MM` of the height the files give it, the files were
 * exported with the figure on the base, and that is the placement. Returns the figure standing
 * on y = 0 at the files' x and z, and its height in the files; null otherwise.
 */
export function registeredFigure(
  files: PairFiles,
  base: PlacedMesh,
  map: HeightMap,
): { mesh: IndexedMesh; heightMm: number } | null {
  if (base.mesh.positions.length < 3 || files.figure.positions.length < 3) return null;
  // The shift the base was placed with: its first vertex turned, against where it ended up.
  const first = turnPositions(files.base.positions.subarray(0, 3), files.baseRotation);
  const shift = [0, 1, 2].map((k) => first[k]! - base.mesh.positions[k]!);
  const positions = turnPositions(files.figure.positions, files.baseRotation);
  let low = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i]! - shift[0]!;
    positions[i + 1] = positions[i + 1]! - shift[1]!;
    positions[i + 2] = positions[i + 2]! - shift[2]!;
    if (positions[i + 1]! < low) low = positions[i + 1]!;
  }
  for (let i = 1; i < positions.length; i += 3) positions[i] = positions[i]! - low;
  const drop = dropHeight(positions, map);
  if (!(drop > 0) || Math.abs(low - drop) > REGISTERED_TOLERANCE_MM) return null;
  return { mesh: { positions, indices: files.figure.indices }, heightMm: low };
}

/**
 * A figure belongs near the middle of its base: when the seat or the flattest patch would put
 * its box centre further than this share of the base's width from the base's centre, the box
 * is centred on the base instead and dropped. On every corpus pair the sheets called right the
 * built rule stays within 25 %, on every one called wrong it is 42–129 % away (design note
 * §4.4, from the PM's hand placements). _(proposal)_
 */
export const CENTRE_MAX_SHARE = 0.3;
/** A contact footprint wider than this share of the base is extremities (wing tips): centred at once. _(proposal)_ */
export const WIDE_CONTACT_SHARE = 0.8;

/** The centre of the x/z bounding box of a mesh's vertices. */
function boxCentre(positions: Float32Array): [number, number] {
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
  return [(minX + maxX) / 2, (minZ + maxZ) / 2];
}

/**
 * The centre guard (design note §4.4): the choice as it is, or, when the figure's box centre
 * would land further than `CENTRE_MAX_SHARE` of the base's width from the base's centre, or its
 * contact is wider than `WIDE_CONTACT_SHARE` of the base, the figure's box over the base's
 * centre (spot `flat`, `centred`, sized like the base).
 *
 * @param baseSizeMm The base's footprint, x and z: its measured outline, or its bounding box.
 */
export function guardCentre(
  figure: IndexedMesh,
  map: HeightMap,
  choice: Choice,
  contact: Contact,
  baseSizeMm: [number, number],
): Choice {
  const width = Math.max(baseSizeMm[0], baseSizeMm[1]);
  const figureCentre = boxCentre(figure.positions);
  const centred = (): Choice => ({
    // The contact centre goes where it takes the box centre onto the base's centre.
    spot: {
      kind: 'flat',
      centre: [contact.centre[0] - figureCentre[0], contact.centre[1] - figureCentre[1]],
      sizeMm: baseSizeMm,
      depthMm: 0,
      fit: 0,
      centred: true,
    },
    basin: null,
    candidates: choice.candidates,
  });
  if (Math.max(contact.sizeMm[0], contact.sizeMm[1]) > WIDE_CONTACT_SHARE * width) return centred();
  // Without a turn the figure only moves by the contact centre's shift, box centre included;
  // a seat that turns it is placed for real.
  const [x, z] =
    choice.basin === null
      ? [
          figureCentre[0] + choice.spot.centre[0] - contact.centre[0],
          figureCentre[1] + choice.spot.centre[1] - contact.centre[1],
        ]
      : boxCentre(placeFigure(figure, map, choice, contact).positions);
  return Math.sqrt(x * x + z * z) > CENTRE_MAX_SHARE * width ? centred() : choice;
}

/** A contact vertex within this height of the base's top touches it. */
export const TOUCH_MM = 0.3;

/**
 * How well a placed figure rests on the base: the share of its contact vertices within
 * `TOUCH_MM` of the top under them. It picks between two candidate up axes of the figure.
 */
export function touchShare(positions: Float32Array, points: number[], map: HeightMap): number {
  const { columns, rows, top, cellMm, origin } = map;
  if (points.length === 0) return 0;
  let touching = 0;
  for (const p of points) {
    const i = Math.round((positions[p * 3]! - origin[0]) / cellMm);
    const j = Math.round((positions[p * 3 + 2]! - origin[1]) / cellMm);
    if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
    const h = top[j * columns + i]!;
    if (!Number.isNaN(h) && Math.abs(positions[p * 3 + 1]! - h) <= TOUCH_MM) touching++;
  }
  return touching / points.length;
}

/** The base's top, read once: its height map and the basins that would hold rain. */
export interface BaseTop {
  map: HeightMap;
  basins: Basin[];
}

export function readBaseTop(base: PlacedMesh): BaseTop {
  const map = topHeightMap(base.mesh);
  return { map, basins: findBasins(map) };
}

/**
 * How the figure of a pair stands before it is placed (issue #92, design note
 * docs/design/up-before-reduce.md §4.2): registered, or the candidate that touches the base
 * better. The orient step decides it when it asks about the figure; the place step does not
 * repeat it.
 */
export interface FigureDecision {
  top: BaseTop;
  /** Which of the candidates stays: 0 the first, 1 the alternative. */
  candidate: 0 | 1;
  /** The figure where its file puts it, when the pair is registered; else null. */
  registered: { mesh: IndexedMesh; heightMm: number } | null;
}

/**
 * The decision of `placeOnBase`, without the placing: the base's top, the registration test
 * when `files` are given, and between two candidates the one touching the base better.
 */
export function decideFigure(
  figure: PlacedMesh,
  base: PlacedMesh,
  files?: PairFiles,
  alternative?: PlacedMesh,
): FigureDecision {
  const top = readBaseTop(base);
  const { map, basins } = top;
  const registered = files ? registeredFigure(files, base, map) : null;
  let candidate: 0 | 1 = 0;
  if (!registered && alternative) {
    const touch = (mesh: IndexedMesh): number => {
      const contact = contactFootprint(mesh.positions);
      const trial = placeFigure(mesh, map, chooseSpot(map, basins, contact), contact);
      return touchShare(trial.positions, contact.points, map);
    };
    if (touch(alternative.mesh) > touch(figure.mesh)) candidate = 1;
  }
  return { top, candidate, registered };
}

/**
 * The place step (design note §4): the base's top, its basins, the figure's contact
 * footprint, the spot, the figure set on it, and the two merged, the figure first. The
 * merged mesh keeps the base's origin, so it stands centred on its base like a single file,
 * and its base is the one measured from the base file.
 *
 * @param figure The figure after its own `orientAndPlace`.
 * @param base The base file after its own `orientAndPlace`.
 * @param files The files as welded, for the registration test; left out, it is not run (the
 *   user chose the figure's orientation).
 * @param alternative The figure turned to a second candidate up axis (design note §9 step 4):
 *   placed both ways, the one touching the base better stays; `candidate` says which.
 * @param decided What `decideFigure` found, when the orient step decided it already (#92):
 *   then `files` and `alternative` are not tested again.
 */
export function placeOnBase(
  figure: PlacedMesh,
  base: PlacedMesh,
  pairing: Pairing,
  options: PlacementOptions = {},
  files?: PairFiles,
  alternative?: PlacedMesh,
  decided?: FigureDecision,
): { merged: PlacedMesh; pair: Omit<PairResult, 'baseOrientation'>; candidate: 0 | 1 } {
  const { top, registered, candidate } = decided ?? decideFigure(figure, base, files, alternative);
  const { map, basins } = top;
  if (candidate === 1) figure = alternative!;
  const placing = registered?.mesh ?? figure.mesh;
  const contact = contactFootprint(placing.positions);
  let choice = chooseSpot(map, basins, contact);
  if (!registered) {
    const size: [number, number] = base.base
      ? base.base.footprintMm
      : [base.sizeMm[0], base.sizeMm[2]];
    choice = guardCentre(placing, map, choice, contact, size);
  }
  if (registered)
    choice = {
      spot: {
        kind: 'registered',
        centre: contact.centre,
        sizeMm: contact.sizeMm,
        depthMm: 0,
        fit: 0,
      },
      basin: null,
      candidates: choice.candidates,
      keepLiftMm: registered.heightMm,
    };
  const { positions, placement } = placeFigure(placing, map, choice, contact, options);
  const mesh = mergeMeshes({ positions, indices: figure.mesh.indices }, base.mesh);
  return {
    candidate,
    merged: { mesh, sizeMm: extentOf(mesh.positions), base: base.base },
    pair: {
      pairing,
      placement,
      figureVertices: positions.length / 3,
      figureTriangles: figure.mesh.indices.length / 3,
    },
  };
}

/** Width, height and depth of a mesh's vertices. */
function extentOf(positions: Float32Array): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]!;
      if (value < min[k]!) min[k] = value;
      if (value > max[k]!) max[k] = value;
    }
  }
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

/** One mesh of two: the first's vertices and triangles first, then the second's, indices offset. */
export function mergeMeshes(first: IndexedMesh, second: IndexedMesh): IndexedMesh {
  const count = first.positions.length;
  const positions = new Float32Array(count + second.positions.length);
  positions.set(first.positions);
  positions.set(second.positions, count);
  const indices = new Uint32Array(first.indices.length + second.indices.length);
  indices.set(first.indices);
  const offset = count / 3;
  for (let i = 0; i < second.indices.length; i++)
    indices[first.indices.length + i] = second.indices[i]! + offset;
  return { positions, indices };
}
