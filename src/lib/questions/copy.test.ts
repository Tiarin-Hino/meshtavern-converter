import { describe, expect, it } from 'vitest';
import {
  describeAskedFile,
  describeAskPending,
  describePairs,
  describePairWarning,
  describePart,
  describeParts,
  describePlacement,
  describeUp,
  QUESTION_COPY,
} from './copy';
import type { BaseMeasurement } from '../pipeline/size';
import type { PartResult } from '../pipeline/assemble';
import type { Fit } from '../pipeline/fit';
import type { Orientation, UpReason } from '../index';
import type { Placement } from '../pipeline/place';
import type { Rotation } from '../pipeline/rotation';

// Moved from src/page/page-state.test.ts with the functions (#119).

const placement = (
  changes: Partial<Placement['spot']>,
  method: Placement['method'] = 'detected',
): Placement => ({
  spot: { kind: 'recess', centre: [0, 0], sizeMm: [14, 10], depthMm: 1, fit: 0.5, ...changes },
  contactMm: [12, 8],
  offsetMm: [0, 0, 3],
  yawDeg: 0,
  method,
  candidates: [],
});

describe('the base section', () => {
  it('says where the figure was set', () => {
    expect(describePlacement(placement({}))).toBe('Set in the 14 × 10 mm recess');
    expect(describePlacement(placement({ sizeMm: [13, 13] }))).toBe('Set in the 13 mm recess');
    expect(describePlacement(placement({ kind: 'hole', sizeMm: [3.2, 3.1] }))).toBe(
      'Set in the 3.2 mm hole',
    );
    expect(describePlacement(placement({ kind: 'hole', sizeMm: [2, 9] }))).toBe(
      'Set in the 9 × 2 mm slot',
    );
    expect(describePlacement(placement({ kind: 'flat' }), 1)).toBe(
      'Set on the flattest patch of the top',
    );
    expect(describePlacement(placement({ kind: 'hole', sizeMm: [0.125, 0.125] }), 25.4)).toBe(
      'Set in the 3.2 mm hole',
    );
    expect(describePlacement(placement({ kind: 'registered' }))).toBe('Set where the files put it');
    expect(describePlacement(placement({ kind: 'flat', centred: true }))).toBe(
      'Set over the middle of the base',
    );
    expect(describePlacement(placement({}, 'manual'))).toBe(
      'Set in the 14 × 10 mm recess · moved by hand',
    );
  });

  it('says what it saw about the two files', () => {
    expect(describePairWarning([])).toBeNull();
    expect(describePairWarning(['both-look-like-bases'])).toMatch(/Both files look like bases/);
    expect(describePairWarning(['figure-has-its-own-base'])).toMatch(/flat underside of its own/);
    // Two files without a flat underside (#92): at the question, and after the conversion.
    expect(describePairWarning(['no-flat-underside'], 'question')).toBe(
      'Neither file has a flat underside, so the converter cannot tell which one is the base. It took the lower, wider one. If this is the figure, swap them.',
    );
    expect(describePairWarning(['no-flat-underside'])).toBe(
      'Neither file has a flat underside; you said which one is the base.',
    );
  });
});

