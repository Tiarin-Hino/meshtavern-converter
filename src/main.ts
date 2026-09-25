import './style.css';
import { generateBumpySheet } from './pipeline/generate';
import { encodeGlb, glbEncoderReady } from './pipeline/glb';
import { DEFAULT_LOOK, type Look } from './pipeline/look';
import type { IndexedMesh } from './pipeline/mesh';
import { checkFits, memoryBudgetBytes } from './pipeline/memory';
import { UP_AXES, type Orientation, type OrientationOptions, type UpAxis } from './pipeline/orient';
import {
  fromAxisAngle,
  IDENTITY,
  multiply,
  turnAngleDeg,
  type Rotation,
} from './pipeline/rotation';
import { toProblem, type ProblemCode } from './pipeline/problems';
import { BAKED_LEVEL, type ConversionStats, type Progress } from './pipeline/run';
import {
  CREATURE_SIZES,
  sizeLabel,
  type CreatureSize,
  type Sizing,
  type SizingOptions,
  type Units,
} from './pipeline/size';
import { UNIT_FACTORS } from './pipeline/units';
import { encodeBinaryStl, SNIFF_BYTES, sniffStl } from './pipeline/stl';
import { runBenchmark, type BenchmarkSize } from './benchmark';
import { transcodeDetail } from './compressed-texture';
import { parsePageOptions } from './options';
import { Viewer, type BakedMini, type Perf } from './viewer';
import { ConversionCancelled, Converter } from './worker/client';

interface AppState {
  ready: boolean;
  busy: boolean;
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
   * rotation (`stats.orientation`). Shown in the viewer only; `setDown()` converts with it.
   */
  orientation: { turn: Rotation | null; turnDeg: number };
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
      /** Turns the shown mini by `deg` about the scene's x (pitch) or z (roll) axis: a preview, nothing is converted. */
      turn: (axis: TurnAxis, deg: number) => void;
      /** Converts the last file again, turned as previewed and set down on its lowest points. */
      setDown: () => Promise<void>;
      /** Drops the previewed turn. */
      resetTurn: () => void;
      /**
       * Converts the last file again with changed sizing choices (units, size, scale to a
       * base diameter, plain base), merged into the ones made so far. `undefined` drops a choice.
       */
      setSizing: (changes: Partial<SizingOptions>) => Promise<void>;
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
const status = document.querySelector<HTMLElement>('#status')!;
const progressBar = document.querySelector<HTMLProgressElement>('#progress')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!;
const statsList = document.querySelector<HTMLElement>('#stats')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const levelButtons = document.querySelector<HTMLElement>('#levels')!;
const stressButtons = document.querySelector<HTMLElement>('#stress')!;
const upSelect = document.querySelector<HTMLSelectElement>('#up')!;
const upLabel = document.querySelector<HTMLElement>('#up-label')!;
const turnPanel = document.querySelector<HTMLElement>('#turn')!;
const turnByHand = document.querySelector<HTMLInputElement>('#turn-by-hand')!;
const turnPending = document.querySelector<HTMLElement>('#turn-pending')!;
const turnReset = document.querySelector<HTMLButtonElement>('#turn-reset')!;
const perfLine = document.querySelector<HTMLElement>('#perf')!;
const sizingPanel = document.querySelector<HTMLElement>('#sizing')!;
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
  busy: false,
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
/** Re-reads the last source, because its buffer moves to the worker on every conversion. */
let lastSource: { name: string; read: () => Promise<ArrayBuffer> } | null = null;
/** What the user chose for the last source; a new file starts without choices. */
let choices: { orientation: OrientationOptions; sizing: SizingOptions } = {
  orientation: {},
  sizing: {},
};

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function showStats(stats: ConversionStats): void {
  const rows: [string, string][] = [
    ['Up', describeOrientation(stats.orientation)],
    ['Size', describeSize(stats.sizing)],
    ['Units', describeUnits(stats.sizing)],
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
  statsList.hidden = false;
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
  sizingPanel.hidden = false;
}

async function setSizing(changes: Partial<SizingOptions>): Promise<void> {
  if (!lastSource || state.busy) return;
  choices.sizing = { ...choices.sizing, ...changes };
  await convert(await lastSource.read(), lastSource.name);
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
  const labels = [
    'Full',
    ...stats.lods.map((lod) => `${lod.name} ${Math.round(lod.triangles / 1000)}k`),
  ];
  levelButtons.replaceChildren(
    ...labels.map((label, level) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => showLevel(level));
      return button;
    }),
  );
  levelButtons.hidden = false;
}

