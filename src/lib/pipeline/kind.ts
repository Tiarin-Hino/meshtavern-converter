import type { IndexedMesh } from './mesh';
import type { BaseMeasurement } from './size';

/**
 * Whether a mini is a character or a prop (issue #99, design note `docs/design/thumbnail-and-kind.md`):
 * a first guess the table shows on its switch, derived from the detected base.
 */

/**
 * A flat surface higher than this above the floor is the top of a prop, not of a base. Gaming
 * bases are 3 to 5 mm thick, a scenic topper raises the top to about 10. _(proposal)_
 */
export const DISC_HEIGHT_MAX_MM = 10;
/** A face counts as part of a base's top when its normal is within this angle of straight up. _(proposal)_ */
export const TOP_CONE_DEG = 30;
/** A base whose bare top covers at least this share of its outline carries something: a character. _(proposal)_ */
export const TOP_SHARE = 0.5;

const TOP_CONE_COS = Math.cos((TOP_CONE_DEG * Math.PI) / 180);

export type MiniKind = 'character' | 'prop';

export interface KindGuess {
  kind: MiniKind;
  method: 'guessed' | 'manual';
  /**
   * base-file: the mini came with a separate base file, so it is a figure made for a base.
   * no-base: no flat underside, so a figure made for a base it did not come with, or one that leans.
   * base-top: a flat top within DISC_HEIGHT_MAX_MM of the floor covers at least TOP_SHARE of the base's outline: a disc with something standing on it.
   * solid: a flat underside without such a top: the thing is its own base.
   * manual: the option said so.
   */
  reason: 'base-file' | 'no-base' | 'base-top' | 'solid' | 'manual';
  /** The share the base-top rule measured, null when the rule did not run. Kept so the corpus report can show how close a miss was. */
  topShare: number | null;
}

/** The area inside a base's outline as `measureBase` saw it: the circle, or the footprint's box. */
export function outlineAreaMm2(base: BaseMeasurement): number {
  if (base.shape === 'round') return Math.PI * (base.diameterMm / 2) ** 2;
  return base.footprintMm[0] * base.footprintMm[1];
}

/**
 * The share of the base's outline covered by bare top: the projected area of the faces within
 * `TOP_CONE_DEG` of up whose centroid lies within `DISC_HEIGHT_MAX_MM` of the floor, over
 * `outlineAreaMm2`. One pass over the triangles of a mesh standing Y-up, in mm.
 */
export function baseTopShare({ positions, indices }: IndexedMesh, base: BaseMeasurement): number {
  const outline = outlineAreaMm2(base);
  if (!(outline > 0)) return 0;
  let floor = Infinity;
  for (let i = 1; i < positions.length; i += 3) if (positions[i]! < floor) floor = positions[i]!;
  // The centroid within the band: the sum of the three heights within three times it.
  const limit = 3 * (floor + DISC_HEIGHT_MAX_MM);
  let topArea = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ay = positions[a + 1]!;
    const by = positions[b + 1]!;
    const cy = positions[c + 1]!;
    if (ay + by + cy > limit) continue;
    const ux = positions[b]! - positions[a]!;
    const uy = by - ay;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = cy - ay;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (ny <= 0) continue;
    // Within the cone: ny / |n| ≥ cos, without a square root.
    if (ny * ny < TOP_CONE_COS * TOP_CONE_COS * (nx * nx + ny * ny + nz * nz)) continue;
    // The projected area is half the cross product's vertical component.
    topArea += ny / 2;
  }
  return topArea / outline;
}

/**
 * The guess, in order: a separate base file makes a character; no base makes a character; a base
 * whose bare top covers `TOP_SHARE` of its outline makes a character; anything else on a flat
 * underside is a prop. `chosen` replaces the guess (the share is still measured when there is a
 * base, for the report).
 *
 * @param mesh The sized mesh, Y-up on the floor, in mm. A plain base the size step added is never
 *   scanned: without a measured base the pass does not run.
 * @param pair The pair's result when the mini came in several files.
 */
export function guessKind(
  mesh: IndexedMesh,
  base: BaseMeasurement | null,
  pair: { pairing: { baseFile: number | null } } | null,
  chosen?: MiniKind,
): KindGuess {
  if (chosen !== undefined) {
    const topShare = base ? baseTopShare(mesh, base) : null;
    return { kind: chosen, method: 'manual', reason: 'manual', topShare };
  }
  if (pair !== null && pair.pairing.baseFile !== null)
    return { kind: 'character', method: 'guessed', reason: 'base-file', topShare: null };
  if (base === null)
    return { kind: 'character', method: 'guessed', reason: 'no-base', topShare: null };
  const topShare = baseTopShare(mesh, base);
  return topShare >= TOP_SHARE
    ? { kind: 'character', method: 'guessed', reason: 'base-top', topShare }
    : { kind: 'prop', method: 'guessed', reason: 'solid', topShare };
}
