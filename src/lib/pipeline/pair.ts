/**
 * A figure and its base as two files (issue #70, design note docs/design/base-file.md §4.1):
 * which of the two is the base, guessed from the shapes. Where the figure is set down on
 * the base is place.ts.
 */
import { measureBase, MIN_BASE_COVERAGE, type Vec3 } from './base';
import type { IndexedMesh } from './mesh';
import {
  coverageFor,
  LEVEL_TOLERANCE_DEG,
  orientAndPlace,
  quarterTurnAxis,
  resolveOrientation,
  TO_Y_UP,
  UP_AXES,
  type MeshScan,
  type Orientation,
  type OrientationOptions,
  type PlacedMesh,
  type UpAxis,
  type UpDetection,
} from './orient';
import { findBasins, topHeightMap } from './place';
import { ConversionProblem } from './problems';
import {
  angleDeg,
  AXIS_ROTATION,
  axisVector,
  fileUp,
  fromTo,
  nearestUpAxis,
  normalise,
} from './rotation';

/**
 * Both files have a flat underside: the one lower than this (height over the longer side of
 * the footprint) looks like a base. A 25 mm base 4 mm tall is 0.16, a 32 mm scenic base with
 * a 15 mm rock 0.47, a hound on an integral oval base about 0.6, a standing figure on its
 * base about 1.5. _(proposal)_
 */
export const BASE_MAX_ASPECT = 0.5;

export type PairWarning =
  /** Both files have a flat underside and are low and wide; the lower one was taken as the base. */
  | 'both-look-like-bases'
  /** The figure has a flat underside of its own (an integral base); it was set on the base anyway. */
  | 'figure-has-its-own-base';

export interface FileShape {
  /** Width, height and depth in file units after the file's own orientation. */
  sizeMm: [number, number, number];
  up: UpAxis;
  upMethod: Orientation['method'];
  /** Height over the longer side of the footprint: low and wide is small. */
  aspect: number;
  /** A flat underside covering `MIN_BASE_COVERAGE` of the footprint: what a base has. */
  flatUnderside: boolean;
}

export interface Pairing {
  /** Which of the two files is the base: 0 the first given, 1 the second. */
  baseFile: 0 | 1;
  method: 'guessed' | 'manual';
  warnings: PairWarning[];
  files: [FileShape, FileShape];
}

/** What the user chose about the pair. */
export interface PairingOptions {
  /** The other file is the base: the user swapped the guess. */
  swap?: boolean;
}

/**
 * The shape of one file after its own detection and placing: a flat underside is what the
 * detection calls a base (`method === 'base'`).
 *
 * @param orientation The file's own detection, without any of the user's options.
 * @param sizeMm Its size after `orientAndPlace`, Y-up.
 */
export function fileShape(orientation: Orientation, sizeMm: [number, number, number]): FileShape {
  const across = Math.max(sizeMm[0], sizeMm[2]);
  return {
    sizeMm,
    up: orientation.up,
    upMethod: orientation.method,
    aspect: across > 0 ? sizeMm[1] / across : Infinity,
    flatUnderside: orientation.method === 'base',
  };
}

/**
 * The underside of a base is found within this distance of the lowest point, not within a
 * share of the height: base undersides are hollow (a rim on the floor, the inner face 1–1.5 mm
 * up), and the 2 % band of a 5 mm base (0.1 mm) sees only the rim. 2 mm finds 860 of 864
 * library bases (design note §12). _(proposal)_
 */
export const UNDERSIDE_BAND_MM = 2;
/**
 * A base exported tilted has no axis-aligned underside; its dominant plane is taken as the
 * underside when it holds at least this share of the surface area. _(proposal)_
 */
export const DOMINANT_PLANE_SHARE = 0.1;
/**
 * Two opposite sides of a base whose underside coverages are this close are a plain disc with
 * a flat top: the side with the larger basins (hollowed, lettered) is the underside. _(proposal)_
 */
export const UNDERSIDE_TIE = 0.1;
/**
 * ...and only when that side's basins cover at least this share of the footprint: a hollowed
 * underside is one basin inside a rim, a seat for the figure on a plain top is much smaller
 * (the 14 mm recess of the generated base is 19 %). _(proposal, the build's refinement of §12's
 * tie-break: without it a plain disc with a seat on top comes out upside down)_
 */
export const HOLLOW_MIN_SHARE = 0.5;
/** Normals within this angle of an axis or of the dominant plane count as facing it. */
const FACING_COS = Math.cos((10 * Math.PI) / 180);

