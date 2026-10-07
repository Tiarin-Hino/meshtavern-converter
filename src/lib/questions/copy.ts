import { turnAngleDeg, type Rotation } from '../pipeline/rotation';
import type { MeetQuestion, UpQuestion, UpRole } from '../pipeline/ask';
import type { PartResult } from '../pipeline/assemble';
import type { Fit } from '../pipeline/fit';
import type { PairWarning } from '../pipeline/pair';
import type { Placement } from '../pipeline/place';

/**
 * The words of the questions a conversion asks (#92, #93, #100), moved from the page's
 * `page-state.ts` (#119, design note `docs/design/questions-view.md` §5). No DOM and no three.js:
 * the view puts these strings into its elements, the page spreads them into its own `COPY`, and a
 * consumer replaces any of them through `mountQuestions({ copy })`. Every string is a proposal
 * the PM may change.
 */
export const QUESTION_COPY = {
  askUp: 'Is this the right way up?',
  confirmUp: 'Yes, convert',
  confirmBaseUp: 'Yes, next: the figure',
  confirmFigureUp: 'Yes, next: where they meet',
  askSetDown: 'Set down',
  askReset: 'Reset',
  swapPair: 'Swap figure and base',
  noBase: 'No base: these are the parts of one figure',
  base: 'Base',
  upAxis: 'Up axis in file',
  pitch: 'Pitch',
  roll: 'Roll',
  turnByHand: 'Turn by hand',
  // #100: source presets.
  source: 'Source',
  noPreset: 'None (guess)',
  // #93: where the parts meet.
  askParts: 'Are the parts where they belong?',
  confirmParts: 'Yes, the parts are in place',
  askMeet: 'Is the figure where it belongs on its base?',
  // #93, the rework: pairs of patches, then the final view.
  askPairs: 'Is this where they meet?',
  confirmPairs: 'Yes, put them together',
  addPair: 'Add a pair',
  brush: 'Brush',
  erase: 'Erase',
  undo: 'Undo',
  startOver: 'Start over',
  pullApart: 'Pull apart',
  showInPlace: 'Show in place',
  markEveryPart: 'Mark where every part goes, then put them together.',
  backToMarking: 'Back to marking',
  raise: 'Raise',
  lower: 'Lower',
  turn: 'Turn',
  letTilt: 'Let it tilt to fit',
  keepUpright: 'Keep it upright',
  lookAt: 'Look at',
  viewAll: 'All',
  viewHint:
    'Right-click a spot, or hold a finger on it, to turn the view about it. The wheel zooms to the pointer.',
  /** The accessible names of the chips' list, the tools' group and the final view's buttons. */
  pairs: 'Pairs',
  marks: 'Marks',
  adjustMeeting: 'Adjust where they meet',
  /** The accessible name of a chip's ×, followed by the pair's number. */
  clearPair: 'Clear pair',
  /** On a chip of the proposal. */
  proposed: 'proposed',
} as const;

/** The words, each replaceable by any string. */
export type QuestionWords = { readonly [K in keyof typeof QUESTION_COPY]: string };

/** The sentences with numbers in them, replaceable as a whole. The defaults are the functions below. */
export interface QuestionSentences {
  describeUp: typeof describeUp;
  describeAskedFile: typeof describeAskedFile;
  describeAskPending: typeof describeAskPending;
  describePairWarning: typeof describePairWarning;
  describePairs: typeof describePairs;
  describePart: typeof describePart;
  describePlacement: typeof describePlacement;
}

/** Everything the view says: the words and the sentences. `mountQuestions({ copy })` replaces any field. */
export type QuestionCopy = QuestionWords & QuestionSentences;

/** How far one press of Turn turns: the up question's Pitch and Roll, a part at the final view. _(proposal, #72, #93)_ */
export const TURN_STEP_DEG = 15;

/** How far one press of Raise or Lower moves the figure on its base. _(proposal, #70)_ */
export const LIFT_STEP_MM = 0.5;

/** Below this size a length keeps one decimal: 7.5 mm, not 8 mm. */
const WHOLE_MM_FROM = 10;

const millimetres = (mm: number): string =>
  mm < WHOLE_MM_FROM ? `${Math.round(mm * 10) / 10} mm` : `${Math.round(mm)} mm`;

