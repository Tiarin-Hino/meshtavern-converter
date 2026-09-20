import './style.css';
import { generateBumpySheet } from './pipeline/generate';
import type { IndexedMesh } from './pipeline/mesh';
import type { ConversionStats, Progress } from './pipeline/run';
import { encodeBinaryStl } from './pipeline/stl';
import { Viewer } from './viewer';
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
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const progressBar = document.querySelector<HTMLProgressElement>('#progress')!;
const statsList = document.querySelector<HTMLElement>('#stats')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const levelButtons = document.querySelector<HTMLElement>('#levels')!;

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
};
/** Full-detail mesh first, then the LODs. */
let levels: IndexedMesh[] = [];

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function showStats(stats: ConversionStats): void {
  const rows: [string, string][] = [
    ['Size', `${stats.sizeMm.map((mm) => mm.toFixed(1)).join(' × ')} mm`],
    ['Triangles', stats.triangles.toLocaleString()],
    ['Vertices', stats.vertices.toLocaleString()],
    ['Dropped', stats.degenerateTriangles.toLocaleString()],
    ...stats.lods.map((lod): [string, string] => [
      `LOD ${Math.round(lod.targetTriangles / 1000)}k`,
      `${lod.triangles.toLocaleString()} tris, ±${lod.errorMm.toFixed(2)} mm`,
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
  viewer.showMesh(mesh, state.stats.sizeMm, reframe);
  state.shownLevel = level;
  for (const [index, button] of [...levelButtons.children].entries()) {
    button.setAttribute('aria-pressed', String(index === level));
  }
}

function showLevelButtons(stats: ConversionStats): void {
  const labels = ['Full', ...stats.lods.map((lod) => `${Math.round(lod.triangles / 1000)}k`)];
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

async function convert(stl: ArrayBuffer, fileName: string): Promise<void> {
  if (state.busy) return;
  Object.assign(state, { busy: true, fileName, stats: null, error: null, progressLog: [] });
  statsList.hidden = true;
  levelButtons.hidden = true;
  progressBar.hidden = false;
  const stopWatching = watchFrames();
  try {
    const result = await converter.convert(stl, (progress) => {
      state.progress = progress;
      state.progressLog.push(progress);
      progressBar.value = progress.percent;
      status.textContent = `${fileName}: ${progress.step}… ${progress.percent}%`;
    });
    stopWatching();
    levels = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    state.stats = result.stats;
    showLevelButtons(result.stats);
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
  await convert(await file.arrayBuffer(), file.name);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Clear the input so picking the same file again still fires a change event.
  fileInput.value = '';
  void loadFile(file);
});
document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  void loadFile(event.dataTransfer?.files[0]);
});

window.__mt = {
  state,
  loadDemo: () => convert(demoStl(), 'demo.stl'),
  loadGenerated: (quadsPerSide) =>
    convert(encodeBinaryStl(generateBumpySheet(quadsPerSide)), `generated-${quadsPerSide}.stl`),
  showLevel: (level) => showLevel(level),
  setCamera: (azimuthDeg, elevationDeg, zoom) => viewer.setCamera(azimuthDeg, elevationDeg, zoom),
  setWireframe: (wireframe) => viewer.setWireframe(wireframe),
};
state.ready = true;
