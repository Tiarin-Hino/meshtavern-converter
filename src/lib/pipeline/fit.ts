/**
 * Where two parts meet, from pairs of patches (#93, design note
 * docs/design/patches-where-parts-meet.md §5.4): the least change that brings the paired patches
 * onto each other. A figure keeps standing as the person confirmed it when a move is enough; it
 * is turned about the base's up when that fits; it is turned freely only when its marks disagree
 * with how it stands by more than `FIT_NORMAL_SLACK_DEG`.
 *
 * Deterministic: only + - * / and sqrt feed a coordinate. The angles reported use acos; the turn
 * a person asks for (`nudged`) uses trigonometry, like every turn a person asks for.
 */
import type { Vec3 } from './base';
import type { PatchSummary } from './marks';
import {
  apply,
  dot,
  fromAxisAngle,
  fromTo,
  IDENTITY,
  multiply,
  normalise,
  type Rotation,
} from './rotation';

/** How a meeting was fitted. */
export interface Fit {
  /** `standing`: moved only. `upright`: also turned about the base's up. `free`: turned to fit. */
  kept: 'standing' | 'upright' | 'free';
  /** How far the paired centres are apart after the fit, weighted rms. */
  centreRmsMm: number;
  /** The largest angle by which a flat pair's normals fail to oppose each other after the fit. */
  normalsDeg: number;
}

/** A pair of patches as the fit reads them: `on` in the target frame, `of` as the part stands now. */
export interface FitPair {
  on: PatchSummary;
  of: PatchSummary;
}

/** The free turn weighs each pair's normals as a direction this long, in mm. _(proposal)_ */
export const FIT_NORMAL_LEVER_MM = 10;
/** A fit's paired centres may end this far apart (weighted rms)... _(proposal)_ */
export const FIT_CENTRE_SLACK_MM = 0.3;
/** ...or this share of the spread of the `on` centres, whichever is larger. _(proposal)_ */
export const FIT_CENTRE_SLACK_SHARE = 0.1;
/** A patch at least this flat has a normal the fit trusts. _(proposal)_ */
export const FLAT_MIN = 0.5;
/** A flat pair's normals may fail to oppose by this much and the fit still holds. _(proposal)_ */
export const FIT_NORMAL_SLACK_DEG = 15;
/** `fitMeeting` on the largest corpus pair, development PC, Node; placing the vertices excluded. _(proposal)_ */
export const FIT_BUDGET_MS = 50;

const NORMAL_SLACK_COS = Math.cos((FIT_NORMAL_SLACK_DEG * Math.PI) / 180);

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const negate = (a: Vec3): Vec3 => [0 - a[0], 0 - a[1], 0 - a[2]];

/** Each pair's weight: the smaller of its two areas (1 each when every area is zero). */
function weightsOf(pairs: readonly FitPair[]): number[] {
  const weights = pairs.map(({ on, of }) => Math.min(on.areaMm2, of.areaMm2));
  return weights.some((w) => w > 0) ? weights : pairs.map(() => 1);
}

function weightedCentre(points: readonly Vec3[], weights: readonly number[]): Vec3 {
  let total = 0;
  let sum: Vec3 = [0, 0, 0];
  points.forEach((p, k) => {
    sum = add(sum, scale(p, weights[k]!));
    total += weights[k]!;
  });
  return scale(sum, 1 / total);
}

/** The translation that puts the turned weighted `of` centre on the weighted `on` centre. */
function translationFor(rotation: Rotation, pairs: readonly FitPair[], weights: number[]): Vec3 {
  const on = weightedCentre(
    pairs.map((pair) => pair.on.centre),
    weights,
  );
  const of = weightedCentre(
    pairs.map((pair) => pair.of.centre),
    weights,
  );
  return sub(on, apply(rotation, of));
}

/**
 * The turn about `up` that best lays the `of` centres on the `on` centres, each about its weighted
 * centre and across `up`: the angle's cosine and sine from the weighted sums, the half angle by
 * the half-angle formulas. Identity when the sums vanish.
 */
function uprightTurn(pairs: readonly FitPair[], weights: number[], up: Vec3): Rotation {
  const u = normalise(up);
  const onC = weightedCentre(
    pairs.map((pair) => pair.on.centre),
    weights,
  );
  const ofC = weightedCentre(
    pairs.map((pair) => pair.of.centre),
    weights,
  );
  let c = 0;
  let s = 0;
  pairs.forEach(({ on, of }, k) => {
    const a = sub(of.centre, ofC);
    const b = sub(on.centre, onC);
    const aa = sub(a, scale(u, dot(a, u)));
    const bb = sub(b, scale(u, dot(b, u)));
    c += weights[k]! * dot(aa, bb);
    // (a × b) · u
    s +=
      weights[k]! *
      ((aa[1] * bb[2] - aa[2] * bb[1]) * u[0] +
        (aa[2] * bb[0] - aa[0] * bb[2]) * u[1] +
        (aa[0] * bb[1] - aa[1] * bb[0]) * u[2]);
  });
  const length = Math.sqrt(c * c + s * s);
  if (length === 0) return IDENTITY;
  const cos = c / length;
  const half = Math.sqrt((1 + cos) / 2);
  const sinHalf = (s < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (1 - cos) / 2));
  return [u[0] * sinHalf, u[1] * sinHalf, u[2] * sinHalf, half];
}