/** How one file of a pair stands, and whether it has what a base needs (design note §4.1). */
export interface FileOrientation {
  /** The orientation and the one pass over the triangles, as `resolveOrientation` returns it. */
  detection: UpDetection;
  /**
   * `band`: a flat underside within `UNDERSIDE_BAND_MM`. `dominant-plane`: a tilted export.
   * `detector`: neither, the up detection's guess. `chosen`: the user's axis or turn (#92).
   */
  how: 'band' | 'dominant-plane' | 'detector' | 'chosen';
  flatUnderside: boolean;
  /** The underside's coverage of the footprint: what `orientAndPlace` measures the base with. */
  coverage: number;
}

/**
 * Per entry of `UP_AXES`, the area of faces within 10° of pointing down along that up axis
 * whose centroid lies within `bandMm` of the lowest point, over the footprint seen from that
 * axis. `sumTriangles` in orient.ts does the same with a band relative to the height.
 */
export function undersideCoverage(mesh: IndexedMesh, scan: MeshScan, bandMm: number): number[] {
  const { min, max } = scan;
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return undersideArea(mesh, scan, bandMm).map((value, entry) => {
    const k = entry >> 1;
    const footprint = extent[(k + 1) % 3]! * extent[(k + 2) % 3]!;
    return footprint > 0 ? value / footprint : 0;
  });
}

/** The same areas in square file units, not as a share of the footprint. */
export function undersideArea(
  { positions, indices }: IndexedMesh,
  scan: MeshScan,
  bandMm: number,
): number[] {
  const { min, max } = scan;
  const area = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const area2 = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!);
    if (area2 === 0) continue;
    const flat = FACING_COS * area2;
    for (let k = 0; k < 3; k++) {
      // Facing -k on the lowest plane of k means +k is up (entry 2k), and the other way round.
      if (n[k]! <= -flat) {
        const centroid = (positions[a + k]! + positions[b + k]! + positions[c + k]!) / 3;
        if (centroid - min[k]! <= bandMm) area[2 * k] = area[2 * k]! + area2 / 2;
      } else if (n[k]! >= flat) {
        const centroid = (positions[a + k]! + positions[b + k]! + positions[c + k]!) / 3;
        if (max[k]! - centroid <= bandMm) area[2 * k + 1] = area[2 * k + 1]! + area2 / 2;
      }
    }
  }
  return area;
}

/**
 * The soles of a figure made for a separate base are cut flat at one plane where it stood on
 * it: the most coplanar flat area at an axis extreme, within this band, names its up axis
 * (issue #90). _(proposal)_
 */
export const PRINT_CUT_BAND_MM = 0.3;
/** A print cut is confident with at least this much flat area... (issue #90) _(proposal)_ */
export const PRINT_CUT_MIN_MM2 = 1;
/** ...and this many times the area of any other axis. _(proposal)_ */
export const PRINT_CUT_MIN_LEAD = 4;
/**
 * A weaker cut, with this much area and the lead, is a second candidate when it disagrees with
 * the up detection: the figure is placed both ways and the one touching the base better stays
 * (design note §9 step 4). Switched off by setting it to the confident area (the build, PR #89):
 * with the note's touch share it turned the bat (`flying-01`, right today) upside down, and the
 * one figure it was meant to turn right (`flying-04`) is a registered pair. The research's 0.3
 * compared by the surface match, which the design dropped. _(proposal, for the PM)_
 */
export const PRINT_CUT_WEAK_MM2 = PRINT_CUT_MIN_MM2;

/** The print-cut axis of a figure, how much flat area it has, and how confident it is. */
export interface PrintCut {
  up: UpAxis;
  areaMm2: number;
  /** Its area over the runner-up's; Infinity when no other axis has any. */
  lead: number;
  strength: 'confident' | 'weak' | 'none';
}

export function printCut(mesh: IndexedMesh, scan: MeshScan): PrintCut {
  const area = undersideArea(mesh, scan, PRINT_CUT_BAND_MM);
  let best = 0;
  for (let k = 1; k < 6; k++) if (area[k]! > area[best]!) best = k;
  let second = 0;
  for (let k = 0; k < 6; k++) if (k !== best && area[k]! > second) second = area[k]!;
  const areaMm2 = area[best]!;
  const lead = second > 0 ? areaMm2 / second : areaMm2 > 0 ? Infinity : 0;
  const strength =
    lead >= PRINT_CUT_MIN_LEAD && areaMm2 >= PRINT_CUT_MIN_MM2
      ? 'confident'
      : lead >= PRINT_CUT_MIN_LEAD && areaMm2 >= PRINT_CUT_WEAK_MM2
        ? 'weak'
        : 'none';
  return { up: UP_AXES[best]!, areaMm2, lead, strength };
}

