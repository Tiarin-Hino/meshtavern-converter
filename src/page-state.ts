import type { ConversionStats, Progress, StepName } from './pipeline/run';
import type { CreatureSize, Units } from './pipeline/size';

/**
 * What the page says and which of its four states it is in (issue #41, design note
 * `docs/design/product-page.md`). No DOM and no three.js: the wording has unit tests, and
 * `main.ts` only puts these strings into elements. Every string is a proposal the PM may change.
 */

export type PageState = 'empty' | 'converting' | 'done' | 'error';

/** The state of the page follows from the app state; nothing sets it by hand. */
export function pageStateOf(app: {
  busy: boolean;
  stats: unknown | null;
  imported: unknown | null;
  error: string | null;
}): PageState {
  if (app.busy) return 'converting';
  if (app.error !== null) return 'error';
  if (app.stats !== null || app.imported !== null) return 'done';
  return 'empty';
}

export const COPY = {
  title: 'MeshTavern Converter',
  promise: 'Your file never leaves your computer.',
  promiseShort: 'Runs in your browser. Your file never leaves your computer.',
  openStl: 'Open an STL',
  dropHeading: 'Drop an STL here',
  chooseFile: 'Choose a file',
  chooseAnother: 'Choose another file',
  dropHint: 'You get a game-ready mini in seconds. Everything runs in this tab.',
  dropOverlay: 'Drop to convert',
  errorHeading: 'This file did not become a mini',
  cancel: 'Cancel',
  cancelled: 'Cancelled.',
  downloads: 'Download as GLB',
  downloadTable: 'Download table level',
  downloadFar: 'Download far level',
  adjust: 'Adjust',
  adjustHint: 'Up and turn · Size · Look',
} as const;

/** The level chips, in the order of the levels: full detail, then close, table, far. */
export const LEVEL_LABELS = ['Original', 'Close', 'Table', 'Far'] as const;

export const STEP_LABELS: Record<StepName, string> = {
  read: 'Reading the file',
  weld: 'Joining the surface',
  orient: 'Finding which way is up',
  size: 'Measuring the base',
  simplify: 'Reducing the detail',
  shade: 'Priming and washing',
  levels: 'Making the detail levels',
  unwrap: 'Unwrapping the surface',
  bake: 'Baking the detail',
  compress: 'Compressing the texture',
};

/** "Unwrapping the surface · 40 %" while a step reports its own progress, else "Baking the detail…". */
export function describeProgress(progress: Progress): string {
  const label = STEP_LABELS[progress.step];
  return progress.stepPercent === undefined
    ? `${label}…`
    : `${label} · ${Math.round(progress.stepPercent)} %`;
}

/** Below this height the size line keeps one decimal: 7.5 mm, not 8 mm. */
const WHOLE_MM_FROM = 10;
const UNITS_READ_AS: Record<Units, string> = {
  mm: '',
  in: ', read as inches',
  m: ', read as metres',
};

const millimetres = (mm: number): string =>
  mm < WHOLE_MM_FROM ? `${Math.round(mm * 10) / 10} mm` : `${Math.round(mm)} mm`;

const sizeName = (size: CreatureSize): string => size[0]!.toUpperCase() + size.slice(1);

/** "38 mm tall · Medium, 1 square · 25 mm round base": the one line the done state says about the mini. */
export function describeMini(stats: Pick<ConversionStats, 'sizeMm' | 'sizing'>): string {
  const { sizing } = stats;
  const squares = sizing.footprintSquares;
  const size = `${sizeName(sizing.size)}, ${squares === 1 ? '1 square' : `${squares}×${squares} squares`}`;
  const base = sizing.base
    ? `${Math.round(sizing.base.diameterMm)} mm ${sizing.base.shape === 'round' ? 'round base' : 'base'}`
    : sizing.plainBase
      ? `${Math.round(sizing.plainBase.diameterMm)} mm plain base added`
      : 'no base';
  return `${millimetres(stats.sizeMm[1])} tall · ${size} · ${base}${UNITS_READ_AS[sizing.units]}`;
}

/** "Ready. Converted from 1,250,000 triangles." */
export function describeReady(stats: Pick<ConversionStats, 'sourceTriangles'>): string {
  return `Ready. Converted from ${stats.sourceTriangles.toLocaleString()} triangles.`;
}

/** The line for a dropped file the page does not take; a GLB is only opened under `?dev`. */
export function describeWrongFile(name: string, dev: boolean): string {
  return dev ? `${name} is neither an STL nor a GLB file.` : `${name} is not an STL file.`;
}