/**
 * The largest eigenvector of a symmetric 4 × 4 matrix (row-major), by cyclic Jacobi sweeps:
 * each rotation from + - * / and sqrt only.
 */
export function largestEigenvector(matrix: readonly number[]): [number, number, number, number] {
  const a = matrix.slice();
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const at = (i: number, j: number): number => a[i * 4 + j]!;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += at(i, j) * at(i, j);
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        const apq = at(p, q);
        if (apq === 0) continue;
        const theta = (at(q, q) - at(p, p)) / (2 * apq);
        const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = at(k, p);
          const akq = at(k, q);
          a[k * 4 + p] = c * akp - s * akq;
          a[k * 4 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = at(p, k);
          const aqk = at(q, k);
          a[p * 4 + k] = c * apk - s * aqk;
          a[q * 4 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k * 4 + p]!;
          const vkq = v[k * 4 + q]!;
          v[k * 4 + p] = c * vkp - s * vkq;
          v[k * 4 + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 4; k++) if (at(k, k) > at(best, best)) best = k;
  return [v[best]!, v[4 + best]!, v[8 + best]!, v[12 + best]!];
}

/**
 * The rotation that best takes the directions `from[k]` onto `to[k]` with weights (Horn's closed
 * form: the largest eigenvector of his 4 × 4 matrix).
 */
function hornRotation(from: readonly Vec3[], to: readonly Vec3[], weights: number[]): Rotation {
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  from.forEach((a, k) => {
    const b = to[k]!;
    const w = weights[k]!;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j]! += w * a[i]! * b[j]!;
  });
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [w, x, y, z] = largestEigenvector([
    xx + yy + zz,
    yz - zy,
    zx - xz,
    xy - yx,
    yz - zy,
    xx - yy - zz,
    xy + yx,
    zx + xz,
    zx - xz,
    xy + yx,
    yy - xx - zz,
    yz + zy,
    xy - yx,
    zx + xz,
    yz + zy,
    zz - xx - yy,
  ]);
  const length = Math.sqrt(w * w + x * x + y * y + z * z);
  const sign = w < 0 ? -1 : 1;
  return [(sign * x) / length, (sign * y) / length, (sign * z) / length, (sign * w) / length];
}

/** The free turn (§5.4 candidate 3): one pair by its normals, several by Horn over centres and normals. */
function freeTurn(pairs: readonly FitPair[], weights: number[]): Rotation {
  if (pairs.length === 1) {
    const { on, of } = pairs[0]!;
    // One patch that wraps around has no normal to turn by.
    if (on.flatness < FLAT_MIN || of.flatness < FLAT_MIN) return IDENTITY;
    return fromTo(of.normal, negate(on.normal));
  }
  const onC = weightedCentre(
    pairs.map((pair) => pair.on.centre),
    weights,
  );
  const ofC = weightedCentre(
    pairs.map((pair) => pair.of.centre),
    weights,
  );
  const from: Vec3[] = [];
  const to: Vec3[] = [];
  const w: number[] = [];
  pairs.forEach(({ on, of }, k) => {
    from.push(sub(of.centre, ofC));
    to.push(sub(on.centre, onC));
    w.push(weights[k]!);
    from.push(scale(of.normal, FIT_NORMAL_LEVER_MM));
    to.push(scale(negate(on.normal), FIT_NORMAL_LEVER_MM));
    w.push(weights[k]! * on.flatness * of.flatness);
  });
  return hornRotation(from, to, w);
}

/** How well a rotation and translation fit the pairs. */
function measure(
  pairs: readonly FitPair[],
  weights: number[],
  rotation: Rotation,
  translation: Vec3,
): { centreRmsMm: number; normalsDeg: number; normalsHold: boolean } {
  let sum = 0;
  let total = 0;
  let worst = 1;
  pairs.forEach(({ on, of }, k) => {
    const d = sub(add(apply(rotation, of.centre), translation), on.centre);
    sum += weights[k]! * dot(d, d);
    total += weights[k]!;
    if (on.flatness >= FLAT_MIN && of.flatness >= FLAT_MIN) {
      const agreement = dot(apply(rotation, of.normal), negate(on.normal));
      if (agreement < worst) worst = agreement;
    }
  });
  return {
    centreRmsMm: Math.sqrt(sum / total),
    normalsDeg: (Math.acos(Math.max(-1, Math.min(1, worst))) * 180) / Math.PI,
    normalsHold: worst >= NORMAL_SLACK_COS,
  };
}

