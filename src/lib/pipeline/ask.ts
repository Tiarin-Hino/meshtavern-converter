/**
 * The questions a conversion asks on the full-detail meshes before anything is reduced: which way
 * is up (issue #92, design note docs/design/up-before-reduce.md §3), and where the parts meet
 * (issue #93, docs/design/marks-where-parts-meet.md §3.5). The pipeline asks through a callback
 * (`AskUp`), so it stays free of workers and DOM.
 */
import type { PartResult } from './assemble';
import type { Vec3 } from './base';
import type { Mark, Meeting, PartJoint } from './marks';
import type { IndexedMesh } from './mesh';
import { quarterTurnAxis, TO_Y_UP, type Orientation, type OrientationOptions } from './orient';
import type { FileOrientation, PairWarning } from './pair';
import type { Placement } from './place';
import { apply, multiply, toMatrix, type Rotation } from './rotation';
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

/** A box in scene axes, file units. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** What the page draws at a question: one file's welded mesh at a transform, file coordinates to the scene (#93). */
export interface Shown {
  file: number;
  rotation: Rotation;
  translation: Vec3;
}

/** What every question carries: the meshes the page has not had yet, and where to draw what (#93, design note §3.5). */
interface QuestionBase {
  /**
   * The welded meshes of the files not yet sent in this conversion, positions and indices only:
   * copies, each file once. The page keeps them for the conversion and draws them as `shown` says.
   */
  meshes: { file: number; mesh: IndexedMesh }[];
  /** Every file drawn, at its transform: the worker decides every transform, the page composes none. */
  shown: Shown[];
  /** The box of all of it in scene axes, file units, standing on the grid: for the camera. */
  box: Box;
  /** Which file is the base (null: none) and which are the figure's parts, the body first: for the base select. */
  roles: { baseFile: number | null; figureFiles: number[] };
}

/** Which way is up, about one file or a figure's parts together (#92). */
export interface UpQuestion extends QuestionBase {
  kind: 'up';
  role: UpRole;
  /** The file asked about: the base, the only file, or the figure's body (standing for all its parts). */
  file: number;
  /** How the file stands now: the proposal, or what was last tried. */
  orientation: Orientation;
  reason: UpReason;
  /** The base the file would stand on, measured as the pipeline will measure it; null without one. */
  base: BaseMeasurement | null;
  /** Several files only: what the guess of the roles found (`Pairing.warnings`), for the page to say. Empty for one file. */
  warnings: PairWarning[];
}

/** Two marks where two parts meet, in the coordinates of the files they are on: what the page draws pins from. */
export interface MarkedPair {
  spot: Mark & { file: number };
  contact: Mark & { file: number };
}

/** Where the parts meet (#93): the figure's parts together, or the figure on its base. */
export interface MeetQuestion extends QuestionBase {
  kind: 'meet';
  /** `parts`: how the figure's parts go together. `base`: the figure on its base. */
  about: 'parts' | 'base';
  /** The figure's parts as they are put together now, the body first. */
  parts: PartResult[];
  /** `base` only: the placement shown, automatic or marked. */
  placement: Placement | null;
  /** The meetings marked so far, resolved: one per joint (`parts`), or the one meeting (`base`). */
  marks: MarkedPair[];
  /**
   * What the converter proposes where nothing is marked, as pins (PM decision 2026-09-30): where a
   * part the file puts in place touches the part next to it (`parts`; a part further than
   * `IN_PLACE_GAP_MM` from every other lies apart and has none), or where the automatic placement
   * set the figure (`base`).
   */
  proposed: MarkedPair[];
  /** `base` only: the figure standing beside its base, for marking both; null for `parts`. */
  apart: { shown: Shown[]; box: Box } | null;
}

export type Question = UpQuestion | MeetQuestion;

export interface UpAnswer {
  kind: 'up';
  /**
   * How the file should stand, resolved from scratch like `PipelineOptions.orientation`:
   * an axis, a rotation, Set down. Empty: as the converter proposes.
   */
  orientation: OrientationOptions;
  /** True: this is right, go on. False: show me how this stands (the question comes again). */
  confirm: boolean;
  /** Two files only: the other file is the base. The roles are exchanged and the questions start again with the base. */
  swap?: boolean;
  /** This file is the base, or null: no base, the parts of one figure. The questions start again with the parts (#93). */
  baseFile?: number | null;
}

