import './style.css';
import { generateBumpySheet } from './pipeline/generate';
import { DEFAULT_LOOK, type Look } from './pipeline/look';
import type { IndexedMesh } from './pipeline/mesh';
import { UP_AXES, type UpAxis } from './pipeline/orient';
import type { ConversionStats, Progress } from './pipeline/run';
import { encodeBinaryStl } from './pipeline/stl';
import { Viewer, type Perf } from './viewer';
import { Converter } from './worker/client';

interface AppState {
  ready: boolean;
  busy: boolean;
  fileName: string | null;
  progress: Progress | null;
  /** Every progress message of the last conversion, for tests. */
  progressLog: Progress[];
  stats: ConversionStats | null;
  error: string | null;
  /** Main-thread health while the worker was converting: frames drawn and the longest gap between two frames. */
  framesWhileConverting: number;
  longestFrameGapMs: number;
  /** Main-thread time to build normals and hand the mesh to the GPU. */
  showMeshMs: number | null;
  /** Which version is on screen: 0 = full detail, 1… = LODs from highest to lowest. */
  shownLevel: number;
  /** Live rendering figures, refreshed twice a second. */
  perf: Perf | null;
  /** Number of minis in the stress scene; 0 when a single mini is shown. */
  stressCount: number;
  look: Look;
}

