import { describe, expect, it } from 'vitest';
import { addBlob, generateFigure } from '../../regression/shapes';
import { addRoundBase } from './base';
import { weldVertices } from './mesh';
import { coverageFor, orientAndPlace, resolveOrientation } from './orient';
import { BASE_MAX_ASPECT, fileShape, guessRoles, type FileShape } from './pair';
import { ConversionProblem } from './problems';

/** The shape the pipeline sees for a Z-up soup: its own detection, then placed. */
function shapeOf(soup: Float32Array): FileShape {
  const mesh = weldVertices(soup).mesh;
  const detection = resolveOrientation(mesh, {});
  const { orientation } = detection;
  const placed = orientAndPlace(mesh, orientation.rotation, coverageFor(detection, orientation.up));
  return fileShape(orientation, placed.sizeMm);
}

function roundBase(diameterMm: number, heightMm: number): Float32Array {
  const soup: number[] = [];
  addRoundBase(soup, [0, 0], diameterMm, heightMm, 24);
  return new Float32Array(soup);
}

/** A low creature without a base: a flattened blob, wider than tall. */
function lowCreature(): Float32Array {
  const soup: number[] = [];
  addBlob(soup, [0, 0, 4], [12, 8, 4], 16, 0.1);
  return new Float32Array(soup);
}

const figure = shapeOf(generateFigure(false));
const figureOnBase = shapeOf(generateFigure(true));
const base = shapeOf(roundBase(32, 4));

describe('fileShape', () => {
  it('sees a flat underside on a base and none under a figure without one', () => {
    expect(base.flatUnderside).toBe(true);
    expect(base.aspect).toBeCloseTo(4 / 32, 3);
    expect(figure.flatUnderside).toBe(false);
    expect(figure.aspect).toBeGreaterThan(1);
    expect(figureOnBase.flatUnderside).toBe(true);
    expect(figureOnBase.aspect).toBeGreaterThan(BASE_MAX_ASPECT);
  });
});

describe('guessRoles', () => {
  it('takes the file with the flat underside as the base, in either order', () => {
    expect(guessRoles([figure, base])).toMatchObject({
      baseFile: 1,
      method: 'guessed',
      warnings: [],
    });
    expect(guessRoles([base, figure]).baseFile).toBe(0);
  });

  it('takes the flat underside whatever its aspect: a tall pillar is still the base', () => {
    const pillar: FileShape = { ...base, aspect: 1.4, sizeMm: [20, 28, 20] };
    expect(guessRoles([lowCreatureShape(), pillar]).baseFile).toBe(1);
  });

  it('takes the low one when the figure has an integral base, and says so', () => {
    const pairing = guessRoles([figureOnBase, base]);
    expect(pairing.baseFile).toBe(1);
    expect(pairing.warnings).toEqual(['figure-has-its-own-base']);
  });

  it('takes the lower of two bases, with a warning', () => {
    const lower = shapeOf(roundBase(40, 3));
    const pairing = guessRoles([base, lower]);
    expect(pairing.baseFile).toBe(1);
    expect(pairing.warnings).toEqual(['both-look-like-bases']);
    expect(guessRoles([lower, base]).baseFile).toBe(0);
  });

  it('refuses two figures without a flat underside', () => {
    const refuse = (): unknown => guessRoles([figure, lowCreatureShape()]);
    expect(refuse).toThrow(ConversionProblem);
    expect(refuse).toThrow(/Neither of these files has a flat underside/);
  });

  it('swaps the roles on request and keeps the warnings as seen', () => {
    expect(guessRoles([figure, base], { swap: true })).toMatchObject({
      baseFile: 0,
      method: 'manual',
    });
    expect(guessRoles([figureOnBase, base], { swap: true })).toMatchObject({
      baseFile: 0,
      warnings: ['figure-has-its-own-base'],
    });
  });
});

function lowCreatureShape(): FileShape {
  const shape = shapeOf(lowCreature());
  expect(shape.flatUnderside).toBe(false);
  return shape;
}
