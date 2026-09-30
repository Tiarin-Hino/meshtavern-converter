import './style.css';
import {
  encodeGlb,
  glbEncoderReady,
  DEFAULT_LOOK,
  type Look,
  type IndexedMesh,
  memoryBudgetBytes,
  UP_AXES,
  type Orientation,
  type OrientationOptions,
  type UpAxis,
  fromAxisAngle,
  IDENTITY,
  multiply,
  turnAngleDeg,
  type Rotation,
  toProblem,
  type ProblemCode,
  BAKED_LEVEL,
  type ConversionStats,
  type Progress,
  CREATURE_SIZES,
  sizeLabel,
  type CreatureSize,
  type Sizing,
  type SizingOptions,
  type Units,
  UNIT_FACTORS,
  readStlFile,
  ConversionCancelled,
  Converter,
  type PairingOptions,
  type PairResult,
  type PlacementOptions,
  type AskOptions,
  type UpAnswer,
  type UpQuestion,
} from '../lib';
import { transcodeDetail } from '../lib/three';
import { generateBumpySheet, encodeBinaryStl } from '../lib/dev';
import { runBenchmark, type BenchmarkSize } from './benchmark';
import { parsePageOptions } from './options';
import {
  COPY,
  describeAskedFile,
  describeAskPending,
  describeMini,
  describeProgress,
  describePairWarning,
  describePendingPlacement,
  describePlacement,
  describeReady,
  describeTooManyFiles,
  describeUp,
  describeWrongFile,
  LEVEL_LABELS,
  LIFT_STEP_MM,
  pageStateOf,
  type PageState,
} from './page-state';
import { Viewer, type BakedMini, type Perf } from './viewer';

interface AppState {
  ready: boolean;
  /** Which of the five states the page shows; follows from the rest, see `render()`. */
  page: PageState;
  busy: boolean;
  /**
   * The question a conversion waits at after its orient step (#92), without its mesh: what the
   * page shows and asks. `name` is the file's, `serial` counts the questions of a conversion.
   * Null when nothing is asked; the page is `asking` while it is set.
   */
  question: (Omit<UpQuestion, 'mesh'> & { name: string; serial: number }) | null;
  /**
   * From picking or dropping the files to two frames after the first question's mesh went to
   * the viewer: the time to the question (#92, design note §8). Null until measured.
   */
  questionMs: number | null;
  fileName: string | null;
  progress: Progress | null;
  /** Every progress message of the last conversion, for tests. */
  progressLog: Progress[];
  stats: ConversionStats | null;
  /** Why the last file did not become a mini, as the user reads it. */
  error: string | null;
  /** The same as a code, and what happened technically, for tests and developers. */
  errorCode: ProblemCode | null;
  errorDetail: string | null;
  /** The last conversion was stopped by the user. Not an error. */
  cancelled: boolean;
  /**
   * Main-thread health from the start of a conversion until the mini is on screen: frames
   * drawn and the longest gap between two frames.
   */
  framesWhileConverting: number;
  longestFrameGapMs: number;
  /** Main-thread time to hand the first mesh to the GPU. */
  showMeshMs: number | null;
  /** Which version is on screen: 0 = full detail, 1… = LODs from highest to lowest. */
  shownLevel: number;
  /** Live rendering figures, refreshed twice a second. */
  perf: Perf | null;
  /** Number of minis in the stress scene; 0 when a single mini is shown. */
  stressCount: number;
  look: Look;
  /** Set after a GLB was opened: what the file contained. */
  imported: { triangles: number; sizeMm: [number, number, number] } | null;
  /** Figures of the baked table level. Null when the mini has the per-vertex look: see `stats.bakeSkipped`. */
  baked: {
    charts: number;
    utilisation: number;
    vertices: number;
    coverage: number;
    fallback: number;
    bvhBuildMs: number;
    bvhBytes: number;
    /** Size of the KTX2 file and the time it took to encode. Null with `?ktx=off`. */
    ktx2Bytes: number | null;
    ktx2EncodeMs: number | null;
    resolution: number;
    tableAreaMm2: number;
  } | null;
  showingBaked: boolean;
  /**
   * A turn the user is trying out (issue #72): scene axes, applied after the last result's
   * rotation (`stats.orientation`), or at a question after the rotation asked about (#92).
   * Shown in the viewer only; `applyTurn()` and `setDown()` convert with it, Confirm answers
   * with it.
   */
  orientation: { turn: Rotation | null; turnDeg: number };
  /**
   * A placement of the figure on its base the user is trying out (#70): moved across, lifted
   * and turned, relative to where the last result set it, in the base file's units. Shown in
   * the viewer only; `applyPlacement()` converts with it. Null when nothing is pending.
   */
  pair: PendingPlacement | null;
}

interface PendingPlacement {
  moveMm: [number, number];
  liftMm: number;
  turnDeg: number;
}

