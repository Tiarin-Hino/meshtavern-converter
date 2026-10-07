import {
  UNIT_FACTORS,
  type ConversionStats,
  type Progress,
  type StepName,
  type CreatureSize,
  type Orientation,
  type Sizing,
  type Units,
} from '../lib';
import { QUESTION_COPY } from '../lib/questions';

/**
 * What the page says and which of its five states it is in (issue #41, design note
 * `docs/design/product-page.md`; `asking` from #92, `docs/design/up-before-reduce.md` §6). No
 * DOM and no three.js: the wording has unit tests, and `main.ts` only puts these strings into
 * elements. Every string is a proposal the PM may change. The words and sentences of the
 * questions are the library's (`QUESTION_COPY`, `../lib/questions`, #119): `COPY` spreads them,
 * so the page and the e2e tests read every string from one place.
 */

export type PageState = 'empty' | 'converting' | 'asking' | 'done' | 'error';

/**
 * The state of the page follows from the app state; nothing sets it by hand. A conversion
 * waiting at its question is `asking`, though it is still busy.
 */
export function pageStateOf(app: {
  busy: boolean;
  stats: unknown | null;
  imported: unknown | null;
  error: string | null;
  question?: unknown | null;
}): PageState {
  if (app.question != null) return 'asking';
  if (app.busy) return 'converting';
  if (app.error !== null) return 'error';
  if (app.stats !== null || app.imported !== null) return 'done';
  return 'empty';
}

export const COPY = {
  ...QUESTION_COPY,
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
  adjustHint: 'Up and turn · Size · Look · Base',
  pairHint: 'Two files? Drop the figure and its base together.',
  addBase: 'Add a base file',
  removeBase: 'Remove the base',
  moveByHand: 'Move by hand',
  // #93: the Base section's buttons.
  markMeeting: 'Mark where they meet',
  markParts: 'Mark where the parts meet',
} as const;

/** The level chips, in the order of the levels: full detail, then close, table, far. */
export const LEVEL_LABELS = ['Original', 'Close', 'Table', 'Far'] as const;

export const STEP_LABELS: Record<StepName, string> = {
  read: 'Reading the file',
  weld: 'Joining the surface',
  assemble: 'Putting the parts together',
  orient: 'Finding which way is up',
  place: 'Setting the figure on its base',
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

/**
 * "38 mm tall · Medium, 1 square · 25 mm round base": the one line the done state says about
 * the mini. A figure with its base file says "from its own file" after the base.
 */
export function describeMini(
  stats: Pick<ConversionStats, 'sizeMm' | 'sizing'> & { pair?: unknown | null },
): string {
  const { sizing } = stats;
  const own = stats.pair ? ' from its own file' : '';
  const squares = sizing.footprintSquares;
  const size = `${sizeName(sizing.size)}, ${squares === 1 ? '1 square' : `${squares}×${squares} squares`}`;
  const base = sizing.base
    ? `${Math.round(sizing.base.diameterMm)} mm ${sizing.base.shape === 'round' ? 'round base' : 'base'}`
    : sizing.plainBase
      ? `${Math.round(sizing.plainBase.diameterMm)} mm plain base added`
      : 'no base';
  return `${millimetres(stats.sizeMm[1])} tall · ${size} · ${base}${sizing.base ? own : ''}${UNITS_READ_AS[sizing.units]}`;
}

/** "Ready. Converted from 1,250,000 triangles." */
export function describeReady(stats: Pick<ConversionStats, 'sourceTriangles'>): string {
  return `Ready. Converted from ${stats.sourceTriangles.toLocaleString()} triangles.`;
}

/** The line for a dropped file the page does not take; a GLB is only opened under `?dev`. */
export function describeWrongFile(name: string, dev: boolean): string {
  return dev ? `${name} is neither an STL nor a GLB file.` : `${name} is not an STL file.`;
}

/** The line for more files than one mini is made of (`MAX_PARTS`, #93). */
export function describeTooManyFiles(max: number): string {
  return `Drop up to ${max} files: a figure, its base and its parts.`;
}

/** "Moved 2.3 mm, turned 15°, raised 0.5 mm — not applied yet"; null when nothing is pending. */
export function describePendingPlacement(pending: {
  moveMm: [number, number];
  liftMm: number;
  turnDeg: number;
}): string | null {
  const parts: string[] = [];
  const moved = Math.hypot(pending.moveMm[0], pending.moveMm[1]);
  if (moved > 0) parts.push(`moved ${Math.round(moved * 10) / 10} mm`);
  if (pending.turnDeg !== 0) parts.push(`turned ${Math.round(pending.turnDeg)}°`);
  if (pending.liftMm !== 0)
    parts.push(
      `${pending.liftMm > 0 ? 'raised' : 'lowered'} ${Math.round(Math.abs(pending.liftMm) * 10) / 10} mm`,
    );
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return `${text[0]!.toUpperCase()}${text.slice(1)} — not applied yet`;
}

const UNIT_NAMES: Record<Units, string> = { mm: 'mm', in: 'inches', m: 'metres' };

/**
 * "mm (guessed)", with the scale when the mini was scaled to a base diameter or by a preset.
 * `preset`: the units are the source preset's, none were chosen by hand (#100).
 */
export function describeUnits(sizing: Sizing, preset = false): string {
  const method = sizing.unitsMethod === 'guessed' ? 'guessed' : preset ? 'preset' : 'chosen';
  const units = `${UNIT_NAMES[sizing.units]} (${method})`;
  const extra = sizing.scale / UNIT_FACTORS[sizing.units];
  return Math.abs(extra - 1) < 1e-6 ? units : `${units}, scaled ×${extra.toFixed(3)}`;
}

/**
 * "+z (manual, set down 4°)": the six-way axis, how it was decided, and any turn beyond it.
 * `preset`: the axis is the source preset's, none was chosen by hand (#100).
 */
export function describeOrientation(orientation: Orientation, preset = false): string {
  const method = orientation.method === 'manual' && preset ? 'preset' : orientation.method;
  const parts: string[] = [method];
  if (orientation.method === 'base') parts.push(orientation.confidence.toFixed(2));
  if (orientation.tiltDeg > 0) parts.push(`tilted ${Math.round(orientation.tiltDeg)}°`);
  if (orientation.setDownDeg > 0) parts.push(`set down ${Math.round(orientation.setDownDeg)}°`);
  return `${orientation.up} (${parts.join(', ')})`;
}