/** The weighted rms distance of the `on` centres from their weighted centre. */
function spreadOf(pairs: readonly FitPair[], weights: number[]): number {
  const c = weightedCentre(
    pairs.map((pair) => pair.on.centre),
    weights,
  );
  let sum = 0;
  let total = 0;
  pairs.forEach(({ on }, k) => {
    const d = sub(on.centre, c);
    sum += weights[k]! * dot(d, d);
    total += weights[k]!;
  });
  return Math.sqrt(sum / total);
}

/**
 * The least change that brings the `of` patches onto the `on` patches (§5.4): moved only, else
 * also turned about `up` (with `up` and two or more pairs), else turned freely; the first that
 * fits is taken, else the free turn. `turn: 'keep'` only moves, `turn: 'free'` turns freely.
 * The result takes a point `x` of the part as it stands now to `rotation · x + translation`.
 *
 * @param pairs At least one; `on` in the target frame, `of` as the part stands now, same frame.
 * @param options `up`: the base's up, for the figure on its base only.
 */
export function fitMeeting(
  pairs: readonly FitPair[],
  options: { up?: Vec3; turn?: 'keep' | 'free' } = {},
): { rotation: Rotation; translation: Vec3; fit: Fit } {
  const weights = weightsOf(pairs);
  const slack = Math.max(FIT_CENTRE_SLACK_MM, FIT_CENTRE_SLACK_SHARE * spreadOf(pairs, weights));
  const candidate = (
    kept: Fit['kept'],
    rotation: Rotation,
  ): { rotation: Rotation; translation: Vec3; fit: Fit; fits: boolean } => {
    const translation = translationFor(rotation, pairs, weights);
    const { centreRmsMm, normalsDeg, normalsHold } = measure(pairs, weights, rotation, translation);
    return {
      rotation,
      translation,
      fit: { kept, centreRmsMm, normalsDeg },
      fits: normalsHold && centreRmsMm <= slack,
    };
  };
  const strip = ({
    rotation,
    translation,
    fit,
  }: ReturnType<typeof candidate>): ReturnType<typeof fitMeeting> => ({
    rotation,
    translation,
    fit,
  });
  const standing = candidate('standing', IDENTITY);
  if (options.turn === 'keep') return strip(standing);
  const free = (): ReturnType<typeof candidate> => {
    const rotation = freeTurn(pairs, weights);
    // A turn that is no turn (one pair that wraps around) is the standing fit.
    return rotation === IDENTITY ? standing : candidate('free', rotation);
  };
  if (options.turn === 'free') return strip(free());
  if (standing.fits) return strip(standing);
  if (options.up && pairs.length >= 2) {
    const upright = candidate('upright', uprightTurn(pairs, weights, options.up));
    if (upright.fits) return strip(upright);
  }
  return strip(free());
}

/**
 * A fit with the person's nudges (§5.4): raised by `liftMm` along `a`, the normalised weighted
 * sum of the `on` normals (`fallbackUp` when it vanishes), and turned by `turnDeg` about `a`
 * through the weighted `on` centre `p`: `x ↦ W · (R·x + t − p) + p + liftMm × a`.
 */
export function nudged(
  fitted: { rotation: Rotation; translation: Vec3 },
  pairs: readonly FitPair[],
  liftMm: number,
  turnDeg: number,
  fallbackUp: Vec3 = [0, 1, 0],
): { rotation: Rotation; translation: Vec3; axis: Vec3; pivot: Vec3 } {
  const weights = weightsOf(pairs);
  let sum: Vec3 = [0, 0, 0];
  pairs.forEach(({ on }, k) => {
    sum = add(sum, scale(on.normal, weights[k]!));
  });
  const length = Math.sqrt(dot(sum, sum));
  const axis = length > 1e-9 ? scale(sum, 1 / length) : normalise(fallbackUp);
  const pivot = weightedCentre(
    pairs.map((pair) => pair.on.centre),
    weights,
  );
  if (liftMm === 0 && turnDeg === 0) return { ...fitted, axis, pivot };
  const W = turnDeg === 0 ? IDENTITY : fromAxisAngle(axis, turnDeg);
  const moved = apply(W, sub(fitted.translation, pivot));
  return {
    rotation: turnDeg === 0 ? fitted.rotation : multiply(W, fitted.rotation),
    translation: add(add(moved, pivot), scale(axis, liftMm)),
    axis,
    pivot,
  };
}
