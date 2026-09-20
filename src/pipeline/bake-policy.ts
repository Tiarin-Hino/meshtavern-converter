import type { IndexedMesh } from './mesh';

/**
 * How large a baked mini's detail texture should be. A texture only helps while its texels
 * are finer than what the reduced mesh already shows, and every step up costs four times
 * the memory, so the size follows the mini's surface area: the texture gets just enough
 * texels to reach the target size on the surface.
 */

/** Texel size to aim for on the mini's surface, in mm. Finer than this is not visible in play. */
export const TARGET_TEXEL_MM = 0.1;
/** Share of a texture that xatlas's islands actually cover on organic sculpts (measured: 41–56 %). */
export const ISLAND_COVERAGE = 0.5;
/** Sizes on offer, smallest first. */
export const DETAIL_RESOLUTIONS = [512, 1024, 2048] as const;
export type DetailResolution = (typeof DETAIL_RESOLUTIONS)[number];

export function surfaceAreaMm2({ positions, indices }: IndexedMesh): number {
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

/** The smallest size whose texels reach the target on a surface of this area; the largest if none does. */
export function detailResolutionFor(areaMm2: number): DetailResolution {
  const needed = Math.sqrt(areaMm2 / ISLAND_COVERAGE) / TARGET_TEXEL_MM;
  return (
    DETAIL_RESOLUTIONS.find((size) => size >= needed) ??
    DETAIL_RESOLUTIONS[DETAIL_RESOLUTIONS.length - 1]!
  );
}
