import { FLAT_ANGLE_COS, measureBase, MIN_BASE_COVERAGE, RESTING_BAND } from './base';
import type { IndexedMesh } from './mesh';
import type { BaseMeasurement } from './size';

/** The direction in the source file that points up. */
export type UpAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const UP_AXES: readonly UpAxis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

/** Slicers and most print files are Z-up. */
export const DEFAULT_UP: UpAxis = '+z';

export interface UpDetection {
  up: UpAxis;
  /**
   * `base`: a flat underside was found, which is reliable. `tallest`: no base, so the
   * taller of the two common conventions (Y-up from sculpting tools, Z-up from slicers)
   * was picked. That is right for standing figures and wrong for long, low creatures,
   * so the user must be able to override it.
   */
  method: 'base' | 'tallest';
  /** Flat resting area as a share of the footprint, for the chosen axis. 0–1, roughly. */
  coverage: number;
}

export interface PlacedMesh {
  mesh: IndexedMesh;
  /** Width (x), height (y) and depth (z) in mm, in scene axes. */
  sizeMm: [number, number, number];
  /** The base the mini stands on, measured after placing; null when it has none. */
  base: BaseMeasurement | null;
}

/**
 * Finds which way is up by looking for the base: minis rest on a large flat underside.
 * For each of the six directions it adds up the area of faces that point straight down
 * and lie on the lowest plane, relative to the footprint seen from that direction.
 * Minis without a base fall back to a weaker guess; see `UpDetection.method`.
 */
export function detectUpAxis(mesh: IndexedMesh): UpDetection {
  const { positions, indices } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i]!;
    if (value < min[i % 3]!) min[i % 3] = value;
    if (value > max[i % 3]!) max[i % 3] = value;
  }
  const extent = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];

  // Resting area per candidate, indexed like UP_AXES.
  const resting = new Float64Array(6);
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
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const doubleArea = Math.hypot(normal[0]!, normal[1]!, normal[2]!);
    if (doubleArea === 0) continue;

    for (let axis = 0; axis < 3; axis++) {
      const alignment = normal[axis]! / doubleArea;
      if (Math.abs(alignment) < FLAT_ANGLE_COS) continue;
      const centre = (positions[a + axis]! + positions[b + axis]! + positions[c + axis]!) / 3;
      const band = extent[axis]! * RESTING_BAND;
      // A face pointing towards -axis on the lowest plane means +axis is up, and vice versa.
      const area = doubleArea / 2;
      if (alignment < 0 && centre - min[axis]! <= band)
        resting[axis * 2] = resting[axis * 2]! + area;
      if (alignment > 0 && max[axis]! - centre <= band)
        resting[axis * 2 + 1] = resting[axis * 2 + 1]! + area;
    }
  }

  let best = -1;
  let bestCoverage = 0;
  for (let candidate = 0; candidate < 6; candidate++) {
    const axis = candidate >> 1;
    const footprint = extent[(axis + 1) % 3]! * extent[(axis + 2) % 3]!;
    const coverage = footprint > 0 ? resting[candidate]! / footprint : 0;
    if (coverage > bestCoverage) {
      best = candidate;
      bestCoverage = coverage;
    }
  }

  if (best < 0 || bestCoverage < MIN_BASE_COVERAGE) {
    const up = extent[1]! > extent[2]! ? '+y' : DEFAULT_UP;
    return { up, method: 'tallest', coverage: bestCoverage };
  }
  return { up: UP_AXES[best]!, method: 'base', coverage: bestCoverage };
}

/**
 * Rotations taking the source up direction to scene +y. All are proper rotations, so
 * triangle winding is kept. `0 - value` rather than `-value` avoids negative zeros.
 */
const TO_Y_UP: Record<UpAxis, (x: number, y: number, z: number) => [number, number, number]> = {
  '+y': (x, y, z) => [x, y, z],
  '-y': (x, y, z) => [0 - x, 0 - y, z],
  '+z': (x, y, z) => [x, z, 0 - y],
  '-z': (x, y, z) => [x, 0 - z, y],
  '+x': (x, y, z) => [0 - y, x, z],
  '-x': (x, y, z) => [y, 0 - x, z],
};

/**
 * Converts a mesh to the scene convention: Y-up, standing on y = 0, with the origin at
 * the centre of its base in x and z (the centre of its bounding box when it has no base),
 * so the table can centre it in its footprint. Units are never changed. Returns a new mesh; the input is left
 * untouched.
 */
export function orientAndPlace(mesh: IndexedMesh, sourceUp: UpAxis = DEFAULT_UP): PlacedMesh {
  const rotate = TO_Y_UP[sourceUp];
  const positions = new Float32Array(mesh.positions.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    const rotated = rotate(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!);
    for (let axis = 0; axis < 3; axis++) {
      const value = rotated[axis]!;
      positions[i + axis] = value;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
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
  const measured = measureBase(placed);
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
