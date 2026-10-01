import { describe, expect, it } from 'vitest';
import {
  describeAskedFile,
  describeAskPending,
  describePairs,
  describeMini,
  describePairWarning,
  describePart,
  describeParts,
  describePendingPlacement,
  describePlacement,
  describeProgress,
  describeReady,
  describeTooManyFiles,
  describeUp,
  describeWrongFile,
  pageStateOf,
  COPY,
  STEP_LABELS,
} from './page-state';
import {
  BAKE_STEPS,
  STEPS,
  type BaseMeasurement,
  type Fit,
  type Orientation,
  type PartResult,
  type Placement,
  type Rotation,
  type Sizing,
  type UpReason,
} from '../lib';

const idle = { busy: false, stats: null, imported: null, error: null };

describe('pageStateOf', () => {
  it('follows the app state', () => {
    expect(pageStateOf(idle)).toBe('empty');
    expect(pageStateOf({ ...idle, busy: true })).toBe('converting');
    expect(pageStateOf({ ...idle, stats: {} })).toBe('done');
    expect(pageStateOf({ ...idle, error: 'The file is empty.' })).toBe('error');
  });

  it('counts a converting page as converting, whatever the last result was', () => {
    expect(pageStateOf({ ...idle, busy: true, stats: {}, error: 'x' })).toBe('converting');
  });

  it('shows an opened GLB as done', () => {
    expect(pageStateOf({ ...idle, imported: { triangles: 12 } })).toBe('done');
  });

  it('asks while a conversion waits at its question, though it is busy (#92)', () => {
    expect(pageStateOf({ ...idle, busy: true, question: { role: 'mini' } })).toBe('asking');
    expect(pageStateOf({ ...idle, busy: true, question: null })).toBe('converting');
  });
});

describe('describeProgress', () => {
  it('names the step, with the step’s own progress when it reports one', () => {
    expect(describeProgress({ step: 'bake', percent: 70 })).toBe('Baking the detail…');
    expect(describeProgress({ step: 'unwrap', percent: 60, stepPercent: 40 })).toBe(
      'Unwrapping the surface · 40 %',
    );
  });

  it('has a label for every step of the pipeline', () => {
    for (const step of [...STEPS, ...BAKE_STEPS]) expect(STEP_LABELS[step]).toBeTruthy();
  });
});

function sizing(changes: Partial<Sizing>): Sizing {
  return {
    units: 'mm',
    unitsMethod: 'guessed',
    scale: 1,
    base: null,
    plainBase: null,
    size: 'medium',
    sizeMethod: 'suggested',
    footprintSquares: 1,
    baseDiameterMm: 32,
    suggestedFrom: 'default',
    warnings: [],
    ...changes,
  };
}

const measured = (shape: 'round' | 'other', diameterMm: number): Sizing['base'] => ({
  shape,
  diameterMm,
  footprintMm: [diameterMm, diameterMm],
  coverage: 0.9,
});

describe('describeMini', () => {
  it('reads a mini on a round base', () => {
    const stats = {
      sizeMm: [25, 38.2, 25] as [number, number, number],
      sizing: sizing({ base: measured('round', 25.1), baseDiameterMm: 25.1 }),
    };
    expect(describeMini(stats)).toBe('38 mm tall · Medium, 1 square · 25 mm round base');
  });

  it('reads a large creature on a base that is not round', () => {
    const stats = {
      sizeMm: [76, 120, 76] as [number, number, number],
      sizing: sizing({ size: 'huge', footprintSquares: 3, base: measured('other', 76.2) }),
    };
    expect(describeMini(stats)).toBe('120 mm tall · Huge, 3×3 squares · 76 mm base');
  });

  it('reads a mini without a base, and one with a plain base added', () => {
    const sizeMm: [number, number, number] = [20, 32.4, 20];
    expect(describeMini({ sizeMm, sizing: sizing({}) })).toBe(
      '32 mm tall · Medium, 1 square · no base',
    );
    const plainBase = { diameterMm: 32, heightMm: 3 };
    expect(describeMini({ sizeMm, sizing: sizing({ plainBase }) })).toBe(
      '32 mm tall · Medium, 1 square · 32 mm plain base added',
    );
  });

  it('says when the file was read in other units, and keeps a decimal for tiny minis', () => {
    expect(describeMini({ sizeMm: [5, 7.46, 5], sizing: sizing({ units: 'in' }) })).toBe(
      '7.5 mm tall · Medium, 1 square · no base, read as inches',
    );
    expect(describeMini({ sizeMm: [5, 40, 5], sizing: sizing({ units: 'm' }) })).toBe(
      '40 mm tall · Medium, 1 square · no base, read as metres',
    );
  });
});

describe('describeReady and describeWrongFile', () => {
  it('reads the source triangles', () => {
    expect(describeReady({ sourceTriangles: 1_250_000 })).toBe(
      `Ready. Converted from ${(1_250_000).toLocaleString()} triangles.`,
    );
  });

  it('offers a GLB only to the team', () => {
    expect(describeWrongFile('mini.obj', false)).toBe('mini.obj is not an STL file.');
    expect(describeWrongFile('mini.obj', true)).toBe('mini.obj is neither an STL nor a GLB file.');
  });
});

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

  it('says what is pending and not applied', () => {
    expect(describePendingPlacement({ moveMm: [0, 0], liftMm: 0, turnDeg: 0 })).toBeNull();
    expect(describePendingPlacement({ moveMm: [2.3, 0], liftMm: 0.5, turnDeg: 15 })).toBe(
      'Moved 2.3 mm, turned 15°, raised 0.5 mm — not applied yet',
    );
    expect(describePendingPlacement({ moveMm: [0, 0], liftMm: -1, turnDeg: 0 })).toBe(
      'Lowered 1 mm — not applied yet',
    );
  });

  it('says a pair measured its base from the base file, and refuses a seventh file', () => {
    const stats = {
      sizeMm: [32, 34, 32] as [number, number, number],
      sizing: sizing({ base: measured('round', 32), baseDiameterMm: 32 }),
      pair: {},
    };
    expect(describeMini(stats)).toBe(
      '34 mm tall · Medium, 1 square · 32 mm round base from its own file',
    );
    expect(describeTooManyFiles(6)).toBe('Drop up to 6 files: a figure, its base and its parts.');
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
      COPY.askPairs,
      COPY.confirmPairs,
      COPY.addPair,
      COPY.brush,
      COPY.erase,
      COPY.undo,
      COPY.startOver,
      COPY.pullApart,
      COPY.backToMarking,
      COPY.letTilt,
      COPY.keepUpright,
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

  it('names the file of a pair, and the turn being tried out', () => {
    expect(describeAskedFile('base', 'base.stl')).toBe('Base: base.stl');
    expect(describeAskedFile('figure', 'figure.stl')).toBe('Figure: figure.stl');
    expect(describeAskedFile('mini', 'mini.stl')).toBeNull();
    expect(describeAskPending(30)).toBe('Turned 30°');
    expect(describeAskPending(-15.2)).toBe('Turned -15°');
    expect(describeAskPending(0)).toBeNull();
  });

  it('has the words of the note', () => {
    expect(COPY).toMatchObject({
      askUp: 'Is this the right way up?',
      confirmUp: 'Yes, convert',
      confirmBaseUp: 'Yes, next: the figure',
      askSetDown: 'Set down',
      askReset: 'Reset',
    });
  });
});