declare global {
  interface Window {
    /** Test and agent hook: the canvas has no accessibility tree, so state is asserted through this. */
    __mt: {
      state: AppState;
      loadDemo: () => Promise<void>;
      /** Converts a generated sheet of `quadsPerSide`² × 2 triangles; 1000 gives a 100 MB STL. */
      loadGenerated: (quadsPerSide: number) => Promise<void>;
      showLevel: (level: number) => void;
      setCamera: (azimuthDeg: number, elevationDeg: number, zoom: number) => void;
      setWireframe: (wireframe: boolean) => void;
      /** Changes some or all look settings and re-colours what is on screen. */
      setLook: (changes: Partial<Look>) => void;
      /** Fills the table with copies of the converted mini. `forcedLod` pins every copy to one LOD (0 = 50k). */
      /** Converts the last file again with a fixed up axis. */
      setUp: (up: UpAxis) => Promise<void>;
      startStress: (count: number, forcedLod?: number | null) => void;
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
const statsList = document.querySelector<HTMLElement>('#stats')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const levelButtons = document.querySelector<HTMLElement>('#levels')!;
const stressButtons = document.querySelector<HTMLElement>('#stress')!;
const upSelect = document.querySelector<HTMLSelectElement>('#up')!;
const upLabel = document.querySelector<HTMLElement>('#up-label')!;
const perfLine = document.querySelector<HTMLElement>('#perf')!;

const viewer = new Viewer(canvas);
const converter = new Converter();
const state: AppState = {
  ready: false,
  busy: false,
  fileName: null,
  progress: null,
  progressLog: [],
  stats: null,
  error: null,
  framesWhileConverting: 0,
  longestFrameGapMs: 0,
  showMeshMs: null,
  shownLevel: 0,
  perf: null,
  stressCount: 0,
  look: { ...DEFAULT_LOOK },
};
/** Full-detail mesh first, then the LODs. */
let levels: IndexedMesh[] = [];
/** Re-reads the last source, because its buffer moves to the worker on every conversion. */
let lastSource: { name: string; read: () => Promise<ArrayBuffer> } | null = null;

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function showStats(stats: ConversionStats): void {
  const rows: [string, string][] = [
    ['Up', `${stats.up} (${stats.upMethod})`],
    ['Size', `${stats.sizeMm.map((mm) => mm.toFixed(1)).join(' × ')} mm`],
    ['Triangles', stats.triangles.toLocaleString()],
    ['Vertices', stats.vertices.toLocaleString()],
    ['Dropped', stats.degenerateTriangles.toLocaleString()],
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

function showLevel(level: number, reframe = false): void {
  const mesh = levels[level];
  if (!mesh || !state.stats) return;
  state.stressCount = 0;
  viewer.showMesh(mesh, state.stats.sizeMm, reframe);
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
  if (!lastSource) return;
  await convert(await lastSource.read(), lastSource.name, up);
}

const stressPool: { lods: IndexedMesh[]; share: number }[] = [];

function startStress(count: number, forcedLod: number | null = null): void {
  if (levels.length < 2) return;
  if (stressPool.length === 0) {
    viewer.showStress([levels.slice(1)], count, forcedLod);
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
    );
  }
  state.stressCount = count;
}

function showPerf(): void {
  const perf = viewer.perf();
  state.perf = perf;
  const lods = state.stressCount > 0 ? ` · minis per LOD ${perf.minisPerLod.join(' / ')}` : '';
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

async function convert(stl: ArrayBuffer, fileName: string, up?: UpAxis): Promise<void> {
  if (state.busy) return;
  Object.assign(state, { busy: true, fileName, stats: null, error: null, progressLog: [] });
  statsList.hidden = true;
  levelButtons.hidden = true;
  stressButtons.hidden = true;
  lookPanel.hidden = true;
  progressBar.hidden = false;
  const stopWatching = watchFrames();
  try {
    const result = await converter.convert(
      stl,
      (progress) => {
        state.progress = progress;
        state.progressLog.push(progress);
        progressBar.value = progress.percent;
        status.textContent = `${fileName}: ${progress.step}… ${progress.percent}%`;
      },
      up,
    );
    stopWatching();
    levels = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    state.stats = result.stats;
    showLevelButtons(result.stats);
    stressButtons.hidden = false;
    lookPanel.hidden = false;
    upSelect.value = result.stats.up;
    upLabel.hidden = false;
    const start = performance.now();
    showLevel(0, true);
    state.showMeshMs = performance.now() - start;
    status.textContent = `${fileName} (${result.stats.format} STL, ${result.stats.sourceTriangles.toLocaleString()} triangles)`;
    showStats(result.stats);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    status.textContent = `${fileName} could not be converted: ${state.error}`;
  } finally {
    stopWatching();
    progressBar.hidden = true;
    state.progress = null;
    state.busy = false;
  }
}

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

async function loadFile(file: File | undefined): Promise<void> {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.stl')) {
    status.textContent = `${file.name} is not an STL file.`;
    return;
  }
  // The file is read locally and handed to a worker in this tab. It is never sent anywhere.
  lastSource = { name: file.name, read: () => file.arrayBuffer() };
  await convert(await file.arrayBuffer(), file.name);
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
    if (count === 0) return showLevel(0, true);
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
document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  void loadFile(event.dataTransfer?.files[0]);
});

window.__mt = {
  state,
  loadDemo: () => {
    lastSource = { name: 'demo.stl', read: async () => demoStl() };
    return convert(demoStl(), 'demo.stl');
  },
  loadGenerated: (quadsPerSide) => {
    const read = async (): Promise<ArrayBuffer> =>
      encodeBinaryStl(generateBumpySheet(quadsPerSide));
    lastSource = { name: `generated-${quadsPerSide}.stl`, read };
    return read().then((stl) => convert(stl, `generated-${quadsPerSide}.stl`));
  },
  setUp,
  showLevel: (level) => showLevel(level),
  setCamera: (azimuthDeg, elevationDeg, zoom) => viewer.setCamera(azimuthDeg, elevationDeg, zoom),
  setWireframe: (wireframe) => viewer.setWireframe(wireframe),
  setLook,
  startStress,
  poolForStress: (share) => {
    if (levels.length > 1) stressPool.push({ lods: levels.slice(1), share });
  },
  clearStressPool: () => {
    stressPool.length = 0;
  },
  stopStress: () => showLevel(0, true),
};
state.ready = true;
