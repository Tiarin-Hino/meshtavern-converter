import { describe, expect, it } from 'vitest';
import { compareFigures } from './compare';

const baseline = {
  figure: {
    triangles: 114480,
    up: '+z',
    sizeMm: [25, 32.2337, 25],
    levels: [{ name: 'close', decidedBy: 'error', triangles: 54600, errorMm: 0.02 }],
  },
};
const changed = (edit: (copy: typeof baseline) => void): typeof baseline => {
  const copy = structuredClone(baseline);
  edit(copy);
  return copy;
};

describe('compareFigures', () => {
  it('reports nothing for equal figures', () => {
    expect(compareFigures(baseline, structuredClone(baseline))).toEqual([]);
  });

  it('reports a triangle count that moved by one', () => {
    const current = changed((copy) => (copy.figure.levels[0]!.triangles = 54601));
    expect(compareFigures(baseline, current)).toEqual([
      'figure.levels[0].triangles: 54600 → 54601 (+0.0 %)',
    ]);
  });

  it('lets an error drift within its tolerance, and reports it beyond', () => {
    const drift = changed((copy) => (copy.figure.levels[0]!.errorMm = 0.02001));
    expect(compareFigures(baseline, drift)).toEqual([]);
    const worse = changed((copy) => (copy.figure.levels[0]!.errorMm = 0.025));
    expect(compareFigures(baseline, worse)).toEqual([
      'figure.levels[0].errorMm: 0.02 → 0.025 (+25.0 %)',
    ]);
  });

  it('applies a tolerance to every entry of a list', () => {
    const current = changed((copy) => (copy.figure.sizeMm[1] = 30));
    expect(compareFigures(baseline, current)).toEqual(['figure.sizeMm[1]: 32.234 → 30 (-6.9 %)']);
  });

  it('reports changed decisions and directions', () => {
    const current = changed((copy) => {
      copy.figure.up = '+y';
      copy.figure.levels[0]!.decidedBy = 'cap';
    });
    expect(compareFigures(baseline, current)).toEqual([
      'figure.up: "+z" → "+y"',
      'figure.levels[0].decidedBy: "error" → "cap"',
    ]);
  });

  it('reports meshes, levels and figures that appear or disappear', () => {
    const current = { ...changed((copy) => copy.figure.levels.pop()), swarm: { triangles: 1 } };
    expect(compareFigures(baseline, current)).toEqual([
      'figure.levels[0]: gone, was {"name":"close","decidedBy":"error","triangles":54600,"errorMm":0.02}',
      'swarm: new, {"triangles":1}',
    ]);
  });

  it('treats a figure that is not a number any more as a change', () => {
    const current = changed((copy) => (copy.figure.levels[0]!.errorMm = NaN));
    expect(compareFigures(baseline, current)).toHaveLength(1);
  });
});
