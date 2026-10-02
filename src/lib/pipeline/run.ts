import {
  APART_GAP_MM,
  boxOf,
  composeShown,
  copyForQuestion,
  reasonOf,
  reasonOfBase,
  sameOrientationOptions,
  standShown,
  turnedBox,
  type Answer,
  type AskedUp,
  type AskOptions,
  type AskUp,
  type Box,
  type MeetQuestion,
  type PartPlace,
  type Question,
  type Shown,
  type ShownPatch,
  type Target,
  type UpQuestion,
  type UpReason,
  type UpRole,
} from './ask';
import {
  assembleFigure,
  MAX_PARTS,
  placeSummary,
  proposedJoints,
  laidInARow,
  laidOutForPrint,
  pulledApart,
  resolvePairs,
  treesOver,
  wholePart,
  type PartResult,
  type PartsOptions,
  type TreeOf,
} from './assemble';
import { bake, type BakedMaps } from './bake';
import { detailResolutionFor, surfaceAreaMm2 } from './bake-policy';
import { compressDetail, DETAIL_EFFORT } from './compress';
import type { IndexedMesh } from './mesh';
import { computeVertexNormals, dropInvalidTriangles, weldVertices } from './mesh';
import { contactPatches } from './contact';
import {
  applyMeetAction,
  complete,
  MAX_PAIRS,
  marksOf,
  pairsAllowed,
  resolvePatch,
  strokesCovering,
  startMeeting,
  summaryOf,
  surfaceIndexOf,
  dropSurfaceIndex,
  type Hit,
  type MarkingAction,
  type Meeting,
  type MeetContext,
  type MeetDraft,
  type MeetNote,
  type MeetState,
  type PartJoint,
  type Patch,
  type PatchPick,
} from './marks';
import { checkFits, checkNeeded, estimateAssemblyBytes, estimatePairBytes } from './memory';
import {
  coverageFor,
  orientAndPlace,
  resolveOrientation,
  type Orientation,
  type OrientationOptions,
  type PlacedMesh,
  type UpAxis,
  type UpDetection,
} from './orient';
import {
  baseOrientation,
  bodyFile,
  chosenBase,
  figureFiles,
  figureUpCandidates,
  guessRoles,
  placeOriented,
  shapeOfFile,
  type FileOrientation,
  type FileShape,
  type Pairing,
  type PairingOptions,
} from './pair';
import {
  decideFigure,
  extentOf,
  mergeMeshes,
  placeMarked,
  placeOnBase,
  type BaseTop,
  type FigureDecision,
  type PairFiles,
  type PairResult,
  type PlacementOptions,
} from './place';
import { shade } from './shade';
import type { Vec3 } from './base';
import { sizeMini, type BaseMeasurement, type Sizing, type SizingOptions } from './size';
import {
  checkSourcePreset,
  orientationUnder,
  samePreset,
  sizingUnder,
  type SourcePreset,
} from './source-preset';
import { chainLods, LOD_SPECS, simplifierReady, simplifyToSpec, type Lod } from './simplify';
import { unwrap } from './unwrap';
import { ConversionProblem, isOutOfMemory } from './problems';
import {
  angleDeg,
  apply,
  axisVector,
  fileUp,
  fromAxisAngle,
  IDENTITY,
  invert,
  multiply,
  nearestUpAxis,
  type Rotation,
} from './rotation';
import { readStlTriangles, sniffStl, type StlFormat } from './stl';

/**
 * Every step in order. `assemble` runs only for a figure in several files (#93), `place` only for
 * a figure with its base file (#70).
 */
export const STEPS = [
  'read',
  'weld',
  'assemble',
  'orient',
  'place',
  'size',
  'simplify',
  'shade',
  'levels',
] as const;
/** The steps that turn the table level into a baked mini. They run unless baking is switched off. */
export const BAKE_STEPS = ['unwrap', 'bake', 'compress'] as const;
export type BakeStepName = (typeof BAKE_STEPS)[number];
export type StepName = (typeof STEPS)[number] | BakeStepName;

/** Index into `ConversionResult.lods` of the level that gets baked maps: the table level. */
export const BAKED_LEVEL = 1;

export interface Progress {
  /** The step that is about to run. */
  step: StepName;
  /** Share of steps already finished, 0–100. */
  percent: number;
  /** For long steps that can tell: how far this step itself is, 0–100. */
  stepPercent?: number;
}

export interface StepTiming {
  step: StepName;
  ms: number;
}

export interface LodStats {
  name: Lod['name'];
  decidedBy: Lod['decidedBy'];
  triangles: number;
  vertices: number;
  errorMm: number;
}

export interface ConversionStats {
  format: StlFormat;
  sourceTriangles: number;
  triangles: number;
  vertices: number;
  /** Dropped: corners welded together, or no area. */
  degenerateTriangles: number;
  /** Dropped: the same three corners as a triangle kept before. */
  duplicateTriangles: number;
  /** Dropped: a coordinate that is not a number or infinite. */
  invalidTriangles: number;
  /** Width, height and depth in scene mm, after any change of units or scale. */
  sizeMm: [number, number, number];
  /** Units, base, creature size and footprint: what the table needs to place the mini. */
  sizing: Sizing;
  /** Which way was taken as up in the file, and how that was decided: `orientation.up` and `.method`. */
  up: UpAxis;
  upMethod: Orientation['method'];
  /** How the mini stands: the rotation, the tilt and how it was decided (issue #72). */
  orientation: Orientation;
  lods: LodStats[];
  timings: StepTiming[];
  totalMs: number;
  /** Largest sum of pipeline buffers alive at once: a lower bound for the memory a conversion needs. */
  peakBufferBytes: number;
  /** Largest JS heap size seen between steps. Null where the browser does not expose it. */
  peakHeapBytes: number | null;
  /** Set when baking was wanted but the mini keeps the per-vertex look instead, and why. */
  bakeSkipped: BakeSkipped | null;
  /** A figure with its base file: which was the base and where the figure was set. Null for one file. */
  pair: PairResult | null;
  /** The same object as `ConversionResult.choices`. */
  choices: UpChoices;
  /** The questions of #92, in the order confirmed; empty when nothing was asked. */
  asked: AskedUp[];
}

/** The choices a conversion ended with. Converting the same files with them, and no questions, gives the same mini. */
export interface UpChoices {
  orientation: OrientationOptions;
  /** A pair only. */
  baseOrientation?: OrientationOptions;
  /** A pair only. */
  pairing?: PairingOptions;
  /** A figure in parts (#93): how they were put together. */
  parts?: PartsOptions;
  /** A pair placed by marks (#93): the meeting, in file coordinates. */
  placement?: PlacementOptions;
  /** The source preset the conversion ended with (#100); the options above are what was chosen by hand. */
  preset?: SourcePreset;
}

export type BakeSkipped =
  /** The texture the size policy chose is larger than the device can hold. */
  | { reason: 'device'; resolution: number; maxTextureSize: number }
  /** 'transcode' is the page's part: turning the KTX2 file into a GPU texture. */
  | { reason: 'failed'; step: BakeStepName | 'transcode'; message: string };

/** Figures of a bake, without the texture itself. */
export type BakeFigures = Omit<BakedMaps, 'detail'>;

export interface Baked {
  /** The table level with texture coordinates; more vertices than the level itself, because UV islands split them. */
  mesh: IndexedMesh;
  maps: BakeFigures;
  /** The detail texture as a KTX2 file (UASTC + Zstandard): the only copy that is kept. */
  ktx2: Uint8Array | null;
  /** Development only (compression switched off): the raw RGBA texture. Null otherwise. */
  detail: Uint8Array | null;
  /** Surface area of the table level, which decides the texture size when that is left to the policy. */
  tableAreaMm2: number;
  charts: number;
  utilisation: number;
}

export interface ConversionResult {
  /** The welded, oriented source mesh at full detail. */
  mesh: IndexedMesh;
  /** Reduced versions, highest detail first. */
  lods: Lod[];
  /** Only when baking was requested. */
  baked?: Baked;
  /** The same object as `stats.sizing`. */
  sizing: Sizing;
  /** The same object as `stats.orientation`: the figure's, for a pair. */
  orientation: Orientation;
  /** The same object as `stats.pair`. */
  pair: PairResult | null;
  /** The same object as `stats.choices`: what to convert with to get this mini again without questions. */
  choices: UpChoices;
  stats: ConversionStats;
}

