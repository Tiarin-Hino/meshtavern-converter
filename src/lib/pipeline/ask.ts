/**
 * The question after the orient step (issue #92, design note docs/design/up-before-reduce.md §3):
 * which way is up, asked on the full-detail mesh before anything is reduced. The pipeline asks
 * through a callback (`AskUp`), so it stays free of workers and DOM.
 */
import type { Vec3 } from './base';
import type { IndexedMesh } from './mesh';
import { quarterTurnAxis, TO_Y_UP, type Orientation, type OrientationOptions } from './orient';
import type { PairWarning } from './pair';
import { toMatrix, type Rotation } from './rotation';
import type { BaseMeasurement } from './size';

/** Which file a question is about: the only file, or for a pair the base first, then the figure. */
export type UpRole = 'mini' | 'base' | 'figure';

/** Why the file stands as the question shows it: what the page puts into words. */
export type UpReason =
  /** A flat underside of its own decided (`Orientation.method` `base`). */
  | 'base'
  /** No base: the taller of Y-up and Z-up (`tallest`). */
  | 'tallest'
  /** The figure of a pair: its print cut (`cut`, #90). */
  | 'cut'
  /** The figure of a pair: the files were exported together, so it stands the way its base does. */
  | 'registered'
  /** The base file: its flat underside within `UNDERSIDE_BAND_MM` (`FileOrientation.how` `band`). */
  | 'underside'
  /** The base file: its dominant plane, a tilted export (`dominant-plane`). */
  | 'tilted'
  /** The base file without a flat underside (after a swap, or when neither file has one): the up detection's guess (`detector`). */
  | 'guess'
  /** An axis or a turn that was chosen: by the person at the question, or by the options the conversion came with. */
  | 'chosen';

export interface UpQuestion {
  role: UpRole;
  /** Which of the files given: 0 the first, 1 the second. */
  file: 0 | 1;
  /** How the file stands now: the proposal, or what was last tried. */
  orientation: Orientation;
  reason: UpReason;
  /**
   * The box of the mesh turned by `orientation.rotation`, scene axes, file units, before
   * any shift: the page stands the mesh on the grid with it.
   */
  box: { min: Vec3; max: Vec3 };
  /** The base the file would stand on, measured as the pipeline will measure it; null without one. */
  base: BaseMeasurement | null;
  /** A pair only: what the guess of the roles found (`Pairing.warnings`), for the page to say. Empty for one file. */
  warnings: PairWarning[];
  /**
   * The welded mesh in file coordinates, positions and indices only: a copy, sent the first
   * time a file is asked about and never again. The page turns it by `orientation.rotation`.
   */
  mesh?: IndexedMesh;
}

export interface UpAnswer {
  /**
   * How the file should stand, resolved from scratch like `PipelineOptions.orientation`:
   * an axis, a rotation, Set down. Empty: as the converter proposes.
   */
  orientation: OrientationOptions;
  /** True: this is right, go on. False: show me how this stands (the question comes again, without the mesh). */
  confirm: boolean;
  /** A pair only: the other file is the base. The roles are exchanged and the questions start again with the base. */
  swap?: boolean;
}

/** Asked between the orient step and everything after it. Rejecting ends the conversion with that error. */
export type AskUp = (question: UpQuestion) => Promise<UpAnswer>;

/** Which files are asked about. A file that is not asked about stands as its options say, as today. */
export interface AskOptions {
  /** The single file, or the figure of a pair. Default true. */
  up?: boolean;
  /** The base file of a pair. Default true. */
  baseUp?: boolean;
}

/** One confirmed question, for the figures. */
export interface AskedUp {
  role: UpRole;
  /** Answers with `confirm: false` before the confirming one: 0 is the one click of a right detection. */
  tries: number;
  /** From posting the first question of this file to its confirming answer. Not part of any step's time. */
  waitedMs: number;
}

/** The welded mesh for the page: positions and indices copied, nothing else. The pipeline keeps its own. */
export const copyForQuestion = (mesh: IndexedMesh): IndexedMesh => ({
  positions: mesh.positions.slice(),
  indices: mesh.indices.slice(),
});

/**
 * The box of positions turned by a rotation, without turning a copy of them. A quarter turn
 * swaps and negates coordinates exactly, as `orientAndPlace` does, so its box is exact.
 */
export function turnedBox(positions: Float32Array, rotation: Rotation): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const include = (x: number, y: number, z: number): void => {
    if (x < min[0]) min[0] = x;
    if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y;
    if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z;
    if (z > max[2]) max[2] = z;
  };
  const axis = quarterTurnAxis(rotation);
  if (axis) {
    const rotate = TO_Y_UP[axis];
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = rotate(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      include(x, y, z);
    }
  } else {
    const m = toMatrix(rotation);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      include(
        m[0]! * x + m[1]! * y + m[2]! * z,
        m[3]! * x + m[4]! * y + m[5]! * z,
        m[6]! * x + m[7]! * y + m[8]! * z,
      );
    }
  }
  return { min, max };
}

/** Why a single file or a figure stands as it does, from how its orientation was decided. */
export function reasonOf(orientation: Orientation): UpReason {
  switch (orientation.method) {
    case 'base':
      return 'base';
    case 'tallest':
      return 'tallest';
    case 'cut':
      return 'cut';
    case 'manual':
      return 'chosen';
  }
}

/** Whether two sets of orientation options resolve to the same orientation, compared as given. */
export function sameOrientationOptions(a: OrientationOptions, b: OrientationOptions): boolean {
  if (a.up !== b.up || (a.setDown === true) !== (b.setDown === true)) return false;
  if (!a.rotation || !b.rotation) return a.rotation === b.rotation;
  return a.rotation.every((value, i) => Object.is(value, b.rotation![i]));
}
