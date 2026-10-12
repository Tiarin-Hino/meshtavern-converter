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
  /**
   * One RGBA texture: the sculpt's object-space normal in RGB as (n + 1) / 2, and its fine
   * cavity in alpha (see `cavityToByte`). Everything a baked mini needs on the GPU: the look
   * is computed from it in the shader, and the coarse occlusion stays on the vertices.
   */
  detail: Uint8Array;
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
export const MIN_NORMAL_AGREEMENT = 0.2;
/**
 * How far from the reduced surface the sculpt is searched, in mm. The reduced levels stay
 * within about 0.35 mm of the sculpt; more reach only invites answers from a neighbouring part.
 */
const SEARCH_MM = 1;
/** Rings of texels filled in around every island, so filtering never reads an empty texel. */
const DILATION = 4;

/**
 * `reduced` must have normals and uvs; `sculpt` must have normals. Both must be
 * in the same coordinate system.
 */
export function bake(reduced: IndexedMesh, sculpt: IndexedMesh, resolution: number): BakedMaps {
  if (!reduced.uvs || !reduced.normals || !sculpt.normals) {
    throw new Error('Baking needs an unwrapped mesh with normals and a sculpt with normals');
  }
  const texels = resolution * resolution;
  const detail = new Uint8Array(texels * 4);
  // Texels outside every island: a neutral normal (+z) and flat cavity.
  for (let texel = 0; texel < texels; texel++) {
    detail[texel * 4] = 128;
    detail[texel * 4 + 1] = 128;
    detail[texel * 4 + 2] = 255;
    detail[texel * 4 + 3] = cavityToByte(0);
  }
  const sculptCavity = computeCavity(sculpt, SCULPT_CAVITY_SMOOTHING);
  const bvhStart = performance.now();
  const bvh = new TriangleBvh(sculpt);
  const bvhBuildMs = performance.now() - bvhStart;
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
  const facing = { nx: 0, ny: 0, nz: 0, minAgreement: MIN_NORMAL_AGREEMENT };
  // Neighbouring texels usually land on the same or a nearby sculpt triangle; trying the
  // last answer first gives the search a tight bound from the start.
  let hint = -1;

  const { positions } = reduced;
  const normals = reduced.normals;
  // Narrowed here: the walk's callback does not keep the checks above.
  const sculptNormals = sculpt.normals;
  let fallback = 0;

  const { written, covered } = forEachIslandTexel(
    reduced,
    resolution,
    (texel, ia, ib, ic, wa, wb, wc) => {
      const sx = positions[ia * 3]! * wa + positions[ib * 3]! * wb + positions[ic * 3]! * wc;
      const sy =
        positions[ia * 3 + 1]! * wa + positions[ib * 3 + 1]! * wb + positions[ic * 3 + 1]! * wc;
      const sz =
        positions[ia * 3 + 2]! * wa + positions[ib * 3 + 2]! * wb + positions[ic * 3 + 2]! * wc;
      const nx = normals[ia * 3]! * wa + normals[ib * 3]! * wb + normals[ic * 3]! * wc;
      const ny = normals[ia * 3 + 1]! * wa + normals[ib * 3 + 1]! * wb + normals[ic * 3 + 1]! * wc;
      const nz = normals[ia * 3 + 2]! * wa + normals[ib * 3 + 2]! * wb + normals[ic * 3 + 2]! * wc;

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
          sculptNormals[sa * 3]! * hit.u +
          sculptNormals[sb * 3]! * hit.v +
          sculptNormals[sc * 3]! * hit.w;
        oy =
          sculptNormals[sa * 3 + 1]! * hit.u +
          sculptNormals[sb * 3 + 1]! * hit.v +
          sculptNormals[sc * 3 + 1]! * hit.w;
        oz =
          sculptNormals[sa * 3 + 2]! * hit.u +
          sculptNormals[sb * 3 + 2]! * hit.v +
          sculptNormals[sc * 3 + 2]! * hit.w;
        detail[texel * 4 + 3] = cavityToByte(
          sculptCavity[sa]! * hit.u + sculptCavity[sb]! * hit.v + sculptCavity[sc]! * hit.w,
        );
      }
      const length = Math.hypot(ox, oy, oz) || 1;
      detail[texel * 4] = Math.round((ox / length / 2 + 0.5) * 255);
      detail[texel * 4 + 1] = Math.round((oy / length / 2 + 0.5) * 255);
      detail[texel * 4 + 2] = Math.round((oz / length / 2 + 0.5) * 255);
    },
  );

  dilate(resolution, detail, written);
  return {
    resolution,
    detail,
    coverage: covered / texels,
    fallback: covered > 0 ? fallback / covered : 0,
    bvhBuildMs,
    bvhBytes: bvh.byteLength,
  };
}

/** What `forEachIslandTexel` calls per texel: the triangle's corners and the texel centre's weights, clamped and summing to 1. */
export type TexelVisit = (
  texel: number,
  ia: number,
  ib: number,
  ic: number,
  wa: number,
  wb: number,
  wc: number,
) => void;

/**
 * Walks every texel of a mesh's UV islands at `resolution`, triangle by triangle, and calls
 * `visit` with the point of the triangle at the texel's centre. Texels whose centre is just
 * outside a triangle are visited too (half a texel of slack, in barycentric units), so a sliver
 * that covers no texel centre still gets its texels; a texel already owned by the triangle it
 * truly lies in is not visited again for a neighbour's slack. The bake and the test brush
 * (`paintWhere` in paint.ts) fill the same texels this way. `written` is 1 for every texel
 * visited, `covered` how many there are.
 */
export function forEachIslandTexel(
  mesh: IndexedMesh,
  resolution: number,
  visit: TexelVisit,
): { written: Uint8Array; covered: number } {
  const { indices, uvs } = mesh;
  if (!uvs) throw new Error('Walking the texels needs the mesh’s texture coordinates');
  /** 0 = empty, 1 = written. */
  const written = new Uint8Array(resolution * resolution);
  let covered = 0;
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
        if (written[texel] === 1 && !inside) continue;
        if (written[texel] === 0) covered++;
        written[texel] = 1;
        wa = Math.max(0, wa);
        wb = Math.max(0, wb);
        wc = Math.max(0, wc);
        const sum = wa + wb + wc;
        wa /= sum;
        wb /= sum;
        wc /= sum;
        visit(texel, ia, ib, ic, wa, wb, wc);
      }
    }
  }
  return { written, covered };
}

/**
 * Grows every island outwards by copying border texels (RGBA, four bytes each) into empty
 * neighbours, `rings` texels deep: so filtering at an island's edge never reads an empty texel.
 */
export function dilate(
  resolution: number,
  data: Uint8Array,
  written: Uint8Array,
  rings = DILATION,
): void {
  let filled = written;
  for (let pass = 0; pass < rings; pass++) {
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
          data.copyWithin(texel * 4, from * 4, from * 4 + 4);
          next[texel] = 1;
          break;
        }
      }
    }
    filled = next;
  }
}
