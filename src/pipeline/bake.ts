import { TriangleBvh, type SurfaceHit } from './bvh';
import { cavityToByte } from './look';
import type { IndexedMesh } from './mesh';
import { computeCavity } from './shade';

/**
 * Transfers fine detail from the full sculpt onto the texture of a reduced, unwrapped mesh.
 * For every texel it finds the point on the reduced surface, then the closest point on the
 * sculpt's own surface (through a BVH), and stores the sculpt's normal and cavity there,
 * interpolated across the sculpt triangle that was hit.
 *
 * Normals are stored in object space: that needs no tangent frames, and minis are rigid.
 * (glTF only knows tangent-space maps, so an export needs a conversion step later.)
 */
export interface BakedMaps {
  resolution: number;
  /** RGBA per texel: object-space normal in RGB as (n + 1) / 2, alpha 255 where baked. */
  normal: Uint8Array;
  /** One byte per texel, see `cavityToByte`. */
  cavity: Uint8Array;
  /** One byte per texel, 0 (buried) to 255 (open), interpolated from the reduced mesh's vertices. */
  occlusion: Uint8Array;
  /** Share of texels that lie inside a UV island. */
  coverage: number;
  /** Share of covered texels for which no sculpt surface was found within reach. */
  fallback: number;
  /** Building the search tree over the sculpt: time and memory. */
  bvhBuildMs: number;
  bvhBytes: number;
}

/** Neighbour-averaging passes on the sculpt's cavity before it is baked. */
const SCULPT_CAVITY_SMOOTHING = 3;
/** Sculpt vertices facing away from the reduced surface belong to another layer (inside of a cloak). */
const MIN_NORMAL_AGREEMENT = 0.2;
/**
 * How far from the reduced surface the sculpt is searched, in mm. The reduced levels stay
 * within about 0.35 mm of the sculpt; more reach only invites answers from a neighbouring part.
 */
const SEARCH_MM = 1;
/** Rings of texels filled in around every island, so filtering never reads an empty texel. */
const DILATION = 4;

/**
 * `reduced` must have normals, occlusion and uvs; `sculpt` must have normals. Both must be
 * in the same coordinate system.
 */
