import {
  copyForQuestion,
  reasonOf,
  reasonOfBase,
  sameOrientationOptions,
  turnedBox,
  type AskedUp,
  type AskOptions,
  type AskUp,
  type UpQuestion,
  type UpReason,
  type UpRole,
} from './ask';
import { bake, type BakedMaps } from './bake';
import { detailResolutionFor, surfaceAreaMm2 } from './bake-policy';
import { compressDetail, DETAIL_EFFORT } from './compress';
import type { IndexedMesh } from './mesh';
import { computeVertexNormals, dropInvalidTriangles, weldVertices } from './mesh';
import { checkFits, checkNeeded, estimatePairBytes } from './memory';
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
  chosenBase,
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
  placeOnBase,
  type BaseTop,
  type FigureDecision,
  type PairFiles,
  type PairResult,
  type PlacementOptions,
} from './place';
import { shade } from './shade';
import { sizeMini, type BaseMeasurement, type Sizing, type SizingOptions } from './size';
import { chainLods, LOD_SPECS, simplifierReady, simplifyToSpec, type Lod } from './simplify';
import { unwrap } from './unwrap';
import { ConversionProblem, isOutOfMemory } from './problems';
import { readStlTriangles, sniffStl, type StlFormat } from './stl';

/** Every step in order. `place` runs only for a figure with its base file (#70). */
export const STEPS = [
  'read',
  'weld',
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
  pairing: Pairing;
  /** The files as welded, for the registration test; undefined when the user chose the figure's axis. */
  files: PairFiles | undefined;
  baseOrientation: Orientation;
  /** What the orient step decided about the figure when it asked about it (#92); else the place step decides. */
  decided?: FigureDecision;
}

/** Each file of a pair stood the way a base would (#70), and its shape so: once per conversion. */
interface PairStanding {
  meshes: [IndexedMesh, IndexedMesh];
  standing: [FileOrientation, FileOrientation];
  shapes: [FileShape, FileShape];
}

function standPair(meshes: [IndexedMesh, IndexedMesh]): PairStanding {
  const standing = meshes.map((mesh) => baseOrientation(mesh)) as PairStanding['standing'];
  const shapes = [0, 1].map((k) => shapeOfFile(meshes[k]!, standing[k]!)) as PairStanding['shapes'];
  return { meshes, standing, shapes };
}

/** The roles, and the base standing as the options say and placed. */
interface PairBase extends Standing {
  pairing: Pairing;
  /** How the base file stands: on its underside (#70), or as chosen. */
  standing: FileOrientation;
  placed: PlacedMesh;
}