describe('where the parts meet (#93)', () => {
  const summary = (normal: [number, number, number]) => ({
    file: 0,
    areaMm2: 10,
    centre: [0, 3, 0] as [number, number, number],
    normal,
    flatness: 1,
  });
  const fit = (kept: Fit['kept']): Fit => ({
    kept,
    centreRmsMm: 0,
    normalsDeg: 0,
  });
  /** A quarter turn's tilt: 18° about x has w = cos 9°. */
  const tilt18: Rotation = [Math.sin(Math.PI / 20), 0, 0, Math.cos(Math.PI / 20)];
  const marked = (
    liftMm: number,
    turnDeg: number,
    kept: Fit['kept'] = 'standing',
    rotation: Rotation = [0, 0, 0, 1],
  ): Placement => ({
    ...placement({ kind: 'marked', sizeMm: [0, 0] }, 'marked'),
    marks: {
      pairs: [{ on: summary([0, 1, 0]), of: summary([0, -1, 0]) }],
      rotation,
      liftMm,
      turnDeg,
      fit: fit(kept),
    },
  });
  const part = (
    source: PartResult['source'],
    liftMm = 0,
    turnDeg = 0,
    kept: Fit['kept'] = 'standing',
  ): PartResult => ({
    file: 1,
    source,
    rotation: kept === 'free' ? [0, 0, Math.SQRT1_2, Math.SQRT1_2] : [0, 0, 0, 1],
    translation: [0, 0, 0],
    triangles: 12,
    ...(source === 'marked' && {
      joint: {
        onto: 0,
        pairs: [{ on: summary([1, 0, 0]), of: summary([-1, 0, 0]) }],
        liftMm,
        turnDeg,
        fit: fit(kept),
      },
    }),
  });

  it('says a marked placement was set where the person marked, how it was fitted, raised and turned', () => {
    expect(describePlacement(marked(0, 0))).toBe('Set where you marked · kept upright');
    expect(describePlacement(marked(0.5, 0))).toBe(
      'Set where you marked · kept upright · raised 0.5 mm',
    );
    expect(describePlacement(marked(-0.5, 15, 'upright'))).toBe(
      'Set where you marked · turned to fit · lowered 0.5 mm, turned 15°',
    );
    expect(describePlacement(marked(0, 0, 'free', tilt18))).toBe(
      'Set where you marked · tilted 18° to fit',
    );
    // The lift in the base file's units, said in mm.
    expect(describePlacement(marked(0.02, 0), 25.4)).toBe(
      'Set where you marked · kept upright · raised 0.5 mm',
    );
  });

  it('says where each part is', () => {
    expect(describePart(part('body'), 'body.stl')).toBe('body · the body');
    expect(describePart(part('files'), 'wing-l.stl')).toBe('wing-l · where its file puts it');
    expect(describePart(part('files'), 'wing-r.stl', true)).toBe(
      'wing-r · lies apart: mark where it goes',
    );
    expect(describePart(part('marked'), 'wing-r.STL')).toBe(
      'wing-r · set where you marked · kept upright',
    );
    expect(describePart(part('marked', 0.5, -15, 'free'), 'wing-r.stl')).toBe(
      'wing-r · set where you marked · turned 90° to fit · raised 0.5 mm, turned -15°',
    );
    const names = ['body.stl', 'wing-l.stl', 'wing-r.stl'];
    expect(describeParts([{ ...part('body'), file: 0 }], names)).toBeNull();
    expect(
      describeParts(
        [{ ...part('body'), file: 0 }, part('files'), { ...part('marked'), file: 2 }],
        names,
      ),
    ).toBe('Parts: wing-l where its file puts it · wing-r marked');
  });

  it('says what the pairs stop proposes, what to tap next, and why a tap did nothing', () => {
    const side = { ...summary([0, 1, 0]), triangles: new Uint32Array(1) };
    const pair = { on: side, of: side };
    const ask = (
      about: 'base' | 'parts',
      proposed: boolean,
      pairs: { on: typeof side | null; of: typeof side | null }[],
      note?: 'missed' | 'full' | 'one-part',
    ) => describePairs({ about, proposed, pairs, ...(note && { note }) });
    expect(ask('base', true, [pair])).toBe(
      'Confirm, or tap and brush to change a pair: × drops one, Start over brings them back.',
    );
    expect(ask('base', true, [])).toBe(
      'Nothing found. Tap where they touch, or confirm to let the converter place it.',
    );
    expect(ask('parts', true, [])).toBe(
      'Nothing touches. Tap where they touch, or confirm to keep the parts where their files put them.',
    );
    expect(describePairs({ about: 'parts', proposed: true, pairs: [], inPlace: false })).toBe(
      'Each part comes on its own. Tap where two parts touch, on both, to put them together.',
    );
    expect(ask('base', false, [])).toBe('Tap the base and the figure where they touch.');
    expect(ask('parts', false, [pair])).toBe(
      'Tap a part in place and the part that goes there, where they touch.',
    );
    expect(ask('base', false, [{ on: side, of: null }])).toBe(
      'Mark the other side, or clear the pair.',
    );
    expect(ask('base', false, [pair], 'full')).toBe(
      'This pair has both sides. Add a pair to mark another place.',
    );
    expect(ask('parts', false, [pair], 'one-part')).toBe('A part meets one other part.');
    expect(ask('base', false, [], 'missed')).toBe('Nothing to mark there. Tap on a part.');
  });

  it('names the buttons of the two stops', () => {
    expect([
      QUESTION_COPY.askPairs,
      QUESTION_COPY.confirmPairs,
      QUESTION_COPY.addPair,
      QUESTION_COPY.brush,
      QUESTION_COPY.erase,
      QUESTION_COPY.undo,
      QUESTION_COPY.startOver,
      QUESTION_COPY.pullApart,
      QUESTION_COPY.backToMarking,
      QUESTION_COPY.letTilt,
      QUESTION_COPY.keepUpright,
    ]).toEqual([
      'Is this where they meet?',
      'Yes, put them together',
      'Add a pair',
      'Brush',
      'Erase',
      'Undo',
      'Start over',
      'Pull apart',
      'Back to marking',
      'Let it tilt to fit',
      'Keep it upright',
    ]);
  });
});