export function bake(reduced: IndexedMesh, sculpt: IndexedMesh, resolution: number): BakedMaps {
  if (!reduced.uvs || !reduced.normals || !sculpt.normals) {
    throw new Error('Baking needs an unwrapped mesh with normals and a sculpt with normals');
  }
  const texels = resolution * resolution;
  const normal = new Uint8Array(texels * 4);
  const cavity = new Uint8Array(texels).fill(cavityToByte(0));
  const occlusion = new Uint8Array(texels).fill(255);

  const sculptCavity = computeCavity(sculpt, SCULPT_CAVITY_SMOOTHING);
  const bvhStart = performance.now();
  const bvh = new TriangleBvh(sculpt);
  const bvhBuildMs = performance.now() - bvhStart;
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
  const facing = { nx: 0, ny: 0, nz: 0, minAgreement: MIN_NORMAL_AGREEMENT };
  // Neighbouring texels usually land on the same or a nearby sculpt triangle; trying the
  // last answer first gives the search a tight bound from the start.
  let hint = -1;

  const { positions, indices, uvs } = reduced;
  const normals = reduced.normals;
  let covered = 0;
  let fallback = 0;

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]!;
    const ib = indices[t + 1]!;
    const ic = indices[t + 2]!;
    const ax = uvs[ia * 2]! * resolution;
    const ay = uvs[ia * 2 + 1]! * resolution;
    const bx = uvs[ib * 2]! * resolution;
    const by = uvs[ib * 2 + 1]! * resolution;
    const cx = uvs[ic * 2]! * resolution;
    const cy = uvs[ic * 2 + 1]! * resolution;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;

    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(resolution - 1, Math.ceil(Math.max(ax, bx, cx) + 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(resolution - 1, Math.ceil(Math.max(ay, by, cy) + 0.5));
    // Texels whose centre is just outside still get filled: half a texel of slack, in barycentric units.
    const slack = 0.75 / Math.sqrt(Math.abs(area));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let wb = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / area;
        let wc = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / area;
        let wa = 1 - wb - wc;
        if (wa < -slack || wb < -slack || wc < -slack) continue;
        const texel = y * resolution + x;
        const inside = wa >= 0 && wb >= 0 && wc >= 0;
        // A texel already owned by the triangle it truly lies in is not overwritten by a neighbour's slack.
        if (normal[texel * 4 + 3] === 255 && !inside) continue;
        if (normal[texel * 4 + 3] === 0) covered++;
        wa = Math.max(0, wa);
        wb = Math.max(0, wb);
        wc = Math.max(0, wc);
        const sum = wa + wb + wc;
        wa /= sum;
        wb /= sum;
        wc /= sum;

        const sx = positions[ia * 3]! * wa + positions[ib * 3]! * wb + positions[ic * 3]! * wc;
        const sy =
          positions[ia * 3 + 1]! * wa + positions[ib * 3 + 1]! * wb + positions[ic * 3 + 1]! * wc;
        const sz =
          positions[ia * 3 + 2]! * wa + positions[ib * 3 + 2]! * wb + positions[ic * 3 + 2]! * wc;
        const nx = normals[ia * 3]! * wa + normals[ib * 3]! * wb + normals[ic * 3]! * wc;
        const ny =
          normals[ia * 3 + 1]! * wa + normals[ib * 3 + 1]! * wb + normals[ic * 3 + 1]! * wc;
        const nz =
          normals[ia * 3 + 2]! * wa + normals[ib * 3 + 2]! * wb + normals[ic * 3 + 2]! * wc;

        facing.nx = nx;
        facing.ny = ny;
        facing.nz = nz;
        bvh.closest(hit, sx, sy, sz, SEARCH_MM * SEARCH_MM, facing, hint);

        let ox = nx;
        let oy = ny;
        let oz = nz;
        if (hit.triangle < 0) {
          // No sculpt surface within reach: keep the reduced mesh's own normal.
          fallback++;
        } else {
          hint = hit.triangle;
          const sa = sculpt.indices[hit.triangle * 3]!;
          const sb = sculpt.indices[hit.triangle * 3 + 1]!;
          const sc = sculpt.indices[hit.triangle * 3 + 2]!;
          ox =
            sculpt.normals[sa * 3]! * hit.u +
            sculpt.normals[sb * 3]! * hit.v +
            sculpt.normals[sc * 3]! * hit.w;
          oy =
            sculpt.normals[sa * 3 + 1]! * hit.u +
            sculpt.normals[sb * 3 + 1]! * hit.v +
            sculpt.normals[sc * 3 + 1]! * hit.w;
          oz =
            sculpt.normals[sa * 3 + 2]! * hit.u +
            sculpt.normals[sb * 3 + 2]! * hit.v +
            sculpt.normals[sc * 3 + 2]! * hit.w;
          cavity[texel] = cavityToByte(
            sculptCavity[sa]! * hit.u + sculptCavity[sb]! * hit.v + sculptCavity[sc]! * hit.w,
          );
        }
        const length = Math.hypot(ox, oy, oz) || 1;
        normal[texel * 4] = Math.round((ox / length / 2 + 0.5) * 255);
        normal[texel * 4 + 1] = Math.round((oy / length / 2 + 0.5) * 255);
        normal[texel * 4 + 2] = Math.round((oz / length / 2 + 0.5) * 255);
        normal[texel * 4 + 3] = 255;
        if (reduced.occlusion) {
          occlusion[texel] = Math.round(
            (reduced.occlusion[ia]! * wa +
              reduced.occlusion[ib]! * wb +
              reduced.occlusion[ic]! * wc) *
              255,
          );
        }
      }
    }
  }

  dilate(resolution, normal, cavity, occlusion);
  return {
    resolution,
    normal,
    cavity,
    occlusion,
    coverage: covered / texels,
    fallback: covered > 0 ? fallback / covered : 0,
    bvhBuildMs,
    bvhBytes: bvh.byteLength,
  };
}

/** Grows every island outwards by copying border texels into empty neighbours. */
function dilate(
  resolution: number,
  normal: Uint8Array,
  cavity: Uint8Array,
  occlusion: Uint8Array,
): void {
  let filled = new Uint8Array(resolution * resolution);
  for (let texel = 0; texel < filled.length; texel++)
    filled[texel] = normal[texel * 4 + 3] === 255 ? 1 : 0;

  for (let pass = 0; pass < DILATION; pass++) {
    const next = filled.slice();
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const texel = y * resolution + x;
        if (filled[texel]) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= resolution || sy >= resolution) continue;
          const from = sy * resolution + sx;
          if (!filled[from]) continue;
          normal.copyWithin(texel * 4, from * 4, from * 4 + 3);
          cavity[texel] = cavity[from]!;
          occlusion[texel] = occlusion[from]!;
          next[texel] = 1;
          break;
        }
      }
    }
    filled = next;
  }
  // Alpha marked "baked" during rasterising; the finished map is opaque everywhere.
  for (let texel = 0; texel < filled.length; texel++) normal[texel * 4 + 3] = 255;
}