function heapBytes(): number | null {
  // Non-standard and Chromium-only; most browsers do not expose it inside workers.
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

const meshBytes = (mesh: IndexedMesh): number =>
  mesh.positions.byteLength + mesh.indices.byteLength;

export interface PipelineOptions {
  onProgress?: (progress: Progress) => void;
  /** The user's axis or free turn, for when the detection is wrong (see OrientationOptions). */
  orientation?: OrientationOptions;
  /** Units, size, scale and plain base as the user chose them; the rest is guessed. */
  sizing?: SizingOptions;
  /**
   * A known export convention (#100): its up axis, units and scale lie under `orientation`,
   * `baseOrientation` and `sizing`, field by field; what is chosen there wins. Its axis counts as
   * a chosen one. Null or left out: everything is detected and guessed, the path of today.
   */
  preset?: SourcePreset | null;
  /**
   * Texture size for baked detail maps on the table level: 'auto' (the default) picks one
   * from the mini's surface area (see bake-policy.ts). A size in texels, or 0 to skip
   * baking, is for development.
   */
  bake?: number | 'auto';
  /** UASTC effort for the KTX2 file. Null keeps the raw texture instead: development only. */
  compress?: number | null;
  /** Largest texture the device can hold, when known. A mini that needs more keeps the per-vertex look. */
  maxTextureSize?: number;
  /**
   * Memory the conversion may use, from what the device reports (see memory.ts). A file
   * whose estimate is larger is refused before anything is read. Unset: no check.
   */
  memoryBudgetBytes?: number;
  /** The second STL of a figure-plus-base pair. Which one is the base is guessed unless `pairing.swap`. */
  secondStl?: ArrayBuffer;
  /**
   * The third file onwards (#93): the figure's other parts, or its base when the second file is a
   * part. At most `MAX_PARTS` files in all.
   */
  moreStl?: ArrayBuffer[];
  /** How the figure's parts are put together (#93). Left out: every part where its file puts it. */
  parts?: PartsOptions;
  /** For a pair: the user swapped figure and base. */
  pairing?: PairingOptions;
  /** For a pair: the user moved, turned, raised or lowered the figure on its base. */
  placement?: PlacementOptions;
  /** For a pair: the user's axis or turn for the base file. Left out, the base stands by its underside (#70). */
  baseOrientation?: OrientationOptions;
  /** Stops after the orient step and asks which way is up (#92). Left out, nothing is asked: the path of today. */
  askUp?: AskUp;
  /** With `askUp`: which files are asked about. */
  ask?: AskOptions;
}

/** Whether the user chose anything about the orientation. */
const choosesOrientation = (options: OrientationOptions): boolean =>
  options.up !== undefined || options.rotation !== undefined || options.setDown === true;

const placeAs = (mesh: IndexedMesh, detection: UpDetection): PlacedMesh => {
  const { orientation } = detection;
  return orientAndPlace(mesh, orientation.rotation, coverageFor(detection, orientation.up));
};

/** How a file stands at its question: what the question reports about it. */
interface Standing {
  orientation: Orientation;
  reason: UpReason;
  base: BaseMeasurement | null;
}

/** A single file after the orient step. */
interface OrientedOne extends Standing {
  figure: PlacedMesh;
  detection: UpDetection;
}

/** A single file as it stands with these options: the detection over the kept pass, and placed. */
function standOne(mesh: IndexedMesh, options: OrientationOptions, pass?: UpDetection): OrientedOne {
  const detection = resolveOrientation(mesh, options, pass);
  const figure = placeAs(mesh, detection);
  const { orientation } = detection;
  return { figure, detection, orientation, reason: reasonOf(orientation), base: figure.base };
}

/** A figure and its base file after the orient step: who is who, and how each stands. */
interface OrientedPair {
  figure: PlacedMesh;
  orientation: Orientation;
  /** The figure turned to a second candidate up axis, when there is one (design note §9 step 4). */
  alternative: { placed: PlacedMesh; orientation: Orientation } | undefined;
  base: PlacedMesh;
  pairing: BasePairing;
  /** The files as welded, for the registration test; undefined when the user chose the figure's axis. */
  files: PairFiles | undefined;
  baseOrientation: Orientation;
  /** What the orient step decided about the figure when it asked about it (#92); else the place step decides. */
  decided?: FigureDecision;
  /** The figure (one file, or the union of its parts) and the base as welded, whatever was chosen: what marks are resolved on (#93). */
  sources: { figure: IndexedMesh; base: IndexedMesh; baseRotation: Rotation };
  /** Every file as welded, by file index: a contact is resolved on its part's file (#93). */
  meshes: IndexedMesh[];
  /** The figure's parts, the body first. */
  parts: PartResult[];
}

/** Each file stood the way a base would (#70), and its shape so: once per conversion. */
interface FilesStanding {
  meshes: IndexedMesh[];
  standing: FileOrientation[];
  shapes: FileShape[];
}

function standFiles(meshes: IndexedMesh[]): FilesStanding {
  const standing = meshes.map((mesh) => baseOrientation(mesh));
  const shapes = meshes.map((mesh, k) => shapeOfFile(mesh, standing[k]!));
  return { meshes, standing, shapes };
}

/** The figure as the pair path sees it: one file, or its parts put together (#93), with its pass. */
interface FigureSource {
  mesh: IndexedMesh;
  /** The one pass over its triangles: its file's, or the union's. */
  pass: UpDetection;
  parts: PartResult[];
}

/** The figure of these roles: its one file as welded, or the union of its parts (the assemble step, #93). */
function figureSourceOf(
  { meshes, standing }: FilesStanding,
  pairing: Pairing,
  joints: readonly PartJoint[],
  treeOf?: TreeOf,
): FigureSource {
  const parts = figureFiles(pairing);
  if (parts.length === 1) {
    const file = parts[0]!;
    const mesh = meshes[file]!;
    return {
      mesh,
      pass: standing[file]!.detection,
      parts: [wholePart(file, mesh)],
    };
  }
  const assembled = assembleFigure(meshes, parts, joints, treeOf);
  return {
    mesh: assembled.mesh,
    pass: resolveOrientation(assembled.mesh, {}),
    parts: assembled.parts,
  };
}

/** Roles with a base file. */
type BasePairing = Pairing & { baseFile: number };

/** The roles, and the base standing as the options say and placed. */
interface PairBase extends Standing {
  pairing: BasePairing;
  /** The base file as welded. */
  mesh: IndexedMesh;
  /** How the base file stands: on its underside (#70), or as chosen. */
  standing: FileOrientation;
  placed: PlacedMesh;
}

function standBase(
  { meshes, standing }: FilesStanding,
  guessed: BasePairing,
  baseOptions: OrientationOptions,
): PairBase {
  const baseFile = guessed.baseFile;
  const baseMesh = meshes[baseFile]!;
  // The user's axis or turn for the base (#92); its shape is recorded as it then stands.
  const baseStanding = choosesOrientation(baseOptions)
    ? chosenBase(baseMesh, baseOptions, standing[baseFile]!.detection)
    : standing[baseFile]!;
  const pairing = withFileShape(guessed, baseFile, shapeOfFile(baseMesh, baseStanding));
  const placed = placeOriented(baseMesh, baseStanding);
  const orientation = baseStanding.detection.orientation;
  return {
    pairing,
    mesh: baseMesh,
    standing: baseStanding,
    placed,
    orientation,
    reason: reasonOfBase(baseStanding),
    base: placed.base,
  };
}

/** The figure of a pair as it stands before placing. */
interface PairFigure extends Standing {
  figure: PlacedMesh;
  /** The figure's own orientation (the first candidate's), which the place step starts from. */
  own: Orientation;
  alternative: OrientedPair['alternative'];
  files: PairFiles | undefined;
  decided?: FigureDecision;
}

/**
 * The figure of a pair: as the user chose, else by its print cut or the up detection, with a
 * second candidate when a weak cut disagrees (#70). With `decide` the orient step also decides
 * registration and the candidate (#92, design note §4.2), so that the question shows what the
 * pair's rules will do; `top` is the base's top read for an earlier question. A figure of
 * several parts is their union (#93).
 */
function standFigure(
  source: FigureSource,
  base: PairBase,
  options: OrientationOptions,
  decide: boolean,
  top?: BaseTop,
): PairFigure {
  const figureMesh = source.mesh;
  // A second candidate is placed by the place step; the pass is not run again.
  const pass = source.pass;
  const chosen = choosesOrientation(options);
  const candidates = chosen
    ? [resolveOrientation(figureMesh, options, pass)]
    : figureUpCandidates(figureMesh, pass);
  const first = candidates[0]!;
  const figure = placeAs(figureMesh, first);
  const alternative = candidates[1] && {
    placed: placeAs(figureMesh, candidates[1]),
    orientation: candidates[1].orientation,
  };
  // A figure turned by the user skips the registration test.
  const files = chosen
    ? undefined
    : {
        figure: figureMesh,
        base: base.mesh,
        baseRotation: base.orientation.rotation,
      };
  const own = first.orientation;
  const standingAs = { figure, own, alternative, files };
  if (!decide)
    return {
      ...standingAs,
      orientation: own,
      reason: reasonOf(own),
      base: figure.base,
    };

  const decided: FigureDecision =
    chosen && top
      ? { top, candidate: 0, registered: null }
      : decideFigure(figure, base.placed, files, alternative?.placed);
  if (decided.registered) {
    // Registered, it stands the way its base does, where its file puts it.
    const orientation = base.orientation;
    return {
      ...standingAs,
      decided,
      orientation,
      reason: 'registered',
      base: null,
    };
  }
  if (decided.candidate === 1 && alternative) {
    const { orientation, placed } = alternative;
    return {
      ...standingAs,
      decided,
      orientation,
      reason: reasonOf(orientation),
      base: placed.base,
    };
  }
  return {
    ...standingAs,
    decided,
    orientation: own,
    reason: reasonOf(own),
    base: figure.base,
  };
}

/** The orient step's result for a pair from how its base and figure stand. */
function orientedPairOf(
  { meshes }: FilesStanding,
  source: FigureSource,
  base: PairBase,
  figure: PairFigure,
): OrientedPair {
  return {
    sources: {
      figure: source.mesh,
      base: base.mesh,
      baseRotation: base.orientation.rotation,
    },
    meshes,
    parts: source.parts,
    figure: figure.figure,
    orientation: figure.own,
    alternative: figure.alternative,
    base: base.placed,
    pairing: base.pairing,
    files: figure.files,
    baseOrientation: base.orientation,
    decided: figure.decided,
  };
}

/**
 * The orient step for a pair without questions (design note §4.1): each file stands the way a
 * base would, the roles follow, the base stands on its underside and the figure as the user
 * chose, else by its print cut or the up detection.
 */
function orientFiles(
  files: FilesStanding,
  pairing: BasePairing,
  source: FigureSource,
  orientationOptions: OrientationOptions,
  baseOptions: OrientationOptions,
): OrientedPair {
  const base = standBase(files, pairing, baseOptions);
  return orientedPairOf(files, source, base, standFigure(source, base, orientationOptions, false));
}

/** Whether the roles name a base file. */
const hasBase = (pairing: Pairing): pairing is BasePairing => pairing.baseFile !== null;

/** The pairing options after a swap: toggled, or the other file named when there was no guess. */
function swapped(options: PairingOptions, pairing: Pairing): PairingOptions {
  if (options.baseFile !== undefined || pairing.warnings.includes('no-flat-underside'))
    return { baseFile: pairing.baseFile === 0 ? 1 : 0 };
  return options.swap ? {} : { swap: true };
}

/** The pairing with one file's shape replaced: how that file finally stands. */
function withFileShape(pairing: BasePairing, file: number, shape: FileShape): BasePairing {
  if (pairing.files[file] === shape) return pairing;
  const files = [...pairing.files];
  files[file] = shape;
  return { ...pairing, files };
}

/** A pair's place step, and the orientation the figure ends up with. */
interface PlacedPair {
  merged: PlacedMesh;
  pair: PairResult;
  orientation: Orientation;
  /** How the figure stood before it was placed: the pair's rules, or its question. */
  standing: Orientation;
  /** The figure's file frame (the body's, for parts) to the base's placed frame. */
  figureRotation: Rotation;
}

/**
 * How the figure of a pair stands before it is placed: as the pair's rules stood it (the
 * decision of #92, the same with questions or without): the base's way when registered, else the
 * candidate the decision took.
 */
function standingOf(oriented: OrientedPair): Orientation {
  const { figure, base, files, alternative } = oriented;
  const decided = oriented.decided ?? decideFigure(figure, base, files, alternative?.placed);
  if (decided.registered) return oriented.baseOrientation;
  return decided.candidate === 1 && alternative ? alternative.orientation : oriented.orientation;
}

/**
 * The figure placed on its base by pairs of patches (#93, patches design note §5.5). It stands
 * as the pair's rules stood it, and the fit moves, turns about the up or tilts it from there. An
 * `of` patch may be on any of the figure's parts: it is carried into the union by that part's
 * transform. The orientation is the composed one, `marked`, unless the meeting only moved the
 * figure: then it stands as it did. Null when no pair marks anything.
 */
function placeMarkedPair(
  oriented: OrientedPair,
  meeting: Meeting,
  treeOf: TreeOf,
): PlacedPair | null {
  const { base, pairing, sources, parts, meshes } = oriented;
  const partOf = (file: number): PartResult | undefined =>
    parts.find((entry) => entry.file === file);
  if (meeting.pairs.some(({ on, of }) => on.file !== pairing.baseFile || !partOf(of.file)))
    throw new ConversionProblem(
      'unexpected',
      `pairs on files ${meeting.pairs.map(({ on, of }) => `${on.file}/${of.file}`).join(', ')}, base ${pairing.baseFile}`,
    );
  const resolved = resolvePairs(meshes, treeOf, meeting.pairs);
  if (resolved.length === 0) return null;
  const standing = standingOf(oriented);
  const pairs = resolved.map(({ on, of }) => ({
    on: summaryOf(on),
    of: placeSummary(partOf(of.file)!, of),
  }));
  const placed = placeMarked(
    sources.figure,
    standing.rotation,
    base,
    sources.baseRotation,
    pairs,
    meeting,
  );
  const mesh = mergeMeshes(
    { positions: placed.positions, indices: sources.figure.indices },
    base.mesh,
  );
  const up = nearestUpAxis(placed.rotation);
  const orientation: Orientation =
    placed.meeting === IDENTITY
      ? standing
      : {
          up,
          method: 'marked',
          confidence: 1,
          rotation: placed.rotation,
          tiltDeg: angleDeg(fileUp(placed.rotation), axisVector(up)),
          setDownDeg: 0,
        };
  return {
    merged: { mesh, sizeMm: extentOf(mesh.positions), base: base.base },
    pair: {
      pairing,
      placement: placed.placement,
      figureVertices: placed.positions.length / 3,
      figureTriangles: sources.figure.indices.length / 3,
      baseOrientation: oriented.baseOrientation,
      parts,
    },
    orientation,
    standing,
    figureRotation: placed.rotation,
  };
}

/** The place step for a pair, and the orientation the figure ends up with. */
function placeOrientedPair(
  oriented: OrientedPair,
  placementOptions: PlacementOptions,
  treeOf: TreeOf,
): PlacedPair {
  if (placementOptions.marks) {
    const marked = placeMarkedPair(oriented, placementOptions.marks, treeOf);
    if (marked) return marked;
  }
  const { figure, base, pairing, files, alternative, decided, parts } = oriented;
  const placed = placeOnBase(
    figure,
    base,
    pairing,
    withoutMarks(placementOptions),
    files,
    alternative?.placed,
    decided,
  );
  let orientation = oriented.orientation;
  if (placed.candidate === 1 && alternative) orientation = alternative.orientation;
  // A registered figure stands the way its base does.
  if (placed.pair.placement.spot.kind === 'registered') orientation = oriented.baseOrientation;
  const pair: PairResult = {
    ...placed.pair,
    baseOrientation: oriented.baseOrientation,
    parts,
  };
  // The placement turns the figure about the vertical by its yaw (a three.js rotation.y).
  const { yawDeg } = placed.pair.placement;
  const figureRotation =
    yawDeg === 0
      ? orientation.rotation
      : multiply(fromAxisAngle([0, 1, 0], yawDeg), orientation.rotation);
  return {
    merged: placed.merged,
    pair,
    orientation,
    standing: orientation,
    figureRotation,
  };
}

/** Placement options without the marks: what the automatic placement takes. */
function withoutMarks(options: PlacementOptions): PlacementOptions {
  if (!('marks' in options)) return options;
  const rest = { ...options };
  delete rest.marks;
  return rest;
}

/** The first vertex of the figure: where its placed copy is compared with its file frame. */
function figureTranslation(figure: IndexedMesh, placed: Float32Array, rotation: Rotation): Vec3 {
  if (figure.positions.length < 3) return [0, 0, 0];
  const turned = apply(rotation, [
    figure.positions[0]!,
    figure.positions[1]!,
    figure.positions[2]!,
  ]);
  return [placed[0]! - turned[0], placed[1]! - turned[1], placed[2]! - turned[2]];
}

/** Where the base sits in its placed frame: turned, then shifted onto y = 0 and its centre. */
function baseShown(oriented: OrientedPair): Shown {
  const shift = oriented.base.shift ?? [0, 0, 0];
  return {
    file: oriented.pairing.baseFile,
    rotation: oriented.sources.baseRotation,
    translation: [0 - shift[0], 0 - shift[1], 0 - shift[2]],
  };
}

/**
 * The final view of a figure on its base (#93): the base's placed frame, the base where the
 * place step put it and every part of the figure where the placement put it.
 */
function meetShown(oriented: OrientedPair, placed: PlacedPair): { shown: Shown[]; box: Box } {
  const rotation = placed.figureRotation;
  const translation = figureTranslation(
    oriented.sources.figure,
    placed.merged.mesh.positions,
    rotation,
  );
  return {
    shown: [
      baseShown(oriented),
      ...oriented.parts.map((part) => composeShown(part, rotation, translation)),
    ],
    box: boxOf(placed.merged.mesh.positions),
  };
}

/**
 * The figure standing beside its base, `APART_GAP_MM` to its right (#93): the base as the place
 * step puts it, the figure as it stands before it is placed. The pairs stop of a pair.
 */
function apartShown(oriented: OrientedPair, standing: Rotation): { shown: Shown[]; box: Box } {
  const baseBox = boxOf(oriented.base.mesh.positions);
  const figureBox = turnedBox(oriented.sources.figure.positions, standing);
  const translation: Vec3 = [
    baseBox.max[0] + APART_GAP_MM - figureBox.min[0],
    0 - figureBox.min[1],
    0 - (figureBox.min[2] + figureBox.max[2]) / 2,
  ];
  const width = figureBox.max[0] - figureBox.min[0];
  const depth = (figureBox.max[2] - figureBox.min[2]) / 2;
  return {
    shown: [
      baseShown(oriented),
      ...oriented.parts.map((part) => composeShown(part, standing, translation)),
    ],
    box: {
      min: [baseBox.min[0], Math.min(baseBox.min[1], 0), Math.min(baseBox.min[2], 0 - depth)],
      max: [
        baseBox.max[0] + APART_GAP_MM + width,
        Math.max(baseBox.max[1], figureBox.max[1] - figureBox.min[1]),
        Math.max(baseBox.max[2], depth),
      ],
    },
  };
}

/**
 * Where the automatic placement sets the figure on its base, as pairs of patches (patches
 * design note §5.3): each part's vertices as placed, carried back into the base file's
 * coordinates, against the base file; the `MAX_PAIRS` largest pairs over all parts.
 */
function proposedPairs(
  oriented: OrientedPair,
  automatic: PlacedPair,
  treeOf: TreeOf,
): { on: Patch; of: Patch }[] {
  const { meshes, parts, pairing } = oriented;
  const baseFile = pairing.baseFile;
  const placed = automatic.merged.mesh.positions;
  const back = invert(oriented.sources.baseRotation);
  const shift = oriented.base.shift ?? [0, 0, 0];
  const pairs: { on: Patch; of: Patch }[] = [];
  let first = 0;
  for (const part of parts) {
    const mesh = meshes[part.file]!;
    const count = mesh.positions.length;
    const positions = new Float32Array(count);
    for (let i = 0; i < count; i += 3) {
      const p = apply(back, [
        placed[first + i]! + shift[0],
        placed[first + i + 1]! + shift[1],
        placed[first + i + 2]! + shift[2],
      ]);
      positions[i] = p[0];
      positions[i + 1] = p[1];
      positions[i + 2] = p[2];
    }
    first += count;
    pairs.push(
      ...contactPatches(
        { file: baseFile, mesh: meshes[baseFile]!, tree: treeOf(baseFile) },
        { file: part.file, mesh, positions },
      ),
    );
  }
  return pairs.sort((a, b) => b.of.areaMm2 - a.of.areaMm2).slice(0, MAX_PAIRS);
}
/** Where a figure was set on its base, without the steps after placing (development and tooling). */
export interface PairPlacement {
  pair: PairResult;
  /** The figure's orientation. */
  orientation: Orientation;
  /** The merged mesh in the base file's units, standing on y = 0 centred on the base. */
  mesh: IndexedMesh;
  /** The base as measured from the base file; null when it has none. */
  base: BaseMeasurement | null;
}

/**
 * The pair path up to and including the place step: read, weld, orient, place, with the same
 * options as `runPipeline`. For the placement score (`npm run score-placements`, the corpus
 * report): what a conversion would place, in seconds rather than minutes on a large figure.
 */
export function placePairOnly(
  stl: ArrayBuffer,
  secondStl: ArrayBuffer,
  options: Pick<
    PipelineOptions,
    'orientation' | 'pairing' | 'placement' | 'baseOrientation' | 'moreStl' | 'parts'
  > = {},
): PairPlacement {
  const meshes = [stl, secondStl, ...(options.moreStl ?? [])].map(
    (file) => weldVertices(dropInvalidTriangles(readStlTriangles(file)).soup).mesh,
  );
  const files = standFiles(meshes);
  const pairing = guessRoles(files.shapes, options.pairing ?? {}, 'refuse');
  if (!hasBase(pairing)) throw new ConversionProblem('not-a-pair', 'no base file');
  const source = figureSourceOf(files, pairing, options.parts?.joints ?? []);
  const oriented = orientFiles(
    files,
    pairing,
    source,
    options.orientation ?? {},
    options.baseOrientation ?? {},
  );
  const placed = placeOrientedPair(oriented, options.placement ?? {}, treesOver(meshes));
  return {
    pair: placed.pair,
    orientation: placed.orientation,
    mesh: placed.merged.mesh,
    base: placed.merged.base,
  };
}

/**
 * Runs every pipeline step on one STL, or on a figure's files (#70, #93). DOM-free, so it works
 * in a worker and in Node. A file that cannot become a mini throws a `ConversionProblem` (see
 * problems.ts).
 */
export async function runPipeline(
  stl: ArrayBuffer,
  {
    onProgress = () => {},
    orientation: orientationOptions = {},
    sizing: sizingOptions = {},
    preset: presetOption,
    bake: bakeRequest = 'auto',
    compress = DETAIL_EFFORT,
    maxTextureSize,
    memoryBudgetBytes,
    secondStl,
    moreStl = [],
    parts: partsOptions,
    pairing: pairingOptions = {},
    placement: placementOptions = {},
    baseOrientation: baseOrientationOptions = {},
    askUp,
    ask: askOptions = {},
  }: PipelineOptions = {},
): Promise<ConversionResult> {
  if (presetOption) checkSourcePreset(presetOption);
  /** The preset as it is now: an up answer may set or clear it (#100). */
  let presetChoice = presetOption ?? undefined;
  /** Orientation options as the steps see them: the preset's axis under what was chosen by hand. */
  const under = (options: OrientationOptions): OrientationOptions =>
    orientationUnder(presetChoice, options);
  const files = [stl, ...(secondStl ? [secondStl] : []), ...moreStl];
  if (files.length > MAX_PARTS)
    throw new ConversionProblem('too-many-files', `${files.length} files`);
  const format = sniffStl(new Uint8Array(stl), stl.byteLength);
  if (memoryBudgetBytes !== undefined) {
    if (files.length > 2) {
      const sized = files.map((file) => ({
        byteLength: file.byteLength,
        format: sniffStl(new Uint8Array(file), file.byteLength),
      }));
      checkNeeded(estimateAssemblyBytes(sized), memoryBudgetBytes);
    } else if (secondStl) {
      const secondFormat = sniffStl(new Uint8Array(secondStl), secondStl.byteLength);
      const needed = estimatePairBytes(stl.byteLength, format, secondStl.byteLength, secondFormat);
      checkNeeded(needed, memoryBudgetBytes);
    } else checkFits(stl.byteLength, format, memoryBudgetBytes);
  }
  const fileBytes = files.reduce((sum, file) => sum + file.byteLength, 0);

  const bakeSteps = BAKE_STEPS.filter((step) => step !== 'compress' || compress !== null);
  // The assemble step runs for a figure in parts, the place step for a figure on its base file.
  const assembling = files.length > 2 || (files.length === 2 && pairingOptions.baseFile === null);
  const placing = files.length > 1 && pairingOptions.baseFile !== null;
  let stepCount =
    STEPS.length -
    (placing ? 0 : 1) -
    (assembling ? 0 : 1) +
    (bakeRequest !== 0 ? bakeSteps.length : 0);
  // Compiling the WebAssembly simplifier is a one-off cost and not part of any step.
  await simplifierReady();

  const timings: StepTiming[] = [];
  let peakBufferBytes = 0;
  let peakHeapBytes = heapBytes();

  /** Announces a step; the function it returns records the step's time and memory when called. */
  const begin = (step: StepName): (<T>(result: T, liveBytes: number) => T) => {
    onProgress({ step, percent: Math.round((timings.length / stepCount) * 100) });
    const start = performance.now();
    return (result, liveBytes) => {
      timings.push({ step, ms: performance.now() - start });
      peakBufferBytes = Math.max(peakBufferBytes, liveBytes);
      const heap = heapBytes();
      if (heap !== null) peakHeapBytes = Math.max(peakHeapBytes ?? 0, heap);
      return result;
    };
  };
  const run = <T>(step: StepName, work: () => T, liveBytes: (result: T) => number): T => {
    const end = begin(step);
    const result = work();
    return end(result, liveBytes(result));
  };
  /** More work of a step that already ran: its time goes to the step's entry, nothing is announced. */
  const resume = <T>(step: StepName, work: () => T): T => {
    const start = performance.now();
    const result = work();
    const entry = timings.find((timing) => timing.step === step)!;
    entry.ms += performance.now() - start;
    return result;
  };

  // With several files, read, weld and orient each run over all of them inside their step.
  const reads = run(
    'read',
    () => files.map((file) => dropInvalidTriangles(readStlTriangles(file))),
    (r) => fileBytes + r.reduce((sum, read) => sum + read.soup.byteLength * 2, 0),
  );
  const soupBytes = reads.reduce((sum, read) => sum + read.soup.byteLength, 0);
  const invalidTriangles = reads.reduce((sum, read) => sum + read.invalidTriangles, 0);
  const sourceTriangles = reads.reduce(
    (sum, read) => sum + read.soup.length / 9 + read.invalidTriangles,
    0,
  );
  // While welding, the soup, the hash table and the per-corner scratch arrays coexist:
  // roughly three more soup-sized allocations.
  const welds = run(
    'weld',
    () => reads.map((read) => weldVertices(read.soup)),
    (w) => fileBytes + soupBytes * 4 + w.reduce((sum, weld) => sum + meshBytes(weld.mesh), 0),
  );
  welds.forEach((weld, k) => {
    if (weld.mesh.indices.length > 0) return;
    const read = reads[k]!;
    const which = files.length > 1 ? ` in file ${k + 1}` : '';
    throw new ConversionProblem(
      'no-surface',
      `${read.soup.length / 9 + read.invalidTriangles} triangles${which}, none usable`,
    );
  });
  const meshes = welds.map((weld) => weld.mesh);
  const weldedBytes = welds.reduce((sum, weld) => sum + meshBytes(weld.mesh), 0);
  const heldBytes = fileBytes + soupBytes + weldedBytes;
  /** Work of a step that may not have begun: begun here, else resumed. */
  const within = <T>(step: StepName, work: () => T): T => {
    if (timings.some((timing) => timing.step === step)) return resume(step, work);
    if (step === 'assemble' && !assembling) stepCount++;
    return run(step, work, () => heldBytes);
  };

  const orientedBytes = (figure: PlacedMesh, base: PlacedMesh | null): number =>
    heldBytes + figure.mesh.positions.byteLength + (base?.mesh.positions.byteLength ?? 0);

  const asked: AskedUp[] = [];
  /** Files whose welded mesh the page has had with a question: each travels once per conversion. */
  const sentFiles = new Set<number>();
  /** Copies of the meshes of the files shown that the page has not had yet. */
  const meshesFor = (shown: readonly Shown[]): Question['meshes'] => {
    const out: Question['meshes'] = [];
    for (const { file } of shown) {
      if (sentFiles.has(file)) continue;
      sentFiles.add(file);
      out.push({ file, mesh: copyForQuestion(meshes[file]!) });
    }
    return out;
  };
  /**
   * The files' search trees for marks and picks (patches design note §4): built once per file the
   * first time they are needed, released before the size step.
   */
  let trees: TreeOf | null = null;
  const treeOf: TreeOf = (file) => (trees ??= treesOver(meshes))(file);
  /** Patches resolved once per file and strokes: an answer that keeps a side does not pay for it again. */
  const patches = new Map<string, Patch>();
  const patchOf = (pick: PatchPick): Patch => {
    const key = `${pick.file}:${JSON.stringify(pick.strokes)}`;
    let patch = patches.get(key);
    if (!patch) {
      patch = resolvePatch(meshes[pick.file]!, treeOf(pick.file), pick);
      patches.set(key, patch);
    }
    return patch;
  };
  /** A patch for the page: its triangles copied, because they are transferred. */
  const shownPatch = (patch: Patch): ShownPatch => ({
    ...summaryOf(patch),
    triangles: patch.triangles.slice(),
  });
  /**
   * Where a finger is on the files drawn (§4): its ray carried into each file's frame by the
   * inverse of that file's transform, the nearest hit of all.
   */
  const hitOf = (target: Target, shown: readonly Shown[]): Hit | null => {
    if (!('ray' in target)) return { file: target.file, point: target.point };
    const { origin, direction } = target.ray;
    let best: Hit | null = null;
    let bestT = Infinity;
    for (const { file, rotation, translation } of shown) {
      const back = invert(rotation);
      const o = apply(back, [
        origin[0] - translation[0],
        origin[1] - translation[1],
        origin[2] - translation[2],
      ]);
      const d = apply(back, direction);
      const hit = treeOf(file).raycast(o, d);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = {
          file,
          point: [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t],
        };
      }
    }
    return best;
  };
  const rolesOf = (pairing: Pairing | null): Question['roles'] => ({
    baseFile: pairing?.baseFile ?? null,
    figureFiles: pairing ? figureFiles(pairing) : [0],
  });
  /** An answer of the wrong kind is the page's bug. */
  const expectAnswer = <K extends Answer['kind']>(
    answer: Answer,
    kind: K,
  ): Extract<Answer, { kind: K }> => {
    if (answer.kind !== kind)
      throw new ConversionProblem('unexpected', `a ${answer.kind} answer to a ${kind} question`);
    return answer as Extract<Answer, { kind: K }>;
  };

  /**
   * The proposal as the person's pairs, to edit (PM decision 2026-10-01): each patch as brush
   * dabs that cover it (`strokesCovering`). At the parts question a pair that would make two
   * parts hang on each other is left out.
   */
  const proposalDraft = (
    proposal: readonly { on: Patch; of: Patch }[],
    context: MeetContext,
  ): MeetDraft => {
    const onto = new Map<number, number>();
    const pairs: MeetDraft['pairs'] = [];
    for (const { on, of } of proposal) {
      if (context.about === 'parts') {
        let goesRound = false;
        for (let at: number | undefined = on.file; at !== undefined; at = onto.get(at))
          if (at === of.file) goesRound = true;
        const already = onto.get(of.file);
        if (goesRound || (already !== undefined && already !== on.file)) continue;
        onto.set(of.file, on.file);
      }
      const side = (patch: Patch): PatchPick => ({
        file: patch.file,
        strokes: strokesCovering(meshes[patch.file]!, treeOf(patch.file), patch),
      });
      pairs.push({ on: side(on), of: side(of) });
    }
    return {
      pairs: pairs.slice(0, pairsAllowed(context.about, context.figureFiles.length)),
      nudges: [],
    };
  };

  /** What a meet question needs to know about its step (patches design note §5.6). */
  interface MeetingAsk<P> {
    step: 'assemble' | 'place';
    context: MeetContext;
    /** The marks the conversion came with. */
    initial: Meeting | PartJoint[] | null;
    /** The base question: the automatic placement's lift and turn the conversion came with. */
    automatic: { liftMm?: number; turnDeg?: number };
    /** Every file shown: their trees are built while the first question waits. */
    files: readonly number[];
    /** Where the parts touch as the converter would put them: computed once, at the first question. */
    proposal: () => { on: Patch; of: Patch }[];
    /** The parts put together by the marks, or as proposed. */
    place: (state: MeetState) => P;
    /** What to draw at a stage. */
    scene: (
      stage: MeetState['stage'],
      placed: P | null,
    ) => Pick<MeetQuestion, 'shown' | 'box' | 'apart' | 'parts' | 'placement' | 'roles'>;
    /** No final view when it would be the picture just confirmed (a kit in place, §15 Q5). */
    skipFinal: (state: MeetState) => boolean;
  }

  /**
   * Asks where the parts meet (§5.6): the pairs stop, then the final view, until confirmed. Every
   * action is applied in the step's time; waiting is in no step. Returns the state confirmed and
   * the parts put together by it.
   */
  const askMeeting = async <P>(
    ask: AskUp,
    m: MeetingAsk<P>,
  ): Promise<{ state: MeetState; placed: P }> => {
    let state = startMeeting(m.initial, m.automatic, m.context);
    let placed: P | null = null;
    let proposal: { on: Patch; of: Patch }[] | null = null;
    let note: MeetNote | null = null;
    let picked: Hit | null | undefined;
    let start: number | undefined;
    let tries = 0;
    const done = (): { state: MeetState; placed: P } => {
      asked.push({
        role: m.context.about === 'base' ? 'meet' : 'parts',
        tries,
        waitedMs: performance.now() - start!,
      });
      return { state, placed: placed! };
    };
    for (;;) {
      const question = resume(m.step, (): MeetQuestion => {
        proposal ??= m.proposal();
        const { draft } = state;
        const pairs = draft
          ? draft.pairs.map(({ on, of }) => ({
              on: on && shownPatch(patchOf(on)),
              of: of && shownPatch(patchOf(of)),
            }))
          : proposal.map(({ on, of }) => ({
              on: shownPatch(on),
              of: shownPatch(of),
            }));
        return {
          kind: 'meet',
          about: m.context.about,
          stage: state.stage,
          pairs,
          proposed: draft === null,
          marks: marksOf(draft, m.context),
          ...m.scene(state.stage, placed),
          meshes: [],
          ...(picked !== undefined && { picked }),
          ...(note && { note }),
        };
      });
      question.meshes = meshesFor([...question.shown, ...(question.apart?.shown ?? [])]);
      note = null;
      picked = undefined;
      start ??= performance.now();
      const pending = ask(question);
      // The first tap should not wait for a tree.
      resume(m.step, () =>
        m.files.forEach((file) => {
          treeOf(file);
          surfaceIndexOf(meshes[file]!);
        }),
      );
      const { action } = expectAnswer(await pending, 'meet');
      const hit = (target: Target): Hit | null =>
        hitOf(
          target,
          'ray' in target && target.apart && question.apart ? question.apart.shown : question.shown,
        );
      const mark = (marking: MarkingAction): void => {
        // A tap, a dab or a pair cleared on the proposal edits it: the proposal becomes the
        // person's pairs first, and Undo goes straight back to it (PM decision 2026-10-01).
        const before = state;
        const edits =
          marking.do === 'tap' ||
          marking.do === 'brush' ||
          (marking.do === 'clear' && marking.pair !== undefined);
        if (edits && !state.draft && proposal && proposal.length > 0) {
          const seed = resume(m.step, () => proposalDraft(proposal!, m.context));
          state = { ...state, draft: seed };
        }
        const applied = resume(m.step, () => applyMeetAction(state, marking, m.context));
        if (before !== state && applied.state === state) state = before;
        else if (before !== state)
          state = { ...applied.state, history: [null, ...applied.state.history.slice(1)] };
        else state = applied.state;
        note = applied.note;
        tries++;
      };
      switch (action.do) {
        case 'pick':
          picked = resume(m.step, () => hit(action.at));
          break;
        case 'tap':
          mark({
            do: 'tap',
            hit: resume(m.step, () => hit(action.at)),
            pair: action.pair,
          });
          state = { ...state, stage: 'pairs' };
          break;
        case 'brush':
          mark({
            do: 'brush',
            hits: resume(m.step, () => action.at.map(hit)),
            pair: action.pair,
            radiusMm: action.radiusMm,
            ...(action.erase && { erase: true }),
          });
          state = { ...state, stage: 'pairs' };
          break;
        case 'clear':
        case 'undo':
        case 'set':
          mark(action);
          state = { ...state, stage: 'pairs' };
          break;
        case 'nudge':
          mark(action);
          if (state.stage === 'fitted') placed = resume(m.step, () => m.place(state));
          break;
        case 'back':
          state = { ...state, stage: 'pairs' };
          break;
        case 'fit':
        case 'confirm':
          if (state.stage === 'fitted' && action.do === 'confirm') return done();
          placed = resume(m.step, () => m.place(state));
          if (m.skipFinal(state)) return done();
          state = { ...state, stage: 'fitted' };
          break;
      }
    }
  };

  /**
   * The parts question (patches design note §3.3, §5.6): the figure's parts where their files put
   * them, turned by the body's detected up and stood on the grid, with the pairs where they touch;
   * then put together by the person's pairs. Inside the assemble step's time.
   */
  const askParts = async (
    ask: AskUp,
    standing: FilesStanding,
    pairing: Pairing,
    joints: PartJoint[],
  ): Promise<{ source: FigureSource; joints: PartJoint[] }> => {
    const files = figureFiles(pairing);
    const body = files[0]!;
    const context: MeetContext = {
      about: 'parts',
      baseFile: pairing.baseFile,
      figureFiles: files,
    };
    const scenes = within('assemble', () => {
      const up = resolveOrientation(meshes[body]!, {}, standing.standing[body]!.detection)
        .orientation.rotation;
      const inFiles = figureSourceOf(standing, pairing, [], treeOf);
      // Parts laid out for print overlap at the origin: nothing to propose, laid in a row.
      const forPrint = laidOutForPrint(meshes, files);
      const proposals = forPrint ? [] : proposedJoints(meshes, files, treeOf);
      const pulled = forPrint ? laidInARow(meshes, files) : pulledApart(meshes, files);
      // The union moved part by part, for the box of the parts pulled apart.
      const moved = inFiles.mesh.positions.slice();
      let at = 0;
      for (const { file, translation } of pulled) {
        const end = at + meshes[file]!.positions.length;
        for (let i = at; i < end; i += 3) {
          moved[i] = moved[i]! + translation[0];
          moved[i + 1] = moved[i + 1]! + translation[1];
          moved[i + 2] = moved[i + 2]! + translation[2];
        }
        at = end;
      }
      const apart = standShown(
        pulled.map(({ file, translation }) => ({
          file,
          rotation: IDENTITY,
          translation,
        })),
        moved,
        up,
      );
      return { up, inFiles, proposals, apart, inPlace: !forPrint };
    });
    const answered = await askMeeting<FigureSource>(ask, {
      step: 'assemble',
      context,
      initial: joints,
      automatic: {},
      files,
      proposal: () => scenes.proposals.flatMap((proposal) => proposal.pairs),
      place: (state) =>
        figureSourceOf(
          standing,
          pairing,
          (marksOf(state.draft, context) as PartJoint[] | null) ?? [],
          treeOf,
        ),
      scene: (stage, placed) => {
        const source = stage === 'fitted' && placed ? placed : scenes.inFiles;
        return {
          ...standShown(source.parts, source.mesh.positions, scenes.up),
          apart: stage === 'pairs' ? scenes.apart : null,
          inPlace: scenes.inPlace,
          parts: source.parts,
          placement: null,
          roles: rolesOf(pairing),
        };
      },
      // A kit in place with nothing marked is the picture just confirmed; a kit laid out for
      // print is a pile at the origin until its parts are marked: always shown before it converts.
      skipFinal: (state) => scenes.inPlace && !state.draft?.pairs.some(complete),
    });
    return {
      source: answered.placed,
      joints: (marksOf(answered.state.draft, context) as PartJoint[] | null) ?? [],
    };
  };
  /** How an up question ended: confirmed, or the roles changed (a swap, or another base named). */
  type Answered<T> =
    | { standing: T; options: OrientationOptions; restart: null }
    | { restart: { swap: true } | { baseFile: number | null } | { preset: true } };
  /**
   * Asks which way is up about one file, or a figure's parts together, until the answer confirms
   * (#92 design note §4): each answer is resolved from scratch by `resolve`, inside the orient
   * step's time; waiting is in no step. Returns early when the answer changes the roles, or
   * the preset when `presetRestarts` (a pair's figure: its base comes from the same tool).
   */
  const askAbout = async <T extends Standing>(
    ask: AskUp,
    role: UpRole,
    file: number,
    figure: { parts: readonly PartPlace[]; positions: Float32Array },
    pairing: Pairing | null,
    proposal: T,
    options: OrientationOptions,
    resolve: (options: OrientationOptions) => T,
    presetRestarts = false,
  ): Promise<Answered<T>> => {
    let start: number | undefined;
    let standing = proposal;
    let tries = 0;
    for (;;) {
      const question = resume('orient', (): UpQuestion => {
        const { orientation, reason, base } = standing;
        const drawn = standShown(figure.parts, figure.positions, orientation.rotation);
        return {
          kind: 'up',
          role,
          file,
          orientation,
          reason,
          base,
          warnings: pairing?.warnings ?? [],
          roles: rolesOf(pairing),
          ...drawn,
          meshes: meshesFor(drawn.shown),
        };
      });
      start ??= performance.now();
      const answer = expectAnswer(await ask(question), 'up');
      if (answer.swap) return { restart: { swap: true } };
      if (answer.baseFile !== undefined && answer.baseFile !== (pairing?.baseFile ?? null))
        return { restart: { baseFile: answer.baseFile } };
      // Every answer is resolved under the preset as it is now (#100 design note §4).
      const preset = answer.preset === undefined ? presetChoice : (answer.preset ?? undefined);
      const presetChanged = !samePreset(preset, presetChoice);
      if (presetChanged) {
        if (preset) checkSourcePreset(preset);
        presetChoice = preset;
        if (presetRestarts) return { restart: { preset: true } };
      }
      if (presetChanged || !sameOrientationOptions(answer.orientation, options)) {
        standing = resume('orient', () => resolve(answer.orientation));
        options = answer.orientation;
      }
      if (answer.confirm) {
        asked.push({ role, tries, waitedMs: performance.now() - start });
        return { standing, options, restart: null };
      }
      tries++;
    }
  };

  const joints = partsOptions?.joints ?? [];
  let choices: UpChoices =
    files.length > 1
      ? {
          orientation: orientationOptions,
          baseOrientation: baseOrientationOptions,
          pairing: pairingOptions,
          ...(partsOptions && { parts: partsOptions }),
          ...(placementOptions.marks && { placement: placementOptions }),
        }
      : { orientation: orientationOptions };
  const askFigure = askUp !== undefined && askOptions.up !== false;
  const askBase = askUp !== undefined && askOptions.baseUp !== false;
  const askTheParts = askUp !== undefined && askOptions.parts !== false;
  const askMeet = askUp !== undefined && askOptions.meet !== false;
  /** A figure without a base file after the orient step: one file, or the union of its parts. */
  interface OrientedAlone {
    figure: PlacedMesh;
    orientation: Orientation;
    base: null;
    /** Parts without a base file (#93); null for one file. */
    pairing: Pairing | null;
    parts: PartResult[];
  }
  let oriented: OrientedPair | OrientedAlone;
  if (files.length === 1) {
    const mesh = meshes[0]!;
    let one = run(
      'orient',
      () => standOne(mesh, under(orientationOptions)),
      (o) => orientedBytes(o.figure, null),
    );
    if (askUp && askFigure) {
      const pass = one.detection;
      const answered = await askAbout(
        askUp,
        'mini',
        0,
        { parts: [wholePart(0, mesh)], positions: mesh.positions },
        null,
        one,
        orientationOptions,
        (o) => standOne(mesh, under(o), pass),
      );
      if (answered.restart)
        throw new ConversionProblem('unexpected', 'the roles of a single file changed');
      one = answered.standing;
      choices = { orientation: answered.options };
    }
    oriented = {
      figure: one.figure,
      orientation: one.orientation,
      base: null,
      pairing: null,
      parts: [],
    };
  } else if (!askUp || !(askFigure || askBase || (assembling && askTheParts))) {
    // With parts, the roles and the union are the assemble step; the orient step stands them.
    const prepared = assembling
      ? run(
          'assemble',
          () => {
            const standing = standFiles(meshes);
            const pairing = guessRoles(standing.shapes, pairingOptions, 'refuse');
            return {
              standing,
              pairing,
              source: figureSourceOf(standing, pairing, joints),
            };
          },
          (a) => heldBytes + meshBytes(a.source.mesh),
        )
      : undefined;
    if (prepared && !hasBase(prepared.pairing)) {
      const { source, pairing } = prepared;
      const one = run(
        'orient',
        () => standOne(source.mesh, under(orientationOptions), source.pass),
        (o) => orientedBytes(o.figure, null),
      );
      oriented = {
        figure: one.figure,
        orientation: one.orientation,
        base: null,
        pairing,
        parts: source.parts,
      };
    } else {
      oriented = run(
        'orient',
        () => {
          const standing = prepared?.standing ?? standFiles(meshes);
          const pairing =
            prepared?.pairing ?? guessRoles(standing.shapes, pairingOptions, 'refuse');
          if (!hasBase(pairing)) throw new ConversionProblem('unexpected', 'roles without a base');
          const source = prepared?.source ?? figureSourceOf(standing, pairing, joints);
          return orientFiles(
            standing,
            pairing,
            source,
            under(orientationOptions),
            under(baseOrientationOptions),
          );
        },
        (o) => orientedBytes(o.figure, o.base),
      );
    }
  } else {
    // Several files ask about the parts, then the base, then the figure (as the union of its
    // parts); a swap, or another base named at either up question, starts again with the parts
    // (#92 design note §4.2, #93 §4).
    const ask = askUp;
    // Without a flat underside on any file, the base is proposed when a person will confirm it.
    const whenNone = askBase ? 'propose' : 'refuse';
    const standing = run(
      assembling ? 'assemble' : 'orient',
      () => standFiles(meshes),
      () => heldBytes,
    );
    let pairingChoice = pairingOptions;
    let baseChoice = baseOrientationOptions;
    let figureChoice = orientationOptions;
    let jointsChoice = joints;
    /** The figure as its parts were put together, kept when only the preset changed. */
    let keptSource: FigureSource | null = null;
    /** The roles changed at a question: everything chosen about the files starts again. */
    const restartWith = (pairing: PairingOptions): void => {
      pairingChoice = pairing;
      baseChoice = {};
      figureChoice = {};
      jointsChoice = [];
    };
    for (;;) {
      const guessed = within(assembling ? 'assemble' : 'orient', () =>
        guessRoles(standing.shapes, pairingChoice, whenNone),
      );
      const inParts = figureFiles(guessed).length > 1;
      let source: FigureSource;
      if (keptSource) {
        source = keptSource;
        keptSource = null;
      } else if (inParts && askTheParts) {
        const answered = await askParts(ask, standing, guessed, jointsChoice);
        source = answered.source;
        jointsChoice = answered.joints;
      } else
        source = inParts
          ? within('assemble', () => figureSourceOf(standing, guessed, jointsChoice))
          : figureSourceOf(standing, guessed, jointsChoice);
      const partsChoice: Pick<UpChoices, 'parts'> =
        inParts && (jointsChoice.length > 0 || partsOptions)
          ? { parts: { joints: jointsChoice } }
          : {};
      const figureShown = {
        parts: source.parts,
        positions: source.mesh.positions,
      };
      if (!hasBase(guessed)) {
        // Parts without a base file: asked about like one file, their union (#93); no meeting.
        let one = within('orient', () => standOne(source.mesh, under(figureChoice), source.pass));
        if (askFigure) {
          const answered = await askAbout(
            ask,
            'mini',
            bodyFile(guessed),
            figureShown,
            guessed,
            one,
            figureChoice,
            (o) => standOne(source.mesh, under(o), source.pass),
          );
          if (answered.restart) {
            const { restart } = answered;
            restartWith('baseFile' in restart ? { baseFile: restart.baseFile } : {});
            continue;
          }
          one = answered.standing;
          figureChoice = answered.options;
        }
        oriented = {
          figure: one.figure,
          orientation: one.orientation,
          base: null,
          pairing: guessed,
          parts: source.parts,
        };
        choices = {
          orientation: figureChoice,
          pairing: pairingChoice,
          ...partsChoice,
        };
        break;
      }
      let base = within('orient', () => standBase(standing, guessed, under(baseChoice)));
      const baseFile = base.pairing.baseFile;
      const { warnings } = base.pairing;
      if (askBase) {
        const proposal = base;
        const answered = await askAbout(
          ask,
          'base',
          baseFile,
          {
            parts: [wholePart(baseFile, meshes[baseFile]!)],
            positions: meshes[baseFile]!.positions,
          },
          base.pairing,
          base,
          baseChoice,
          (o) => standBase(standing, guessed, under(o)),
        );
        if (answered.restart) {
          const { restart } = answered;
          restartWith(
            'baseFile' in restart
              ? { baseFile: restart.baseFile }
              : swapped(pairingChoice, proposal.pairing),
          );
          continue;
        }
        base = answered.standing;
        baseChoice = answered.options;
        // Where the roles could not be guessed, confirming the base's question decided them.
        if (warnings.includes('no-flat-underside') && pairingChoice.baseFile === undefined) {
          pairingChoice = { baseFile };
          base = { ...base, pairing: { ...base.pairing, method: 'manual' } };
        }
      }
      const confirmedBase = base;
      let figure = resume('orient', () =>
        standFigure(source, confirmedBase, under(figureChoice), true),
      );
      if (askFigure) {
        const top = figure.decided?.top;
        const answered = await askAbout(
          ask,
          'figure',
          bodyFile(confirmedBase.pairing),
          figureShown,
          confirmedBase.pairing,
          figure,
          figureChoice,
          (o) => standFigure(source, confirmedBase, under(o), true, top),
          true,
        );
        if (answered.restart) {
          const { restart } = answered;
          if ('preset' in restart) {
            // The base comes from the same tool: it is asked again under the new preset, the
            // parts as they were put together.
            keptSource = source;
            figureChoice = {};
            continue;
          }
          restartWith(
            'baseFile' in restart
              ? { baseFile: restart.baseFile }
              : swapped(pairingChoice, confirmedBase.pairing),
          );
          continue;
        }
        figure = answered.standing;
        figureChoice = answered.options;
      }
      oriented = orientedPairOf(standing, source, confirmedBase, figure);
      choices = {
        orientation: figureChoice,
        baseOrientation: baseChoice,
        pairing: pairingChoice,
        ...partsChoice,
        ...(placementOptions.marks && { placement: placementOptions }),
      };
      break;
    }
  }

  let pair: PairResult | null = null;
  let toSize: PlacedMesh = oriented.figure;
  let orientation = oriented.orientation;
  if (oriented.base) {
    const pairOriented = oriented;
    const { figure, base } = pairOriented;
    let placedPair = run(
      'place',
      () => placeOrientedPair(pairOriented, placementOptions, treeOf),
      (p) => fileBytes + meshBytes(figure.mesh) + meshBytes(base.mesh) + meshBytes(p.merged.mesh),
    );
    if (askUp && askMeet) {
      // Shown before the conversion for every pair (PM decision 2026-09-30): the pairs where the
      // automatic placement sets the figure, apart, then the figure placed (PM decision
      // 2026-10-01).
      const automaticOptions = withoutMarks(placementOptions);
      let automatic: PlacedPair | null = placementOptions.marks ? null : placedPair;
      const automaticPlacement = (): PlacedPair =>
        (automatic ??= placeOrientedPair(pairOriented, automaticOptions, treeOf));
      const context: MeetContext = {
        about: 'base',
        baseFile: pairOriented.pairing.baseFile,
        figureFiles: figureFiles(pairOriented.pairing),
      };
      const apart = resume('place', () =>
        apartShown(pairOriented, standingOf(pairOriented).rotation),
      );
      const roles = rolesOf(pairOriented.pairing);
      const answered = await askMeeting<PlacedPair>(askUp, {
        step: 'place',
        context,
        initial: placementOptions.marks ?? null,
        automatic: automaticOptions,
        files: [context.baseFile!, ...context.figureFiles],
        proposal: () => proposedPairs(pairOriented, automaticPlacement(), treeOf),
        place: (state) => {
          const marks = marksOf(state.draft, context) as Meeting | null;
          if (marks) return placeOrientedPair(pairOriented, { marks }, treeOf);
          if (!state.automatic.nudged) return automaticPlacement();
          const { liftMm, turnDeg } = state.automatic;
          return placeOrientedPair(pairOriented, { ...automaticOptions, liftMm, turnDeg }, treeOf);
        },
        scene: (stage, placed) =>
          stage === 'fitted' && placed
            ? {
                ...meetShown(pairOriented, placed),
                apart: null,
                parts: placed.pair.parts,
                placement: placed.pair.placement,
                roles,
              }
            : { ...apart, apart: null, parts: pairOriented.parts, placement: null, roles },
        skipFinal: () => false,
      });
      placedPair = answered.placed;
      const marks = marksOf(answered.state.draft, context) as Meeting | null;
      const { automatic: nudges } = answered.state;
      choices = { ...choices };
      if (marks) choices.placement = { marks };
      else if (nudges.nudged)
        choices.placement = {
          ...automaticOptions,
          liftMm: nudges.liftMm,
          turnDeg: nudges.turnDeg,
        };
      else delete choices.placement;
    }
    pair = placedPair.pair;
    toSize = placedPair.merged;
    orientation = placedPair.orientation;
  } else if (oriented.pairing) {
    // Parts without a base file (#93): no place step; the pairing and the parts are recorded.
    if (placing) stepCount--;
    pair = {
      pairing: oriented.pairing,
      placement: null,
      figureVertices: toSize.mesh.positions.length / 3,
      figureTriangles: toSize.mesh.indices.length / 3,
      baseOrientation: null,
      parts: oriented.parts,
    };
  }

  if (presetChoice) choices = { ...choices, preset: presetChoice };
  // The trees and patches of the questions are not needed any more.
  trees = null;
  for (const mesh of meshes) dropSurfaceIndex(mesh);
  patches.clear();
  const placed = run(
    'size',
    // A figure on its base file has its base: the plain one is never added.
    () => {
      const sizing = sizingUnder(presetChoice, sizingOptions);
      return sizeMini(toSize, oriented.base ? { ...sizing, plainBase: false } : sizing);
    },
    // A scaled mesh is a copy; the oriented one is dropped once this step is done.
    (s) => fileBytes + meshBytes(toSize.mesh) + (s.mesh === toSize.mesh ? 0 : meshBytes(s.mesh)),
  );
  const close = run(
    'simplify',
    () => {
      // Every LOD keeps the shading of the full sculpt at the vertices that survive.
      placed.mesh.normals = computeVertexNormals(placed.mesh);
      return simplifyToSpec(placed.mesh, LOD_SPECS[0]!);
    },
    // The simplifier copies the mesh into WebAssembly memory while it works.
    (lod) => meshBytes(placed.mesh) * 2 + meshBytes(lod.mesh),
  );
  // Shade the highest level only: the lower ones are made of its vertices and inherit the result.
  run(
    'shade',
    () => shade(close.mesh),
    // The occlusion grid is at most 160 voxels a side, one byte each.
    () => meshBytes(placed.mesh) + meshBytes(close.mesh) + 160 ** 3,
  );
  const lods = run(
    'levels',
    () => [close, ...chainLods(close, LOD_SPECS.slice(1))],
    (l) => meshBytes(placed.mesh) + l.reduce((sum, lod) => sum + meshBytes(lod.mesh), 0),
  );

  let baked: Baked | undefined;
  let bakeSkipped: BakeSkipped | null = null;
  if (bakeRequest !== 0) {
    const table = lods[BAKED_LEVEL]!.mesh;
    const tableAreaMm2 = surfaceAreaMm2(table);
    const resolution = bakeRequest === 'auto' ? detailResolutionFor(tableAreaMm2) : bakeRequest;
    if (maxTextureSize !== undefined && resolution > maxTextureSize) {
      bakeSkipped = { reason: 'device', resolution, maxTextureSize };
    } else {
      // A mini with the per-vertex look is better than no mini: a failing step is not an error.
      let step: BakeStepName = 'unwrap';
      try {
        const overall = Math.round((timings.length / stepCount) * 100);
        const unwrapEnd = begin('unwrap');
        const unwrapProgress = (stepPercent: number): void =>
          onProgress({ step: 'unwrap', percent: overall, stepPercent });
        const unwrapped = unwrapEnd(
          await unwrap(table, resolution, unwrapProgress),
          meshBytes(placed.mesh) + meshBytes(table) * 3,
        );
        step = 'bake';
        const { detail, ...maps } = run(
          'bake',
          () => bake(unwrapped.mesh, placed.mesh, resolution),
          // The detail texture (4 bytes a texel), the rasteriser's mask (1) and the search tree.
          (m) => meshBytes(placed.mesh) + m.resolution ** 2 * 5 + m.bvhBytes,
        );
        let ktx2: Uint8Array | null = null;
        if (compress !== null) {
          step = 'compress';
          const compressEnd = begin('compress');
          ktx2 = compressEnd(
            await compressDetail(detail, resolution, compress),
            // The texture, the encoder's copy of it and its output buffer with mipmaps.
            meshBytes(placed.mesh) + resolution ** 2 * 14,
          );
        }
        baked = {
          tableAreaMm2,
          mesh: unwrapped.mesh,
          maps,
          ktx2,
          // Once compressed, the raw texture is dropped here and never leaves the pipeline.
          detail: ktx2 ? null : detail,
          charts: unwrapped.charts,
          utilisation: unwrapped.utilisation,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Out of memory is not a baking problem: the worker must end it and start afresh.
        if (isOutOfMemory(error)) throw new ConversionProblem('out-of-memory', message);
        bakeSkipped = { reason: 'failed', step, message };
      }
    }
  }

  return {
    mesh: placed.mesh,
    lods,
    baked,
    sizing: placed.sizing,
    orientation,
    pair,
    choices,
    stats: {
      format,
      sourceTriangles,
      triangles: placed.mesh.indices.length / 3,
      vertices: placed.mesh.positions.length / 3,
      degenerateTriangles: welds.reduce((sum, weld) => sum + weld.degenerateTriangles, 0),
      duplicateTriangles: welds.reduce((sum, weld) => sum + weld.duplicateTriangles, 0),
      invalidTriangles,
      sizeMm: placed.sizeMm,
      sizing: placed.sizing,
      up: orientation.up,
      upMethod: orientation.method,
      orientation,
      lods: lods.map((lod) => ({
        name: lod.name,
        decidedBy: lod.decidedBy,
        triangles: lod.triangles,
        vertices: lod.mesh.positions.length / 3,
        errorMm: lod.errorMm,
      })),
      timings,
      totalMs: timings.reduce((sum, timing) => sum + timing.ms, 0),
      peakBufferBytes,
      peakHeapBytes,
      bakeSkipped,
      pair,
      choices,
      asked,
    },
  };
}