describe('the up question (#92)', () => {
  const orientation: Orientation = {
    up: '+z',
    method: 'manual',
    confidence: 1,
    rotation: [0, 0, 0, 1],
    tiltDeg: 0,
    setDownDeg: 0,
  };
  const round: BaseMeasurement = {
    shape: 'round',
    diameterMm: 25.2,
    footprintMm: [25, 25],
    coverage: 0.9,
  };
  const up = (reason: UpReason, changes: Partial<Parameters<typeof describeUp>[0]> = {}): string =>
    describeUp({ reason, base: null, orientation, ...changes });

  it('says why the file stands as it does', () => {
    expect(up('base', { base: round })).toBe('Standing on its base, 25 mm across.');
    expect(up('tallest')).toBe('No base found, so the taller way was taken as up. Check it.');
    expect(up('cut')).toBe('Standing on the flat cut of its feet.');
    expect(up('registered')).toBe(
      'Standing the way its base does: the two files were exported together.',
    );
    expect(up('underside')).toBe('Standing on its flat underside.');
    expect(up('tilted')).toBe('Stored at an angle; standing on its flat underside.');
    expect(up('guess')).toBe('No flat underside found. Check it.');
    expect(up('chosen')).toBe('As you turned it.');
    expect(up('chosen', { orientation: { ...orientation, setDownDeg: 4.2 } })).toBe(
      'As you turned it, set down by 4°.',
    );
  });

  it('says "standing as its source says" for an axis that comes from a preset (#100)', () => {
    const standing = { ...orientation, up: '+y' as const };
    expect(describeUp({ reason: 'chosen', base: null, orientation: standing }, true)).toBe(
      'Standing as its source says.',
    );
    expect(describeUp({ reason: 'chosen', base: null, orientation: standing })).toBe(
      'As you turned it.',
    );
  });

  it('names the file of a pair, and the turn being tried out', () => {
    expect(describeAskedFile('base', 'base.stl')).toBe('Base: base.stl');
    expect(describeAskedFile('figure', 'figure.stl')).toBe('Figure: figure.stl');
    expect(describeAskedFile('mini', 'mini.stl')).toBeNull();
    expect(describeAskPending(30)).toBe('Turned 30°');
    expect(describeAskPending(-15.2)).toBe('Turned -15°');
    expect(describeAskPending(0)).toBeNull();
  });

  it('has the words of the note', () => {
    expect(QUESTION_COPY).toMatchObject({
      askUp: 'Is this the right way up?',
      confirmUp: 'Yes, convert',
      confirmBaseUp: 'Yes, next: the figure',
      askSetDown: 'Set down',
      askReset: 'Reset',
    });
  });

  it('names the select of source presets and its first entry (#100)', () => {
    expect([QUESTION_COPY.source, QUESTION_COPY.noPreset]).toEqual(['Source', 'None (guess)']);
  });
});
