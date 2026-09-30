import type {
  ConversionStats,
  PairWarning,
  PartResult,
  Placement,
  Progress,
  StepName,
  CreatureSize,
  Units,
  UpQuestion,
  UpRole,
} from '../lib';

/**
 * What the page says and which of its five states it is in (issue #41, design note
 * `docs/design/product-page.md`; `asking` from #92, `docs/design/up-before-reduce.md` §6). No
 * DOM and no three.js: the wording has unit tests, and `main.ts` only puts these strings into
 * elements. Every string is a proposal the PM may change.
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
  swapPair: 'Swap figure and base',
  moveByHand: 'Move by hand',
  askUp: 'Is this the right way up?',
  confirmUp: 'Yes, convert',
  confirmBaseUp: 'Yes, next: the figure',
  askSetDown: 'Set down',
  askReset: 'Reset',
  // #93: where the parts meet.
  confirmFigureUp: 'Yes, next: where they meet',
  noBase: 'No base: these are the parts of one figure',
  askParts: 'Are the parts where they belong?',
  partsHint:
    'Tap the spot on a part that is in place, then the contact on the part that goes there.',
  confirmParts: 'Yes, the parts are in place',
  askMeet: 'Is the figure where it belongs on its base?',
  meetHint: 'Tap the spot on the base, then the contact on the figure.',
  markMeeting: 'Mark where they meet',
  markParts: 'Mark where the parts meet',
  undoMark: 'Undo the last mark',
  resetMarks: 'Reset marks',
  raise: 'Raise',
  lower: 'Lower',
} as const;

/** How far one press of Turn turns a marked part about the spot's normal. _(proposal, #93)_ */
export const TURN_STEP_DEG = 15;

/** How far one press of Raise or Lower moves the figure on its base. _(proposal, #70)_ */
export const LIFT_STEP_MM = 0.5;

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

/** A file's name as the page lists it: without `.stl`. */
export const partName = (fileName: string): string => fileName.replace(/\.stl$/i, '');

/** " · raised 0.5 mm, turned 15°" for a marked meeting's lift and turn; empty without either. */
function liftAndTurn(liftMm: number, turnDeg: number): string {
  const said: string[] = [];
  if (liftMm !== 0)
    said.push(`${liftMm > 0 ? 'raised' : 'lowered'} ${Math.round(Math.abs(liftMm) * 10) / 10} mm`);
  if (turnDeg !== 0) said.push(`turned ${Math.round(turnDeg)}°`);
  return said.length > 0 ? ` · ${said.join(', ')}` : '';
}

/** Two sides this close count as one size: a round hole, not a slot. _(proposal)_ */
const ROUND_SPOT = 0.1;

/**
 * "Set in the 3.2 mm hole", "Set in the 14 × 10 mm recess", "Set on the flattest patch of
 * the top", with " · moved by hand" when the user moved it. `scale` turns the base file's
 * units into mm (`Sizing.scale`).
 */
export function describePlacement(placement: Placement, scale = 1): string {
  const { spot } = placement;
  // Marked by the person (#93): where they marked, raised and turned along the spot's normal.
  if (placement.method === 'marked')
    return `Set where you marked${liftAndTurn((placement.marks?.liftMm ?? 0) * scale, placement.marks?.turnDeg ?? 0)}`;
  const [a, b] = [...spot.sizeMm].map((mm) => mm * scale).sort((x, y) => y - x) as [number, number];
  const size =
    a - b <= a * ROUND_SPOT ? millimetres(a) : `${millimetres(a).slice(0, -3)} × ${millimetres(b)}`;
  const where =
    spot.kind === 'registered'
      ? 'Set where the files put it'
      : spot.centred
        ? 'Set over the middle of the base'
        : spot.kind === 'flat'
          ? 'Set on the flattest patch of the top'
          : spot.kind === 'hole'
            ? `Set in the ${size} ${a - b <= a * ROUND_SPOT ? 'hole' : 'slot'}`
            : `Set in the ${size} recess`;
  return placement.method === 'manual' ? `${where} · moved by hand` : where;
}

/**
 * The warning line of a pair, or null when there is nothing to say. `at` is where it is said:
 * at the base's question, where the person still decides the roles, or after the conversion.
 */