/**
 * The candidate up axes of the figure of a pair (design note §9 step 4): the print cut when it
 * is confident; the detection and the cut when a weak cut disagrees with it (the pair's
 * placement then picks); else the detection alone. Each as a detection over the same pass.
 */
export function figureUpCandidates(mesh: IndexedMesh, pass: UpDetection): UpDetection[] {
  const cut = printCut(mesh, pass.scan);
  const detected = resolveOrientation(mesh, {}, pass);
  if (cut.strength === 'none' || cut.up === detected.orientation.up) return [detected];
  const turned = resolveOrientation(mesh, { up: cut.up }, pass);
  const confidence = Number.isFinite(cut.lead) ? 1 - 1 / cut.lead : 1;
  const byCut: UpDetection = {
    ...turned,
    orientation: { ...turned.orientation, method: 'cut', confidence },
  };
  return cut.strength === 'confident' ? [byCut] : [detected, byCut];
}

/**
 * The direction with the most face area within 10° of it: normals binned on a cube-sphere
 * (12 × 12 cells a face, by area), the best bin's direction refined twice as the area-weighted
 * mean of the normals within 10° of it. For a base exported at an angle this is its
 * underside's outward normal. `share` is that area over the whole surface.
 */
export function dominantPlane({ positions, indices }: IndexedMesh): {
  normal: Vec3;
  share: number;
} {
  const CELLS = 12;
  const bins = new Float64Array(6 * CELLS * CELLS);
  const count = indices.length / 3;
  const normals = new Float64Array(count * 3);
  const areas = new Float64Array(count);
  let total = 0;
  const cell = (value: number): number =>
    Math.min(CELLS - 1, Math.floor(((value + 1) / 2) * CELLS));
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (area2 === 0) continue;
    const x = nx / area2;
    const y = ny / area2;
    const z = nz / area2;
    normals[t * 3] = x;
    normals[t * 3 + 1] = y;
    normals[t * 3 + 2] = z;
    areas[t] = area2 / 2;
    total += area2 / 2;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let bin: number;
    if (ax >= ay && ax >= az)
      bin = (x > 0 ? 0 : 1) * CELLS * CELLS + cell(z / ax) * CELLS + cell(y / ax);
    else if (ay >= az) bin = (y > 0 ? 2 : 3) * CELLS * CELLS + cell(z / ay) * CELLS + cell(x / ay);
    else bin = (z > 0 ? 4 : 5) * CELLS * CELLS + cell(y / az) * CELLS + cell(x / az);
    bins[bin] = bins[bin]! + area2 / 2;
  }
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i]! > bins[best]!) best = i;
  const face = Math.floor(best / (CELLS * CELLS));
  const j = Math.floor((best % (CELLS * CELLS)) / CELLS);
  const i = best % CELLS;
  const u = -1 + ((i + 0.5) * 2) / CELLS;
  const v = -1 + ((j + 0.5) * 2) / CELLS;
  const sign = face % 2 === 0 ? 1 : -1;
  let dir: Vec3 = face < 2 ? [sign, u, v] : face < 4 ? [u, sign, v] : [u, v, sign];
  dir = normalise(dir);
  let share = 0;
  // Two passes over the faces facing the plane; the third only over those that lie in it, within
  // `UNDERSIDE_BAND_MM` of the extreme, so faces inside the base that face the same way (a part
  // that pokes into it) do not tilt the plane.
  for (let pass = 0; pass < 3; pass++) {
    let extreme = -Infinity;
    if (pass === 2)
      for (let v = 0; v < positions.length; v += 3) {
        const h = positions[v]! * dir[0] + positions[v + 1]! * dir[1] + positions[v + 2]! * dir[2];
        if (h > extreme) extreme = h;
      }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let near = 0;
    for (let t = 0; t < count; t++) {
      const d =
        normals[t * 3]! * dir[0] + normals[t * 3 + 1]! * dir[1] + normals[t * 3 + 2]! * dir[2];
      if (d < FACING_COS) continue;
      if (pass === 2) {
        const a = indices[t * 3]! * 3;
        const h = positions[a]! * dir[0] + positions[a + 1]! * dir[1] + positions[a + 2]! * dir[2];
        if (extreme - h > UNDERSIDE_BAND_MM) continue;
      }
      sx += normals[t * 3]! * areas[t]!;
      sy += normals[t * 3 + 1]! * areas[t]!;
      sz += normals[t * 3 + 2]! * areas[t]!;
      near += areas[t]!;
    }
    if (near === 0) break;
    dir = normalise([sx, sy, sz]);
    if (pass < 2) share = near / total;
  }
  return { normal: dir, share };
}

