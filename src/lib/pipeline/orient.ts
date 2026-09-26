import { FLAT_ANGLE_COS, measureBase, MIN_BASE_COVERAGE, RESTING_BAND } from './base';
import type { IndexedMesh } from './mesh';
import type { BaseMeasurement } from './size';
import type { Vec3 } from './base';
import {
  angleDeg,
  apply,
  AXIS_ROTATION,
  axisVector,
  fileUp,
  fromTo,
  multiply,
  nearestAxis,
  nearestUpAxis,
  toMatrix,
  type Rotation,
} from './rotation';
import { setDown } from './stance';

/** The direction in the source file that points up. */
export type UpAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const UP_AXES: readonly UpAxis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

/**
 * A shell counts as open when its face area vectors do not cancel out to within this share
 * of its area: in a closed shell they sum to zero. An open sheet's enclosed "volume" is
 * the cone from wherever it is measured, so its centroid is taken from the surface instead.
 * A few small holes stay under it. _(proposal)_
 */
export const OPEN_SHELL_SHARE = 0.02;

/** Slicers and most print files are Z-up. */
export const DEFAULT_UP: UpAxis = '+z';

/**
 * A mini whose resting plane lies within this angle of a file axis stands on that axis:
 * it is turned by the quarter turn alone, so a mini that rests flat is not moved. The
 * issue's number (#72). _(proposal)_
 */
export const LEVEL_TOLERANCE_DEG = 2;

/** How a mini stands: the result of the orient step (issue #72). */
export interface Orientation {
  /** The six-way direction taken as up in the file: the coarse step, the nearest axis of `rotation`. */
  up: UpAxis;
  /**
   * `base`: a flat underside decided, which is reliable. `tallest`: no base, so the taller
   * of the two common conventions (Y-up from sculpting tools, Z-up from slicers) was taken:
   * right for standing figures, wrong for long, low creatures. `manual`: the user's choice.
   * A detection for minis without a base is open (#72, PR #79).
   */
  method: 'base' | 'tallest' | 'manual';
  /** base: coverage of the footprint. tallest: 0. manual: 1. */
  confidence: number;
  /** File coordinates → scene coordinates (Y-up), before the shift to the base centre and before any scale. */
  rotation: Rotation;
  /** Angle between the final up direction and the axis `up`: how far the mini was turned beyond a quarter turn. 0 when it rested flat, or stands on a base. */
  tiltDeg: number;
  /** The angle by which setting down turned the mini. 0 when it was not set down, or already rested level. */
  setDownDeg: number;
}

/** What the user chose about orientation; everything left out is detected. */
export interface OrientationOptions {
  /** The coarse step: which file axis is up. Overrides the detection. */
  up?: UpAxis;
  /** A full rotation, file → scene, from the page's free turn. Overrides `up`. */
  rotation?: Rotation;
  /**
   * Set the mini down on its lowest points after the turn. Default false: the axis or
   * rotation given is kept exactly, because the user's placement is final (PM decision on
   * PR #79, 2026-09-25). The page's Set down button sends true.
   */
  setDown?: boolean;
}

export interface UpDetection {
  orientation: Orientation;
  /** Resting-area coverage per candidate axis, indexed like UP_AXES: what a forced axis reads its base from. */
  coverageByAxis: number[];
  /** What the stance search needs, kept so that nothing is measured twice. */
  scan: MeshScan;
}

/** The figures of the one pass over a mesh's triangles, in file coordinates. */
export interface MeshScan {
  min: Vec3;
  max: Vec3;
  /** Volume centroid, or the surface centroid when the volume is unusable (an open or inside-out shell). */
  centroid: Vec3;
  /** Enclosed volume in cubic file units; 0 or less for an open or inside-out shell. */
  volume: number;
}

