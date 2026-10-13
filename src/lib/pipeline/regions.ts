import { MIN_NORMAL_AGREEMENT } from './bake';
import type { PaintRegions } from './brush';
import { TriangleBvh, type SurfaceHit } from './bvh';
import { DISC_HEIGHT_MAX_MM, TOP_CONE_DEG, type KindGuess } from './kind';
import type { IndexedMesh } from './mesh';
import type { Sizing } from './size';

/**
 * The fill's ready regions (issue #127, design note `docs/design/painting-engine.md` §7.2): which
 * triangles of the table level are the base, so a person can fill "the base" or "the figure" in
 * one tap. Found from what a conversion knows: the base file of a pair, the plain base the
 * converter added, or a base in the file whose top the kind guess saw.
 */

/**
 * A table-level vertex is on the base file's surface when the closest point there lies this
 * near, facing its way: the levels stay within 0.2 mm of the sculpt, as for the paint per vertex
 * (`PAINT_REACH_MM`). _(proposal)_
 */
export const REGION_REACH_MM = 1;
/** How far above a base's top a vertex may lie and still be the base's: float noise. _(proposal)_ */
export const REGION_BAND_MM = 0.05;
/** The height bands a base's top is looked for in, from the floor. _(proposal)_ */
export const BASE_TOP_BIN_MM = 0.5;

const TOP_CONE_COS = Math.cos((TOP_CONE_DEG * Math.PI) / 180);

/** What a conversion knows about the base: pass what the result has (`result.mesh`, `result.pair?.figureTriangles`, `result.sizing`, `result.kind`). */
export interface RegionSources {
  /** The full-detail mesh, the figure's triangles first: `result.mesh`. */
  source?: IndexedMesh;
  /** How many of `source`'s triangles are the figure's; the rest is the base file's (`result.pair.figureTriangles`). */
  figureTriangles?: number;
  sizing?: Sizing;
  kind?: KindGuess;
}

/**
 * The ready regions of `mesh` (the table level, `result.baked.mesh`), or null when no base was
 * found. In order: `pair`, where a base file came with the figure: a triangle is the base's when
 * its three corners each have a point of the base file's surface within `REGION_REACH_MM` facing
 * their way (so a foot's side above the base's top is not); `plain`, where the converter added
 * its plain base: the triangles at or below its height; `disc`, where the file has a base and the
 * kind guess saw its top: the band of `BASE_TOP_BIN_MM` within `DISC_HEIGHT_MAX_MM` of the floor
 * with the most upward-facing area is the top, and the triangles at or below it are the base's.
 */
export function regionsOf(mesh: IndexedMesh, about: RegionSources): PaintRegions | null {
  const { source, figureTriangles, sizing, kind } = about;
  if (source && figureTriangles !== undefined && figureTriangles * 3 < source.indices.length)
    return { base: onBaseFile(mesh, source, figureTriangles), method: 'pair' };
  if (sizing?.plainBase)
    return { base: atOrBelow(mesh, sizing.plainBase.heightMm), method: 'plain' };
  if (sizing?.base && kind?.reason === 'base-top') {
    const top = baseTop(mesh);
    if (top !== null) return { base: atOrBelow(mesh, top), method: 'disc' };
  }
  return null;
}

/** 1 for every triangle whose corners all lie on the base file's part of `source`. */
function onBaseFile(mesh: IndexedMesh, source: IndexedMesh, figureTriangles: number): Uint8Array {
  const baseFile: IndexedMesh = {
    positions: source.positions,
    indices: source.indices.subarray(figureTriangles * 3),
    normals: source.normals,
  };
  const bvh = new TriangleBvh(baseFile);
  const vertexCount = mesh.positions.length / 3;
  const onBase = new Uint8Array(vertexCount);
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
  const facing = { nx: 0, ny: 0, nz: 0, minAgreement: MIN_NORMAL_AGREEMENT };
  const withFacing = mesh.normals !== undefined && source.normals !== undefined;
  let hint = -1;
  for (let v = 0; v < vertexCount; v++) {
    if (withFacing) {
      facing.nx = mesh.normals![v * 3]!;
      facing.ny = mesh.normals![v * 3 + 1]!;
      facing.nz = mesh.normals![v * 3 + 2]!;
    }
    bvh.closest(
      hit,
      mesh.positions[v * 3]!,
      mesh.positions[v * 3 + 1]!,
      mesh.positions[v * 3 + 2]!,
      REGION_REACH_MM * REGION_REACH_MM,
      withFacing ? facing : null,
      hint,
    );
    if (hit.triangle < 0) continue;
    hint = hit.triangle;
    onBase[v] = 1;
  }
  const triangles = mesh.indices.length / 3;
  const base = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++)
    base[t] =
      onBase[mesh.indices[t * 3]!]! &
      onBase[mesh.indices[t * 3 + 1]!]! &
      onBase[mesh.indices[t * 3 + 2]!]!;
  return base;
}

/** 1 for every triangle whose corners all lie at or below `heightMm` (plus the band). */
function atOrBelow({ positions, indices }: IndexedMesh, heightMm: number): Uint8Array {
  const limit = heightMm + REGION_BAND_MM;
  const triangles = indices.length / 3;
  const base = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    base[t] =
      positions[indices[t * 3]! * 3 + 1]! <= limit &&
      positions[indices[t * 3 + 1]! * 3 + 1]! <= limit &&
      positions[indices[t * 3 + 2]! * 3 + 1]! <= limit
        ? 1
        : 0;
  }
  return base;
}

/**
 * The height of a base's top: of the bands of `BASE_TOP_BIN_MM` from the floor up to
 * `DISC_HEIGHT_MAX_MM`, the one with the most area of faces within `TOP_CONE_DEG` of up, and in
 * it the highest of those faces' centroids. Null when no face points up near the floor.
 */
function baseTop({ positions, indices }: IndexedMesh): number | null {
  let floor = Infinity;
  for (let i = 1; i < positions.length; i += 3) if (positions[i]! < floor) floor = positions[i]!;
  const bins = Math.ceil(DISC_HEIGHT_MAX_MM / BASE_TOP_BIN_MM);
  const area = new Float64Array(bins);
  const highest = new Float64Array(bins).fill(-Infinity);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const height = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3;
    const bin = Math.floor((height - floor) / BASE_TOP_BIN_MM);
    if (bin < 0 || bin >= bins) continue;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (ny <= 0 || ny * ny < TOP_CONE_COS * TOP_CONE_COS * (nx * nx + ny * ny + nz * nz)) continue;
    area[bin] = area[bin]! + ny / 2;
    if (height > highest[bin]!) highest[bin] = height;
  }
  let best = -1;
  for (let bin = 0; bin < bins; bin++)
    if (area[bin]! > 0 && (best < 0 || area[bin]! > area[best]!)) best = bin;
  return best < 0 ? null : highest[best]!;
}