/** The area of the basins on the top of a mesh standing Y-up: how hollowed that side is. */
function basinArea(mesh: IndexedMesh): number {
  const map = topHeightMap(mesh);
  return findBasins(map).reduce((sum, basin) => sum + basin.cells.length, 0) * map.cellMm ** 2;
}

const OPPOSITE: Record<UpAxis, UpAxis> = {
  '+x': '-x',
  '-x': '+x',
  '+y': '-y',
  '-y': '+y',
  '+z': '-z',
  '-z': '+z',
};

/**
 * How a file of a pair stands, the way a base needs it (design note §4.1, §12):
 *
 * 1. A flat underside within `UNDERSIDE_BAND_MM` of the lowest point, covering
 *    `MIN_BASE_COVERAGE` of the footprint. A slab has one on more sides than its underside (the
 *    wall of a square base covers its side footprint), so of several the thinnest axis wins,
 *    and on that axis the side with the larger coverage. When the two sides are within
 *    `UNDERSIDE_TIE` (a plain disc, flat on both faces), the underside is the side whose
 *    basins cover more, when they cover `HOLLOW_MIN_SHARE` of the footprint: a hollowed
 *    underside inside a rim.
 * 2. Otherwise a dominant plane with `DOMINANT_PLANE_SHARE` of the area, more than
 *    `LEVEL_TOLERANCE_DEG` off every axis: a base exported tilted.
 * 3. Otherwise the up detection's guess, and no flat underside.
 */
export function baseOrientation(mesh: IndexedMesh): FileOrientation {
  const detection = resolveOrientation(mesh, {});
  const { scan } = detection;
  const coverage = undersideCoverage(mesh, scan, UNDERSIDE_BAND_MM);
  const extent = [0, 1, 2].map((axis) => scan.max[axis]! - scan.min[axis]!);
  let best = -1;
  for (let candidate = 0; candidate < UP_AXES.length; candidate++) {
    if (!(coverage[candidate]! >= MIN_BASE_COVERAGE)) continue;
    if (
      best < 0 ||
      extent[candidate >> 1]! < extent[best >> 1]! ||
      (candidate >> 1 === best >> 1 && coverage[candidate]! > coverage[best]!)
    )
      best = candidate;
  }
  if (best >= 0) {
    let up = UP_AXES[best]!;
    const other = OPPOSITE[up];
    const otherCoverage = coverage[UP_AXES.indexOf(other)]!;
    if (otherCoverage >= MIN_BASE_COVERAGE && coverage[best]! - otherCoverage <= UNDERSIDE_TIE) {
      // Standing on `up`, the underside is the top of the mesh turned the other way.
      const underside = (side: UpAxis): number =>
        basinArea(orientAndPlace(mesh, OPPOSITE[side], 0).mesh);
      const k = best >> 1;
      const footprint = extent[(k + 1) % 3]! * extent[(k + 2) % 3]!;
      const [here, there] = [underside(up), underside(other)];
      // Only a hollow covering much of the footprint says underside; a seat on a plain disc's top
      // or a logo is small, and then the coverage decides.
      if (there > here && there >= HOLLOW_MIN_SHARE * footprint) up = other;
    }
    const upCoverage = coverage[UP_AXES.indexOf(up)]!;
    return {
      detection: { ...detection, orientation: quarterTurnOrientation(up, upCoverage) },
      how: 'band',
      flatUnderside: true,
      coverage: upCoverage,
    };
  }
  const plane = dominantPlane(mesh);
  const offAxis = UP_AXES.every(
    (axis) => angleDeg(plane.normal, axisVector(axis)) > LEVEL_TOLERANCE_DEG,
  );
  if (plane.share >= DOMINANT_PLANE_SHARE && offAxis) {
    const rotation = fromTo(plane.normal, [0, -1, 0]);
    const orientation: Orientation = {
      up: nearestUpAxis(rotation),
      method: 'base',
      confidence: plane.share,
      rotation,
      tiltDeg: angleDeg(fileUp(rotation), axisVector(nearestUpAxis(rotation))),
      setDownDeg: 0,
    };
    return {
      detection: { ...detection, orientation },
      how: 'dominant-plane',
      flatUnderside: true,
      coverage: plane.share,
    };
  }
  return { detection, how: 'detector', flatUnderside: false, coverage: 0 };
}

/**
 * How a base file stands when the user chose its axis or turn (issue #92, design note §4.2). On a
 * quarter turn, its underside is measured in the 2 mm band like a detected one; any other
 * rotation is taken as the base's underside, because the user said so, and is measured after
 * placing, as a tilted export is.
 *
 * @param pass The one pass over the file's triangles, from `baseOrientation`.
 */