export interface PlacedMesh {
  mesh: IndexedMesh;
  /** Width (x), height (y) and depth (z) in mm, in scene axes. */
  sizeMm: [number, number, number];
  /** The base the mini stands on, measured after placing; null when it has none. */
  base: BaseMeasurement | null;
}

/** Bounding box of a mesh's vertices: min x, y, z, then max x, y, z. */
function boundsOf(positions: Float32Array): Float64Array {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    minX = x < minX ? x : minX;
    maxX = x > maxX ? x : maxX;
    minY = y < minY ? y : minY;
    maxY = y > maxY ? y : maxY;
    minZ = z < minZ ? z : minZ;
    maxZ = z > maxZ ? z : maxZ;
  }
  return Float64Array.of(minX, minY, minZ, maxX, maxY, maxZ);
}

/** What `sumTriangles` returns, by position. */
const enum Sum {
  /** Twice the resting area per candidate, indexed like UP_AXES: 0–5. */
  Rest = 0,
  /** Six times the enclosed volume. */
  Volume6 = 6,
  /** First moments of the volume (×24) about the bounding-box centre, x y z. */
  Moment = 7,
  /** Twice the surface area. */
  Area2 = 10,
  /** Sum of the face area vectors (×2), x y z: zero for a closed shell. */
  Open = 11,
  /** First moments of the surface area (×6) about the bounding-box centre, x y z. */
  Surface = 14,
  Count = 17,
}

/**
 * The loop over every triangle, in the order of the indices. On a mesh whose vertices do
 * not fit the processor's cache, fetching the corners is most of the time: 260 ms of about
 * 600 on the largest corpus file (5.6 M triangles, development PC; #72 journal entry).
 */
function sumTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  bounds: Float64Array,
): Float64Array {
  const flatCos = FLAT_ANGLE_COS;
  const minX = bounds[0]!;
  const minY = bounds[1]!;
  const minZ = bounds[2]!;
  const maxX = bounds[3]!;
  const maxY = bounds[4]!;
  const maxZ = bounds[5]!;
  const bandX = (maxX - minX) * RESTING_BAND;
  const bandY = (maxY - minY) * RESTING_BAND;
  const bandZ = (maxZ - minZ) * RESTING_BAND;
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const oz = (minZ + maxZ) / 2;

  let restPX = 0;
  let restNX = 0;
  let restPY = 0;
  let restNY = 0;
  let restPZ = 0;
  let restNZ = 0;
  let volume6 = 0;
  let momentX = 0;
  let momentY = 0;
  let momentZ = 0;
  let area2 = 0;
  let openX = 0;
  let openY = 0;
  let openZ = 0;
  let surfaceX = 0;
  let surfaceY = 0;
  let surfaceZ = 0;

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const by = positions[b + 1]!;
    const bz = positions[b + 2]!;
    const cx = positions[c]!;
    const cy = positions[c + 1]!;
    const cz = positions[c + 2]!;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const squared = nx * nx + ny * ny + nz * nz;
    if (squared === 0) continue;
    const doubleArea = Math.sqrt(squared);

    const sumX = ax + bx + cx - 3 * ox;
    const sumY = ay + by + cy - 3 * oy;
    const sumZ = az + bz + cz - 3 * oz;
    const tetra6 = (ax - ox) * nx + (ay - oy) * ny + (az - oz) * nz;
    volume6 += tetra6;
    momentX += tetra6 * sumX;
    momentY += tetra6 * sumY;
    momentZ += tetra6 * sumZ;
    area2 += doubleArea;
    openX += nx;
    openY += ny;
    openZ += nz;
    surfaceX += doubleArea * sumX;
    surfaceY += doubleArea * sumY;
    surfaceZ += doubleArea * sumZ;

    // A face pointing towards -axis on the lowest plane means +axis is up, and vice versa.
    // Within 10° of an axis, a face cannot be within 10° of another, so one test at most holds.
    const flat = flatCos * doubleArea;
    if (nx <= -flat) {
      if ((ax + bx + cx) / 3 - minX <= bandX) restPX += doubleArea;
    } else if (nx >= flat) {
      if (maxX - (ax + bx + cx) / 3 <= bandX) restNX += doubleArea;
    } else if (ny <= -flat) {
      if ((ay + by + cy) / 3 - minY <= bandY) restPY += doubleArea;
    } else if (ny >= flat) {
      if (maxY - (ay + by + cy) / 3 <= bandY) restNY += doubleArea;
    } else if (nz <= -flat) {
      if ((az + bz + cz) / 3 - minZ <= bandZ) restPZ += doubleArea;
    } else if (nz >= flat) {
      if (maxZ - (az + bz + cz) / 3 <= bandZ) restNZ += doubleArea;
    }
  }

  const sums = new Float64Array(Sum.Count);
  sums.set([restPX, restNX, restPY, restNY, restPZ, restNZ], Sum.Rest);
  sums.set([volume6, momentX, momentY, momentZ], Sum.Volume6);
  sums.set([area2, openX, openY, openZ, surfaceX, surfaceY, surfaceZ], Sum.Area2);
  return sums;
}

