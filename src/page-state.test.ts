import { describe, expect, it } from 'vitest';
import {
  describeMini,
  describeProgress,
  describeReady,
  describeWrongFile,
  pageStateOf,
  STEP_LABELS,
} from './page-state';
import { BAKE_STEPS, STEPS } from './pipeline/run';
import type { Sizing } from './pipeline/size';

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