export function chosenBase(
  mesh: IndexedMesh,
  options: OrientationOptions,
  pass: Omit<UpDetection, 'orientation'>,
): FileOrientation {
  const detection = resolveOrientation(mesh, options, pass);
  const axis = quarterTurnAxis(detection.orientation.rotation);
  if (!axis) return { detection, how: 'chosen', flatUnderside: true, coverage: MIN_BASE_COVERAGE };
  const coverage = undersideCoverage(mesh, pass.scan, UNDERSIDE_BAND_MM)[UP_AXES.indexOf(axis)]!;
  return { detection, how: 'chosen', flatUnderside: coverage >= MIN_BASE_COVERAGE, coverage };
}

function quarterTurnOrientation(up: UpAxis, confidence: number): Orientation {
  return { up, method: 'base', confidence, rotation: AXIS_ROTATION[up], tiltDeg: 0, setDownDeg: 0 };
}

/**
 * A file of a pair placed as it stands: Y-up on y = 0, centred on its base. A base's outline is
 * measured within `UNDERSIDE_BAND_MM` of the floor, like its underside was found: the rim or lip
 * of a hollow underside alone would give a base a few millimetres wide. A tilted export is not
 * a quarter turn, so `orientAndPlace` does not measure it at all; it is measured here too.
 */
export function placeOriented(mesh: IndexedMesh, oriented: FileOrientation): PlacedMesh {
  const { orientation } = oriented.detection;
  if (oriented.how === 'detector')
    return orientAndPlace(
      mesh,
      orientation.rotation,
      coverageFor(oriented.detection, orientation.up),
    );
  const coverage = Math.max(oriented.coverage, MIN_BASE_COVERAGE);
  const placed = orientAndPlace(mesh, orientation.rotation, coverage);
  const measured = measureBase(placed.mesh, coverage, UNDERSIDE_BAND_MM);
  if (!measured) return placed;
  const [x, z] = measured.centre;
  const positions = placed.mesh.positions;
  if (x !== 0 || z !== 0)
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = positions[i]! - x;
      positions[i + 2] = positions[i + 2]! - z;
    }
  return { ...placed, base: measured.base };
}

/**
 * The shape of one file of a pair as `baseOrientation` stands it. A quarter turn only
 * exchanges the axes of the bounding box; a tilted export is placed to be measured.
 */
export function shapeOfFile(mesh: IndexedMesh, oriented: FileOrientation): FileShape {
  const { orientation, scan } = oriented.detection;
  let sizeMm: [number, number, number];
  // A turn that is not a quarter turn exchanges no axes: the file is placed to be measured.
  if (oriented.how === 'dominant-plane' || !quarterTurnAxis(orientation.rotation))
    sizeMm = placeOriented(mesh, oriented).sizeMm;
  else {
    const { min, max } = scan;
    const turned = TO_Y_UP[orientation.up](max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    sizeMm = [Math.abs(turned[0]), Math.abs(turned[1]), Math.abs(turned[2])];
  }
  return { ...fileShape(orientation, sizeMm), flatUnderside: oriented.flatUnderside };
}

/**
 * Which file is the base (design note §4.1). With one flat underside, that file, whatever its
 * aspect; with two, the lower aspect, with a warning; with none, a `not-a-pair` problem,
 * because two figures cannot be set on each other. `swap` exchanges the roles after the guess;
 * the warnings stay as computed.
 */
export function guessRoles(files: [FileShape, FileShape], options: PairingOptions = {}): Pairing {
  const [a, b] = files;
  let baseFile: 0 | 1;
  const warnings: PairWarning[] = [];
  if (a.flatUnderside && b.flatUnderside) {
    // Equal aspects keep the first file as the figure: the order the user gave them.
    baseFile = b.aspect <= a.aspect ? 1 : 0;
    const figure = files[1 - baseFile]!;
    warnings.push(
      figure.aspect <= BASE_MAX_ASPECT ? 'both-look-like-bases' : 'figure-has-its-own-base',
    );
  } else if (a.flatUnderside || b.flatUnderside) {
    baseFile = a.flatUnderside ? 0 : 1;
  } else {
    throw new ConversionProblem(
      'not-a-pair',
      `aspects ${a.aspect.toFixed(2)} and ${b.aspect.toFixed(2)}, no flat underside`,
    );
  }
  if (options.swap) baseFile = baseFile === 0 ? 1 : 0;
  return { baseFile, method: options.swap ? 'manual' : 'guessed', warnings, files };
}