/**
 * The one pass over a mesh's triangles (issue #72). For each of the six directions it
 * adds up the area of faces that point straight down and lie on the lowest plane,
 * relative to the footprint seen from that direction: a mini on a base has a large flat
 * underside. In the same loop it sums the enclosed volume and its centroid (signed
 * tetrahedra from the bounding-box centre, which keeps the terms small), and the
 * area-weighted surface centroid as the fallback for open shells.
 *
 * No allocation and no `Math.hypot` per triangle: this runs over 5.6 M triangles on the
 * largest corpus file.
 */
function scanMesh(mesh: IndexedMesh): Omit<UpDetection, 'orientation'> {
  const bounds = boundsOf(mesh.positions);
  const sums = sumTriangles(mesh.positions, mesh.indices, bounds);
  const min: Vec3 = [bounds[0]!, bounds[1]!, bounds[2]!];
  const max: Vec3 = [bounds[3]!, bounds[4]!, bounds[5]!];
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const coverageByAxis = UP_AXES.map((_, candidate) => {
    const axis = candidate >> 1;
    const footprint = extent[(axis + 1) % 3]! * extent[(axis + 2) % 3]!;
    return footprint > 0 ? sums[Sum.Rest + candidate]! / 2 / footprint : 0;
  });

  // The volume is usable for a closed, outward-facing shell: positive, and the face area
  // vectors cancel out.
  const origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const volume6 = sums[Sum.Volume6]!;
  const area2 = sums[Sum.Area2]!;
  const open = Math.sqrt(
    sums[Sum.Open]! ** 2 + sums[Sum.Open + 1]! ** 2 + sums[Sum.Open + 2]! ** 2,
  );
  const volume = volume6 / 6;
  const usable = Number.isFinite(volume) && volume > 0 && open <= OPEN_SHELL_SHARE * area2;
  const centroid = origin.map((o, axis) =>
    usable
      ? o + sums[Sum.Moment + axis]! / (4 * volume6)
      : area2 > 0
        ? o + sums[Sum.Surface + axis]! / (3 * area2)
        : o,
  ) as Vec3;
  return { coverageByAxis, scan: { min, max, centroid, volume: usable ? volume : 0 } };
}

/**
 * Finds how a mini stands: on a base when the one pass finds a flat underside on an axis
 * (never levelled), otherwise on the taller of Y-up and Z-up (see `Orientation.method`).
 */
export function detectUpAxis(mesh: IndexedMesh): UpDetection {
  return resolveOrientation(mesh, {});
}

/** The resting-area coverage the pass found for one axis. */
export const coverageFor = (detection: Omit<UpDetection, 'orientation'>, up: UpAxis): number =>
  detection.coverageByAxis[UP_AXES.indexOf(up)]!;

