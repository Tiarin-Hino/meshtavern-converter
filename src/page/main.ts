import './style.css';
// The question view's stylesheet (#119): a consumer imports it once, as the page does.
import '../lib/questions.css';
// The painting view's and the painter's panel's stylesheets (#127, #166), for the painter (#167).
import '../lib/painting.css';
import '../lib/painting-panel.css';
import {
  encodeGlb,
  glbEncoderReady,
  DEFAULT_LOOK,
  LOOK_PRESETS,
  presetOf,
  type Look,
  type LookPresetId,
  type IndexedMesh,
  memoryBudgetBytes,
  UP_AXES,
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
  SOURCE_PRESETS,
  findSourcePreset,
  type SourcePreset,
  readStlFile,
  ConversionCancelled,
  Converter,
  type PairingOptions,
  type PairResult,
  type PlacementOptions,
  type AskOptions,
  MAX_PARTS,
  type MeetAction,
  type PartsOptions,
  type KindGuess,
  type Albedo,
  type PaintMask,
  PAINT_SIZE,
  groupsOf,
  regionsOf,
  type PaintGroups,
  paintAtVertices,
  paintedTexture,
  type ShadedTexels,
  convertOptionsOf,
  matchSources,
  paintedOnOlderEngine,
  paintFileOf,
  readPaintFile,
  recentColours,
  sourceRoles,
  writePaintFile,
  PAINT_FILE_EXTENSION,
  PAINT_FILE_TYPE,
  type PaintChoices,
  type PaintFile,
  type SourceFingerprint,
} from '../lib';
import { DataTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { createDetailTexture, renderThumbnail, transcodeDetail } from '../lib/three';
import { generateBumpySheet, encodeBinaryStl, paintWhere } from '../lib/dev';
import { runBenchmark, type BenchmarkSize } from './benchmark';
import {
  createPainter,
  downloadBlob,
  encodePng,
  type MiniForPainting,
  type PaintHooks,
  type PaintReplay,
} from './painter';
import { PAINT_COPY, type PaintingState } from '../lib/painting';
import { parsePageOptions } from './options';
import {
  describePairWarning,
  describeParts,
  describePlacement,
  LIFT_STEP_MM,
  mountQuestions,
  TURN_STEP_DEG,
  type AskedQuestion,
  type MeetUi,
  type QuestionsState,
  type TurnAxis,
} from '../lib/questions';
import {
  axisLabel,
  COPY,
  describeLookHint,
  describeMini,
  describePairHint,
  describeSizeHint,
  describeUpHint,
  describeOrientation,
  describeProgress,
  describePendingPlacement,
  describeReady,
  describeTooManyFiles,
  describeUnits,
  describeWrongFile,
  describePaintFileWaiting,
  describeUnsavedPainting,
  paintSaved,
  LEVEL_LABELS,
  MESHTAVERN_URL,
  pageStateOf,
  type PageState,
} from './page-state';
import { ICONS, type IconName } from './icons';
import { createDialog } from './dialog';
import { createConfirm } from './confirm';
import {
  forgetUnsaved,
  readPalette,
  readUnsaved,
  warnWith,
  withColour,
  writePalette,
  writeUnsaved,
  type UnsavedPainting,
} from './storage';
import { createMenu } from './menu';
import { Viewer, type BakedMini, type Perf } from './viewer';

interface AppState {
  ready: boolean;
  /** Which of the five states the page shows; follows from the rest, see `render()`. */
  page: PageState;
  busy: boolean;
  /**
   * The question a conversion waits at after its orient step (#92), without its mesh: what the
   * question view shows and asks (#119). `name` is the file's, `serial` counts the questions of
   * a conversion. Null when nothing is asked; the page is `asking` while it is set.
   */
  question: AskedQuestion | null;
  /**
   * At a meet question (#93, patches §7): the pair the next tap goes to, the brush and the eraser,
   * the parts pulled apart, and the part the final view's buttons move (null: the last marked).
   * The view's; the marks themselves are the worker's.
   */
  meet: MeetUi;
  /**
   * From picking or dropping the files to two frames after the first question's meshes went to
   * the question view: the time to the question (#92, design note §8). Null until measured.
   */
  questionMs: number | null;
  fileName: string | null;
  progress: Progress | null;
  /** Every progress message of the last conversion, for tests. */
  progressLog: Progress[];
  stats: ConversionStats | null;
  /** Character or prop, as the last conversion guessed or was told (#99). */
  kind: KindGuess | null;
  /** The painter (#127, #167): the painting view's state, null before it was first opened. */
  painting: PaintingState | null;
  /** The painter is on screen: Paint was pressed and Done not yet (#167). Never true while busy. */
  painter: boolean;
  /** The time from Paint to the view's first frame, the last time the painter was opened (#167). */
  painterMs: number | null;
  /** The time the last painted download took to make its texture and PNG (#167). */
  paintExportMs: number | null;
  /** The mini carries a paint, taken at the last Done (#167): its downloads carry it. */
  painted: boolean;
  /** What the page knows of the paint file on this mini (#167, design note §7). */
  paintFile: {
    /** A paint file dropped alone, waiting for its STL files: its sources; null when none waits. */
    pending: SourceFingerprint[] | null;
    /** The painting on screen replays steps of an older engine (PAINT_COPY.olderEngine). */
    olderEngine: boolean;
    /** The name the last Save paint file wrote, for the status line; null before one. */
    savedAs: string | null;
  };
  /** The confirm dialog's question on screen (#167, §8.3); null when none is. */
  confirm: string | null;
  /** The unsaved painting the last drop offered back (#167, §8.4); null when none was. */
  unsavedOffer: UnsavedPainting | null;
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
  /**
   * Where the conversion was when the longest gap fell: the step in progress, `transcode` or
   * `show` after the worker is done, `before → after` when it changed during the gap (#156).
   */
  longestFrameGapDuring: string | null;
  /** Main-thread time to hand the first mesh to the GPU. */
  showMeshMs: number | null;
  /** Which version is on screen: 0 = full detail, 1… = LODs from highest to lowest. */
  shownLevel: number;
  /** Live rendering figures, refreshed twice a second. */
  perf: Perf | null;
  /** Number of minis in the stress scene; 0 when a single mini is shown. */
  stressCount: number;
  look: Look;
  /** The preset the look is; null once a control was moved away from all of them (#45). */
  lookPreset: LookPresetId | null;
  /** The id of the source preset in force (#100): at a question, what the select set; null for none. */
  preset: string | null;
  /** Set after a GLB was opened: what the file contained. */
  imported: {
    triangles: number;
    sizeMm: [number, number, number];
    /** The file carries texture coordinates: an unwrapped table level (#109). */
    textureCoordinates: boolean;
  } | null;
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

type Vec3 = [number, number, number];
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
      /**
       * The painter (#127, #167): opens the painting view on the converted mini and enters the
       * painting state, with the test paint `paint` (#125's) and a mask (#138) to continue from,
       * and gives the view for the tests; `close` closes the view and leaves the state.
       */
      painting: Omit<PaintHooks, 'open'> & {
        /** `groups` (#139): the groups to open with; left out, the page's automatic ones (`groupsOf`). */
        open: (
          paint?: TestPaint | null,
          mask?: PaintMask | null,
          groups?: PaintGroups | null,
          replay?: PaintReplay | null,
        ) => Promise<void>;
        /** The test paint `open` takes, as pixels: what a test compares the view's paint with. */
        testPaint: (paint: TestPaint) => Albedo;
      };
      /** Paint (#167): enters the painting state, opening the view on the mini unless it is open. */
      openPainter: () => Promise<void>;
      /** Done (#167): back to the done state, the view kept open and hidden. */
      closePainter: () => Promise<void>;
      /** The paint on the mini after Done (#167), null when it has none. */
      paint: () => Promise<Albedo | null>;
      /** Save paint file (#167): what the button writes, as bytes; the download happens too. */
      savePaintFile: () => Promise<Uint8Array>;
      /** What Open paint file and a paint file dropped alone do (#167). */
      openPaintFile: (bytes: ArrayBuffer, name?: string) => Promise<void>;
      /** Answers the confirm dialog on screen (#167), as its yes or no button does. */
      confirm: (answer: boolean) => void;
      /** What the page keeps on this device (#167, §8.5). */
      storage: {
        unsaved: () => Promise<UnsavedPainting | null>;
        forget: () => Promise<void>;
        palette: () => string[];
      };
      loadDemo: () => Promise<void>;
      /** Converts a generated sheet of `quadsPerSide`² × 2 triangles; 1000 gives a 100 MB STL. */
      loadGenerated: (quadsPerSide: number, sizing?: SizingOptions) => Promise<void>;
      showLevel: (level: number) => void;
      setCamera: (azimuthDeg: number, elevationDeg: number, zoom: number) => void;
      setWireframe: (wireframe: boolean) => void;
      /** Changes some or all look settings and re-colours what is on screen. */
      setLook: (changes: Partial<Look>) => void;
      /** Sets every look control to a preset's values, as its button does (#45). */
      setLookPreset: (id: LookPresetId) => void;
      /** Shows the table level with baked maps (true) or with per-vertex data (false). */
      showBaked: (on: boolean) => void;
      /** Stops the running conversion. */
      cancel: () => void;
      /** The converted mini's detail texture as a KTX2 file, or null when it has none. */
      detailKtx2: () => Uint8Array | null;
      /**
       * The thumbnail of the converted mini's table level as a PNG (#99): baked when it was, in the
       * current look, drawn with the viewer's renderer. Rejects for an opened GLB. `paint` (#125, a
       * baked mini only) paints the table level red where x > 0 (`x+`), x < 0 (`x-`) or all over
       * (`all`) and draws that paint under the look.
       */
      thumbnail: (size?: number, paint?: TestPaint) => Promise<ArrayBuffer>;
      /** Runs the device benchmark and resolves with its Markdown result. */
      runBenchmark: (size: BenchmarkSize) => Promise<string>;
      /**
       * Encodes a level (1 = close, 2 = table, 3 = far) with the current look. `unwrapped`
       * takes the table level's baked mesh, with its texture coordinates: the file the table
       * application stores next to the detail texture (#109).
       */
      exportGlb: (level: number, compact: boolean, unwrapped?: boolean) => Promise<ArrayBuffer>;
      /** Opens a GLB in the viewer, as dropping the file would. */
      loadGlb: (glb: ArrayBuffer, name?: string) => Promise<void>;
      /** Fills the table with copies of the converted mini. `forcedLod` pins every copy to one LOD (0 = 50k). */
      /** Converts the last file again with a fixed up axis. */
      setUp: (up: UpAxis) => Promise<void>;
      /**
       * Picks a source preset by id, or none (#100): at an up question the question comes again
       * standing the preset's way; after a conversion it converts again with it, asking nothing.
       * Resolves when the question or the mini is back.
       */
      setPreset: (id: string | null) => Promise<void>;
      /**
       * At a question (#92): shows how the file stands with these options (left out: the
       * proposal). Resolves when the question that comes back is on screen.
       */
      answerUp: (options?: OrientationOptions) => Promise<void>;
      /** At a question: confirms, with these options or, left out, what is on screen, a turn being tried out included. */
      confirmUp: (options?: OrientationOptions) => Promise<void>;
      /** At a question about a pair: the other file is the base. Resolves when its question is on screen. */
      swapAtQuestion: () => Promise<void>;
      /** At the base's question (#93): this file is the base, or null: none, the files are parts of one figure. */
      chooseBase: (file: number | null) => Promise<void>;
      /**
       * At a meet question (#93, patches §7.5): a tap on `file` at `point`, file coordinates, on
       * pair `pair` (left out: the one selected). Each of these resolves when the question that
       * comes back is on screen, the one that ends the meeting at once.
       */
      tap: (file: number, point: Vec3, pair?: number) => Promise<void>;
      /** Brush dabs (or eraser dabs) of one drag on `file`, file coordinates. */
      brush: (
        file: number,
        points: Vec3[],
        options?: { erase?: boolean; pair?: number },
      ) => Promise<void>;
      /** Selects the next pair, or one of the pairs: where the next tap goes. */
      addPair: () => void;
      selectPair: (k: number) => void;
      /** Clears one pair, or everything: back to the proposal ("Start over"). */
      clearMarks: (pair?: number) => Promise<void>;
      undoMark: () => Promise<void>;
      /** The pairs stop: put them together. The final view: back to the pairs. */
      fitMeeting: () => Promise<void>;
      backToMarks: () => Promise<void>;
      /** The final view: raises (positive) or lowers, turns, lets tilt or keeps upright what is fitted. */
      liftMeeting: (mm: number) => Promise<void>;
      turnMeeting: (deg: number) => Promise<void>;
      setTilt: (mode: 'keep' | 'free' | null) => Promise<void>;
      /** Confirms the stop on screen: the pairs (put together), or the final view (go on). */
      confirmMeet: () => Promise<void>;
      /** Any action at a meet question, as the worker takes it. */
      answerMeet: (action: MeetAction) => Promise<void>;
      /** What a tap at canvas point (x, y), CSS pixels, would hit; nothing is marked. */
      pickAt: (x: number, y: number) => Promise<{ file: number; point: Vec3 } | null>;
      /** At a question: where a file's point is on the canvas, CSS pixels from its corner. */
      screenOf: (file: number, point: Vec3) => [number, number] | null;
      /** At a meet question: the camera turns about the spot under (x, y), as a right-click does; resolves with what was hit. */
      focusAt: (x: number, y: number) => Promise<{ file: number; point: Vec3 } | null>;
      /** At a meet question: the camera frames one file, as its Look at button does. */
      focusFile: (file: number) => void;
      /** The Base section's buttons (#93): converts again, asking only where they meet, or how the parts go together. */
      markMeeting: () => Promise<void>;
      markParts: () => Promise<void>;
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
const panel = document.querySelector<HTMLElement>('#panel')!;
const sheetHandle = document.querySelector<HTMLButtonElement>('#sheet-handle')!;
/** Adjust's four disclosures (#144): Up and turn, Size, Look, Base and parts. */
const disclosures = {
  orient: document.querySelector<HTMLDetailsElement>('#orient')!,
  sizing: document.querySelector<HTMLDetailsElement>('#sizing')!,
  look: document.querySelector<HTMLDetailsElement>('#look')!,
  pair: document.querySelector<HTMLDetailsElement>('#pair')!,
};
/** The hint at the right of each disclosure's summary: what it holds now. */
const hints = Object.fromEntries(
  [...document.querySelectorAll<HTMLElement>('[data-hint]')].map((hint) => [
    hint.dataset.hint!,
    hint,
  ]),
) as Record<keyof typeof disclosures, HTMLElement>;
const status = document.querySelector<HTMLElement>('#status')!;
const statusText = status.querySelector<HTMLElement>('.status-text')!;
/** The application's progress component: a bar whose fill is the share of the steps done. */
const progressBar = document.querySelector<HTMLElement>('#progress')!;
const progressFill = progressBar.querySelector<HTMLElement>('span')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!;
const statsList = document.querySelector<HTMLElement>('#stats')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const levelButtons = document.querySelector<HTMLElement>('#levels')!;
const stressButtons = document.querySelector<HTMLElement>('#stress')!;
/** The up axis after a conversion (#144): a segmented group of six buttons, as the question's. */
const upButtons = document.querySelector<HTMLElement>('#up')!;
const turnPanel = document.querySelector<HTMLElement>('#turn')!;
const turnByHand = document.querySelector<HTMLInputElement>('#turn-by-hand')!;
const turnPending = document.querySelector<HTMLElement>('#turn-pending')!;
const turnReset = document.querySelector<HTMLButtonElement>('#turn-reset')!;
const turnApply = document.querySelector<HTMLButtonElement>('#turn-apply')!;
const perfLine = document.querySelector<HTMLElement>('#perf')!;
/** The source preset's select in Adjust; the question's is the view's (#100). */
const sourceSelect = document.querySelector<HTMLSelectElement>('#source')!;
const pairInputs = {
  fieldset: disclosures.pair,
  addBase: document.querySelector<HTMLButtonElement>('#add-base')!,
  baseFile: document.querySelector<HTMLInputElement>('#base-file')!,
  files: document.querySelector<HTMLElement>('#pair-files')!,
  parts: document.querySelector<HTMLElement>('#pair-parts')!,
  markMeeting: document.querySelector<HTMLButtonElement>('#mark-meeting')!,
  markParts: document.querySelector<HTMLButtonElement>('#mark-parts')!,
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

/** Paint (#167): the done panel's section. */
const paintOpen = document.querySelector<HTMLButtonElement>('#paint-open')!;
const paintCannot = document.querySelector<HTMLElement>('#paint-cannot')!;
/** The painter's footer (#167) and the empty state's way out of a waiting paint file. */
const paintFileSave = document.querySelector<HTMLButtonElement>('#paint-file-save')!;
const paintFileInput = document.querySelector<HTMLInputElement>('#paint-file-input')!;
const paintFileForget = document.querySelector<HTMLButtonElement>('#paint-file-forget')!;
paintCannot.textContent = PAINT_COPY.cannotPaint;

const viewer = new Viewer(canvas);
/**
 * The questions a conversion asks (#92, #93, #119): the library's question view, mounted where they
 * lived on the page, its canvas over the viewer's. The page mirrors what it shows into `state`.
 */
const view = mountQuestions({
  scene: document.querySelector<HTMLElement>('#question-view')!,
  controls: document.querySelector<HTMLElement>('#questions')!,
  // Confirm beside the page's Cancel, in the panel's footer (design note look-and-feel.md §4.5).
  footer: document.querySelector<HTMLElement>('#panel-footer')!,
  onChange: showAsked,
});
/** When the person picked the files, for `questionMs`; null once measured or when nothing is asked. */
let questionStartedAt: number | null = null;
const converter = new Converter();
/** Memory a conversion may use on this device; only Chromium says how much the device has. */
const memoryBudget = memoryBudgetBytes(
  (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
);
/**
 * What the page knows about a mini, as before the first file: the start-up values, and what Close
 * puts back (#144). The look, the theme and the figures of the page itself stay.
 */
const noMini = (): Pick<
  AppState,
  | 'questionMs'
  | 'fileName'
  | 'stats'
  | 'kind'
  | 'cancelled'
  | 'showMeshMs'
  | 'shownLevel'
  | 'stressCount'
  | 'preset'
  | 'imported'
  | 'baked'
  | 'showingBaked'
  | 'orientation'
  | 'pair'
  | 'painter'
  | 'painterMs'
  | 'paintExportMs'
  | 'painted'
> => ({
  questionMs: null,
  fileName: null,
  stats: null,
  kind: null,
  cancelled: false,
  showMeshMs: null,
  shownLevel: 0,
  stressCount: 0,
  preset: null,
  imported: null,
  baked: null,
  showingBaked: false,
  orientation: { turn: null, turnDeg: 0 },
  pair: null,
  painter: false,
  painterMs: null,
  paintExportMs: null,
  painted: false,
});
const state: AppState = {
  ...noMini(),
  ready: false,
  page: 'empty',
  busy: false,
  question: null,
  meet: view.state.meet,
  progress: null,
  progressLog: [],
  painting: null,
  error: null,
  errorCode: null,
  errorDetail: null,
  paintFile: { pending: null, olderEngine: false, savedAs: null },
  confirm: null,
  unsavedOffer: null,
  framesWhileConverting: 0,
  longestFrameGapMs: 0,
  longestFrameGapDuring: null,
  perf: null,
  look: { ...DEFAULT_LOOK },
  lookPreset: presetOf(DEFAULT_LOOK),
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
  /**
   * Its size and SHA-256 (#167, §7.4), for the paint file: taken once, from a fresh `read`, in
   * `digest.worker.ts`, when the painter first opens on the mini.
   */
  fingerprint?: Promise<Omit<SourceFingerprint, 'role'>>;
}

/**
 * The worker that hashes the sources (#167): a digest on the page's thread copies the file there
 * first, and a 280 MB file stalled the page about 250 ms at the conversion's start (journal).
 */
let digester: Worker | null = null;
const digests = new Map<number, (fingerprint: Omit<SourceFingerprint, 'role'>) => void>();
let digestId = 0;

/** A file's size and SHA-256, without its role, hashed off the page's thread; the buffer moves there. */
function digestOf(bytes: ArrayBuffer): Promise<Omit<SourceFingerprint, 'role'>> {
  if (!digester) {
    digester = new Worker(new URL('./digest.worker.ts', import.meta.url), { type: 'module' });
    digester.onmessage = ({
      data,
    }: MessageEvent<{ id: number } & Omit<SourceFingerprint, 'role'>>) => {
      digests.get(data.id)?.({ bytes: data.bytes, sha256: data.sha256 });
      digests.delete(data.id);
    };
  }
  const id = ++digestId;
  return new Promise((resolve) => {
    digests.set(id, resolve);
    digester!.postMessage({ id, bytes }, [bytes]);
  });
}

/** Starts the sources' fingerprints, each once (the painter's open, a save, the record). */
function fingerprintSources(): void {
  for (const source of sources) source.fingerprint ??= source.read().then(digestOf);
}

/** The sources' fingerprints in the conversion's order, with the roles it gave them (#167, §7.4). */
async function sourceFingerprints(): Promise<SourceFingerprint[]> {
  const roles = sourceRoles(state.stats?.pair ?? null, sources.length);
  fingerprintSources();
  return Promise.all(
    sources.map(async (source, k) => ({ role: roles[k]!, ...(await source.fingerprint!) })),
  );
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
  /** A pair only: the user moved, raised or turned the figure, relative to the detection, or marked where they meet (#93). */
  placement: PlacementOptions;
  /** A figure in parts (#93): the joints of the parts that lie apart in their files. */
  parts: PartsOptions;
  /** The source preset (#100): laid under the choices above by the converter; null for none. */
  preset: SourcePreset | null;
}
const noChoices = (): Choices => ({
  preset: null,
  orientation: {},
  baseOrientation: {},
  sizing: {},
  pairing: {},
  placement: {},
  parts: { joints: [] },
});
/** Whether the axis comes from the source preset: one is set, and these options choose no axis or turn. */
const upFromPreset = (options: OrientationOptions): boolean =>
  state.preset !== null && options.up === undefined && options.rotation === undefined;
/** Whether the units come from the source preset: one is set, and no units were chosen by hand. */
const unitsFromPreset = (): boolean =>
  choices.preset !== null && choices.sizing.units === undefined;
/** Whether an axis or turn was chosen, rather than left to the detection. */
const chosen = (options: OrientationOptions): boolean =>
  options.up !== undefined || options.rotation !== undefined || options.setDown === true;
/** What the user chose for the last source; a new file starts without choices. */
let choices: Choices = noChoices();

/**
 * "figure.stl", or "body.stl + wing.stl + base.stl": the figure's parts first, the body leading,
 * then the base, once a conversion said which is which (#70, #93).
 */
function sourcesName(pair: PairResult | null = null): string {
  const names = sources.map((source) => source.name);
  if (!pair) return names.join(' + ');
  const { baseFile } = pair.pairing;
  const order = [...pair.parts.map((part) => part.file), ...(baseFile === null ? [] : [baseFile])];
  return order.map((file) => names[file]).join(' + ');
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
  // Over unsaved steps in the painter, the person says whether to lose them (#167, §8.3).
  if (!(await paintingMayGo())) return;
  const [stl, ...others] = await Promise.all(sources.map((source) => source.read()));
  // The files as given: the roles may have changed with them (a base added or removed).
  await convert(stl!, sourcesName(), others, ask);
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
  // The application's centred card, or its panel frame when done, at a question (#144) and
  // painting (#167).
  const framed = state.page === 'done' || state.page === 'asking' || state.page === 'painting';
  panel.classList.toggle('card', !framed);
  panel.classList.toggle('panel', framed);
  // In the card Cancel is the one button; in the panel's footer it stands beside Confirm.
  cancelButton.classList.toggle('btn-ghost', framed);
  if (!framed) expandSheet(false);
  if (state.imported) document.body.dataset.kind = 'glb';
  else delete document.body.dataset.kind;
  const name = state.fileName ?? '';
  heading.textContent =
    state.page === 'empty'
      ? COPY.dropHeading
      : state.page === 'error'
        ? COPY.errorHeading
        : state.page === 'done' || state.page === 'painting'
          ? (importedName ?? name.replace(/\.stl(?=$| \+ )/gi, ''))
          : name;
  fileNameLine.textContent = name;
  sourceSelect.value = state.preset ?? '';
  chooseAgain.textContent = state.page === 'error' ? COPY.chooseAnother : COPY.chooseFile;
  chooseButton.disabled = state.busy;
  // Paint (#167): a mini without a detail texture cannot be painted, and the hint says why.
  paintOpen.disabled = baked === null;
  paintCannot.hidden = baked !== null;
  paintFileForget.hidden = state.paintFile.pending === null;
  paintFileSave.disabled = (state.painting?.steps ?? 0) === 0;
}

/** Writes the status line; a problem shows as the application's error callout, with its icon. */
function setStatus(text: string, problem = false): void {
  statusText.textContent = text;
  status.classList.toggle('problem', problem);
  status.classList.toggle('callout', problem);
  status.classList.toggle('callout-error', problem);
}

/** The share of the conversion done on the progress bar; `silent`: the step says nothing of its own. */
function showProgress(percent: number, silent = false): void {
  progressFill.style.width = `${percent}%`;
  progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
  progressBar.toggleAttribute('data-silent', silent);
}

/** The bottom sheet on a phone (design note §4.8): its first screen, or expanded by its handle. */
function expandSheet(expanded: boolean): void {
  panel.toggleAttribute('data-expanded', expanded);
  sheetHandle.setAttribute('aria-expanded', String(expanded));
}

/** The hints of Adjust's disclosures for the mini on screen; the look's follows its controls. */
function showHints(stats: ConversionStats): void {
  hints.orient.textContent = describeUpHint(stats.orientation, upFromPreset(choices.orientation));
  hints.sizing.textContent = describeSizeHint(stats.sizing);
  hints.pair.textContent = describePairHint(stats.pair);
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function showStats(stats: ConversionStats): void {
  const rows: [string, string][] = [
    ['Up', describeOrientation(stats.orientation, upFromPreset(choices.orientation))],
    ['Size', describeSize(stats.sizing)],
    ['Units', describeUnits(stats.sizing, unitsFromPreset())],
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
  const parts = pair!.parts.length > 1 ? `, ${pair!.parts.length} parts` : '';
  const base = pairing.files[pairing.baseFile]!;
  const { spot } = placement;
  return [
    [
      'Pair',
      `base: file ${pairing.baseFile + 1} (${pairing.method}), figure ${size(figure.sizeMm)}${parts}, base ${size(base.sizeMm)}` +
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
    sizingInputs.warning.querySelector('.callout-text')!.textContent =
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
      button.className = 'chip';
      button.textContent = LEVEL_LABELS[level] ?? `Level ${level}`;
      button.title = `${count.toLocaleString()} triangles`;
      button.addEventListener('click', () => showLevel(level));
      return button;
    }),
  );
}

const lookBaseHex = document.querySelector<HTMLElement>('#look-base-hex')!;
const lookInputs = {
  enabled: document.querySelector<HTMLInputElement>('#look-enabled')!,
  base: document.querySelector<HTMLInputElement>('#look-base')!,
  occlusion: document.querySelector<HTMLInputElement>('#look-occlusion')!,
  wash: document.querySelector<HTMLInputElement>('#look-wash')!,
  edges: document.querySelector<HTMLInputElement>('#look-edges')!,
};

// The starting points (#45): a button per preset, pressed while the controls are at its values.
const presetButtons = LOOK_PRESETS.map((preset) => {
  const button = document.createElement('button');
  const dot = document.createElement('span');
  button.type = 'button';
  button.className = 'chip';
  dot.className = 'chip-dot';
  button.append(dot, preset.label);
  button.dataset.preset = preset.id;
  // The dot is the preset's base coat.
  button.style.setProperty('--chip-color', preset.look.base);
  button.addEventListener('click', () => setLookPreset(preset.id));
  return button;
});
document.querySelector<HTMLElement>('#look-presets')!.append(...presetButtons);

/**
 * The look is one value (#167, design note §5): the page's, shown in Adjust, the viewer and the
 * painter. `toView` false when the painter's panel changed it: the view has it already.
 */
function setLook(changes: Partial<Look>, toView = true): void {
  Object.assign(state.look, changes);
  lookInputs.enabled.checked = state.look.enabled;
  lookInputs.base.value = state.look.base;
  lookInputs.occlusion.value = String(state.look.occlusion);
  lookInputs.wash.value = String(state.look.wash);
  lookInputs.edges.value = String(state.look.edges);
  lookBaseHex.textContent = state.look.base;
  state.lookPreset = presetOf(state.look);
  hints.look.textContent = describeLookHint(
    LOOK_PRESETS.find((preset) => preset.id === state.lookPreset)?.label ?? null,
  );
  for (const button of presetButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === state.lookPreset));
  }
  viewer.setLook(state.look);
  if (toView && paintTool.isOpen()) paintTool.view().setLook(state.look);
}

/** The same five values: the look the view shows is the page's. */
const sameLook = (a: Look, b: Look): boolean =>
  a.enabled === b.enabled &&
  a.base === b.base &&
  a.occlusion === b.occlusion &&
  a.wash === b.wash &&
  a.edges === b.edges;

function setLookPreset(id: LookPresetId): void {
  const preset = LOOK_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No look preset "${id}"`);
  setLook(preset.look);
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

async function setUp(up: UpAxis): Promise<void> {
  if (sources.length === 0 || state.busy) return;
  choices.orientation = { up };
  await reconvert();
}

/**
 * Picks a source preset, or none (#100 design note §5). At an up question the view answers: the
 * question comes again, the file standing the preset's way. After a conversion it converts
 * again asking nothing, without the choices the preset replaces: that is what picking it means.
 */
async function setPreset(id: string | null): Promise<void> {
  const preset = id === null ? null : findSourcePreset(id);
  if (id !== null && !preset) throw new Error(`No source preset "${id}"`);
  if (state.question?.kind === 'up') return view.setPreset(id);
  if (sources.length === 0 || state.busy || !state.stats) return;
  const sizing = { ...choices.sizing };
  delete sizing.units;
  delete sizing.scale;
  delete sizing.scaleToBaseMm;
  choices = preset
    ? { ...choices, orientation: {}, baseOrientation: {}, sizing, preset }
    : { ...choices, preset: null };
  await reconvert();
}

const presetOptions = (): HTMLOptionElement[] => [
  new Option(COPY.noPreset, ''),
  ...SOURCE_PRESETS.map((preset) => new Option(preset.label, preset.id)),
];
sourceSelect.replaceChildren(...presetOptions());
sourceSelect.addEventListener('change', () => void setPreset(sourceSelect.value || null));

/** Pitch tips the mini towards the camera's default view (about scene x), roll to the side (about z). */
const TURN_AXES: Record<TurnAxis, [number, number, number]> = {
  pitch: [1, 0, 0],
  roll: [0, 0, 1],
};

/** Shows a turn being tried out after a conversion, in the viewer and in words; null drops it. */
function showTurn(turn: Rotation | null): void {
  const deg = turn ? turnAngleDeg(turn) : 0;
  state.orientation = { turn: deg > 0 ? turn : null, turnDeg: deg };
  viewer.setTurn(state.orientation.turn);
  turnPending.hidden = state.orientation.turn === null;
  turnPending.textContent = `Turned ${Math.round(deg)}°, not set down yet`;
  turnReset.disabled = state.orientation.turn === null;
  turnApply.disabled = state.orientation.turn === null;
}

function turn(axis: TurnAxis, deg: number): void {
  // At a question the turn is the view's (#119).
  if (state.busy || !state.stats) return;
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
  // At a question the meshes are the view's, drawn by its own renderer over the viewer's (#119).
  if (state.question) Object.assign(perf, view.rendered());
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

/** Where a conversion is once the worker is done: the frame watch names it (#156). */
let afterWorker: 'transcode' | 'show' | null = null;

/** Counts animation frames until stopped, to prove the page stayed responsive. */
function watchFrames(): () => void {
  let running = true;
  let last = performance.now();
  afterWorker = null;
  const phase = (): string => afterWorker ?? state.progress?.step ?? 'start';
  let lastPhase = phase();
  state.framesWhileConverting = 0;
  state.longestFrameGapMs = 0;
  state.longestFrameGapDuring = null;
  const tick = (now: number): void => {
    if (!running) return;
    state.framesWhileConverting++;
    const during = phase();
    if (now - last > state.longestFrameGapMs) {
      state.longestFrameGapMs = now - last;
      state.longestFrameGapDuring = during === lastPhase ? during : `${lastPhase} → ${during}`;
    }
    last = now;
    lastPhase = during;
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
 * What the question view shows (#119), mirrored into `state` for the tests, after every change.
 * The first question of a conversion takes the mini off the viewer, as drawing the question there
 * did (#92), and starts the clock of the time to the question.
 */
function showAsked(shown: QuestionsState): void {
  const before = state.question;
  state.question = shown.question;
  state.meet = shown.meet;
  // While a conversion runs the turn being tried out is the view's; after it, the page's (Adjust).
  if (state.busy) state.orientation = shown.turn;
  if (shown.question && state.busy) state.preset = shown.preset;
  if (shown.question && shown.question !== before) {
    setStatus('');
    const started = questionStartedAt;
    if (started !== null) {
      questionStartedAt = null;
      viewer.clear();
      // Once the meshes have all their chunks, one per frame (#108), and two frames more, so that
      // drawing them counts.
      void view
        .drawn()
        .then(() =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => (state.questionMs = performance.now() - started)),
          ),
        );
    }
  }
  render();
}

/**
 * Converts with the choices made for the current source; see `choices`. `ask` names the files
 * to stop and ask about after the orient step (#92), unless the address has `?ask=off`;
 * `startedAt` is when the person picked the files, for the time to the question.
 */
async function convert(
  stl: ArrayBuffer,
  fileName: string,
  others: ArrayBuffer[] = [],
  ask: AskOptions | null = null,
  startedAt = performance.now(),
): Promise<void> {
  if (state.busy) return;
  const asks = ask !== null && pageOptions.ask;
  const [secondStl, ...moreStl] = others;
  // The view words and answers the questions: the names, what is asked, what Confirm sends back.
  const askUp = asks
    ? view.start({
        names: sources.map((source) => source.name),
        ask: ask!,
        orientation: choices.orientation,
        baseOrientation: choices.baseOrientation,
        preset: choices.preset?.id ?? null,
      })
    : undefined;
  questionStartedAt = asks ? startedAt : null;
  // The steps belong to the surface that was converted: a conversion closes the painter (#167).
  paintTool.close();
  showPaint(null, false);
  unsaved = false;
  painterProblem = null;
  state.paintFile.olderEngine = false;
  state.paintFile.savedAs = null;
  Object.assign(state, {
    painter: false,
    busy: true,
    preset: choices.preset?.id ?? null,
    question: null,
    meet: view.state.meet,
    questionMs: null,
    fileName,
    stats: null,
    error: null,
    errorCode: null,
    errorDetail: null,
    cancelled: false,
    progressLog: [],
  });
  setStatus('');
  showProgress(0);
  render();
  const stopWatching = watchFrames();
  try {
    const result = await converter.convert(
      stl,
      (progress) => {
        state.progress = progress;
        if (progress.stepPercent === undefined) state.progressLog.push(progress);
        showProgress(progress.percent, progress.stepPercent === undefined);
        setStatus(describeProgress(progress));
      },
      {
        orientation: choices.orientation,
        sizing: choices.sizing,
        preset: choices.preset,
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
        ...(moreStl.length > 0 && { moreStl }),
        ...(secondStl && choices.parts.joints.length > 0 && { parts: choices.parts }),
      },
      askUp,
    );
    // From here on the mini exists; cancelling would only stop it from being shown.
    cancelButton.disabled = true;
    const stats = result.stats;
    // What was confirmed at the questions is kept: a later conversion of these files repeats it.
    choices.orientation = result.choices.orientation;
    choices.preset = result.choices.preset ?? null;
    if (secondStl) {
      choices.baseOrientation = result.choices.baseOrientation ?? {};
      choices.pairing = result.choices.pairing ?? {};
      choices.parts = result.choices.parts ?? { joints: [] };
      // What the meet question ended with stays (marks, or the automatic placement nudged);
      // without either, a move made by hand stays (#93).
      const byHand = { ...choices.placement };
      delete byHand.marks;
      choices.placement = result.choices.placement ?? byHand;
    }
    baked = null;
    detailKtx2 = null;
    state.baked = null;
    afterWorker = 'transcode';
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
    afterWorker = 'show';
    levels = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    state.stats = stats;
    state.kind = result.kind;
    // The heading names the figure first once the conversion said which file is the base.
    state.fileName = sourcesName(stats.pair);
    showLevelButtons(stats);
    state.imported = null;
    importedName = null;
    showUp(stats.up);
    showTurn(null);
    showPlacement(null);
    showPairSection(stats);
    showSizing(stats.sizing);
    showHints(stats);
    // A size warning is never hidden behind a closed disclosure.
    if (stats.sizing.warnings.length > 0) disclosures.sizing.open = true;
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
    setStatus(describeReady(stats));
    miniSize.textContent = describeMini(stats);
    showStats(stats);
    if (pageOptions.dev) void showDevThumbnail();
  } catch (error) {
    if (error instanceof ConversionCancelled) {
      state.cancelled = true;
      setStatus(COPY.cancelled);
    } else {
      showProblem(fileName, error);
    }
  } finally {
    stopWatching();
    cancelButton.disabled = false;
    showProgress(0);
    state.progress = null;
    state.busy = false;
    // Cancelled or failed at a question: its meshes leave the screen too.
    questionStartedAt = null;
    view.end();
    // A preset tried at a question that was then cancelled is not the mini's.
    state.preset = choices.preset?.id ?? null;
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

/**
 * A level as a GLB with the current look. A painted mini's downloads carry the paint (#167, design
 * note §6.1): the table level as the unwrapped mesh with the painted look as its texture, the far
 * level with the paint per vertex. Unpainted, both are the files of before, byte for byte.
 */
async function exportGlb(level: number, compact: boolean, unwrapped = false): Promise<ArrayBuffer> {
  const painted = miniPaint && baked ? { albedo: miniPaint, table: baked.mesh } : null;
  const table = level === TABLE_LEVEL && (unwrapped || painted) ? baked?.mesh : undefined;
  const mesh = table ?? levels[level];
  if (!mesh || level === 0 || !state.fileName) throw new Error('No converted level to export');
  if (compact) await glbEncoderReady();
  const started = performance.now();
  const texture = painted && table ? await paintedPng(painted.albedo) : null;
  const paint =
    painted && !table && level === levels.length - 1
      ? paintAtVertices(mesh, painted.table, painted.albedo)
      : null;
  if (texture) state.paintExportMs = performance.now() - started;
  return encodeGlb(mesh, {
    name: downloadName(),
    look: state.look,
    compact,
    sizing: state.stats?.sizing,
    orientation: state.stats?.orientation,
    paint,
    texture: texture && { mimeType: 'image/png', bytes: texture },
  });
}

/** The surface the paint was taken from, read once per paint from the view (#167). */
let paintSurface: { paint: Albedo; surface: Promise<ShadedTexels> } | null = null;

/** The painted look per texel as a PNG (#167): `paintedTexture` over the view's surface, encoded by a canvas. */
async function paintedPng(albedo: Albedo): Promise<Uint8Array> {
  if (paintSurface?.paint !== albedo)
    paintSurface = { paint: albedo, surface: paintTool.view().surface() };
  const { data, width, height } = paintedTexture(await paintSurface.surface, state.look, albedo);
  const png = await encodePng(data, width, height);
  if (!png) throw new Error('The painted texture could not be encoded');
  return new Uint8Array(await png.arrayBuffer());
}

/**
 * The thumbnail of the converted mini (#99): what `renderThumbnail` makes of the table level, baked
 * when it was, in the current look, with the viewer's renderer (no second WebGL context).
 */
async function thumbnail(size?: number, paint?: TestPaint): Promise<ArrayBuffer> {
  const mesh = baked ? baked.mesh : levels[TABLE_LEVEL];
  if (!mesh || !state.stats || state.imported) throw new Error('No converted mini to draw');
  // Uncompressed (?ktx=off) the page keeps texels: a texture is made for the picture and released.
  const made =
    baked && baked.texture instanceof Uint8Array
      ? createDetailTexture(baked.texture, baked.resolution)
      : null;
  const texture: Texture | null = made ?? (baked?.texture as Texture | undefined) ?? null;
  const tested = paint && baked ? testPaintTexture(baked.mesh, paint) : null;
  try {
    const png = await renderThumbnail(mesh, {
      size,
      look: state.look,
      texture,
      // The test paint, else the mini's own after Done (#167).
      albedo: tested ?? (baked ? viewer.paintTexture : null),
      renderer: viewer.webglRenderer,
    });
    return await png.arrayBuffer();
  } finally {
    made?.dispose();
    tested?.dispose();
  }
}

/** Where the test hook paints the table level red (#125). */
type TestPaint = 'x+' | 'x-' | 'all';
const TEST_PAINT_SIZE = 1024;
const TEST_PAINT_RED = [255, 0, 0, 255] as const;

/**
 * A paint texture as the table would hand it over: sRGB, rows as the detail texture's. Without
 * mipmaps: a test brush's paint is spread only PAINT_DILATION texels past its islands, and the
 * smaller mipmaps would mix neighbouring islands into specks the pixel test counts.
 */
function testPaintTexture(mesh: IndexedMesh, paint: TestPaint): Texture {
  const where = (x: number): boolean => (paint === 'all' ? true : paint === 'x+' ? x > 0 : x < 0);
  const { data, width, height } = paintWhere(mesh, TEST_PAINT_SIZE, where, TEST_PAINT_RED);
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The test paint (#125) at the painting engine's size, for opening the Paint tool on a paint (#127). */
function testPaintAlbedo(mesh: IndexedMesh, paint: TestPaint): Albedo {
  const where = (x: number): boolean => (paint === 'all' ? true : paint === 'x+' ? x > 0 : x < 0);
  return paintWhere(mesh, PAINT_SIZE, where, TEST_PAINT_RED);
}

/** The converted mini as the Paint tool takes it (#127): the baked table level, its texture, the look, the regions. */
function miniForPainting(): MiniForPainting | null {
  if (!baked || !state.stats || state.imported) return null;
  // Uncompressed (?ktx=off) the page keeps texels: a texture is made for the view and released.
  const made =
    baked.texture instanceof Uint8Array
      ? createDetailTexture(baked.texture, baked.resolution)
      : null;
  const pair = state.stats.pair;
  const regions = regionsOf(baked.mesh, {
    source: levels[0],
    figureTriangles: pair?.figureTriangles,
    sizing: state.stats.sizing,
    kind: state.kind ?? undefined,
  });
  return {
    mesh: baked.mesh,
    texture: made ?? (baked.texture as Texture),
    look: state.look,
    names: sources.map((source) => source.name),
    regions,
    // The automatic groups (#139): the base, the files and the shells.
    groups: groupsOf(baked.mesh, {
      regions,
      source: levels[0],
      parts: pair?.parts,
      figureTriangles: pair?.figureTriangles,
    }),
    release: () => made?.dispose(),
  };
}

const paintTool = createPainter(
  document.querySelector<HTMLElement>('#paint-view')!,
  document.querySelector<HTMLElement>('#paint-panel')!,
  miniForPainting,
  readPalette,
  (painting) => {
    const before = state.painting;
    state.painting = painting;
    // The panel's Look section changed the view's look: the page takes it (§5).
    if (painting?.open && !sameLook(painting.look, state.look)) setLook(painting.look, false);
    if (!painting?.open || replaying) return render();
    if (painting.steps !== before?.steps || painting.undone !== before?.undone) {
      paintingChanged(painting.steps > (before?.steps ?? 0));
    }
    render();
  },
);

/** The view's steps are a paint file's being replayed at open: not the person's changes. */
let replaying = false;
/** The painting changed since it was opened or last saved (#167, §7.3). */
let unsaved = false;
/** A refused paint file on the painter's status line, until the next change (§9.2). */
let painterProblem: string | null = null;
/** How long after the last step the unsaved record is written (#167, §8.2). _(proposal)_ */
const UNSAVED_WRITE_DELAY_MS = 1000;
let unsavedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A step was painted, undone or redone (#167): the painting is unsaved, the status line goes back
 * to what stays on the device, the record is written a second later, and a committed step's colour
 * joins the palette.
 */
function paintingChanged(committed: boolean): void {
  unsaved = true;
  painterProblem = null;
  state.paintFile.savedAs = null;
  showPainterStatus();
  if (unsavedTimer !== null) clearTimeout(unsavedTimer);
  unsavedTimer = setTimeout(() => {
    unsavedTimer = null;
    void keepUnsaved();
  }, UNSAVED_WRITE_DELAY_MS);
  if (!committed) return;
  const [colour] = recentColours(paintTool.view().history(), 1);
  if (!colour) return;
  writePalette(withColour(readPalette(), colour));
  paintTool.panel().setPalette(readPalette());
}

/** Writes the unsaved painting to this device (§8.2): the paint file's contents, no pixels. */
async function keepUnsaved(): Promise<void> {
  if (!unsaved || !paintTool.isOpen()) return;
  const file = await paintFileNow();
  await writeUnsaved({ file, names: sources.map((source) => source.name), at: Date.now() });
}

/** The painting as a paint file now (#167, §7.1). */
async function paintFileNow(): Promise<PaintFile> {
  const view = paintTool.view();
  return paintFileOf({
    sources: await sourceFingerprints(),
    choices: paintChoices(),
    look: { ...state.look },
    steps: view.history(),
    engines: view.engines(),
  });
}

/** The conversion's choices as a paint file keeps them: the result's, and the sizing chosen. */
function paintChoices(): PaintChoices {
  const sizing = choices.sizing;
  return {
    ...structuredClone(state.stats!.choices),
    ...(Object.keys(sizing).length > 0 && { sizing: structuredClone(sizing) }),
  };
}

/**
 * The painter's one status line (§9.2), the first that applies: a refused paint file, the older
 * engine, the save, else what stays on this device.
 */
function showPainterStatus(): void {
  if (!state.painter) return;
  if (painterProblem !== null) return setStatus(painterProblem, true);
  if (state.paintFile.olderEngine) return setStatus(PAINT_COPY.olderEngine);
  if (state.paintFile.savedAs !== null) return setStatus(paintSaved(state.paintFile.savedAs));
  setStatus(COPY.paintingKept);
}

/** Save paint file (#167, §7.1): the download, the line, and the record forgotten. */
async function savePaintFile(): Promise<Uint8Array> {
  const bytes = await writePaintFile(await paintFileNow());
  const name = `${downloadName()}${PAINT_FILE_EXTENSION}`;
  downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: PAINT_FILE_TYPE }), name);
  unsaved = false;
  if (unsavedTimer !== null) clearTimeout(unsavedTimer);
  unsavedTimer = null;
  painterProblem = null;
  state.paintFile.savedAs = name;
  showPainterStatus();
  await forgetUnsaved();
  return bytes;
}

/** The confirm dialog (#167, §8.3). */
const confirmDialog = createConfirm(document.querySelector<HTMLElement>('#confirm')!, (text) => {
  state.confirm = text;
});

/**
 * Before a conversion of the mini on screen (Adjust): with unsaved steps in the painter, asks
 * whether to convert again and lose them (§8.3). No puts Adjust's controls back.
 */
async function paintingMayGo(): Promise<boolean> {
  if (!paintTool.isOpen() || !unsaved) return true;
  const yes = await confirmDialog.ask(COPY.paintingLost, COPY.convertAgain, COPY.keepPainting);
  if (!yes && state.stats) {
    showSizing(state.stats.sizing);
    showUp(state.stats.up);
    render();
  }
  return yes;
}

/** The page's choices from a paint file's (#167, §7.5), so Adjust shows them and keeps them. */
function choicesOf(file: PaintFile): Choices {
  const options = convertOptionsOf(file);
  return {
    orientation: options.orientation ?? {},
    baseOrientation: options.baseOrientation ?? {},
    sizing: options.sizing ?? {},
    pairing: options.pairing ?? {},
    placement: options.placement ?? {},
    parts: options.parts ?? { joints: [] },
    // A preset the converter no longer has falls back to none.
    preset: options.preset ? (findSourcePreset(options.preset.id) ?? null) : null,
  };
}

/**
 * A paint file with its STL files (#167, §7.2 way 1, and the offer's Continue): the files convert
 * in the paint file's order with its choices and look, without a question, and the painter opens
 * at the end of its steps.
 */
async function convertWithPaintFile(
  file: PaintFile,
  files: { name: string; bytes: ArrayBuffer; read: () => Promise<ArrayBuffer> }[],
  startedAt = performance.now(),
): Promise<void> {
  sources = files.map(({ name, read }) => ({ name, read }));
  choices = choicesOf(file);
  setLook(file.look);
  pendingPaintFile = null;
  state.paintFile.pending = null;
  const [first, ...others] = files.map(({ bytes }) => bytes);
  await convert(first!, files.map(({ name }) => name).join(' + '), others, null, startedAt);
  if (!state.stats || state.error !== null) return;
  await replayOnMini(file);
}

/** Opens the painter on the mini on screen at the end of a paint file's steps (§7.2). */
async function replayOnMini(file: PaintFile): Promise<void> {
  setLook(file.look);
  replaying = true;
  try {
    await openPainter({ steps: file.steps, engines: file.engines });
  } finally {
    replaying = false;
  }
  unsaved = false;
  painterProblem = null;
  state.paintFile.olderEngine = paintedOnOlderEngine(file);
  state.paintFile.savedAs = null;
  showPainterStatus();
  render();
}

/** A paint file dropped alone, waiting for the STL files it names (§7.2 way 2). */
let pendingPaintFile: PaintFile | null = null;

/**
 * Open paint file, or a paint file dropped alone (#167, §7.2): for the mini on screen it replays
 * there (way 3), with no mini it waits for its files (way 2).
 */
async function openPaintFile(bytes: ArrayBuffer, name = 'paint file'): Promise<void> {
  if (state.busy) return;
  const onMini = state.stats !== null && !state.imported && state.error === null;
  let file: PaintFile;
  try {
    file = await readPaintFile(bytes);
  } catch (error) {
    if (onMini) return refusePaintFile(error);
    state.fileName = name;
    return showProblem(name, error);
  }
  if (onMini) return openPaintFileOnMini(file);
  pendingPaintFile = file;
  Object.assign(state, { error: null, errorCode: null, errorDetail: null, fileName: null });
  state.paintFile.pending = file.sources;
  setStatus(describePaintFileWaiting(file.sources));
  render();
}

/** A paint file refused on the mini on screen: its sentence on the status line, the mini as it is. */
function refusePaintFile(error: unknown): void {
  const problem = toProblem(error);
  painterProblem = problem.message;
  setStatus(problem.message, true);
}

/**
 * A paint file for the mini on screen (§7.2 way 3): its files must be this mini's; then, over
 * unsaved steps after asking, it replays here, or converts again first when its choices are not
 * the ones this mini was converted with.
 */
async function openPaintFileOnMini(file: PaintFile): Promise<void> {
  const buffers = await Promise.all(sources.map((source) => source.read()));
  let ordered: ArrayBuffer[];
  try {
    ordered = await matchSources(file, buffers);
  } catch (error) {
    return refusePaintFile(error);
  }
  if (paintTool.isOpen() && unsaved) {
    const yes = await confirmDialog.ask(COPY.replacePainting, COPY.openIt, COPY.keepPainting);
    if (!yes) return;
  }
  await forgetUnsaved();
  const same =
    JSON.stringify(convertOptionsOf(file)) ===
    JSON.stringify(convertOptionsOf({ choices: paintChoices() }));
  if (same) return replayOnMini(file);
  const files = ordered.map((bytes) => {
    const source = sources[buffers.indexOf(bytes)]!;
    return { name: source.name, bytes, read: source.read };
  });
  await convertWithPaintFile(file, files);
}

paintFileSave.addEventListener('click', () => void savePaintFile());
document.querySelector('#paint-file-open')!.addEventListener('click', () => paintFileInput.click());
paintFileInput.addEventListener('change', () => {
  const file = paintFileInput.files?.[0];
  paintFileInput.value = '';
  if (file) void file.arrayBuffer().then((bytes) => openPaintFile(bytes, file.name));
});
paintFileForget.addEventListener('click', () => {
  pendingPaintFile = null;
  state.paintFile.pending = null;
  setStatus(COPY.dropHint);
  render();
  chooseAgain.focus();
});

/**
 * Paint (#167, design note §3.2): the painting state, the view opened on the mini unless it is
 * open on it already (after a Done), so the session goes on with its undo. `replay` opens it
 * afresh with a paint file's steps. `painterMs` runs from here to the view's first frame.
 */
async function openPainter(replay: PaintReplay | null = null): Promise<void> {
  if (state.busy || !state.stats || state.imported) return;
  const started = performance.now();
  // The paint file names the files by their contents: hashed now, off the page's thread.
  fingerprintSources();
  state.painter = true;
  showPainterStatus();
  render();
  try {
    if (replay || !paintTool.isOpen()) await paintTool.open(null, null, null, replay);
    else paintTool.show(true);
  } catch (error) {
    state.painter = false;
    render();
    throw error;
  }
  requestAnimationFrame(() => (state.painterMs = performance.now() - started));
}

/**
 * Done (#167): back to the done panel; the view stays open, hidden, its frame loop stopped. The
 * paint is taken once into the mini (§6): the viewer draws it, the downloads carry it.
 */
async function closePainter(): Promise<void> {
  if (!state.painter) return;
  paintTool.show(false);
  state.painter = false;
  painterProblem = null;
  if (state.stats) setStatus(describeReady(state.stats));
  render();
  paintOpen.focus();
  showPaint(await paintTool.view().paint());
}

/** The mini's paint after Done (#167); null while unpainted, so the downloads stay as before. */
let miniPaint: Albedo | null = null;

/**
 * Takes the paint into the mini, or drops it (null, or a paint without a painted texel), and
 * shows the level on screen again with it unless `redraw` is false (the mini is leaving).
 */
function showPaint(albedo: Albedo | null, redraw = true): void {
  let painted = false;
  if (albedo)
    for (let i = 3; i < albedo.data.length && !painted; i += 4) painted = albedo.data[i]! > 0;
  miniPaint = painted ? albedo : null;
  state.painted = painted;
  viewer.setPaint(
    miniPaint && baked ? { albedo: miniPaint, table: baked.mesh, levels: levels.slice(1) } : null,
  );
  if (redraw && state.stats && !state.painter)
    showLevel(state.shownLevel, false, state.showingBaked || state.shownLevel !== TABLE_LEVEL);
}

paintOpen.addEventListener('click', () => void openPainter());
document.querySelector('#paint-done')!.addEventListener('click', () => void closePainter());

const devThumbnail = document.querySelector<HTMLImageElement>('#dev-thumbnail');
const devKind = document.querySelector<HTMLElement>('#dev-kind');

/** Under ?dev: the thumbnail next to the viewer and the kind under it, for verify-3d. */
async function showDevThumbnail(): Promise<void> {
  if (!devThumbnail || !devKind) return;
  const kind = state.kind;
  devKind.textContent = kind
    ? `Kind: ${kind.kind} (${kind.method}, ${kind.reason}${kind.topShare === null ? '' : `, ${kind.topShare.toFixed(2)}`})`
    : '';
  try {
    const png = new Blob([await thumbnail()], { type: 'image/png' });
    if (devThumbnail.src) URL.revokeObjectURL(devThumbnail.src);
    devThumbnail.src = URL.createObjectURL(png);
  } catch (error) {
    devKind.textContent += ` · no thumbnail: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadGlb(glb: ArrayBuffer, name = 'file.glb'): Promise<void> {
  setStatus('');
  try {
    state.error = null;
    state.imported = await viewer.showGlb(glb);
    importedName = name;
    state.stressCount = 0;
    const size = state.imported.sizeMm.map((mm) => mm.toFixed(1)).join(' × ');
    setStatus(
      `${name}: ${state.imported.triangles.toLocaleString()} triangles, ${size} mm, ${(glb.byteLength / 1024).toFixed(0)} KB`,
    );
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    setStatus(`${name} could not be opened: ${state.error}`);
  }
  render();
}

// Each button writes its own level, whatever chip is pressed: looking at the close level
// cannot change what a download contains. The close and full levels are never exported.
for (const button of document.querySelectorAll<HTMLButtonElement>('#export [data-level]')) {
  button.addEventListener('click', () => {
    const level = Number(button.dataset.level);
    void exportGlb(level, compactBox.checked).then((glb) =>
      downloadBlob(
        new Blob([glb], { type: 'model/gltf-binary' }),
        `${downloadName()}-${state.stats!.lods[level - 1]!.name}.glb`,
      ),
    );
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
  setStatus(problem.message, true);
  if (problem.detail) console.warn(`${fileName}: ${problem.code}: ${problem.detail}`);
  render();
}

/**
 * One file converts alone and replaces whatever is on screen; two convert as a figure and its
 * base file (#70); more are refused. A single file never joins the mini on screen by itself:
 * a base is added with the Base section's button, so converting the next mini stays one drop.
 */
async function loadFiles(dropped: File[]): Promise<void> {
  if (dropped.length === 0 || state.busy) return;
  // The time to the question counts from here: reading the files from disk is part of it.
  const startedAt = performance.now();
  const refuse = (fileName: string, error: string, errorCode: ProblemCode): void => {
    // The error card, like the refusals below, so the page state matches what is on screen.
    Object.assign(state, { fileName, error, errorCode, errorDetail: null });
    setStatus(error, true);
    render();
  };
  // A paint file (#167, §7.2): alone it opens or waits; with STL files they convert as it says.
  const isPaintFile = (file: File): boolean =>
    file.name.toLowerCase().endsWith(PAINT_FILE_EXTENSION);
  const paintFiles = dropped.filter(isPaintFile);
  const files = dropped.filter((file) => !isPaintFile(file));
  if (paintFiles.length > 1)
    return refuse(
      paintFiles.map((file) => file.name).join(' + '),
      COPY.onePaintFile,
      'one-paint-file',
    );
  if (paintFiles.length === 1 && files.length === 0)
    return openPaintFile(await paintFiles[0]!.arrayBuffer(), paintFiles[0]!.name);
  setStatus('');
  let paintFile: PaintFile | null = null;
  if (paintFiles.length === 1) {
    try {
      paintFile = await readPaintFile(await paintFiles[0]!.arrayBuffer());
    } catch (error) {
      state.fileName = paintFiles[0]!.name;
      return showProblem(paintFiles[0]!.name, error);
    }
  }
  const names = files.map((file) => file.name).join(' + ');
  if (files.length > MAX_PARTS)
    return refuse(names, describeTooManyFiles(MAX_PARTS), 'too-many-files');
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
  const given = files.map((file, k) => ({
    name: file.name,
    bytes: buffers[k]!,
    read: () => file.arrayBuffer(),
  }));
  // Dropped with the files, or waiting for them; else an unsaved painting of these files offered.
  const painting = paintFile ?? pendingPaintFile ?? (await offerUnsaved(buffers));
  if (painting) {
    let ordered: ArrayBuffer[];
    try {
      ordered = await matchSources(painting, buffers);
    } catch (error) {
      // A waiting paint file keeps waiting: a wrong drop costs one more drop, not the paint file.
      state.fileName = names;
      return showProblem(names, error);
    }
    return convertWithPaintFile(
      painting,
      ordered.map((bytes) => given[buffers.indexOf(bytes)]!),
      startedAt,
    );
  }
  sources = given.map(({ name, read }) => ({ name, read }));
  choices = noChoices();
  // New files: every question is asked (#92 design note §6.4, #93 §6.6).
  const ask = { up: true, baseUp: true, parts: true, meet: true };
  await convert(buffers[0]!, names, buffers.slice(1), ask, startedAt);
}

/**
 * The offer on a drop (#167, §8.4): an unsaved painting of these very files is offered back. Yes
 * gives its paint file, which converts and replays as a dropped one would; no forgets it.
 */
async function offerUnsaved(buffers: ArrayBuffer[]): Promise<PaintFile | null> {
  const record = await readUnsaved();
  state.unsavedOffer = null;
  if (!record) return null;
  // Sizes first: hashing copies the files on this thread, so only files that could match are.
  const sizes = (list: number[]): string => [...list].sort((a, b) => a - b).join();
  if (
    sizes(record.file.sources.map((source) => source.bytes)) !==
    sizes(buffers.map((buffer) => buffer.byteLength))
  )
    return null;
  try {
    await matchSources(record.file, buffers);
  } catch {
    return null;
  }
  state.unsavedOffer = record;
  const yes = await confirmDialog.ask(
    describeUnsavedPainting(record),
    COPY.continuePainting,
    COPY.convertAfresh,
  );
  if (yes) return record.file;
  await forgetUnsaved();
  return null;
}

/** The figure's sources, the body first: every file that is not the base. */
function figureSources(): Source[] {
  const pair = state.stats?.pair;
  return pair ? pair.parts.flatMap((part) => sources[part.file] ?? []) : sources.slice(0, 1);
}

/**
 * Adds a base file to the mini on screen: the figure (one file, or its parts) and the base
 * convert together, the guess says which is the base. The parts keep their joints: the base
 * comes last, so no file index moves.
 */
async function addBase(base: Source): Promise<void> {
  const figure = figureSources();
  if (figure.length === 0 || state.busy) return;
  const parts =
    figure.length > 1 && sources.length === figure.length ? choices.parts : { joints: [] };
  sources = [...figure, base];
  // The figure's orientation stays; the size is measured from the base now. The new base is
  // asked about, and the figure too unless its up was chosen: the pair may stand it another way.
  // Where they meet is shown before the conversion, as for every pair (PM decision 2026-09-30).
  choices = { ...noChoices(), orientation: choices.orientation, parts, preset: choices.preset };
  await reconvert({ up: !chosen(choices.orientation), baseUp: true, parts: false, meet: true });
}

/** Converts the figure alone again: one file, or its parts without a base (#93). */
async function removeBase(): Promise<void> {
  const pair = state.stats?.pair;
  const figure = figureSources();
  if (!pair || pair.pairing.baseFile === null || state.busy) return;
  const turned = choices.pairing.swap === true;
  // The joints name files by index: without the base, the files after it move up one.
  const index = new Map(pair.parts.map((part, k) => [part.file, k]));
  const at = (file: number): number => index.get(file) ?? file;
  const joints = choices.parts.joints.map((joint) => ({
    ...joint,
    part: at(joint.part),
    onto: at(joint.onto),
    pairs: joint.pairs.map(({ on, of }) => ({
      on: { ...on, file: at(on.file) },
      of: { ...of, file: at(of.file) },
    })),
  }));
  sources = figure;
  choices = {
    ...noChoices(),
    orientation: turned ? {} : choices.orientation,
    parts: { joints },
    pairing: figure.length > 1 ? { baseFile: null } : {},
    preset: choices.preset,
  };
  await reconvert({ up: !chosen(choices.orientation), parts: false });
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
  choices = { ...noChoices(), pairing, sizing: choices.sizing, preset: choices.preset };
  await reconvert({ up: true, baseUp: true, parts: false, meet: true });
}

/** Converts again asking only where the figure meets its base (#93 design note §6.6). */
function markMeeting(): Promise<void> {
  if (!state.stats?.pair?.placement) return Promise.resolve();
  return reconvert({ up: false, baseUp: false, parts: false, meet: true });
}

/** Converts again asking only how the figure's parts go together. */
function markParts(): Promise<void> {
  if ((state.stats?.pair?.parts.length ?? 0) < 2) return Promise.resolve();
  return reconvert({ up: false, baseUp: false, parts: true, meet: false });
}

/** The Base section for what is on screen: the add button for one file, the pair's lines and controls for two. */
function showPairSection(stats: ConversionStats): void {
  const { pair } = stats;
  const kind = !pair ? 'single' : pair.pairing.baseFile === null ? 'parts' : 'pair';
  pairInputs.fieldset.dataset.kind = kind;
  pairInputs.fieldset.toggleAttribute('data-marked', pair?.placement?.method === 'marked');
  pairInputs.moveByHand.checked = false;
  viewer.setMoveGizmo(null);
  if (!pair) return;
  const names = sources.map((source) => source.name);
  const figure = pair.parts.map((part) => names[part.file] ?? '').join(' + ');
  const parts = describeParts(pair.parts, names);
  pairInputs.parts.hidden = parts === null;
  pairInputs.parts.textContent = parts ?? '';
  pairInputs.markParts.hidden = pair.parts.length < 2;
  pairInputs.swap.hidden = sources.length !== 2;
  if (!pair.placement || pair.pairing.baseFile === null) {
    pairInputs.files.textContent = `Figure: ${figure}`;
    return;
  }
  const base = names[pair.pairing.baseFile] ?? '';
  pairInputs.files.textContent = `Base: ${base} · Figure: ${figure}`;
  const warning = describePairWarning(pair.pairing.warnings);
  pairInputs.warning.hidden = warning === null;
  pairInputs.warning.querySelector('.callout-text')!.textContent = warning ?? '';
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
upButtons.replaceChildren(
  ...UP_AXES.map((axis) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm';
    button.dataset.up = axis;
    button.textContent = axisLabel(axis);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => void setUp(axis));
    return button;
  }),
);

/** Presses the button of the axis the mini stands on. */
function showUp(up: UpAxis): void {
  for (const button of upButtons.querySelectorAll<HTMLElement>('[data-up]'))
    button.setAttribute('aria-pressed', String(button.dataset.up === up));
}
for (const button of turnPanel.querySelectorAll<HTMLButtonElement>('[data-turn]')) {
  button.addEventListener('click', () =>
    turn(button.dataset.turn as TurnAxis, Number(button.dataset.deg ?? TURN_STEP_DEG)),
  );
}
turnByHand.addEventListener('change', () =>
  viewer.setTurnGizmo(turnByHand.checked ? (turned) => showTurn(turned) : null),
);
turnApply.addEventListener('click', () => void applyTurn(false));
pairInputs.markMeeting.addEventListener('click', () => void markMeeting());
pairInputs.markParts.addEventListener('click', () => void markParts());
document.querySelector('#set-down')!.addEventListener('click', () => void applyTurn(true));
turnReset.addEventListener('click', () => showTurn(null));
for (const button of [chooseButton, chooseAgain]) {
  button.addEventListener('click', () => fileInput.click());
}

/**
 * The panel's Close (#144): back to the drop card, as before the first file. The mini leaves the
 * screen and the page forgets its files and choices; nothing was stored anywhere else.
 */
function closeMini(): void {
  if (state.busy || state.page !== 'done') return;
  paintTool.close();
  showPaint(null, false);
  if (state.orientation.turn) showTurn(null);
  if (state.pair) showPlacement(null);
  turnByHand.checked = false;
  viewer.setTurnGizmo(null);
  viewer.setMoveGizmo(null);
  viewer.clear();
  sources = [];
  choices = noChoices();
  levels = [];
  baked = null;
  detailKtx2 = null;
  importedName = null;
  Object.assign(state, noMini());
  setStatus(COPY.dropHint);
  render();
  chooseAgain.focus();
}
document.querySelector('#close')!.addEventListener('click', closeMini);
sheetHandle.addEventListener('click', () => expandSheet(!panel.hasAttribute('data-expanded')));

// The bar's Credits and, on a phone, its More menu (design note §4.1, §4.6).
const credits = createDialog(document.querySelector<HTMLElement>('#credits')!);
const moreButton = document.querySelector<HTMLElement>('#more')!;
createMenu(moreButton, document.querySelector<HTMLElement>('#more-menu')!);
document
  .querySelector('#credits-open')!
  .addEventListener('click', (event) => credits.open(event.currentTarget as HTMLElement));
document.querySelector('#more-credits')!.addEventListener('click', () => credits.open(moreButton));
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
  painting: {
    ...paintTool,
    open: async (paint, mask, groups, replay) => {
      state.painter = true;
      render();
      try {
        await paintTool.open(
          paint && baked ? testPaintAlbedo(baked.mesh, paint) : null,
          mask,
          groups,
          replay,
        );
      } catch (error) {
        state.painter = false;
        render();
        throw error;
      }
    },
    close: () => {
      paintTool.close();
      showPaint(null);
      state.painter = false;
      render();
    },
    testPaint: (paint) => {
      if (!baked) throw new Error('No baked mini');
      return testPaintAlbedo(baked.mesh, paint);
    },
  },
  openPainter: () => openPainter(),
  closePainter,
  paint: () => Promise.resolve(miniPaint),
  savePaintFile,
  openPaintFile,
  confirm: (answer) => confirmDialog.answer(answer),
  storage: { unsaved: readUnsaved, forget: forgetUnsaved, palette: readPalette },
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
  setPreset,
  // The questions' hooks are the view's methods of the same name (#119 design note §4).
  answerUp: (options) => view.answerUp(options),
  confirmUp: (options) => {
    view.confirmUp(options);
    return Promise.resolve();
  },
  swapAtQuestion: () => view.swapAtQuestion(),
  chooseBase: (file) => view.chooseBase(file),
  tap: (file, point, pair) => view.tap(file, point, pair),
  brush: (file, points, options) => view.brush(file, points, options),
  addPair: () => view.addPair(),
  selectPair: (k) => view.selectPair(k),
  clearMarks: (pair) => view.clearMarks(pair),
  undoMark: () => view.undoMark(),
  fitMeeting: () => view.fitMeeting(),
  backToMarks: () => view.backToMarks(),
  liftMeeting: (mm) => view.liftMeeting(mm),
  turnMeeting: (deg) => view.turnMeeting(deg),
  setTilt: (mode) => view.setTilt(mode),
  confirmMeet: () => view.confirmMeet(),
  answerMeet: (action) => view.answerMeet(action),
  pickAt: (x, y) => view.pickAt(x, y),
  screenOf: (file, point) => view.screenOf(file, point),
  focusAt: (x, y) => view.focusAt(x, y),
  focusFile: (file) => view.focusFile(file),
  markMeeting,
  markParts,
  // At a question the view's turn preview; after a conversion the page's (Adjust, #72).
  turn: (axis, deg) => (state.question ? view.turn(axis, deg) : turn(axis, deg)),
  applyTurn: () => applyTurn(false),
  setDown: () => applyTurn(true),
  resetTurn: () => (state.question ? view.resetTurn() : showTurn(null)),
  setSizing,
  showLevel: (level) => showLevel(level),
  setCamera: (azimuthDeg, elevationDeg, zoom) =>
    (state.question ? view : viewer).setCamera(azimuthDeg, elevationDeg, zoom),
  setWireframe: (wireframe) => {
    viewer.setWireframe(wireframe);
    view.setWireframe(wireframe);
  },
  setLook,
  setLookPreset,
  showBaked: (on) => showLevel(TABLE_LEVEL, false, on),
  cancel: () => converter.cancel(),
  detailKtx2: () => detailKtx2,
  thumbnail,
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

// The wording is in COPY (page-state.ts); data-copy names the string an element shows,
// data-copy-label the name of a control that shows only an icon.
for (const element of document.querySelectorAll<HTMLElement>('[data-copy]')) {
  element.textContent = COPY[element.dataset.copy as keyof typeof COPY];
}
for (const element of document.querySelectorAll<HTMLElement>('[data-copy-label]')) {
  const label = COPY[element.dataset.copyLabel as keyof typeof COPY];
  element.setAttribute('aria-label', label);
  element.title = label;
}
for (const link of document.querySelectorAll<HTMLAnchorElement>('#meshtavern, #more-meshtavern'))
  link.href = MESHTAVERN_URL;
// The icons are inline SVG (icons.ts, #143); data-icon names the one an element starts with
// (icons.test.ts checks every name in index.html).
for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  element.insertAdjacentHTML('afterbegin', ICONS[element.dataset.icon as IconName] ?? '');
}
/** Screens up to this width get the phone layout; the same number is in the media query of style.css. _(proposal)_ */
const PHONE_MAX_WIDTH_PX = 600;
// On a desktop Up and turn starts open; on a phone the sheet starts with the size line and the
// downloads, and every disclosure is closed (design note look-and-feel.md §4.4).
disclosures.orient.open = !matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches;
// The team's tools exist only under ?dev. Removed rather than hidden: a product page has no
// benchmark button to find. References taken above stay valid, and the hooks keep working.
if (!pageOptions.dev) {
  for (const element of document.querySelectorAll('[data-dev]')) element.remove();
} else {
  warnWith((message) => console.warn(message));
  fileInput.accept = '.stl,.mtpaint,.glb';
}
if (pageOptions.problems.length > 0) {
  setStatus(`Check the address: ${pageOptions.problems.join('; ')}.`, true);
}
// Adjust's look controls show the start-up look, once the painter they also reach exists.
setLook({});
render();
state.ready = true;