declare global {
  interface Window {
    /** Test and agent hook: the canvas has no accessibility tree, so state is asserted through this. */
    __mt: {
      state: AppState;
      loadDemo: () => Promise<void>;
      /** Converts a generated sheet of `quadsPerSide`² × 2 triangles; 1000 gives a 100 MB STL. */
      loadGenerated: (quadsPerSide: number, sizing?: SizingOptions) => Promise<void>;
      showLevel: (level: number) => void;
      setCamera: (azimuthDeg: number, elevationDeg: number, zoom: number) => void;
      setWireframe: (wireframe: boolean) => void;
      /** Changes some or all look settings and re-colours what is on screen. */
      setLook: (changes: Partial<Look>) => void;
      /** Shows the table level with baked maps (true) or with per-vertex data (false). */
      showBaked: (on: boolean) => void;
      /** Stops the running conversion. */
      cancel: () => void;
      /** The converted mini's detail texture as a KTX2 file, or null when it has none. */
      detailKtx2: () => Uint8Array | null;
      /** Runs the device benchmark and resolves with its Markdown result. */
      runBenchmark: (size: BenchmarkSize) => Promise<string>;
      /** Encodes a level (1 = close, 2 = table, 3 = far) with the current look. */
      exportGlb: (level: number, compact: boolean) => Promise<ArrayBuffer>;
      /** Opens a GLB in the viewer, as dropping the file would. */
      loadGlb: (glb: ArrayBuffer, name?: string) => Promise<void>;
      /** Fills the table with copies of the converted mini. `forcedLod` pins every copy to one LOD (0 = 50k). */
      /** Converts the last file again with a fixed up axis. */
      setUp: (up: UpAxis) => Promise<void>;
      /**
       * At a question (#92): shows how the file stands with these options (left out: the
       * proposal). Resolves when the question that comes back is on screen.
       */
      answerUp: (options?: OrientationOptions) => Promise<void>;
      /** At a question: confirms, with these options or, left out, what is on screen, a turn being tried out included. */
      confirmUp: (options?: OrientationOptions) => Promise<void>;
      /** At a question about a pair: the other file is the base. Resolves when its question is on screen. */
      swapAtQuestion: () => Promise<void>;
      /** Turns the shown mini by `deg` about the scene's x (pitch) or z (roll) axis: a preview, nothing is converted. */
      turn: (axis: TurnAxis, deg: number) => void;
      /** Converts the last file again, turned exactly as previewed. */
      applyTurn: () => Promise<void>;
      /** Converts the last file again, turned as previewed and set down on its lowest points. */
      setDown: () => Promise<void>;
      /** Drops the previewed turn. */
      resetTurn: () => void;
      /**
       * Converts the last file again with changed sizing choices (units, size, scale to a
       * base diameter, plain base), merged into the ones made so far. `undefined` drops a choice.
       */
      setSizing: (changes: Partial<SizingOptions>) => Promise<void>;
      /** Adds a base file to the mini on screen and converts the two as a pair. */
      addBase: (stl: ArrayBuffer, name: string) => Promise<void>;
      /** Converts the pair again with figure and base the other way round. */
      swapPair: () => Promise<void>;
      /** Moves the figure on its base by mm across (scene x, z): a preview, nothing is converted. */
      movePlacement: (dxMm: number, dzMm: number) => void;
      /** Raises (positive) or lowers the figure on its base: a preview. */
      liftPlacement: (dyMm: number) => void;
      /** Turns the figure on its base about the vertical: a preview. */
      turnPlacement: (deg: number) => void;
      /** Converts the pair again with the placement as previewed. */
      applyPlacement: () => Promise<void>;
      /** Drops the previewed placement. */
      resetPlacement: () => void;
      /** Converts the figure alone again, without its base. */
      removeBase: () => Promise<void>;
      /**
       * Where the figure of the pair on screen stands, with the placement being tried out: its
       * box centre (x, z) and lowest point in the base file's frame and units, and its turn.
       * Null without a pair. What `npm run feedback` records (design note §13).
       */
      figurePlacement: () => {
        figureCentreMm: [number, number];
        figureLowestMm: number;
        yawDeg: number;
        offsetMm: [number, number, number];
      } | null;
      startStress: (count: number, forcedLod?: number | null, textureBudgetMb?: number) => void;
      /**
       * Remembers the converted mini for mixed stress scenes. With a pool, `startStress`
       * fills the table from it: `share` is the fraction of positions this mini takes.
       */
      poolForStress: (share: number) => void;
      clearStressPool: () => void;
      stopStress: () => void;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const heading = document.querySelector<HTMLElement>('#heading')!;
const fileNameLine = document.querySelector<HTMLElement>('#file-name')!;
const chooseButton = document.querySelector<HTMLButtonElement>('#choose')!;
const chooseAgain = document.querySelector<HTMLButtonElement>('#choose-again')!;
const miniSize = document.querySelector<HTMLElement>('#mini-size')!;
const adjust = document.querySelector<HTMLDetailsElement>('#adjust')!;
const status = document.querySelector<HTMLElement>('#status')!;
const progressBar = document.querySelector<HTMLProgressElement>('#progress')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!;
const statsList = document.querySelector<HTMLElement>('#stats')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const levelButtons = document.querySelector<HTMLElement>('#levels')!;
const stressButtons = document.querySelector<HTMLElement>('#stress')!;
const upSelect = document.querySelector<HTMLSelectElement>('#up')!;
const turnPanel = document.querySelector<HTMLElement>('#turn')!;
const turnByHand = document.querySelector<HTMLInputElement>('#turn-by-hand')!;
const turnPending = document.querySelector<HTMLElement>('#turn-pending')!;
const turnReset = document.querySelector<HTMLButtonElement>('#turn-reset')!;
const turnApply = document.querySelector<HTMLButtonElement>('#turn-apply')!;
const perfLine = document.querySelector<HTMLElement>('#perf')!;
const askInputs = {
  file: document.querySelector<HTMLElement>('#ask-file')!,
  found: document.querySelector<HTMLElement>('#ask-found')!,
  warning: document.querySelector<HTMLElement>('#ask-warning')!,
  up: document.querySelector<HTMLSelectElement>('#ask-up')!,
  turn: document.querySelector<HTMLElement>('#ask-turn')!,
  turnByHand: document.querySelector<HTMLInputElement>('#ask-turn-by-hand')!,
  pending: document.querySelector<HTMLElement>('#ask-pending')!,
  setDown: document.querySelector<HTMLButtonElement>('#ask-set-down')!,
  reset: document.querySelector<HTMLButtonElement>('#ask-reset')!,
  swap: document.querySelector<HTMLButtonElement>('#ask-swap')!,
  confirm: document.querySelector<HTMLButtonElement>('#ask-confirm')!,
};
const pairInputs = {
  fieldset: document.querySelector<HTMLFieldSetElement>('#pair')!,
  addBase: document.querySelector<HTMLButtonElement>('#add-base')!,
  baseFile: document.querySelector<HTMLInputElement>('#base-file')!,
  files: document.querySelector<HTMLElement>('#pair-files')!,
  swap: document.querySelector<HTMLButtonElement>('#swap-pair')!,
  warning: document.querySelector<HTMLElement>('#pair-warning')!,
  placement: document.querySelector<HTMLElement>('#placement')!,
  controls: document.querySelector<HTMLElement>('#placement-controls')!,
  moveByHand: document.querySelector<HTMLInputElement>('#move-by-hand')!,
  pending: document.querySelector<HTMLElement>('#placement-pending')!,
  apply: document.querySelector<HTMLButtonElement>('#placement-apply')!,
  reset: document.querySelector<HTMLButtonElement>('#placement-reset')!,
  remove: document.querySelector<HTMLButtonElement>('#remove-base')!,
};
const sizingInputs = {
  units: document.querySelector<HTMLSelectElement>('#units')!,
  size: document.querySelector<HTMLSelectElement>('#size')!,
  scaleTo: document.querySelector<HTMLInputElement>('#scale-to')!,
  scaleApply: document.querySelector<HTMLButtonElement>('#scale-apply')!,
  plainBase: document.querySelector<HTMLInputElement>('#plain-base')!,
  warning: document.querySelector<HTMLElement>('#sizing-warning')!,
  scaleFit: document.querySelector<HTMLButtonElement>('#scale-fit')!,
};

const viewer = new Viewer(canvas);
const converter = new Converter();
/** Memory a conversion may use on this device; only Chromium says how much the device has. */
const memoryBudget = memoryBudgetBytes(
  (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
);
const state: AppState = {
  ready: false,
  page: 'empty',
  busy: false,
  question: null,
  questionMs: null,
  fileName: null,
  progress: null,
  progressLog: [],
  stats: null,
  error: null,
  errorCode: null,
  errorDetail: null,
  cancelled: false,
  framesWhileConverting: 0,
  longestFrameGapMs: 0,
  showMeshMs: null,
  shownLevel: 0,
  perf: null,
  stressCount: 0,
  look: { ...DEFAULT_LOOK },
  imported: null,
  baked: null,
  showingBaked: false,
  orientation: { turn: null, turnDeg: 0 },
  pair: null,
};
/** The baked table level of the converted mini; null when it has the per-vertex look. */
let baked: BakedMini | null = null;
/**
 * The mini's detail texture as a KTX2 file: what a table would store and send to other
 * players. The raw texture never reaches the page.
 */
let detailKtx2: Uint8Array | null = null;
/** Development only: `?bake=` and `?ktx=` change or switch off what is otherwise the normal path. */
const pageOptions = parsePageOptions(location.search);
/** How long a finished conversion waits for the mini's first frames before it stops measuring stalls. */
const FRAME_WAIT_MS = 500;
/** Index into `levels` of the level that is baked. */
const TABLE_LEVEL = BAKED_LEVEL + 1;
/** Full-detail mesh first, then the LODs. */
let levels: IndexedMesh[] = [];
/** A file the page can read again, because its buffer moves to the worker on every conversion. */
interface Source {
  name: string;
  read: () => Promise<ArrayBuffer>;
}
/** The last file, or the figure and its base file in the order given (#70). */
let sources: Source[] = [];
interface Choices {
  orientation: OrientationOptions;
  /** A pair only: the axis or turn chosen for the base file (#92). */
  baseOrientation: OrientationOptions;
  sizing: SizingOptions;
  /** A pair only: the user swapped figure and base. */
  pairing: PairingOptions;
  /** A pair only: the user moved, raised or turned the figure, relative to the detection. */
  placement: PlacementOptions;
}
const noChoices = (): Choices => ({
  orientation: {},
  baseOrientation: {},
  sizing: {},
  pairing: {},
  placement: {},
});
/** Whether an axis or turn was chosen, rather than left to the detection. */
const chosen = (options: OrientationOptions): boolean =>
  options.up !== undefined || options.rotation !== undefined || options.setDown === true;
/** What the user chose for the last source; a new file starts without choices. */
let choices: Choices = noChoices();

/** "figure.stl" or "figure.stl + base.stl": the figure first once a conversion said which it is. */
function sourcesName(pair: PairResult | null = null): string {
  const names = sources.map((source) => source.name);
  if (pair && names.length === 2 && pair.pairing.baseFile === 0) names.reverse();
  return names.join(' + ');
}

/** The figure's source of the pair on screen, or the only source. */
function figureSource(): Source | undefined {
  const pair = state.stats?.pair;
  // The body: the figure's first part (#93).
  return pair ? sources[pair.parts[0]?.file ?? 0] : sources[0];
}

/**
 * Converts the current sources again with the current choices. `ask` names the files to ask
 * about (#92, design note §6.4); left out, a conversion that only applies a choice asks nothing.
 */
async function reconvert(ask: AskOptions | null = null): Promise<void> {
  if (sources.length === 0 || state.busy) return;
  const [stl, secondStl] = await Promise.all(sources.map((source) => source.read()));
  await convert(stl!, sourcesName(), secondStl, ask);
}
/** Name of the GLB on screen (`?dev`); null when the page shows a converted mini or none. */
let importedName: string | null = null;

/**
 * Puts the page into the state that follows from `state`: the CSS shows and hides by
 * `body[data-state]`. Called after every change of the app state.
 */
function render(): void {
  state.page = pageStateOf(state);
  document.body.dataset.state = state.page;
  if (state.imported) document.body.dataset.kind = 'glb';
  else delete document.body.dataset.kind;
  const name = state.fileName ?? '';
  heading.textContent =
    state.page === 'empty'
      ? COPY.dropHeading
      : state.page === 'error'
        ? COPY.errorHeading
        : state.page === 'done'
          ? (importedName ?? name.replace(/\.stl(?=$| \+ )/gi, ''))
          : name;
  fileNameLine.textContent = name;
  chooseAgain.textContent = state.page === 'error' ? COPY.chooseAnother : COPY.chooseFile;
  chooseButton.disabled = state.busy;
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function showStats(stats: ConversionStats): void {
  const rows: [string, string][] = [
    ['Up', describeOrientation(stats.orientation)],
    ['Size', describeSize(stats.sizing)],
    ['Units', describeUnits(stats.sizing)],
    ...describePairRows(stats.pair),
    ['Dimensions', `${stats.sizeMm.map((mm) => mm.toFixed(1)).join(' × ')} mm`],
    ['Triangles', stats.triangles.toLocaleString()],
    ['Vertices', stats.vertices.toLocaleString()],
    [
      'Dropped',
      `${(stats.degenerateTriangles + stats.duplicateTriangles + stats.invalidTriangles).toLocaleString()} (flat ${stats.degenerateTriangles.toLocaleString()}, repeated ${stats.duplicateTriangles.toLocaleString()}, broken ${stats.invalidTriangles.toLocaleString()})`,
    ],
    ...stats.lods.map((lod): [string, string] => [
      lod.name,
      `${lod.triangles.toLocaleString()} tris, ±${lod.errorMm.toFixed(3)} mm (${lod.decidedBy})`,
    ]),
    ...stats.timings.map((t): [string, string] => [t.step, `${t.ms.toFixed(0)} ms`]),
    ['Total', `${stats.totalMs.toFixed(0)} ms`],
    ['Show', `${(state.showMeshMs ?? 0).toFixed(0)} ms`],
    ['Buffers', megabytes(stats.peakBufferBytes)],
    ['Heap', stats.peakHeapBytes === null ? 'not exposed' : megabytes(stats.peakHeapBytes)],
    ['Longest stall', `${state.longestFrameGapMs.toFixed(0)} ms`],
    [
      'Table level',
      state.baked
        ? `baked, ${state.baked.resolution} px` +
          (state.baked.ktx2Bytes === null
            ? ', uncompressed'
            : `, ${Math.round(state.baked.ktx2Bytes / 1024)} KB KTX2`)
        : stats.bakeSkipped
          ? describeSkipped(stats.bakeSkipped)
          : 'per-vertex look (baking switched off)',
    ],
  ];
  statsList.replaceChildren(
    ...rows.map(([term, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );
}

/**
 * The figures of a pair (#70): "base: file 2 (guessed), figure 16 × 31 × 12 mm, base 32 × 4 ×
 * 32 mm" and "recess 13 × 13 mm, fit 0.85, lift 3.0 mm, turn 0°". File units.
 */
function describePairRows(pair: PairResult | null): [string, string][] {
  const { pairing, placement } = pair ?? {};
  if (!pairing || !placement || pairing.baseFile === null) return [];
  const size = (mm: number[]): string => `${mm.map((v) => v.toFixed(0)).join(' × ')} mm`;
  const figure = pairing.files[pair!.parts[0]?.file ?? 0]!;
  const base = pairing.files[pairing.baseFile]!;
  const { spot } = placement;
  return [
    [
      'Pair',
      `base: file ${pairing.baseFile + 1} (${pairing.method}), figure ${size(figure.sizeMm)}, base ${size(base.sizeMm)}` +
        (pairing.warnings.length > 0 ? `, ${pairing.warnings.join(', ')}` : ''),
    ],
    [
      'Placement',
      `${spot.kind} ${spot.sizeMm.map((v) => v.toFixed(1)).join(' × ')} mm, fit ${spot.fit.toFixed(2)}, ` +
        `lift ${placement.offsetMm[2].toFixed(1)} mm, turn ${Math.round(placement.yawDeg)}° (${placement.method}), ` +
        `${placement.candidates.length} basins`,
    ],
  ];
}

const UNIT_NAMES: Record<Units, string> = { mm: 'mm', in: 'inches', m: 'metres' };

/** "Medium (1×1) (suggested), base 32.0 mm round (measured)", for the figures. */
function describeSize(sizing: Sizing): string {
  const method = sizing.sizeMethod === 'manual' ? 'chosen' : 'suggested';
  const size = `${sizeLabel(sizing.size)} (${method})`;
  if (sizing.base) {
    const shape = sizing.base.shape === 'round' ? 'round' : 'across, not round';
    return `${size}, base ${sizing.base.diameterMm.toFixed(1)} mm ${shape} (measured)`;
  }
  if (sizing.plainBase)
    return `${size}, plain base ${sizing.plainBase.diameterMm.toFixed(1)} mm (added)`;
  return `${size}, no base`;
}

/** "mm (guessed)", with the scale when the mini was scaled to a base diameter. */
function describeUnits(sizing: Sizing): string {
  const method = sizing.unitsMethod === 'manual' ? 'chosen' : 'guessed';
  const units = `${UNIT_NAMES[sizing.units]} (${method})`;
  const extra = sizing.scale / UNIT_FACTORS[sizing.units];
  return Math.abs(extra - 1) < 1e-6 ? units : `${units}, scaled ×${extra.toFixed(3)}`;
}

/** The base diameter a warning offers to scale to; null when it offers none. */
function scaleTargetOf(warning: Sizing['warnings'][number] | undefined): number | null {
  if (warning?.kind === 'base-exceeds-footprint') return warning.footprintMm;
  if (warning?.kind === 'base-small-for-size') return warning.targetMm;
  return null;
}

/** Sets the size form to what the conversion made of the mini, and shows any warning. */
function showSizing(sizing: Sizing): void {
  sizingInputs.units.value = sizing.units;
  sizingInputs.size.value = sizing.size;
  const chosen = choices.sizing.scaleToBaseMm;
  sizingInputs.scaleTo.value = chosen === undefined ? '' : String(chosen);
  sizingInputs.plainBase.checked = sizing.plainBase !== null;
  // A mini that came with a base gets no second one.
  sizingInputs.plainBase.disabled = sizing.base !== null;
  const warning = sizing.warnings[0];
  sizingInputs.warning.hidden = !warning;
  const target = scaleTargetOf(warning);
  sizingInputs.scaleFit.hidden = target === null;
  sizingInputs.scaleFit.textContent =
    warning?.kind === 'base-small-for-size' ? `Scale up to a ${target} mm base` : 'Scale to fit';
  if (warning) {
    const base = `The base (${warning.baseMm.toFixed(1)} mm)`;
    sizingInputs.warning.querySelector('span')!.textContent =
      warning.kind === 'base-exceeds-footprint'
        ? `${base} is larger than ${sizeLabel(sizing.size)}, ${warning.footprintMm} mm.`
        : warning.kind === 'base-small-for-size'
          ? `${base} is small for ${sizeLabel(sizing.size)}: the mini may be printed small.`
          : `The mini measures ${warning.baseMm.toFixed(0)} mm across, more than Gargantuan: are the units right?`;
  }
}

async function setSizing(changes: Partial<SizingOptions>): Promise<void> {
  if (sources.length === 0 || state.busy) return;
  choices.sizing = { ...choices.sizing, ...changes };
  await reconvert();
}

sizingInputs.size.replaceChildren(
  ...CREATURE_SIZES.map((size) => {
    const option = document.createElement('option');
    option.value = size;
    option.textContent = sizeLabel(size);
    return option;
  }),
);
// Units and a scale both decide the size in mm: choosing units drops a scale to a base diameter.
sizingInputs.units.addEventListener('change', () => {
  void setSizing({ units: sizingInputs.units.value as Units, scaleToBaseMm: undefined });
});
sizingInputs.size.addEventListener('change', () => {
  void setSizing({ size: sizingInputs.size.value as CreatureSize });
});
sizingInputs.scaleApply.addEventListener('click', () => {
  // An empty field goes back to the measured size.
  if (sizingInputs.scaleTo.value === '') return void setSizing({ scaleToBaseMm: undefined });
  const mm = sizingInputs.scaleTo.valueAsNumber;
  if (mm > 0 && Number.isFinite(mm)) void setSizing({ scaleToBaseMm: mm });
});
sizingInputs.plainBase.addEventListener('change', () => {
  void setSizing({ plainBase: sizingInputs.plainBase.checked });
});
sizingInputs.scaleFit.addEventListener('click', () => {
  // Only the scale: a size the user chose is already in the choices, a suggested one stays suggested.
  const target = scaleTargetOf(state.stats?.sizing.warnings[0]);
  if (target !== null) void setSizing({ scaleToBaseMm: target });
});

/** The table level is drawn from its baked maps when it has them, unless `preferBaked` is off. */
function showLevel(level: number, reframe = false, preferBaked = true): void {
  const mesh = levels[level];
  if (!mesh || !state.stats) return;
  // Another level drops a placement being tried out: it is shown on the full-detail mesh only.
  if (state.pair || pairInputs.moveByHand.checked) {
    state.pair = null;
    pairInputs.pending.hidden = true;
    pairInputs.apply.disabled = true;
    pairInputs.reset.disabled = true;
    pairInputs.moveByHand.checked = false;
    viewer.setMoveGizmo(null);
  }
  state.showingBaked = level === TABLE_LEVEL && baked !== null && preferBaked;
  state.stressCount = 0;
  if (state.showingBaked) viewer.showBaked(baked!, state.stats.sizeMm, reframe);
  else viewer.showMesh(mesh, state.stats.sizeMm, reframe);
  state.shownLevel = level;
  for (const [index, button] of [...levelButtons.children].entries()) {
    button.setAttribute('aria-pressed', String(index === level));
  }
}

function showLevelButtons(stats: ConversionStats): void {
  const triangles = [stats.triangles, ...stats.lods.map((lod) => lod.triangles)];
  levelButtons.replaceChildren(
    ...triangles.map((count, level) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = LEVEL_LABELS[level] ?? `Level ${level}`;
      button.title = `${count.toLocaleString()} triangles`;
      button.addEventListener('click', () => showLevel(level));
      return button;
    }),
  );
}

const lookInputs = {
  enabled: document.querySelector<HTMLInputElement>('#look-enabled')!,
  base: document.querySelector<HTMLInputElement>('#look-base')!,
  occlusion: document.querySelector<HTMLInputElement>('#look-occlusion')!,
  wash: document.querySelector<HTMLInputElement>('#look-wash')!,
  edges: document.querySelector<HTMLInputElement>('#look-edges')!,
};

function setLook(changes: Partial<Look>): void {
  Object.assign(state.look, changes);
  lookInputs.enabled.checked = state.look.enabled;
  lookInputs.base.value = state.look.base;
  lookInputs.occlusion.value = String(state.look.occlusion);
  lookInputs.wash.value = String(state.look.wash);
  lookInputs.edges.value = String(state.look.edges);
  viewer.setLook(state.look);
}

for (const input of Object.values(lookInputs)) {
  input.addEventListener('input', () =>
    setLook({
      enabled: lookInputs.enabled.checked,
      base: lookInputs.base.value,
      occlusion: Number(lookInputs.occlusion.value),
      wash: Number(lookInputs.wash.value),
      edges: Number(lookInputs.edges.value),
    }),
  );
}
setLook({});

async function setUp(up: UpAxis): Promise<void> {
  if (sources.length === 0 || state.busy) return;
  choices.orientation = { up };
  await reconvert();
}

/** The steps of the turn buttons. _(proposal, #72)_ */
const TURN_STEP_DEG = 15;
type TurnAxis = 'pitch' | 'roll';
/** Pitch tips the mini towards the camera's default view (about scene x), roll to the side (about z). */
const TURN_AXES: Record<TurnAxis, [number, number, number]> = {
  pitch: [1, 0, 0],
  roll: [0, 0, 1],
};

/** "+z (manual, set down 4°)": the six-way axis, how it was decided, and any turn beyond it. */
function describeOrientation(orientation: Orientation): string {
  const parts: string[] = [orientation.method];
  if (orientation.method === 'base') parts.push(orientation.confidence.toFixed(2));
  if (orientation.tiltDeg > 0) parts.push(`tilted ${Math.round(orientation.tiltDeg)}°`);
  if (orientation.setDownDeg > 0) parts.push(`set down ${Math.round(orientation.setDownDeg)}°`);
  return `${orientation.up} (${parts.join(', ')})`;
}

/** Shows a turn being tried out, in the viewer and in words; null drops it. */
function showTurn(turn: Rotation | null): void {
  const deg = turn ? turnAngleDeg(turn) : 0;
  state.orientation = { turn: deg > 0 ? turn : null, turnDeg: deg };
  viewer.setTurn(state.orientation.turn);
  turnPending.hidden = state.orientation.turn === null;
  turnPending.textContent = `Turned ${Math.round(deg)}°, not set down yet`;
  const pending = describeAskPending(state.orientation.turn ? deg : 0);
  askInputs.pending.hidden = pending === null;
  askInputs.pending.textContent = pending ?? '';
  turnReset.disabled = state.orientation.turn === null;
  turnApply.disabled = state.orientation.turn === null;
}

function turn(axis: TurnAxis, deg: number): void {
  // After a conversion, or at a question (#92): a preview either way.
  if (state.busy ? !state.question : !state.stats) return;
  if (state.pair) showPlacement(null);
  showTurn(multiply(fromAxisAngle(TURN_AXES[axis], deg), state.orientation.turn ?? IDENTITY));
}

/**
 * Converts the last file again, turned as previewed. Apply keeps exactly that turn: the
 * user's placement is final. Set down also levels the mini on its lowest points (PM
 * decision on PR #79, 2026-09-25: only on request).
 */
async function applyTurn(setDown: boolean): Promise<void> {
  if (sources.length === 0 || state.busy || !state.stats) return;
  const last = state.stats.orientation.rotation;
  const turned = state.orientation.turn;
  choices.orientation = { rotation: turned ? multiply(turned, last) : last, setDown };
  await reconvert();
}

const stressPool: {
  lods: IndexedMesh[];
  share: number;
  baked: BakedMini | null;
  footprintSquares: number;
}[] = [];

/**
 * `textureBudgetMb`: how much GPU memory the textures of baked minis may take; minis beyond it use the per-vertex look. 0 switches
 * baked minis off, Infinity (the default) bakes them all.
 */
function startStress(
  count: number,
  forcedLod: number | null = null,
  textureBudgetMb = Infinity,
): void {
  if (levels.length < 2 || !state.stats) return;
  const budget = textureBudgetMb * 1024 * 1024;
  if (stressPool.length === 0) {
    const squares = state.stats.sizing.footprintSquares;
    viewer.showStress([levels.slice(1)], count, forcedLod, () => 0, [baked], budget, squares);
  } else {
    // Spread each pooled mini evenly over the table according to its share.
    const total = stressPool.reduce((sum, entry) => sum + entry.share, 0);
    const filled = stressPool.map(() => 0);
    const setFor = (index: number): number => {
      let pick = 0;
      let deficit = -Infinity;
      stressPool.forEach((entry, set) => {
        const owed = ((index + 1) * entry.share) / total - filled[set]!;
        if (owed > deficit) [pick, deficit] = [set, owed];
      });
      filled[pick] = filled[pick]! + 1;
      return pick;
    };
    viewer.showStress(
      stressPool.map((entry) => entry.lods),
      count,
      forcedLod,
      setFor,
      stressPool.map((entry) => entry.baked),
      budget,
      Math.max(...stressPool.map((entry) => entry.footprintSquares)),
    );
  }
  state.stressCount = count;
}

function showPerf(): void {
  const perf = viewer.perf();
  state.perf = perf;
  const textures =
    perf.bakedMinis > 0
      ? ` · ${perf.bakedMinis} baked, ${Math.round(perf.textureBytes / 1048576)} MB of textures`
      : '';
  const lods =
    state.stressCount > 0
      ? ` · minis per LOD ${perf.minisPerLod.join(' / ')}${textures}`
      : textures;
  perfLine.textContent =
    `${perf.fps.toFixed(0)} fps · ${perf.frameMs.toFixed(1)} ms/frame (worst ${perf.worstFrameMs.toFixed(0)}) · ` +
    `CPU ${perf.renderCpuMs.toFixed(1)} ms · ${perf.triangles.toLocaleString()} triangles · ${perf.drawCalls} draw calls${lods}`;
}
setInterval(showPerf, 500);

/** Counts animation frames until stopped, to prove the page stayed responsive. */
function watchFrames(): () => void {
  let running = true;
  let last = performance.now();
  state.framesWhileConverting = 0;
  state.longestFrameGapMs = 0;
  const tick = (now: number): void => {
    if (!running) return;
    state.framesWhileConverting++;
    state.longestFrameGapMs = Math.max(state.longestFrameGapMs, now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => (running = false);
}

/** Why a mini that should have been baked has the per-vertex look, in words for the stats list. */
function describeSkipped(skipped: NonNullable<ConversionStats['bakeSkipped']>): string {
  return skipped.reason === 'device'
    ? `per-vertex look: this device holds textures up to ${skipped.maxTextureSize} px, the mini needs ${skipped.resolution} px`
    : `per-vertex look: ${skipped.step} failed (${skipped.message})`;
}

/**
 * The question after the orient step (#92, design note §6): what the worker sent about each
 * file, kept until the last question is confirmed, and the answer the page owes it.
 */
const asking = {
  /** The welded meshes the worker sent, by file: each travels once per conversion. */
  meshes: [] as (IndexedMesh | undefined)[],
  /** The file whose mesh the viewer shows, or null. */
  shown: null as number | null,
  /** Answers the question on screen; null when none waits. */
  answer: null as ((answer: UpAnswer) => void) | null,
  /**
   * The options the question on screen was resolved from, as the worker has them: what
   * Confirm sends when nothing is being turned. `key` says for which role and file.
   */
  options: {} as OrientationOptions,
  key: '',
  /** The options the conversion started with; after a swap every question starts from the proposal. */
  sent: { orientation: {}, baseOrientation: {} } as Pick<
    Choices,
    'orientation' | 'baseOrientation'
  >,
  swapped: false,
  /** Whether the figure of a pair is asked about too: then the base's question is not the last. */
  figureAsked: true,
  serial: 0,
  /** Hooks waiting for the next question on screen. */
  waiters: [] as (() => void)[],
  /** When the person picked the files, for `questionMs`; null once measured or when nothing is asked. */
  startedAt: null as number | null,
};

/** The worker's question: the mesh to the viewer, the words to the section, and wait for the person. */
function askUp(question: UpQuestion): Promise<UpAnswer> {
  return new Promise((resolve) => {
    const { mesh, ...asked } = question;
    if (mesh) asking.meshes[question.file] = mesh;
    const key = `${question.role}:${question.file}`;
    if (key !== asking.key) {
      asking.key = key;
      asking.options = asking.swapped
        ? {}
        : question.role === 'base'
          ? asking.sent.baseOrientation
          : asking.sent.orientation;
    }
    asking.answer = resolve;
    const { rotation } = question.orientation;
    if (asking.shown === question.file) viewer.turnQuestion(rotation, question.box);
    else {
      viewer.showQuestion(asking.meshes[question.file]!, rotation, question.box);
      asking.shown = question.file;
    }
    const name = sources[question.file]?.name ?? '';
    state.question = { ...asked, name, serial: ++asking.serial };
    showTurn(null);
    showQuestion(state.question);
    status.textContent = '';
    render();
    const started = asking.startedAt;
    if (started !== null) {
      asking.startedAt = null;
      // Two frames, so that handing the mesh to the GPU counts.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (state.questionMs = performance.now() - started)),
      );
    }
    for (const waiter of asking.waiters.splice(0)) waiter();
  });
}

/** The question's section: which file, why it stands so, the warning, the axis, the buttons. */
function showQuestion(question: NonNullable<AppState['question']>): void {
  const file = describeAskedFile(question.role, question.name);
  askInputs.file.hidden = file === null;
  askInputs.file.textContent = file ?? '';
  askInputs.found.textContent = describeUp(question);
  // The base's question is where the roles are confirmed: the warning of the guess goes there.
  const warning =
    question.role === 'base' ? describePairWarning(question.warnings, 'question') : null;
  askInputs.warning.hidden = warning === null;
  askInputs.warning.textContent = warning ?? '';
  askInputs.up.value = question.orientation.up;
  askInputs.swap.hidden = question.role === 'mini';
  askInputs.confirm.textContent =
    question.role === 'base' && asking.figureAsked ? COPY.confirmBaseUp : COPY.confirmUp;
}

/** Gives up the question's meshes: the viewer releases them and the page drops its arrays (§4.3). */
function giveUpQuestion(): void {
  asking.meshes = [];
  asking.shown = null;
  viewer.clear();
}

/** Answers the question on screen. False when none waits. */
function answerQuestion(answer: UpAnswer): boolean {
  const resolve = asking.answer;
  const question = state.question;
  if (!resolve || !question) return false;
  asking.answer = null;
  if (answer.swap) asking.swapped = true;
  else if (!answer.confirm) asking.options = answer.orientation;
  if (answer.confirm || answer.swap) {
    // After the last Confirm the conversion runs as it does without a question (PM decision).
    if (answer.confirm && (question.role !== 'base' || !asking.figureAsked)) giveUpQuestion();
    state.question = null;
    showTurn(null);
    render();
  }
  resolve(answer);
  return true;
}

/** The rotation on screen at the question: the one asked about, with a turn being tried out. */
function rotationAtQuestion(): Rotation | null {
  const question = state.question;
  if (!question) return null;
  const { turn } = state.orientation;
  return turn ? multiply(turn, question.orientation.rotation) : question.orientation.rotation;
}

/** Confirms the question: with `options`, or what is on screen. */
function confirmUp(options?: OrientationOptions): void {
  if (!state.question) return;
  const orientation =
    options ?? (state.orientation.turn ? { rotation: rotationAtQuestion()! } : asking.options);
  answerQuestion({ orientation, confirm: true });
}

/** An answer that brings the next question; resolves when it is on screen. */
function answerAndWait(answer: UpAnswer): Promise<void> {
  return new Promise((resolve) => {
    asking.waiters.push(resolve);
    if (!answerQuestion(answer)) {
      asking.waiters.pop();
      resolve();
    }
  });
}

/**
 * Converts with the choices made for the current source; see `choices`. `ask` names the files
 * to stop and ask about after the orient step (#92), unless the address has `?ask=off`;
 * `startedAt` is when the person picked the files, for the time to the question.
 */
async function convert(
  stl: ArrayBuffer,
  fileName: string,
  secondStl?: ArrayBuffer,
  ask: AskOptions | null = null,
  startedAt = performance.now(),
): Promise<void> {
  if (state.busy) return;
  const asks = ask !== null && pageOptions.ask;
  Object.assign(asking, {
    meshes: [],
    shown: null,
    answer: null,
    key: '',
    sent: { orientation: choices.orientation, baseOrientation: choices.baseOrientation },
    swapped: false,
    figureAsked: ask?.up !== false,
    serial: 0,
    startedAt: asks ? startedAt : null,
  });
  Object.assign(state, {
    busy: true,
    question: null,
    questionMs: null,
    fileName,
    stats: null,
    error: null,
    errorCode: null,
    errorDetail: null,
    cancelled: false,
    progressLog: [],
  });
  status.classList.remove('problem');
  status.textContent = '';
  progressBar.value = 0;
  render();
  const stopWatching = watchFrames();
  try {
    const result = await converter.convert(
      stl,
      (progress) => {
        state.progress = progress;
        if (progress.stepPercent === undefined) state.progressLog.push(progress);
        progressBar.value = progress.percent;
        progressBar.toggleAttribute('data-silent', progress.stepPercent === undefined);
        status.textContent = describeProgress(progress);
      },
      {
        orientation: choices.orientation,
        sizing: choices.sizing,
        bake: pageOptions.bake,
        compress: pageOptions.ktx,
        maxTextureSize: viewer.webglRenderer.capabilities.maxTextureSize,
        memoryBudgetBytes: memoryBudget,
        ...(asks && { ask }),
        ...(secondStl && {
          secondStl,
          pairing: choices.pairing,
          placement: choices.placement,
          baseOrientation: choices.baseOrientation,
        }),
      },
      asks ? askUp : undefined,
    );
    // From here on the mini exists; cancelling would only stop it from being shown.
    cancelButton.disabled = true;
    const stats = result.stats;
    // What was confirmed at the questions is kept: a later conversion of these files repeats it.
    choices.orientation = result.choices.orientation;
    if (secondStl) {
      choices.baseOrientation = result.choices.baseOrientation ?? {};
      choices.pairing = result.choices.pairing ?? {};
    }
    baked = null;
    detailKtx2 = null;
    state.baked = null;
    if (result.baked) {
      const { mesh, maps, ktx2, detail, charts, utilisation, tableAreaMm2 } = result.baked;
      try {
        // Transcoding to the GPU's block format happens in three.js's own workers.
        const texture = ktx2 ? await transcodeDetail(ktx2, viewer.webglRenderer) : detail!;
        baked = { mesh, resolution: maps.resolution, texture };
        detailKtx2 = ktx2;
        state.baked = {
          charts,
          utilisation,
          vertices: mesh.positions.length / 3,
          coverage: maps.coverage,
          fallback: maps.fallback,
          bvhBuildMs: maps.bvhBuildMs,
          bvhBytes: maps.bvhBytes,
          ktx2Bytes: ktx2?.byteLength ?? null,
          ktx2EncodeMs: stats.timings.find((timing) => timing.step === 'compress')?.ms ?? null,
          resolution: maps.resolution,
          tableAreaMm2,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stats.bakeSkipped = { reason: 'failed', step: 'transcode', message };
      }
    }
    levels = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    state.stats = stats;
    // The heading names the figure first once the conversion said which file is the base.
    state.fileName = sourcesName(stats.pair);
    showLevelButtons(stats);
    state.imported = null;
    importedName = null;
    upSelect.value = stats.up;
    showTurn(null);
    showPlacement(null);
    showPairSection(stats);
    showSizing(stats.sizing);
    // A size warning is never hidden behind a closed Adjust.
    if (stats.sizing.warnings.length > 0) adjust.open = true;
    // What is shown first is what the table will show: the table level, baked where it could be.
    const start = performance.now();
    showLevel(TABLE_LEVEL, true);
    state.showMeshMs = performance.now() - start;
    // Two frames, so that uploading the mini to the GPU counts towards the longest stall.
    // A hidden tab gets no frames at all, and must not wait for them: hence the timer.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      setTimeout(resolve, FRAME_WAIT_MS);
    });
    stopWatching();
    status.textContent = describeReady(stats);
    miniSize.textContent = describeMini(stats);
    showStats(stats);
  } catch (error) {
    if (error instanceof ConversionCancelled) {
      state.cancelled = true;
      status.textContent = COPY.cancelled;
    } else {
      showProblem(fileName, error);
    }
  } finally {
    stopWatching();
    cancelButton.disabled = false;
    progressBar.removeAttribute('data-silent');
    state.progress = null;
    state.busy = false;
    // Cancelled or failed at a question: its mesh leaves the screen too.
    asking.answer = null;
    state.question = null;
    if (asking.shown !== null) giveUpQuestion();
    if (askInputs.turnByHand.checked) {
      askInputs.turnByHand.checked = false;
      viewer.setTurnGizmo(null);
    }
    for (const waiter of asking.waiters.splice(0)) waiter();
    render();
  }
}
cancelButton.addEventListener('click', () => converter.cancel());

/** A 25 mm base with a 32 mm pyramid on it: enough to check scale, orientation and rendering. */
function demoStl(): ArrayBuffer {
  const b = 12.5;
  const h = 32;
  // prettier-ignore
  return encodeBinaryStl([
    -b, -b, 0,  b, b, 0,  b, -b, 0,
    -b, -b, 0,  -b, b, 0,  b, b, 0,
    -b, -b, 0,  b, -b, 0,  0, 0, h,
    b, -b, 0,  b, b, 0,  0, 0, h,
    b, b, 0,  -b, b, 0,  0, 0, h,
    -b, b, 0,  -b, -b, 0,  0, 0, h,
  ]);
}

const compactBox = document.querySelector<HTMLInputElement>('#compact')!;

async function exportGlb(level: number, compact: boolean): Promise<ArrayBuffer> {
  const mesh = levels[level];
  if (!mesh || level === 0 || !state.fileName) throw new Error('No converted level to export');
  if (compact) await glbEncoderReady();
  return encodeGlb(mesh, {
    name: downloadName(),
    look: state.look,
    compact,
    sizing: state.stats?.sizing,
    orientation: state.stats?.orientation,
  });
}

async function loadGlb(glb: ArrayBuffer, name = 'file.glb'): Promise<void> {
  status.classList.remove('problem');
  try {
    state.error = null;
    state.imported = await viewer.showGlb(glb);
    importedName = name;
    state.stressCount = 0;
    const size = state.imported.sizeMm.map((mm) => mm.toFixed(1)).join(' × ');
    status.textContent = `${name}: ${state.imported.triangles.toLocaleString()} triangles, ${size} mm, ${(glb.byteLength / 1024).toFixed(0)} KB`;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    status.textContent = `${name} could not be opened: ${state.error}`;
  }
  render();
}

// Each button writes its own level, whatever chip is pressed: looking at the close level
// cannot change what a download contains. The close and full levels are never exported.
for (const button of document.querySelectorAll<HTMLButtonElement>('#export [data-level]')) {
  button.addEventListener('click', () => {
    const level = Number(button.dataset.level);
    void exportGlb(level, compactBox.checked).then((glb) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      link.download = `${downloadName()}-${state.stats!.lods[level - 1]!.name}.glb`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  });
}

/** Shows why a file did not become a mini, in words for the user; the technical detail goes to `state` and the console. */
function showProblem(fileName: string, error: unknown): void {
  const problem = toProblem(error);
  Object.assign(state, {
    error: problem.message,
    errorCode: problem.code,
    errorDetail: problem.detail ?? null,
  });
  status.textContent = problem.message;
  status.classList.add('problem');
  if (problem.detail) console.warn(`${fileName}: ${problem.code}: ${problem.detail}`);
  render();
}

/**
 * One file converts alone and replaces whatever is on screen; two convert as a figure and its
 * base file (#70); more are refused. A single file never joins the mini on screen by itself:
 * a base is added with the Base section's button, so converting the next mini stays one drop.
 */
async function loadFiles(files: File[]): Promise<void> {
  if (files.length === 0 || state.busy) return;
  // The time to the question counts from here: reading the files from disk is part of it.
  const startedAt = performance.now();
  status.classList.remove('problem');
  const refuse = (fileName: string, error: string, errorCode: ProblemCode): void => {
    // The error card, like the refusals below, so the page state matches what is on screen.
    Object.assign(state, { fileName, error, errorCode, errorDetail: null });
    status.textContent = error;
    status.classList.add('problem');
    render();
  };
  const names = files.map((file) => file.name).join(' + ');
  if (files.length > 2) return refuse(names, describeTooManyFiles(), 'not-stl');
  // Opening a GLB checks the export's round trip: a tool for the team, under ?dev.
  const [first] = files;
  if (files.length === 1 && pageOptions.dev && first!.name.toLowerCase().endsWith('.glb')) {
    return loadGlb(await first!.arrayBuffer(), first!.name);
  }
  const wrong = files.find((file) => !file.name.toLowerCase().endsWith('.stl'));
  if (wrong) return refuse(wrong.name, describeWrongFile(wrong.name, pageOptions.dev), 'not-stl');
  // The files are read locally and handed to a worker in this tab. They are never sent anywhere.
  const buffers: ArrayBuffer[] = [];
  for (const file of files) {
    try {
      // Look at the start and the size first: a file that is empty, not an STL or too large
      // for this device is refused before all of it is read into memory.
      buffers.push(await readStlFile(file, memoryBudget));
    } catch (error) {
      state.fileName = file.name;
      return showProblem(file.name, error);
    }
  }
  sources = files.map((file) => ({ name: file.name, read: () => file.arrayBuffer() }));
  choices = noChoices();
  // New files: every one of them is asked about (design note §6.4).
  await convert(buffers[0]!, names, buffers[1], { up: true, baseUp: true }, startedAt);
}

/** Adds a base file to the mini on screen: the two convert as a pair, the guess says which is the base. */
async function addBase(base: Source): Promise<void> {
  const figure = figureSource();
  if (!figure || state.busy) return;
  sources = [figure, base];
  // The figure's orientation stays; the size is measured from the base now. The new base is
  // asked about, and the figure too unless its up was chosen: the pair may stand it another way.
  choices = { ...noChoices(), orientation: choices.orientation };
  await reconvert({ up: !chosen(choices.orientation), baseUp: true });
}

/** Converts the figure alone again. */
async function removeBase(): Promise<void> {
  const figure = figureSource();
  if (!figure || sources.length < 2 || state.busy) return;
  const turned = choices.pairing.swap === true;
  sources = [figure];
  choices = { ...noChoices(), orientation: turned ? {} : choices.orientation };
  await reconvert({ up: !chosen(choices.orientation) });
}

/** Converts the pair again with figure and base the other way round. The up axis was the figure's: it starts afresh. */
async function swapPair(): Promise<void> {
  if (sources.length < 2 || state.busy) return;
  // Roles the person named (neither file had a flat underside) swap by naming the other file.
  const { baseFile } = choices.pairing;
  const pairing =
    baseFile === undefined
      ? { swap: !choices.pairing.swap }
      : { baseFile: baseFile === 0 ? (1 as const) : (0 as const) };
  choices = { ...noChoices(), pairing, sizing: choices.sizing };
  await reconvert({ up: true, baseUp: true });
}

/** The Base section for what is on screen: the add button for one file, the pair's lines and controls for two. */
function showPairSection(stats: ConversionStats): void {
  const { pair } = stats;
  pairInputs.fieldset.dataset.kind = pair ? 'pair' : 'single';
  pairInputs.moveByHand.checked = false;
  viewer.setMoveGizmo(null);
  if (!pair?.placement || pair.pairing.baseFile === null) return;
  const figure = sources[pair.parts[0]?.file ?? 0]?.name ?? '';
  const base = sources[pair.pairing.baseFile]?.name ?? '';
  pairInputs.files.textContent = `Base: ${base} · Figure: ${figure}`;
  const warning = describePairWarning(pair.pairing.warnings);
  pairInputs.warning.hidden = warning === null;
  pairInputs.warning.textContent = warning ?? '';
  pairInputs.placement.textContent = describePlacement(pair.placement, stats.sizing.scale);
}

/**
 * Shows a placement being tried out, in the viewer and in words; null drops it. The figure
 * part moves in scene mm: the base file's units times the scale.
 */
function showPlacement(pending: PendingPlacement | null): void {
  const text = pending && describePendingPlacement(pending);
  state.pair = text ? pending : null;
  pairInputs.pending.hidden = !text;
  pairInputs.pending.textContent = text ?? '';
  pairInputs.apply.disabled = !text;
  pairInputs.reset.disabled = !text;
  const pair = state.stats?.pair;
  if (!pair?.placement || !state.stats) return;
  if (!state.pair && !pairInputs.moveByHand.checked) {
    // Back to what the table will show.
    if (viewer.hasFigure()) showLevel(TABLE_LEVEL);
    return;
  }
  const scale = state.stats.sizing.scale;
  if (!viewer.hasFigure()) {
    const [x, z] = pair.placement.offsetMm;
    viewer.showPair(levels[0]!, pair.figureTriangles, [x * scale, z * scale], state.stats.sizeMm);
    state.shownLevel = 0;
    for (const [index, button] of [...levelButtons.children].entries())
      button.setAttribute('aria-pressed', String(index === 0));
  }
  const shown = state.pair ?? { moveMm: [0, 0], liftMm: 0, turnDeg: 0 };
  viewer.setFigureOffset(
    [shown.moveMm[0] * scale, shown.moveMm[1] * scale],
    shown.liftMm * scale,
    shown.turnDeg,
  );
}

/** Adds to the placement being tried out; the turn preview of the whole mini is dropped. */
function changePlacement(change: Partial<PendingPlacement>): void {
  if (!state.stats?.pair || state.busy) return;
  if (state.orientation.turn) showTurn(null);
  const current = state.pair ?? { moveMm: [0, 0], liftMm: 0, turnDeg: 0 };
  showPlacement({
    moveMm: [
      current.moveMm[0] + (change.moveMm?.[0] ?? 0),
      current.moveMm[1] + (change.moveMm?.[1] ?? 0),
    ],
    liftMm: current.liftMm + (change.liftMm ?? 0),
    turnDeg: current.turnDeg + (change.turnDeg ?? 0),
  });
}

/** Converts the pair again with the placement as previewed, on top of what was applied before. */
async function applyPlacement(): Promise<void> {
  if (!state.pair || sources.length < 2 || state.busy) return;
  const before = choices.placement;
  const { moveMm, liftMm, turnDeg } = state.pair;
  choices.placement = {
    moveMm: [(before.moveMm?.[0] ?? 0) + moveMm[0], (before.moveMm?.[1] ?? 0) + moveMm[1]],
    liftMm: (before.liftMm ?? 0) + liftMm,
    turnDeg: (before.turnDeg ?? 0) + turnDeg,
  };
  await reconvert();
}

/**
 * The figure's box centre and lowest point in the base file's frame, the pending preview
 * included: the figure's vertices of the full-detail mesh, back to file units, turned about the
 * contact centre, moved and lifted as the preview shows them.
 */
function figurePlacement(): ReturnType<Window['__mt']['figurePlacement']> {
  const pair = state.stats?.pair;
  const mesh = levels[0];
  if (!pair?.placement || !mesh || !state.stats) return null;
  const scale = state.stats.sizing.scale;
  const pending = state.pair ?? { moveMm: [0, 0], liftMm: 0, turnDeg: 0 };
  const [cx, cz, lift] = pair.placement.offsetMm;
  // As the viewer turns the figure part: a three.js rotation.y about the contact centre.
  const theta = (pending.turnDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (let v = 0; v < pair.figureVertices; v++) {
    const dx = mesh.positions[v * 3]! / scale - cx;
    const dz = mesh.positions[v * 3 + 2]! / scale - cz;
    const x = cx + pending.moveMm[0] + dx * cos + dz * sin;
    const z = cz + pending.moveMm[1] - dx * sin + dz * cos;
    const y = mesh.positions[v * 3 + 1]! / scale + pending.liftMm;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (y < minY) minY = y;
  }
  return {
    figureCentreMm: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    figureLowestMm: minY,
    yawDeg: pair.placement.yawDeg + pending.turnDeg,
    offsetMm: [cx + pending.moveMm[0], cz + pending.moveMm[1], lift + pending.liftMm],
  };
}

/** The name downloads carry: the figure's, without .stl. */
function downloadName(): string {
  return (figureSource()?.name ?? state.fileName ?? 'mini').replace(/\.stl$/i, '');
}

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  // Clear the input so picking the same file again still fires a change event.
  fileInput.value = '';
  void loadFiles(files);
});
pairInputs.addBase.addEventListener('click', () => pairInputs.baseFile.click());
pairInputs.baseFile.addEventListener('change', () => {
  const file = pairInputs.baseFile.files?.[0];
  pairInputs.baseFile.value = '';
  if (file) void addBase({ name: file.name, read: () => file.arrayBuffer() });
});
pairInputs.swap.addEventListener('click', () => void swapPair());
pairInputs.remove.addEventListener('click', () => void removeBase());
pairInputs.apply.addEventListener('click', () => void applyPlacement());
pairInputs.reset.addEventListener('click', () => showPlacement(null));
for (const button of pairInputs.controls.querySelectorAll<HTMLButtonElement>('[data-lift]'))
  button.addEventListener('click', () =>
    changePlacement({ liftMm: (Number(button.dataset.lift) * LIFT_STEP_MM) / scaleOfMini() }),
  );
for (const button of pairInputs.controls.querySelectorAll<HTMLButtonElement>('[data-yaw]'))
  button.addEventListener('click', () => changePlacement({ turnDeg: Number(button.dataset.yaw) }));
pairInputs.moveByHand.addEventListener('change', () => {
  if (!pairInputs.moveByHand.checked) {
    viewer.setMoveGizmo(null);
    return showPlacement(state.pair);
  }
  showPlacement(state.pair ?? { moveMm: [0, 0], liftMm: 0, turnDeg: 0 });
  viewer.setMoveGizmo((moveMm) => {
    const scale = scaleOfMini();
    const current = state.pair ?? { moveMm: [0, 0], liftMm: 0, turnDeg: 0 };
    showPlacement({ ...current, moveMm: [moveMm[0] / scale, moveMm[1] / scale] });
  });
});

/** File units to scene mm of the mini on screen. */
function scaleOfMini(): number {
  return state.stats?.sizing.scale ?? 1;
}
for (const button of stressButtons.querySelectorAll<HTMLButtonElement>('button')) {
  button.addEventListener('click', () => {
    const count = Number(button.dataset.count);
    if (count === 0) return showLevel(TABLE_LEVEL, true);
    startStress(count, button.dataset.lod === undefined ? null : Number(button.dataset.lod));
  });
}
upSelect.replaceChildren(
  ...UP_AXES.map((axis) => {
    const option = document.createElement('option');
    option.value = axis;
    option.textContent = axis;
    return option;
  }),
);
upSelect.addEventListener('change', () => void setUp(upSelect.value as UpAxis));
for (const button of turnPanel.querySelectorAll<HTMLButtonElement>('[data-turn]')) {
  button.addEventListener('click', () =>
    turn(button.dataset.turn as TurnAxis, Number(button.dataset.deg ?? TURN_STEP_DEG)),
  );
}
turnByHand.addEventListener('change', () =>
  viewer.setTurnGizmo(turnByHand.checked ? (turned) => showTurn(turned) : null),
);
turnApply.addEventListener('click', () => void applyTurn(false));
// The question's controls (#92): each change is an answer the worker resolves and asks again
// with; the turn buttons are a preview, as after a conversion; Confirm converts.
askInputs.up.replaceChildren(
  ...UP_AXES.map((axis) => {
    const option = document.createElement('option');
    option.value = axis;
    option.textContent = axis;
    return option;
  }),
);
askInputs.up.addEventListener('change', () =>
  answerQuestion({ orientation: { up: askInputs.up.value as UpAxis }, confirm: false }),
);
for (const button of askInputs.turn.querySelectorAll<HTMLButtonElement>('[data-turn]')) {
  button.addEventListener('click', () =>
    turn(button.dataset.turn as TurnAxis, Number(button.dataset.deg ?? TURN_STEP_DEG)),
  );
}
askInputs.turnByHand.addEventListener('change', () =>
  viewer.setTurnGizmo(askInputs.turnByHand.checked ? (turned) => showTurn(turned) : null),
);
askInputs.setDown.addEventListener('click', () => {
  const rotation = rotationAtQuestion();
  if (rotation) answerQuestion({ orientation: { rotation, setDown: true }, confirm: false });
});
askInputs.reset.addEventListener('click', () =>
  answerQuestion({ orientation: {}, confirm: false }),
);
askInputs.swap.addEventListener('click', () =>
  answerQuestion({ orientation: {}, confirm: false, swap: true }),
);
askInputs.confirm.addEventListener('click', () => confirmUp());
document.querySelector('#set-down')!.addEventListener('click', () => void applyTurn(true));
turnReset.addEventListener('click', () => showTurn(null));
for (const button of [chooseButton, chooseAgain]) {
  button.addEventListener('click', () => fileInput.click());
}
// Dropping works in every state; while a file is dragged over the page, a frame says so.
// dragenter and dragleave fire for every child element too, so they are counted.
let dragDepth = 0;
const setDragging = (on: boolean): void => {
  document.body.toggleAttribute('data-dragging', on);
};
document.body.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  setDragging(true);
});
document.body.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});
document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDragging(false);
  void loadFiles([...(event.dataTransfer?.files ?? [])]);
});

window.__mt = {
  state,
  loadDemo: () => {
    sources = [{ name: 'demo.stl', read: async () => demoStl() }];
    choices = noChoices();
    return convert(demoStl(), 'demo.stl');
  },
  loadGenerated: (quadsPerSide, sizing = {}) => {
    const read = async (): Promise<ArrayBuffer> =>
      encodeBinaryStl(generateBumpySheet(quadsPerSide));
    sources = [{ name: `generated-${quadsPerSide}.stl`, read }];
    choices = { ...noChoices(), sizing };
    return reconvert();
  },
  addBase: (stl, name) => addBase({ name, read: async () => stl.slice(0) }),
  swapPair,
  movePlacement: (dxMm, dzMm) => {
    const scale = scaleOfMini();
    changePlacement({ moveMm: [dxMm / scale, dzMm / scale] });
  },
  liftPlacement: (dyMm) => changePlacement({ liftMm: dyMm / scaleOfMini() }),
  turnPlacement: (deg) => changePlacement({ turnDeg: deg }),
  applyPlacement,
  resetPlacement: () => showPlacement(null),
  removeBase,
  figurePlacement,
  setUp,
  answerUp: (options = {}) => answerAndWait({ orientation: options, confirm: false }),
  confirmUp: (options) => {
    confirmUp(options);
    return Promise.resolve();
  },
  swapAtQuestion: () => answerAndWait({ orientation: {}, confirm: false, swap: true }),
  turn,
  applyTurn: () => applyTurn(false),
  setDown: () => applyTurn(true),
  resetTurn: () => showTurn(null),
  setSizing,
  showLevel: (level) => showLevel(level),
  setCamera: (azimuthDeg, elevationDeg, zoom) => viewer.setCamera(azimuthDeg, elevationDeg, zoom),
  setWireframe: (wireframe) => viewer.setWireframe(wireframe),
  setLook,
  showBaked: (on) => showLevel(TABLE_LEVEL, false, on),
  cancel: () => converter.cancel(),
  detailKtx2: () => detailKtx2,
  runBenchmark: benchmark,
  exportGlb,
  loadGlb,
  startStress,
  poolForStress: (share) => {
    if (levels.length > 1 && state.stats) {
      const { footprintSquares } = state.stats.sizing;
      stressPool.push({ lods: levels.slice(1), share, baked, footprintSquares });
    }
  },
  clearStressPool: () => {
    stressPool.length = 0;
  },
  stopStress: () => showLevel(TABLE_LEVEL, true),
};
const benchResult = document.querySelector<HTMLTextAreaElement>('#bench-result')!;
const benchCopy = document.querySelector<HTMLButtonElement>('#bench-copy')!;
const benchButtons = (['light', 'full'] as BenchmarkSize[]).map(
  (size) => [size, document.querySelector<HTMLButtonElement>(`#bench-${size}`)!] as const,
);
async function benchmark(size: BenchmarkSize): Promise<string> {
  benchResult.value = '';
  for (const [, button] of benchButtons) button.disabled = true;
  benchCopy.disabled = true;
  try {
    return await runBenchmark(size, (line) => {
      benchResult.value += `${line}\n`;
      benchResult.scrollTop = benchResult.scrollHeight;
    });
  } catch (error) {
    const message = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
    benchResult.value += `\n${message}\n`;
    return message;
  } finally {
    for (const [, button] of benchButtons) button.disabled = false;
    benchCopy.disabled = false;
  }
}
for (const [size, button] of benchButtons) {
  button.addEventListener('click', () => void benchmark(size));
}
benchCopy.addEventListener('click', () => {
  // The clipboard API needs a secure origin; over plain http on a LAN, select the text instead.
  if (navigator.clipboard) void navigator.clipboard.writeText(benchResult.value);
  benchResult.select();
});

// The wording is in COPY (page-state.ts); data-copy names the string an element shows.
for (const element of document.querySelectorAll<HTMLElement>('[data-copy]')) {
  element.textContent = COPY[element.dataset.copy as keyof typeof COPY];
}
/** Screens up to this width get the phone layout; the same number is in the media query of style.css. _(proposal)_ */
const PHONE_MAX_WIDTH_PX = 600;
// On a phone the sheet starts with the size line and the downloads; Adjust is one tap away.
if (matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches) adjust.open = false;
// The team's tools exist only under ?dev. Removed rather than hidden: a product page has no
// benchmark button to find. References taken above stay valid, and the hooks keep working.
if (!pageOptions.dev) {
  for (const element of document.querySelectorAll('[data-dev]')) element.remove();
} else {
  fileInput.accept = '.stl,.glb';
}
if (pageOptions.problems.length > 0) {
  status.textContent = `Check the address: ${pageOptions.problems.join('; ')}.`;
  status.classList.add('problem');
}
render();
state.ready = true;