/** A quarter turn: how a mini on a base, or one that rests flat, is turned. */
function quarterTurn(up: UpAxis, method: Orientation['method'], confidence: number): Orientation {
  return { up, method, confidence, rotation: AXIS_ROTATION[up], tiltDeg: 0, setDownDeg: 0 };
}

const Y_UP: Vec3 = [0, 1, 0];

/**
 * Sets the mini down on its lowest points, starting from the up direction `from` (file
 * coordinates), and builds the rotation that levels it: `base` followed by the smallest turn
 * that takes the resting plane's normal to +y. Within `LEVEL_TOLERANCE_DEG` of an axis
 * the plain quarter turn is kept instead, so a mini that rests flat is not moved.
 *
 * @param base The rotation to level: the user's, or null for the quarter turn of the axis
 *   nearest to the resting plane's normal (which fixes the yaw the six-way way).
 */
function levelled(
  positions: Float32Array,
  from: Vec3,
  base: Rotation | null,
  method: Orientation['method'],
  confidence: number,
): Orientation {
  const n = setDown(positions, [0 - from[0], 0 - from[1], 0 - from[2]]);
  const up = nearestAxis(n);
  const tiltDeg = angleDeg(n, axisVector(up));
  if (tiltDeg <= LEVEL_TOLERANCE_DEG) {
    return { ...quarterTurn(up, method, confidence), setDownDeg: angleDeg(from, axisVector(up)) };
  }
  const start = base ?? AXIS_ROTATION[up];
  const rotation = multiply(fromTo(apply(start, n), Y_UP), start);
  return {
    up: nearestUpAxis(rotation),
    method,
    confidence,
    rotation,
    tiltDeg,
    setDownDeg: angleDeg(from, n),
  };
}

/**
 * The orient step's decision (design note §3): the detection, or what the user chose.
 * A forced axis or rotation is kept as given, and set down only when `setDown` asks for
 * it; a forced axis with a base on it is never levelled.
 */
export function resolveOrientation(
  mesh: IndexedMesh,
  options: OrientationOptions = {},
): UpDetection {
  const pass = scanMesh(mesh);
  const { positions } = mesh;
  const hasBase = (up: UpAxis): boolean => coverageFor(pass, up) >= MIN_BASE_COVERAGE;
  const setsDown = options.setDown === true && positions.length > 0;

  let orientation: Orientation;
  if (options.rotation) {
    const from = fileUp(options.rotation);
    const up = nearestUpAxis(options.rotation);
    orientation = setsDown
      ? levelled(positions, from, options.rotation, 'manual', 1)
      : {
          up,
          method: 'manual',
          confidence: 1,
          rotation: options.rotation,
          tiltDeg: angleDeg(from, axisVector(up)),
          setDownDeg: 0,
        };
  } else if (options.up) {
    orientation =
      hasBase(options.up) || !setsDown
        ? quarterTurn(options.up, 'manual', 1)
        : levelled(positions, axisVector(options.up), AXIS_ROTATION[options.up], 'manual', 1);
  } else {
    let best = 0;
    for (let candidate = 1; candidate < 6; candidate++)
      if (pass.coverageByAxis[candidate]! > pass.coverageByAxis[best]!) best = candidate;
    const coverage = pass.coverageByAxis[best]!;
    if (coverage >= MIN_BASE_COVERAGE) {
      orientation = quarterTurn(UP_AXES[best]!, 'base', coverage);
    } else {
      const { min, max } = pass.scan;
      const up = max[1] - min[1] > max[2] - min[2] ? '+y' : DEFAULT_UP;
      orientation = quarterTurn(up, 'tallest', 0);
    }
  }
  return { orientation, ...pass };
}

/**
 * Rotations taking the source up direction to scene +y. All are proper rotations, so
 * triangle winding is kept. `0 - value` rather than `-value` avoids negative zeros.
 */