/** A file's name as the page lists it: without `.stl`. */
export const partName = (fileName: string): string => fileName.replace(/\.stl$/i, '');

/**
 * " · kept upright", " · turned to fit", " · tilted 18° to fit": how the fit placed a part (#93,
 * patches §7.4). `about` is what a free turn is called: a tilt on a base, a turn for a part.
 */
function fitWords(fit: Fit, rotation: Rotation, about: 'base' | 'parts'): string {
  switch (fit.kept) {
    case 'standing':
      return ' · kept upright';
    case 'upright':
      return ' · turned to fit';
    case 'free':
      return ` · ${about === 'base' ? 'tilted' : 'turned'} ${Math.round(turnAngleDeg(rotation))}° to fit`;
  }
}

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
  // Marked by the person (#93): where they marked, how it was fitted, raised and turned.
  if (placement.method === 'marked') {
    const { marks } = placement;
    const fitted = marks ? fitWords(marks.fit, marks.rotation, 'base') : '';
    return `Set where you marked${fitted}${liftAndTurn((marks?.liftMm ?? 0) * scale, marks?.turnDeg ?? 0)}`;
  }
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

/**
 * One line per part at the parts question and in the Base section (#93): "wing-l · where its
 * file puts it", "wing-r · set where you marked · turned 90° to fit · raised 0.5 mm",
 * "wing-r · lies apart: mark where it goes", "body · the body". `apart` says the part is not
 * where it belongs in its file: nothing was proposed for it.
 */
export function describePart(part: PartResult, name: string, apart = false): string {
  const label = partName(name);
  if (part.source === 'body') return `${label} · the body`;
  if (part.source === 'marked') {
    const joint = part.joint;
    const fitted = joint ? fitWords(joint.fit, part.rotation, 'parts') : '';
    return `${label} · set where you marked${fitted}${liftAndTurn(joint?.liftMm ?? 0, joint?.turnDeg ?? 0)}`;
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
 * What the pairs stop says under its chips (#93, patches §7.4): the proposal, what to tap next,
 * or why the last tap did nothing.
 */
export function describePairs(
  question: Pick<MeetQuestion, 'about' | 'proposed' | 'note' | 'inPlace'> & {
    pairs: readonly { on: object | null; of: object | null }[];
  },
): string {
  const parts = question.about === 'parts';
  switch (question.note) {
    case 'full':
      return 'This pair has both sides. Add a pair to mark another place.';
    case 'one-part':
      return 'A part meets one other part.';
    case 'missed':
      return 'Nothing to mark there. Tap on a part.';
    default:
      break;
  }
  if (question.proposed)
    return question.pairs.length > 0
      ? 'Confirm, or tap and brush to change a pair: × drops one, Start over brings them back.'
      : parts && question.inPlace === false
        ? 'Each part comes on its own. Tap where two parts touch, on both, to put them together.'
        : parts
          ? 'Nothing touches. Tap where they touch, or confirm to keep the parts where their files put them.'
          : 'Nothing found. Tap where they touch, or confirm to let the converter place it.';
  if (question.pairs.some(({ on, of }) => (on === null) !== (of === null)))
    return 'Mark the other side, or clear the pair.';
  return parts
    ? 'Tap a part in place and the part that goes there, where they touch.'
    : 'Tap the base and the figure where they touch.';
}

/** "Base: base.stl" or "Figure: figure.stl" above a pair's question; null for a single file. */
export function describeAskedFile(role: UpRole, name: string): string | null {
  if (role === 'mini') return null;
  return `${role === 'base' ? 'Base' : 'Figure'}: ${name}`;
}

/** Why the file stands as the question shows it (#92). */
export function describeUp(
  question: Pick<UpQuestion, 'reason' | 'base' | 'orientation'>,
  /** True when the axis is the source preset's, not one chosen by hand (#100). */
  preset = false,
): string {
  if (question.reason === 'chosen' && preset && question.orientation.setDownDeg === 0)
    return 'Standing as its source says.';
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

/** The default sentences: the functions above. */
export const QUESTION_SENTENCES: QuestionSentences = {
  describeUp,
  describeAskedFile,
  describeAskPending,
  describePairWarning,
  describePairs,
  describePart,
  describePlacement,
};
