import { describe, expect, it } from 'vitest';
import {
  addBlob,
  addBox,
  addRecessBase,
  generateFigure,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
} from '../../regression/shapes';
import { addRoundBase } from './base';
import { weldVertices } from './mesh';
import { resolveOrientation } from './orient';
import {
  BASE_MAX_ASPECT,
  baseOrientation,
  chosenBase,
  figureUpCandidates,
  printCut,
  PRINT_CUT_MIN_MM2,
  PRINT_CUT_WEAK_MM2,
  guessRoles,
  placeOriented,
  shapeOfFile,
  UNDERSIDE_BAND_MM,
  type FileShape,
} from './pair';
import { ConversionProblem } from './problems';
import { angleDeg, apply, AXIS_ROTATION, fileUp, fromAxisAngle, multiply } from './rotation';

/** The shape the pipeline sees for a Z-up soup, standing as `baseOrientation` stands it. */
function shapeOf(soup: Float32Array): FileShape {
  const mesh = weldVertices(soup).mesh;
  return shapeOfFile(mesh, baseOrientation(mesh));
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

/** A Z-up soup turned upside down about x: z → height − z, y → −y. */
function upsideDown(soup: Float32Array, heightMm: number): Float32Array {
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    out[i] = soup[i]!;
    out[i + 1] = 0 - soup[i + 1]!;
    out[i + 2] = heightMm - soup[i + 2]!;
  }
  return out;
}

/**
 * A 32 mm base 4 mm tall with a hollow underside: a 1 mm rim around an inner face 1 mm up,
 * so the faces on the floor cover 12 % of the footprint, under `MIN_BASE_COVERAGE`.
 */
function hollowBase(): Float32Array {
  const soup: number[] = [];
  addRecessBase(soup, 32, 4, 64, 30, 1);
  return upsideDown(new Float32Array(soup), 4);
}

const figure = shapeOf(generateFigure(false));
const figureOnBase = shapeOf(generateFigure(true));
const base = shapeOf(roundBase(32, 4));

describe('baseOrientation', () => {
  it('finds a hollow underside the height-relative band misses', () => {
    const mesh = weldVertices(hollowBase()).mesh;
    // The height-relative band sees the flat top as the underside and stands it upside down.
    expect(resolveOrientation(mesh, {}).orientation.up).toBe('-z');
    const oriented = baseOrientation(mesh);
    expect(oriented).toMatchObject({ how: 'band', flatUnderside: true });
    expect(oriented.detection.orientation.up).toBe('+z');
    expect(UNDERSIDE_BAND_MM).toBe(2);
    // Measured from its rim: a 32 mm round base.
    expect(placeOriented(mesh, oriented).base).toMatchObject({ shape: 'round' });
  });

  it('stands a square base on its underside, not on the wall the single-file detection picks', () => {
    const mesh = weldVertices(generatePlate(25, 3, 0.5, () => false)).mesh;
    expect(resolveOrientation(mesh, {}).orientation.up).toBe('+x');
    expect(baseOrientation(mesh).detection.orientation).toMatchObject({ up: '+z', method: 'base' });
  });

  it('takes a hollowed side as the underside when both sides are flat', () => {
    const hollow = weldVertices(hollowBase()).mesh;
    expect(baseOrientation(hollow).detection.orientation.up).toBe('+z');
    const turned = weldVertices(upsideDown(hollowBase(), 4)).mesh;
    expect(baseOrientation(turned).detection.orientation.up).toBe('-z');
  });

  it('keeps a plain disc with a seat on top the right way up', () => {
    // The recess covers 19 % of the footprint: a seat, not a hollow underside.
    const upright = weldVertices(generateRecessBase()).mesh;
    expect(baseOrientation(upright).detection.orientation.up).toBe('+z');
  });

  it('stands a base exported tilted on its dominant plane', () => {
    // A round base under a dome, tilted by 26° about x: no face is near an axis.
    const soup: number[] = [];
    addRoundBase(soup, [0, 0], 32, 3, 24);
    addBlob(soup, [0, 0, 7], [14, 14, 6], 24, 0);
    const turn = fromAxisAngle([1, 0, 0], 26);
    const tilted = new Float32Array(soup.length);
    for (let i = 0; i < soup.length; i += 3) {
      const [x, y, z] = apply(turn, [soup[i]!, soup[i + 1]!, soup[i + 2]!]);
      tilted[i] = x;
      tilted[i + 1] = y;
      tilted[i + 2] = z;
    }
    const mesh = weldVertices(tilted).mesh;
    const oriented = baseOrientation(mesh);
    expect(oriented).toMatchObject({ how: 'dominant-plane', flatUnderside: true });
    // Up in the file is the base's tilted +z.
    expect(
      angleDeg(fileUp(oriented.detection.orientation.rotation), apply(turn, [0, 0, 1])),
    ).toBeLessThan(1);
    const placed = placeOriented(mesh, oriented);
    expect(placed.base?.shape).toBe('round');
    expect(placed.base?.diameterMm).toBeCloseTo(32, 0);
  });

  it('keeps the detection of a figure without an underside', () => {
    const mesh = weldVertices(generateFigure(false)).mesh;
    const oriented = baseOrientation(mesh);
    expect(oriented).toMatchObject({ how: 'detector', flatUnderside: false });
    expect(oriented.detection).toEqual(resolveOrientation(mesh, {}));
  });
});

