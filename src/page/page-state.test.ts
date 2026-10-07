import { describe, expect, it } from 'vitest';
import {
  describeMini,
  describeOrientation,
  describePendingPlacement,
  describeProgress,
  describeReady,
  describeTooManyFiles,
  describeUnits,
  describeWrongFile,
  pageStateOf,
  COPY,
  STEP_LABELS,
} from './page-state';
import { BAKE_STEPS, STEPS, type Orientation, type Sizing } from '../lib';
import { QUESTION_COPY } from '../lib/questions';

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

describe('the base section', () => {
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

describe('source presets in the words (#100)', () => {
  const orientation: Orientation = {
    up: '+y',
    method: 'manual',
    confidence: 1,
    rotation: [0, 0, 0, 1],
    tiltDeg: 0,
    setDownDeg: 0,
  };

  it('says "preset" where the units come from one, "chosen" or "guessed" otherwise', () => {
    const metres = sizing({ units: 'm', unitsMethod: 'manual', scale: 1000 });
    expect(describeUnits(metres, true)).toBe('metres (preset)');
    expect(describeUnits(metres)).toBe('metres (chosen)');
    expect(describeUnits(sizing({ units: 'm', scale: 1000 }), true)).toBe('metres (guessed)');
    expect(describeUnits(sizing({ units: 'mm', unitsMethod: 'manual', scale: 10 }), true)).toBe(
      'mm (preset), scaled ×10.000',
    );
  });

  it('says "preset" for an axis that comes from one', () => {
    expect(describeOrientation(orientation, true)).toBe('+y (preset)');
    expect(describeOrientation(orientation)).toBe('+y (manual)');
    expect(describeOrientation({ ...orientation, method: 'base', confidence: 0.9 }, true)).toBe(
      '+y (base, 0.90)',
    );
  });

  it('spreads the words of the questions into the page’s own (#119)', () => {
    expect(COPY).toMatchObject(QUESTION_COPY);
    expect(COPY.title).toBe('MeshTavern Converter');
  });
});