function standBase(
  { meshes, standing, shapes }: PairStanding,
  pairingOptions: PairingOptions,
  baseOptions: OrientationOptions,
  whenNone: 'refuse' | 'propose',
): PairBase {
  const guessed = guessRoles(shapes, pairingOptions, whenNone);
  const baseMesh = meshes[guessed.baseFile];
  // The user's axis or turn for the base (#92); its shape is recorded as it then stands.
  const baseStanding = choosesOrientation(baseOptions)
    ? chosenBase(baseMesh, baseOptions, standing[guessed.baseFile].detection)
    : standing[guessed.baseFile];
  const pairing = withFileShape(guessed, guessed.baseFile, shapeOfFile(baseMesh, baseStanding));
  const placed = placeOriented(baseMesh, baseStanding);
  const orientation = baseStanding.detection.orientation;
  return {
    pairing,
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
 * pair's rules will do; `top` is the base's top read for an earlier question.
 */
function standFigure(
  { meshes, standing }: PairStanding,
  base: PairBase,
  options: OrientationOptions,
  decide: boolean,
  top?: BaseTop,
): PairFigure {
  const baseFile = base.pairing.baseFile;
  const figureMesh = meshes[1 - baseFile]!;
  // A second candidate is placed by the place step; the pass is not run again.
  const pass = standing[1 - baseFile]!.detection;
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
    : { figure: figureMesh, base: meshes[baseFile], baseRotation: base.orientation.rotation };
  const own = first.orientation;
  const standingAs = { figure, own, alternative, files };
  if (!decide) return { ...standingAs, orientation: own, reason: reasonOf(own), base: figure.base };

  const decided: FigureDecision =
    chosen && top
      ? { top, candidate: 0, registered: null }
      : decideFigure(figure, base.placed, files, alternative?.placed);
  if (decided.registered) {
    // Registered, it stands the way its base does, where its file puts it.
    const orientation = base.orientation;
    return { ...standingAs, decided, orientation, reason: 'registered', base: null };
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
  return { ...standingAs, decided, orientation: own, reason: reasonOf(own), base: figure.base };
}

/** The orient step's result for a pair from how its base and figure stand. */
function orientedPairOf(base: PairBase, figure: PairFigure): OrientedPair {
  return {
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
function orientPair(
  meshes: [IndexedMesh, IndexedMesh],
  orientationOptions: OrientationOptions,
  pairingOptions: PairingOptions,
  baseOptions: OrientationOptions,
): OrientedPair {
  const pair = standPair(meshes);
  const base = standBase(pair, pairingOptions, baseOptions, 'refuse');
  return orientedPairOf(base, standFigure(pair, base, orientationOptions, false));
}

/** The pairing options after a swap: toggled, or the other file named when there was no guess. */
function swapped(options: PairingOptions, pairing: Pairing): PairingOptions {
  if (options.baseFile !== undefined || pairing.warnings.includes('no-flat-underside'))
    return { baseFile: pairing.baseFile === 0 ? 1 : 0 };
  return options.swap ? {} : { swap: true };
}

/** The pairing with one file's shape replaced: how that file finally stands. */
function withFileShape(pairing: Pairing, file: 0 | 1, shape: FileShape): Pairing {
  if (pairing.files[file] === shape) return pairing;
  const files: [FileShape, FileShape] = [...pairing.files];
  files[file] = shape;
  return { ...pairing, files };
}

/** The place step for a pair, and the orientation the figure ends up with. */
function placeOrientedPair(
  oriented: OrientedPair,
  placementOptions: PlacementOptions,
): { merged: PlacedMesh; pair: PairResult; orientation: Orientation } {
  const { figure, base, pairing, files, alternative, decided } = oriented;
  const placed = placeOnBase(
    figure,
    base,
    pairing,
    placementOptions,
    files,
    alternative?.placed,
    decided,
  );
  let orientation = oriented.orientation;
  if (placed.candidate === 1 && alternative) orientation = alternative.orientation;
  // A registered figure stands the way its base does.
  if (placed.pair.placement.spot.kind === 'registered') orientation = oriented.baseOrientation;
  const pair: PairResult = { ...placed.pair, baseOrientation: oriented.baseOrientation };
  return { merged: placed.merged, pair, orientation };
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
  options: Pick<PipelineOptions, 'orientation' | 'pairing' | 'placement' | 'baseOrientation'> = {},
): PairPlacement {
  const meshes = [stl, secondStl].map(
    (file) => weldVertices(dropInvalidTriangles(readStlTriangles(file)).soup).mesh,
  ) as [IndexedMesh, IndexedMesh];
  const oriented = orientPair(
    meshes,
    options.orientation ?? {},
    options.pairing ?? {},
    options.baseOrientation ?? {},
  );
  const placed = placeOrientedPair(oriented, options.placement ?? {});
  return {
    pair: placed.pair,
    orientation: placed.orientation,
    mesh: placed.merged.mesh,
    base: placed.merged.base,
  };
}

/**
 * Runs every pipeline step on one STL. DOM-free, so it works in a worker and in Node.
 * A file that cannot become a mini throws a `ConversionProblem` (see problems.ts).
 */
export async function runPipeline(
  stl: ArrayBuffer,
  {
    onProgress = () => {},
    orientation: orientationOptions = {},
    sizing: sizingOptions = {},
    bake: bakeRequest = 'auto',
    compress = DETAIL_EFFORT,
    maxTextureSize,
    memoryBudgetBytes,
    secondStl,
    pairing: pairingOptions = {},
    placement: placementOptions = {},
    baseOrientation: baseOrientationOptions = {},
    askUp,
    ask: askOptions = {},
  }: PipelineOptions = {},
): Promise<ConversionResult> {
  const format = sniffStl(new Uint8Array(stl), stl.byteLength);
  const files = secondStl ? [stl, secondStl] : [stl];
  if (memoryBudgetBytes !== undefined) {
    if (secondStl) {
      const secondFormat = sniffStl(new Uint8Array(secondStl), secondStl.byteLength);
      const needed = estimatePairBytes(stl.byteLength, format, secondStl.byteLength, secondFormat);
      checkNeeded(needed, memoryBudgetBytes);
    } else checkFits(stl.byteLength, format, memoryBudgetBytes);
  }
  const fileBytes = files.reduce((sum, file) => sum + file.byteLength, 0);

  const bakeSteps = BAKE_STEPS.filter((step) => step !== 'compress' || compress !== null);
  const stepCount = STEPS.length - (secondStl ? 0 : 1) + (bakeRequest !== 0 ? bakeSteps.length : 0);
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

  const asked: AskedUp[] = [];
  const meshSent = [false, false];
  /**
   * Asks about one file until the answer confirms (design note §4): each answer is resolved
   * from scratch by `resolve`, inside the orient step's time; waiting is in no step. A file's
   * mesh travels with its first question only, once per conversion even when a pair is swapped.
   * Returns early, unconfirmed, when the answer swaps.
   */
  const askAbout = async <T extends Standing>(
    ask: AskUp,
    role: UpRole,
    file: 0 | 1,
    mesh: IndexedMesh,
    warnings: Pairing['warnings'],
    proposal: T,
    options: OrientationOptions,
    resolve: (options: OrientationOptions) => T,
  ): Promise<{ standing: T; options: OrientationOptions; swap: boolean }> => {
    let start: number | undefined;
    let standing = proposal;
    let tries = 0;
    for (;;) {
      const question = resume('orient', (): UpQuestion => {
        const { orientation, reason, base } = standing;
        const box = turnedBox(mesh.positions, orientation.rotation);
        const asking = { role, file, orientation, reason, box, base, warnings };
        return meshSent[file] ? asking : { ...asking, mesh: copyForQuestion(mesh) };
      });
      meshSent[file] = true;
      start ??= performance.now();
      const answer = await ask(question);
      if (answer.swap) return { standing, options, swap: true };
      if (!sameOrientationOptions(answer.orientation, options)) {
        standing = resume('orient', () => resolve(answer.orientation));
        options = answer.orientation;
      }
      if (answer.confirm) {
        asked.push({ role, tries, waitedMs: performance.now() - start });
        return { standing, options, swap: false };
      }
      tries++;
    }
  };

  // With a base file, read, weld and orient each run over both files inside their step.
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
    const which = secondStl ? ` in file ${k + 1}` : '';
    throw new ConversionProblem(
      'no-surface',
      `${read.soup.length / 9 + read.invalidTriangles} triangles${which}, none usable`,
    );
  });
  const weldedBytes = welds.reduce((sum, weld) => sum + meshBytes(weld.mesh), 0);

  const orientedBytes = (figure: PlacedMesh, base: PlacedMesh | null): number =>
    fileBytes +
    soupBytes +
    weldedBytes +
    figure.mesh.positions.byteLength +
    (base?.mesh.positions.byteLength ?? 0);
  let choices: UpChoices = secondStl
    ? {
        orientation: orientationOptions,
        baseOrientation: baseOrientationOptions,
        pairing: pairingOptions,
      }
    : { orientation: orientationOptions };
  let oriented:
    OrientedPair | { figure: PlacedMesh; orientation: Orientation; base: null; pairing: null };
  if (!secondStl) {
    const mesh = welds[0]!.mesh;
    let one = run(
      'orient',
      () => standOne(mesh, orientationOptions),
      (o) => orientedBytes(o.figure, null),
    );
    if (askUp && askOptions.up !== false) {
      const pass = one.detection;
      const answered = await askAbout(askUp, 'mini', 0, mesh, [], one, orientationOptions, (o) =>
        standOne(mesh, o, pass),
      );
      one = answered.standing;
      choices = { orientation: answered.options };
    }
    oriented = { figure: one.figure, orientation: one.orientation, base: null, pairing: null };
  } else if (!askUp || (askOptions.up === false && askOptions.baseUp === false)) {
    oriented = run(
      'orient',
      () =>
        orientPair(
          welds.map((weld) => weld.mesh) as [IndexedMesh, IndexedMesh],
          orientationOptions,
          pairingOptions,
          baseOrientationOptions,
        ),
      (o) => orientedBytes(o.figure, o.base),
    );
  } else {
    // A pair asks about its base first, then its figure; a swap at either starts again with the
    // other file as the base (design note §4.2).
    const askBase = askOptions.baseUp !== false;
    const askFigure = askOptions.up !== false;
    // Without a flat underside on either file, the base is proposed when a person will confirm it.
    const whenNone = askBase ? 'propose' : 'refuse';
    const pair = run(
      'orient',
      () => standPair(welds.map((weld) => weld.mesh) as [IndexedMesh, IndexedMesh]),
      () => fileBytes + soupBytes + weldedBytes,
    );
    let pairingChoice = pairingOptions;
    let baseChoice = baseOrientationOptions;
    let figureChoice = orientationOptions;
    for (;;) {
      let base = resume('orient', () => standBase(pair, pairingChoice, baseChoice, whenNone));
      const baseFile = base.pairing.baseFile;
      const figureFile = baseFile === 0 ? 1 : 0;
      const { warnings } = base.pairing;
      if (askBase) {
        const proposal = base;
        const answered = await askAbout(
          askUp,
          'base',
          baseFile,
          pair.meshes[baseFile],
          warnings,
          base,
          baseChoice,
          (o) => standBase(pair, pairingChoice, o, whenNone),
        );
        if (answered.swap) {
          pairingChoice = swapped(pairingChoice, proposal.pairing);
          baseChoice = {};
          figureChoice = {};
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
      let figure = resume('orient', () => standFigure(pair, confirmedBase, figureChoice, true));
      if (askFigure) {
        const top = figure.decided?.top;
        const answered = await askAbout(
          askUp,
          'figure',
          figureFile,
          pair.meshes[figureFile],
          warnings,
          figure,
          figureChoice,
          (o) => standFigure(pair, confirmedBase, o, true, top),
        );
        if (answered.swap) {
          pairingChoice = swapped(pairingChoice, confirmedBase.pairing);
          baseChoice = {};
          figureChoice = {};
          continue;
        }
        figure = answered.standing;
        figureChoice = answered.options;
      }
      oriented = orientedPairOf(confirmedBase, figure);
      choices = { orientation: figureChoice, baseOrientation: baseChoice, pairing: pairingChoice };
      break;
    }
  }

  let pair: PairResult | null = null;
  let toSize: PlacedMesh = oriented.figure;
  let orientation = oriented.orientation;
  if (oriented.base && oriented.pairing) {
    const { figure, base } = oriented;
    const placedPair = run(
      'place',
      () => placeOrientedPair(oriented, placementOptions),
      (p) => fileBytes + meshBytes(figure.mesh) + meshBytes(base!.mesh) + meshBytes(p.merged.mesh),
    );
    pair = placedPair.pair;
    toSize = placedPair.merged;
    orientation = placedPair.orientation;
  }

  const placed = run(
    'size',
    // A pair has its base: the plain one is never added.
    () => sizeMini(toSize, pair ? { ...sizingOptions, plainBase: false } : sizingOptions),
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