export const TO_Y_UP: Record<
  UpAxis,
  (x: number, y: number, z: number) => [number, number, number]
> = {
  '+y': (x, y, z) => [x, y, z],
  '-y': (x, y, z) => [0 - x, 0 - y, z],
  '+z': (x, y, z) => [x, z, 0 - y],
  '-z': (x, y, z) => [x, 0 - z, y],
  '+x': (x, y, z) => [0 - y, x, z],
  '-x': (x, y, z) => [y, 0 - x, z],
};

/** The axis whose quarter turn `rotation` is exactly (either sign of the quaternion), or null. */
export function quarterTurnAxis(rotation: Rotation): UpAxis | null {
  for (const up of UP_AXES) {
    const q = AXIS_ROTATION[up];
    if (q.every((value, i) => value === rotation[i])) return up;
    if (q.every((value, i) => value === 0 - rotation[i]!)) return up;
  }
  return null;
}

/**
 * Converts a mesh to the scene convention: Y-up, standing on y = 0, with the origin at
 * the centre of its base in x and z (the centre of its bounding box when it has no base),
 * so the table can centre it in its footprint. Units are never changed. Returns a new mesh;
 * the input is left untouched.
 *
 * A quarter turn swaps and negates coordinates, so every coordinate keeps its bits; any
 * other rotation multiplies by its matrix and cannot stand on a base.
 *
 * @param orientation The rotation (`Orientation.rotation`), or a file axis for its quarter turn.
 * @param coverage The resting-area coverage of the rotation's axis (`coverageFor`): whether
 *   there is a base to measure. A quarter turn keeps every coordinate, so the coverage found
 *   before the turn is the coverage after it. Ignored for any other rotation.
 */
export function orientAndPlace(
  mesh: IndexedMesh,
  orientation: Rotation | UpAxis,
  coverage: number,
): PlacedMesh {
  const axis = typeof orientation === 'string' ? orientation : quarterTurnAxis(orientation);
  const source = mesh.positions;
  const positions = new Float32Array(source.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  if (axis) {
    const rotate = TO_Y_UP[axis];
    for (let i = 0; i < positions.length; i += 3) {
      const rotated = rotate(source[i]!, source[i + 1]!, source[i + 2]!);
      positions[i] = rotated[0];
      positions[i + 1] = rotated[1];
      positions[i + 2] = rotated[2];
    }
  } else {
    const m = toMatrix(orientation as Rotation);
    for (let i = 0; i < positions.length; i += 3) {
      const x = source[i]!;
      const y = source[i + 1]!;
      const z = source[i + 2]!;
      positions[i] = m[0]! * x + m[1]! * y + m[2]! * z;
      positions[i + 1] = m[3]! * x + m[4]! * y + m[5]! * z;
      positions[i + 2] = m[6]! * x + m[7]! * y + m[8]! * z;
    }
  }
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]!;
      if (value < min[k]!) min[k] = value;
      if (value > max[k]!) max[k] = value;
    }
  }

  if (positions.length === 0)
    return { mesh: { positions, indices: mesh.indices }, sizeMm: [0, 0, 0], base: null };

  const centreX = (min[0]! + max[0]!) / 2;
  const centreZ = (min[2]! + max[2]!) / 2;
  const floor = min[1]!;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i]! - centreX;
    positions[i + 1] = positions[i + 1]! - floor;
    positions[i + 2] = positions[i + 2]! - centreZ;
  }

  const placed = { positions, indices: mesh.indices };
  const measured = axis ? measureBase(placed, coverage) : null;
  if (measured && (measured.centre[0] !== 0 || measured.centre[1] !== 0)) {
    const [baseX, baseZ] = measured.centre;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = positions[i]! - baseX;
      positions[i + 2] = positions[i + 2]! - baseZ;
    }
  }

  return {
    mesh: placed,
    sizeMm: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!],
    base: measured?.base ?? null,
  };
}
