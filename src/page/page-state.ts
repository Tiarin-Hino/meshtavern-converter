import {
  UNIT_FACTORS,
  type ConversionStats,
  type Progress,
  type StepName,
  type CreatureSize,
  type Orientation,
  type Sizing,
  type SourceRole,
  type UpAxis,
  type Units,
} from '../lib';
import { QUESTION_COPY } from '../lib/questions';

/**
 * What the page says and which of its six states it is in (issue #41, design note
 * `docs/design/product-page.md`; `asking` from #92, `docs/design/up-before-reduce.md` §6;
 * `painting` from #167, `docs/design/painter-on-the-page.md` §3). No
 * DOM and no three.js: the wording has unit tests, and `main.ts` only puts these strings into
 * elements. Every string is a proposal the PM may change. The words and sentences of the
 * questions are the library's (`QUESTION_COPY`, `../lib/questions`, #119): `COPY` spreads them,
 * so the page and the e2e tests read every string from one place.
 */

export type PageState = 'empty' | 'converting' | 'asking' | 'done' | 'error' | 'painting';

/**
 * The state of the page follows from the app state; nothing sets it by hand. A conversion
 * waiting at its question is `asking`, though it is still busy; the painter on screen is
 * `painting` (#167), which the page sets only while a mini is converted.
 */
export function pageStateOf(app: {
  busy: boolean;
  stats: unknown | null;
  imported: unknown | null;
  error: string | null;
  question?: unknown | null;
  painter?: boolean;
}): PageState {
  if (app.question != null) return 'asking';
  if (app.busy) return 'converting';
  if (app.error !== null) return 'error';
  if (app.painter === true && app.stats !== null) return 'painting';
  if (app.stats !== null || app.imported !== null) return 'done';
  return 'empty';
}

/**
 * The product's name (#147: PolyWash, the PM's pick and casing of 2026-10-14), the one place it
 * lives in code: the bar reads it from here, and the tests point at its other copies (index.html's
 * title and description, the README, NOTICE.txt).
 */
const NAME = 'PolyWash';
/** What the page does, in one sentence (#145, spec L3): an STL in, a game-ready mini out. */
const SENTENCE = 'An STL of a miniature in, a game-ready mini out.';
const PROMISE = 'Your file never leaves your computer.';

export const COPY = {
  ...QUESTION_COPY,
  title: NAME,
  // #145: the tab's title and the description tag, written in index.html so a link preview sees
  // them without the script; page-state.test.ts keeps them equal to these.
  documentTitle: `${NAME}: an STL of a miniature in, a game-ready mini out`,
  description: `${SENTENCE} Everything runs in your browser. ${PROMISE}`,
  promise: PROMISE,
  promiseShort: 'Runs in your browser. Your file never leaves your computer.',
  openStl: 'Open an STL',
  dropHeading: 'Drop an STL here',
  chooseFile: 'Choose a file',
  chooseAnother: 'Choose another file',
  // #145: the empty state's two sentences, then what comes out (a third line).
  dropHint: `${SENTENCE} Everything runs in this tab.`,
  whatYouGet: 'You get three detail levels, a look, a painter and two downloads.',
  dropOverlay: 'Drop to convert',
  errorHeading: 'This file did not become a mini',
  cancel: 'Cancel',
  cancelled: 'Cancelled.',
  downloads: 'Download as GLB',
  downloadTable: 'Download table level',
  downloadFar: 'Download far level',
  adjust: 'Adjust',
  pairHint: 'Two files? Drop the figure and its base together.',
  addBase: 'Add a base file',
  removeBase: 'Remove the base',
  moveByHand: 'Move by hand',
  // #93: the Base section's buttons.
  markMeeting: 'Mark where they meet',
  markParts: 'Mark where the parts meet',
  // #144: the bar, the card and the panel on the components.
  converting: 'Converting',
  close: 'Close',
  more: 'More',
  credits: 'Credits',
  // #145: the credits dialog's last line (spec L3).
  collectsNothing:
    'This page collects nothing and sends nothing. It stores only your own choices on this device: the theme, the colours you painted with, and a painting you have not saved yet.',
  meshTavern: 'MeshTavern',
  expandPanel: 'Expand the panel',
  // #167: the painter on the page (design note painter-on-the-page.md §9).
  paint: 'Paint',
  paintMini: 'Paint this mini',
  savePaintFile: 'Save paint file',
  openPaintFile: 'Open paint file',
  done: 'Done',
  paintingKept: 'Kept in this browser until you save it as a paint file. Nothing is sent.',
  onePaintFile: 'Drop one paint file with the STL files.',
  withoutPaintFile: 'Convert without it',
  // The empty state's line about the paint file, and the done panel's under Save paint file.
  paintFileHint: 'Have a paint file? Drop it with the STL files, or open it first.',
  paintFileKeeps:
    'The paint file keeps how this mini was put together, painted or not. Drop it with the STL files next time and nothing is asked again.',
  continuePainting: 'Continue painting',
  convertAfresh: 'Convert afresh',
  paintingLost:
    'Converting again clears the painting on this mini. Save the paint file first, or go on without it.',
  convertAgain: 'Convert again',
  keepPainting: 'Keep the painting',
  replacePainting: 'Opening this paint file replaces the painting on this mini.',
  openIt: 'Open it',
} as const;