export interface MeetAnswer {
  kind: 'meet';
  /** `parts`: the joints; a part left out stays where its file puts it. */
  joints: PartJoint[];
  /** `base`: the meeting of figure and base, or null for the automatic placement. */
  meeting: Meeting | null;
  /** True: this is right, go on. False: show me (the question comes again with it resolved). */
  confirm: boolean;
}

export type Answer = UpAnswer | MeetAnswer;

/** Asked between the steps (#92, #93). Rejecting ends the conversion with that error. The name stays: it asks every question. */
export type AskUp = (question: Question) => Promise<Answer>;

/** Which questions are asked. A question not asked is answered by the options, as without asking. */
export interface AskOptions {
  /** The single file, or the figure. Default true. */
  up?: boolean;
  /** The base file. Default true. */
  baseUp?: boolean;
  /** How a figure in parts goes together (#93). Default true. */
  parts?: boolean;
  /** Where the figure meets its base (#93): shown before the conversion for every pair (PM decision 2026-09-30). Default true. */
  meet?: boolean;
}

/** One confirmed question, for the figures. */
export interface AskedUp {
  role: UpRole | 'parts' | 'meet';
  /** Answers with `confirm: false` before the confirming one: 0 is the one click of a right proposal. */
  tries: number;
  /** From posting the first question of this file to its confirming answer. Not part of any step's time. */
  waitedMs: number;
}

/**
 * The figure is laid this far beside its base while both are marked (#93), so neither hides the
 * other. _(proposal)_
 */
export const APART_GAP_MM = 10;

/** The welded mesh for the page: positions and indices copied, nothing else. The pipeline keeps its own. */
export const copyForQuestion = (mesh: IndexedMesh): IndexedMesh => ({
  positions: mesh.positions.slice(),
  indices: mesh.indices.slice(),
});

/**
 * The box of positions turned by a rotation, without turning a copy of them. A quarter turn
 * swaps and negates coordinates exactly, as `orientAndPlace` does, so its box is exact.
 */
export function turnedBox(positions: Float32Array, rotation: Rotation): Box {
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
    // Turned by marks (#93): what the person set.
    case 'marked':
      return 'chosen';
  }
}

/** Why the base file of a pair stands as it does, from how it was stood. */
export function reasonOfBase(standing: FileOrientation): UpReason {
  switch (standing.how) {
    case 'band':
      return 'underside';
    case 'dominant-plane':
      return 'tilted';
    case 'detector':
      return 'guess';
    case 'chosen':
      return 'chosen';
  }
}

/** Whether two sets of orientation options resolve to the same orientation, compared as given. */
export function sameOrientationOptions(a: OrientationOptions, b: OrientationOptions): boolean {
  if (a.up !== b.up || (a.setDown === true) !== (b.setDown === true)) return false;
  if (!a.rotation || !b.rotation) return a.rotation === b.rotation;
  return a.rotation.every((value, i) => Object.is(value, b.rotation![i]));
}

/** Where a part is drawn from: its file, turned and moved into the figure's frame. */
export type PartPlace = Pick<PartResult, 'file' | 'rotation' | 'translation'>;

/** A part drawn in a scene that is itself turned and moved: the part's transform, then the scene's. */
export function composeShown(part: PartPlace, rotation: Rotation, translation: Vec3): Shown {
  const moved = apply(rotation, part.translation);
  return {
    file: part.file,
    rotation: multiply(rotation, part.rotation),
    translation: [moved[0] + translation[0], moved[1] + translation[1], moved[2] + translation[2]],
  };
}

/**
 * A figure's parts turned by `rotation` and stood on the grid by the box of them all (their
 * `positions` in the figure's frame): centred in x and z, on y = 0. What an up question and the
 * parts question draw.
 */
export function standShown(
  parts: readonly PartPlace[],
  positions: Float32Array,
  rotation: Rotation,
): { shown: Shown[]; box: Box } {
  const turned = turnedBox(positions, rotation);
  const shift: Vec3 = [
    0 - (turned.min[0] + turned.max[0]) / 2,
    0 - turned.min[1],
    0 - (turned.min[2] + turned.max[2]) / 2,
  ];
  return {
    shown: parts.map((part) => composeShown(part, rotation, shift)),
    box: {
      min: [turned.min[0] + shift[0], turned.min[1] + shift[1], turned.min[2] + shift[2]],
      max: [turned.max[0] + shift[0], turned.max[1] + shift[1], turned.max[2] + shift[2]],
    },
  };
}

/** The box of a mesh's vertices as they are. */
export function boxOf(positions: Float32Array): Box {
  return turnedBox(positions, [0, 0, 0, 1]);
}
