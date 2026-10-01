import { describe, expect, it } from 'vitest';
import type { Vec3 } from './base';
import { fitMeeting, largestEigenvector, nudged, type FitPair } from './fit';
import type { PatchSummary } from './marks';
import { angleDeg, apply, fromAxisAngle, IDENTITY, multiply, type Rotation } from './rotation';

const patch = (centre: Vec3, normal: Vec3, areaMm2 = 10, flatness = 1): PatchSummary => ({
  file: 0,
  areaMm2,
  centre,
  normal,
  flatness,
});

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const placed = (fit: { rotation: Rotation; translation: Vec3 }, p: Vec3): Vec3 => {
  const r = apply(fit.rotation, p);
  return [r[0] + fit.translation[0], r[1] + fit.translation[1], r[2] + fit.translation[2]];
};
/** The angle of a rotation, from its w. */
const turnOf = (q: Rotation): number =>
  (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
const UP: Vec3 = [0, 1, 0];
/** The 3-4-5 tilt about x: up turned to (0, 4/5, 3/5), 36.87°. */
const TILTED: Vec3 = [0, 0.8, 0.6];

describe('fitMeeting', () => {
  it('moves a flat sole onto a flat floor without turning it', () => {
    const pairs: FitPair[] = [
      { on: patch([1, 3, -2], [0, 1, 0]), of: patch([10, 20, 30], [0, -1, 0], 6) },
    ];
    const fit = fitMeeting(pairs, { up: UP });
    expect(fit.rotation).toBe(IDENTITY);
    expect(fit.fit.kept).toBe('standing');
    expect(placed(fit, [10, 20, 30])).toEqual([1, 3, -2]);
    expect(fit.fit.centreRmsMm).toBe(0);
    expect(fit.fit.normalsDeg).toBe(0);
  });

  it('moves a peg end into a hole in a vertical face, the figure upright', () => {
    const pairs: FitPair[] = [
      { on: patch([5, 12, 0], [1, 0, 0], 7), of: patch([-3, 8, 1], [-1, 0, 0], 7) },
    ];
    const fit = fitMeeting(pairs, { up: UP });
    expect(fit.fit.kept).toBe('standing');
    expect(placed(fit, [-3, 8, 1])).toEqual([5, 12, 0]);
  });

  it('tilts a sole onto a slope steeper than the slack, and keeps it upright on a gentler one', () => {
    const steep = fitMeeting([{ on: patch([0, 5, 0], TILTED), of: patch([2, 0, 2], [0, -1, 0]) }], {
      up: UP,
    });
    expect(steep.fit.kept).toBe('free');
    expect(Math.abs(turnOf(steep.rotation) - Math.atan2(3, 4) * (180 / Math.PI))).toBeLessThan(
      0.01,
    );
    expect(angleDeg(apply(steep.rotation, [0, -1, 0]), [0, -0.8, -0.6])).toBeLessThan(0.01);
    expect(distance(placed(steep, [2, 0, 2]), [0, 5, 0])).toBeLessThan(1e-9);

    // 10° about x.
    const gentle: Vec3 = [0, Math.cos(Math.PI / 18), Math.sin(Math.PI / 18)];
    const pairs: FitPair[] = [{ on: patch([0, 5, 0], gentle), of: patch([2, 0, 2], [0, -1, 0]) }];
    const kept = fitMeeting(pairs, { up: UP });
    expect(kept.fit.kept).toBe('standing');
    expect(kept.fit.normalsDeg).toBeCloseTo(10, 6);
    const tilted = fitMeeting(pairs, { up: UP, turn: 'free' });
    expect(tilted.fit.kept).toBe('free');
    expect(turnOf(tilted.rotation)).toBeCloseTo(10, 6);
  });

  it('turns two feet about the vertical when the figure stands turned 20°', () => {
    const turn = fromAxisAngle(UP, -20);
    const on: Vec3[] = [
      [-5, 0, 1],
      [5, 0, -1],
    ];
    // The figure's feet as it stands: the base's spots turned back by 20° and moved.
    const pairs: FitPair[] = on.map((centre) => {
      const turned = apply(turn, centre);
      return {
        on: patch(centre, [0, 1, 0]),
        of: patch([turned[0] + 30, turned[1] + 2, turned[2] - 7], [0, -1, 0]),
      };
    });
    const fit = fitMeeting(pairs, { up: UP });
    expect(fit.fit.kept).toBe('upright');
    expect(Math.abs(turnOf(fit.rotation) - 20)).toBeLessThan(0.1);
    pairs.forEach(({ on: o, of }) =>
      expect(distance(placed(fit, of.centre), o.centre)).toBeLessThan(1e-9),
    );
    // Without the base's up there is no upright candidate: the free turn finds the same.
    const free = fitMeeting(pairs);
    expect(free.fit.kept).toBe('free');
    expect(Math.abs(turnOf(free.rotation) - 20)).toBeLessThan(0.1);
  });

  it('turns three pairs under any rotation and move back together', () => {
    const rotation = multiply(fromAxisAngle([1, 2, 3], 73), fromAxisAngle([0, 1, 0], -41));
    const move: Vec3 = [12, -4, 9];
    const on: [Vec3, Vec3][] = [
      [
        [0, 0, 0],
        [0, 1, 0],
      ],
      [
        [6, 1, 0],
        [1, 0, 0],
      ],
      [
        [0, 2, 5],
        [0, 0, 1],
      ],
    ];
    // Each `of` is its `on` taken back: inverse rotation of (centre − move), normal opposite.
    const back = (v: Vec3): Vec3 =>
      apply([0 - rotation[0], 0 - rotation[1], 0 - rotation[2], rotation[3]], v);
    const pairs: FitPair[] = on.map(([centre, normal]) => ({
      on: patch(centre, normal),
      of: patch(
        back([centre[0] - move[0], centre[1] - move[1], centre[2] - move[2]]),
        back([0 - normal[0], 0 - normal[1], 0 - normal[2]]),
      ),
    }));
    const fit = fitMeeting(pairs, { up: UP });
    expect(fit.fit.kept).toBe('free');
    pairs.forEach(({ on: o, of }) =>
      expect(distance(placed(fit, of.centre), o.centre)).toBeLessThan(0.01),
    );
    expect(fit.fit.normalsDeg).toBeLessThan(0.01);
  });

  it('only moves one pair whose patches wrap around', () => {
    const fit = fitMeeting(
      [{ on: patch([0, 0, 0], TILTED, 10, 0.2), of: patch([1, 1, 1], [0, -1, 0], 10, 0.2) }],
      { up: UP },
    );
    expect(fit.fit.kept).toBe('standing');
    expect(fit.rotation).toBe(IDENTITY);
  });

  it('keeps the figure standing when asked, however its marks disagree', () => {
    const fit = fitMeeting([{ on: patch([0, 5, 0], TILTED), of: patch([2, 0, 2], [0, -1, 0]) }], {
      up: UP,
      turn: 'keep',
    });
    expect(fit.fit.kept).toBe('standing');
    expect(fit.rotation).toBe(IDENTITY);
    expect(fit.fit.normalsDeg).toBeCloseTo(Math.atan2(3, 4) * (180 / Math.PI), 6);
  });
});

describe('nudged', () => {
  const pairs: FitPair[] = [{ on: patch([1, 5, 2], TILTED), of: patch([4, 0, 4], [0, -1, 0]) }];

  it('raises along the on normal and turns about it, the on centre staying where it is', () => {
    const fit = fitMeeting(pairs, { up: UP });
    const turned = nudged(fit, pairs, 0, 30);
    expect(distance(placed(turned, [4, 0, 4]), [1, 5, 2])).toBeLessThan(1e-9);
    const raised = nudged(fit, pairs, 1.5, 30);
    const expected: Vec3 = [1, 5 + 1.5 * 0.8, 2 + 1.5 * 0.6];
    expect(distance(placed(raised, [4, 0, 4]), expected)).toBeLessThan(1e-9);
    expect(
      turnOf(
        multiply(raised.rotation, [
          0 - fit.rotation[0],
          0 - fit.rotation[1],
          0 - fit.rotation[2],
          fit.rotation[3],
        ]),
      ),
    ).toBeCloseTo(30, 6);
  });

  it('changes nothing without a nudge', () => {
    const fit = fitMeeting(pairs, { up: UP });
    const same = nudged(fit, pairs, 0, 0);
    expect(same.rotation).toBe(fit.rotation);
    expect(same.translation).toBe(fit.translation);
  });
});

describe('largestEigenvector', () => {
  it('finds the eigenvector of the largest eigenvalue of a symmetric matrix', () => {
    // diag(1, 4, 2, 3) turned by a known orthogonal matrix would do; a diagonal one is enough to pin the order.
    expect(
      largestEigenvector([1, 0, 0, 0, 0, 4, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3]).map(Math.abs),
    ).toEqual([0, 1, 0, 0]);
    const [a, b, c, d] = largestEigenvector([2, 1, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Math.abs(a)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Math.abs(b)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(c).toBeCloseTo(0, 9);
    expect(d).toBeCloseTo(0, 9);
  });
});