/** "Saved as hero.mtpaint." (#167): the status line after Save paint file. */
export function paintSaved(name: string): string {
  return `Saved as ${name}.`;
}

/**
 * "Now drop the STL files this painting was made on: the figure and its base." (#167): the line
 * while a paint file waits for its files, from the roles it lists.
 */
export function describePaintFileWaiting(sources: readonly { role: SourceRole }[]): string {
  const parts = sources.filter((source) => source.role === 'part').length;
  const base = sources.some((source) => source.role === 'base');
  const figure =
    parts === 0 ? 'the figure' : `the figure, ${parts} ${parts === 1 ? 'part' : 'parts'}`;
  return `Now drop the STL files this painting was made on: ${figure}${base ? ' and its base' : ''}.`;
}

/**
 * "You left a painting of hero.stl + base.stl unsaved on 21 October. Continue it?" (#167): the
 * offer of the unsaved painting, the day in the person's locale.
 */
export function describeUnsavedPainting(
  record: { names: readonly string[]; at: number },
  locale?: string,
): string {
  const day = new Date(record.at).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  return `You left a painting of ${record.names.join(' + ')} unsaved on ${day}. Continue it?`;
}

/**
 * Where the bar's MeshTavern link goes (spec L2: its words and target are the PM's). A placeholder
 * until the PM names one: this repository, the one public page of the project today. _(proposal)_
 */
export const MESHTAVERN_URL = 'https://github.com/Tiarin-Hino/meshtavern-converter';

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

/** An up axis as the buttons name it: +Z, −Y, … */
export const axisLabel = (axis: UpAxis): string =>
  `${axis[0] === '-' ? '−' : '+'}${axis.slice(1).toUpperCase()}`;

const UP_HOW: Record<Orientation['method'], string> = {
  base: 'from the base',
  tallest: 'the taller way',
  manual: 'chosen',
  cut: 'from the print cut',
  marked: 'from the marks',
};

/**
 * The hints at the right of Adjust's closed disclosures (#144, design note look-and-feel.md
 * §4.4): what each one holds now, in a few words. _(proposal)_ "+Z, from the base".
 * `preset`: the axis is the source preset's, none was chosen by hand (#100).
 */
export function describeUpHint(orientation: Orientation, preset = false): string {
  const how =
    orientation.method === 'manual' && preset ? 'from the source' : UP_HOW[orientation.method];
  return `${axisLabel(orientation.up)}, ${how}`;
}

/** "Medium, mm": the creature size and the units the file was read in. */
export function describeSizeHint(sizing: Pick<Sizing, 'size' | 'units'>): string {
  return `${sizeName(sizing.size)}, ${UNIT_NAMES[sizing.units]}`;
}

/** The look's preset by its label, or "Your own" once a control moved away from every preset. */
export function describeLookHint(presetLabel: string | null): string {
  return presetLabel ?? 'Your own';
}

/** "one file", "with its base", "3 parts", "3 parts and a base". */
export function describePairHint(
  pair: { parts: readonly unknown[]; pairing: { baseFile: number | null } } | null,
): string {
  if (!pair) return 'one file';
  const parts = pair.parts.length;
  const base = pair.pairing.baseFile !== null;
  if (parts < 2) return base ? 'with its base' : 'one file';
  return base ? `${parts} parts and a base` : `${parts} parts`;
}