describe('chosenBase (#92)', () => {
  const mesh = weldVertices(generateRecessBase()).mesh;
  const { detection } = baseOrientation(mesh);

  it('measures a base turned over in the 2 mm band: its top, recess and all, is the underside', () => {
    const turned = chosenBase(mesh, { up: '-z' }, detection);
    expect(turned).toMatchObject({ how: 'chosen', flatUnderside: true });
    expect(turned.detection.orientation).toMatchObject({ up: '-z', method: 'manual' });
    // The top ring and the recess floor 1 mm below it: the whole disc.
    expect(turned.coverage).toBeGreaterThan(0.7);
    const placed = placeOriented(mesh, turned);
    expect(placed.base).toMatchObject({ shape: 'round' });
    expect(placed.base!.diameterMm).toBeCloseTo(32, 0);
  });

  it('sees no flat underside on a file that has none', () => {
    const figure = weldVertices(generateFigure(false)).mesh;
    const chosen = chosenBase(figure, { up: '+z' }, baseOrientation(figure).detection);
    expect(chosen).toMatchObject({ how: 'chosen', flatUnderside: false });
  });

  it('takes a free turn as the underside, measured after placing', () => {
    const rotation = multiply(fromAxisAngle([1, 0, 0], 5), AXIS_ROTATION['+z']);
    const tilted = chosenBase(mesh, { rotation }, detection);
    expect(tilted).toMatchObject({ how: 'chosen', flatUnderside: true });
    expect(tilted.detection.orientation.rotation).toBe(rotation);
    // Its shape is measured as it stands: 4 mm high plus the tilt over 32 mm.
    const shape = shapeOfFile(mesh, tilted);
    expect(shape.sizeMm[1]).toBeGreaterThan(4 + 32 * Math.sin((5 * Math.PI) / 180) - 0.5);
  });
});

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

/** The figure without a base, with a flat square of `sideMm` at the far end of its file y axis: a print cut facing +y. */
function figureWithCut(sideMm: number): Float32Array {
  const figure = generateFigure(false);
  let maxY = -Infinity;
  for (let i = 1; i < figure.length; i += 3) if (figure[i]! > maxY) maxY = figure[i]!;
  const soup: number[] = [];
  const h = sideMm / 2;
  addBox(soup, [-h, maxY - 1, 11 - h], [h, maxY + 0.2, 11 + h]);
  const joined = new Float32Array(figure.length + soup.length);
  joined.set(figure);
  joined.set(soup, figure.length);
  return joined;
}

describe('the up axis of the figure of a pair', () => {
  it('takes a confident print cut over the detection', () => {
    // 9 mm² of flat cut facing +y; the blobs' own flat patches are under 2 mm².
    const mesh = weldVertices(figureWithCut(3)).mesh;
    const pass = resolveOrientation(mesh, {});
    expect(pass.orientation.up).toBe('+z');
    expect(printCut(mesh, pass.scan)).toMatchObject({ up: '-y', strength: 'confident' });
    const candidates = figureUpCandidates(mesh, pass);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.orientation).toMatchObject({ up: '-y', method: 'cut' });
  });

  it('keeps the detection when the cut agrees with it', () => {
    const mesh = weldVertices(generatePuddleFigure(12)).mesh;
    const pass = resolveOrientation(mesh, {});
    expect(printCut(mesh, pass.scan).up).toBe('+z');
    expect(figureUpCandidates(mesh, pass).map((c) => c.orientation.method)).toEqual(['base']);
  });

  it('has no second candidate below the confident area', () => {
    // The weak-cut test is switched off (PR #89): on the corpus it turned the bat upside down,
    // and the one figure it turned right is a registered pair.
    expect(PRINT_CUT_WEAK_MM2).toBe(PRINT_CUT_MIN_MM2);
    const mesh = weldVertices(figureWithCut(3)).mesh;
    const cut = printCut(mesh, resolveOrientation(mesh, {}).scan);
    expect(cut.areaMm2).toBeGreaterThan(8);
  });
});
