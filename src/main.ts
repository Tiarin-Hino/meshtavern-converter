import './style.css';
import { encodeBinaryStl, inspectStl, type StlInfo } from './pipeline/stl';
import { Viewer } from './viewer';

interface AppState {
  ready: boolean;
  fileName: string | null;
  info: StlInfo | null;
}

declare global {
  interface Window {
    /** Test and agent hook: the canvas has no accessibility tree, so state is asserted through this. */
    __mt: { state: AppState; loadDemo: () => void };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const dropZone = document.body;

const viewer = new Viewer(canvas);
const state: AppState = { ready: false, fileName: null, info: null };

function load(buffer: ArrayBuffer, fileName: string): void {
  const info = inspectStl(buffer);
  viewer.showStl(buffer);
  state.fileName = fileName;
  state.info = info;
  const size = info.bounds
    ? info.bounds.max.map((max, axis) => (max - info.bounds!.min[axis]!).toFixed(1)).join(' × ')
    : 'unknown';
  status.textContent = `${fileName}: ${info.triangleCount.toLocaleString()} triangles, ${info.format}, size ${size} mm`;
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
  // The file is read locally and never sent anywhere.
  load(await file.arrayBuffer(), file.name);
}

fileInput.addEventListener('change', () => void loadFile(fileInput.files?.[0]));
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  void loadFile(event.dataTransfer?.files[0]);
});

window.__mt = { state, loadDemo: () => load(demoStl(), 'demo.stl') };
state.ready = true;