export function describePairWarning(
  warnings: readonly PairWarning[],
  at: 'question' | 'done' = 'done',
): string | null {
  if (warnings.includes('no-flat-underside'))
    return at === 'question'
      ? 'Neither file has a flat underside, so the converter cannot tell which one is the base. It took the lower, wider one. If this is the figure, swap them.'
      : 'Neither file has a flat underside; you said which one is the base.';
  if (warnings.includes('both-look-like-bases'))
    return 'Both files look like bases. If one is a low creature, swap them.';
  if (warnings.includes('figure-has-its-own-base'))
    return 'The figure has a flat underside of its own; it was set on the base anyway.';
  return null;
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

/**
 * One line per part at the parts question and in the Base section (#93): "wing-l · where its
 * file puts it", "wing-r · marked, raised 0.5 mm", "wing-r · lies apart: mark where it goes",
 * "body · the body". `apart` says the part is not where it belongs in its file: nothing was
 * proposed for it.
 */
export function describePart(part: PartResult, name: string, apart = false): string {
  const label = partName(name);
  if (part.source === 'body') return `${label} · the body`;
  if (part.source === 'marked') {
    const joint = part.joint;
    return `${label} · marked${liftAndTurn(joint?.liftMm ?? 0, joint?.turnDeg ?? 0).replace(' · ', ', ')}`;
  }
  return apart ? `${label} · lies apart: mark where it goes` : `${label} · where its file puts it`;
}

/** "Parts: wing-l where its file puts it · wing-r marked" for the Base section; null for a figure of one file. */
export function describeParts(
  parts: readonly PartResult[],
  names: readonly string[],
): string | null {
  const others = parts.filter((part) => part.source !== 'body');
  if (others.length === 0) return null;
  const said = others.map((part) => {
    const name = partName(names[part.file] ?? '');
    return part.source === 'marked' ? `${name} marked` : `${name} where its file puts it`;
  });
  return `Parts: ${said.join(' · ')}`;
}

/**
 * What the meet question says under its heading (#93): the placement shown, or, while the
 * person is marking, which mark comes next.
 */
export function describeMeeting(
  placement: Placement | null,
  marking: { spot: boolean; contact: boolean },
  about: 'parts' | 'base',
): string {
  if (marking.spot !== marking.contact) {
    const next = marking.spot ? 'contact' : 'spot';
    const on =
      about === 'base'
        ? next === 'spot'
          ? 'on the base'
          : 'on the figure'
        : next === 'spot'
          ? 'on a part in place'
          : 'on the part that goes there';
    return `Now tap the ${next} ${on}.`;
  }
  if (about === 'parts') return COPY.partsHint;
  return placement ? describePlacement(placement) : COPY.meetHint;
}

/** "Base: base.stl" or "Figure: figure.stl" above a pair's question; null for a single file. */
export function describeAskedFile(role: UpRole, name: string): string | null {
  if (role === 'mini') return null;
  return `${role === 'base' ? 'Base' : 'Figure'}: ${name}`;
}

/** Why the file stands as the question shows it (#92). */
export function describeUp(question: Pick<UpQuestion, 'reason' | 'base' | 'orientation'>): string {
  switch (question.reason) {
    case 'base':
      return question.base
        ? `Standing on its base, ${Math.round(question.base.diameterMm)} mm across.`
        : 'Standing on its base.';
    case 'tallest':
      return 'No base found, so the taller way was taken as up. Check it.';
    case 'cut':
      return 'Standing on the flat cut of its feet.';
    case 'registered':
      return 'Standing the way its base does: the two files were exported together.';
    case 'underside':
      return 'Standing on its flat underside.';
    case 'tilted':
      return 'Stored at an angle; standing on its flat underside.';
    case 'guess':
      return 'No flat underside found. Check it.';
    case 'chosen': {
      const setDown = Math.round(question.orientation.setDownDeg);
      return setDown > 0 ? `As you turned it, set down by ${setDown}°.` : 'As you turned it.';
    }
  }
}

/** "Turned 30°" while a turn is being tried out at the question; null when there is none. */
export function describeAskPending(turnDeg: number): string | null {
  const degrees = Math.round(turnDeg);
  return degrees === 0 ? null : `Turned ${degrees}°`;
}