const lookPanel = document.querySelector<HTMLElement>('#look')!;
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
  if (!lastSource || state.busy) return;
  choices.orientation = { up };
  await convert(await lastSource.read(), lastSource.name);
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
  turnReset.disabled = state.orientation.turn === null;
}

function turn(axis: TurnAxis, deg: number): void {
  if (!state.stats || state.busy) return;
  showTurn(multiply(fromAxisAngle(TURN_AXES[axis], deg), state.orientation.turn ?? IDENTITY));
}

async function setDown(): Promise<void> {
  if (!lastSource || state.busy || !state.stats) return;
  const last = state.stats.orientation.rotation;
  const turned = state.orientation.turn;
  choices.orientation = { rotation: turned ? multiply(turned, last) : last };
  await convert(await lastSource.read(), lastSource.name);
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

/** Converts with the choices made for the current source; see `choices`. */
async function convert(stl: ArrayBuffer, fileName: string): Promise<void> {
  if (state.busy) return;
  Object.assign(state, {
    busy: true,
    fileName,
    stats: null,
    error: null,
    errorCode: null,
    errorDetail: null,
    cancelled: false,
    progressLog: [],
  });
  status.classList.remove('problem');
  statsList.hidden = true;
  levelButtons.hidden = true;
  stressButtons.hidden = true;
  lookPanel.hidden = true;
  sizingPanel.hidden = true;
  turnPanel.hidden = true;
  exportPanel.hidden = true;
  progressBar.hidden = false;
  cancelButton.hidden = false;
  const stopWatching = watchFrames();
  try {
    const result = await converter.convert(
      stl,
      (progress) => {
        state.progress = progress;
        if (progress.stepPercent === undefined) state.progressLog.push(progress);
        progressBar.value = progress.percent;
        const within =
          progress.stepPercent === undefined ? '' : ` (${progress.stepPercent}% of this step)`;
        status.textContent = `${fileName}: ${progress.step}… ${progress.percent}%${within}`;
      },
      {
        orientation: choices.orientation,
        sizing: choices.sizing,
        bake: pageOptions.bake,
        compress: pageOptions.ktx,
        maxTextureSize: viewer.webglRenderer.capabilities.maxTextureSize,
        memoryBudgetBytes: memoryBudget,
      },
    );
    // From here on the mini exists; cancelling would only stop it from being shown.
    cancelButton.hidden = true;
    const stats = result.stats;
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
    showLevelButtons(stats);
    stressButtons.hidden = false;
    lookPanel.hidden = false;
    exportPanel.hidden = false;
    state.imported = null;
    upSelect.value = stats.up;
    upLabel.hidden = false;
    turnPanel.hidden = false;
    showTurn(null);
    showSizing(stats.sizing);
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
    status.textContent = `${fileName} (${stats.format} STL, ${stats.sourceTriangles.toLocaleString()} triangles)`;
    showStats(stats);
  } catch (error) {
    if (error instanceof ConversionCancelled) {
      state.cancelled = true;
      status.textContent = `${fileName}: cancelled.`;
    } else {
      showProblem(fileName, error);
    }
  } finally {
    stopWatching();
    progressBar.hidden = true;
    cancelButton.hidden = true;
    state.progress = null;
    state.busy = false;
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

const exportPanel = document.querySelector<HTMLElement>('#export')!;
const compactBox = document.querySelector<HTMLInputElement>('#compact')!;

async function exportGlb(level: number, compact: boolean): Promise<ArrayBuffer> {
  const mesh = levels[level];
  if (!mesh || level === 0 || !state.fileName) throw new Error('No converted level to export');
  if (compact) await glbEncoderReady();
  return encodeGlb(mesh, {
    name: state.fileName.replace(/.stl$/i, ''),
    look: state.look,
    compact,
    sizing: state.stats?.sizing,
    orientation: state.stats?.orientation,
  });
}

async function loadGlb(glb: ArrayBuffer, name = 'file.glb'): Promise<void> {
  for (const panel of [
    statsList,
    levelButtons,
    stressButtons,
    lookPanel,
    upLabel,
    turnPanel,
    sizingPanel,
    exportPanel,
  ]) {
    panel.hidden = true;
  }
  try {
    state.imported = await viewer.showGlb(glb);
    state.stressCount = 0;
    const size = state.imported.sizeMm.map((mm) => mm.toFixed(1)).join(' × ');
    status.textContent = `${name}: ${state.imported.triangles.toLocaleString()} triangles, ${size} mm, ${(glb.byteLength / 1024).toFixed(0)} KB`;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    status.textContent = `${name} could not be opened: ${state.error}`;
  }
}

document.querySelector<HTMLButtonElement>('#download')!.addEventListener('click', () => {
  // The full-detail level is never exported; fall back to the close level.
  const level = Math.max(1, state.shownLevel);
  void exportGlb(level, compactBox.checked).then((glb) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    link.download = `${state.fileName!.replace(/.stl$/i, '')}-${state.stats!.lods[level - 1]!.name}.glb`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
});

/** Shows why a file did not become a mini, in words for the user; the technical detail goes to `state` and the console. */
function showProblem(fileName: string, error: unknown): void {
  const problem = toProblem(error);
  Object.assign(state, {
    error: problem.message,
    errorCode: problem.code,
    errorDetail: problem.detail ?? null,
  });
  status.textContent = `${fileName} could not be converted. ${problem.message}`;
  status.classList.add('problem');
  if (problem.detail) console.warn(`${fileName}: ${problem.code}: ${problem.detail}`);
}

async function loadFile(file: File | undefined): Promise<void> {
  if (!file || state.busy) return;
  status.classList.remove('problem');
  if (file.name.toLowerCase().endsWith('.glb')) return loadGlb(await file.arrayBuffer(), file.name);
  if (!file.name.toLowerCase().endsWith('.stl')) {
    status.textContent = `${file.name} is neither an STL nor a GLB file.`;
    return;
  }
  // The file is read locally and handed to a worker in this tab. It is never sent anywhere.
  let stl: ArrayBuffer;
  try {
    // Look at the start and the size first: a file that is empty, not an STL or too large
    // for this device is refused before all of it is read into memory.
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    checkFits(file.size, sniffStl(head, file.size), memoryBudget);
    stl = await file.arrayBuffer();
  } catch (error) {
    state.fileName = file.name;
    return showProblem(file.name, error);
  }
  lastSource = { name: file.name, read: () => file.arrayBuffer() };
  choices = { orientation: {}, sizing: {} };
  await convert(stl, file.name);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Clear the input so picking the same file again still fires a change event.
  fileInput.value = '';
  void loadFile(file);
});
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
document.querySelector('#set-down')!.addEventListener('click', () => void setDown());
turnReset.addEventListener('click', () => showTurn(null));
document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  void loadFile(event.dataTransfer?.files[0]);
});

window.__mt = {
  state,
  loadDemo: () => {
    lastSource = { name: 'demo.stl', read: async () => demoStl() };
    choices = { orientation: {}, sizing: {} };
    return convert(demoStl(), 'demo.stl');
  },
  loadGenerated: (quadsPerSide, sizing = {}) => {
    const read = async (): Promise<ArrayBuffer> =>
      encodeBinaryStl(generateBumpySheet(quadsPerSide));
    lastSource = { name: `generated-${quadsPerSide}.stl`, read };
    choices = { orientation: {}, sizing };
    return read().then((stl) => convert(stl, `generated-${quadsPerSide}.stl`));
  },
  setUp,
  turn,
  setDown,
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

if (pageOptions.problems.length > 0) {
  status.textContent = `Check the address: ${pageOptions.problems.join('; ')}.`;
  status.classList.add('problem');
}
state.ready = true;
