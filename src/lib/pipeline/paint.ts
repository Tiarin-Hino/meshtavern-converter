import { TriangleBvh, type SurfaceHit } from './bvh';
import type { IndexedMesh } from './mesh';

/**
 * Paint on a mini (issue #125): a colour texture under the look, made by the table
 * application. The paint replaces the base coat where it is painted; the wash still pools in
 * the creases and the edges still catch the light on top of it (`pointColour` in look.ts, the
 * baked material's GLSL). Only the table level has texture coordinates (`result.baked.mesh`), so
 * the far and close levels take their paint per vertex, sampled once from the texture here.
 */

/**
 * A paint texture as bytes: RGBA, four per texel, the colour in sRGB and alpha straight (not
 * premultiplied): 255 painted, 0 bare (the base coat shows). Laid out like the detail texture:
 * texel (x, y) covers texture coordinates (x / width .. (x + 1) / width, y / height ..), row 0 at
 * v = 0, so it is uploaded without flipping its rows.
 */
export interface Albedo {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * How far from the table level's surface a vertex of another level may lie and still take its
 * paint, in mm. The levels stay within 0.2 mm of the sculpt (LOD_SPECS); the bake searches as
 * far. _(proposal)_
 */
export const PAINT_REACH_MM = 1;
/** A vertex facing away from the surface found belongs to another layer (the inside of a cloak). */
const MIN_NORMAL_AGREEMENT = 0.2;
/** How far a sample is moved from a triangle's corner toward its middle, in texels. */
const SAMPLE_INSET = 1;

/**
 * The paint at every vertex of `mesh`, a level without texture coordinates of its own (the far
 * or close level), through the table level's: each vertex takes the closest point on `table`'s
 * surface (facing its way when both have normals) and the texel under that point's texture
 * coordinates. All levels are reduced from the same sculpt in the same frame, so the closest
 * point is the same place on the mini. RGBA bytes, four per vertex, as the texture's texels; a
 * vertex farther than PAINT_REACH_MM from the table level gets 0, 0, 0, 0 (bare).
 */
export function paintAtVertices(mesh: IndexedMesh, table: IndexedMesh, albedo: Albedo): Uint8Array {
  const uvs = table.uvs;
  if (!uvs) throw new Error('The paint is sampled through the table level’s texture coordinates');
  const { width, height, data } = albedo;
  if (data.length !== width * height * 4)
    throw new RangeError(`A ${width} × ${height} paint texture is ${width * height * 4} bytes`);
  const vertexCount = mesh.positions.length / 3;
  const paint = new Uint8Array(vertexCount * 4);
  const bvh = new TriangleBvh(table);
  const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
  const facing = { nx: 0, ny: 0, nz: 0, minAgreement: MIN_NORMAL_AGREEMENT };
  const withFacing = mesh.normals !== undefined && table.normals !== undefined;
  const reach = PAINT_REACH_MM * PAINT_REACH_MM;
  let hint = -1;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = mesh.positions[vertex * 3]!;
    const y = mesh.positions[vertex * 3 + 1]!;
    const z = mesh.positions[vertex * 3 + 2]!;
    if (withFacing) {
      facing.nx = mesh.normals![vertex * 3]!;
      facing.ny = mesh.normals![vertex * 3 + 1]!;
      facing.nz = mesh.normals![vertex * 3 + 2]!;
    }
    bvh.closest(hit, x, y, z, reach, withFacing ? facing : null, hint);
    if (hit.triangle < 0) continue;
    hint = hit.triangle;
    const ia = table.indices[hit.triangle * 3]!;
    const ib = table.indices[hit.triangle * 3 + 1]!;
    const ic = table.indices[hit.triangle * 3 + 2]!;
    // In texels. A vertex sits on its triangle's corner, so the texel under it may be the
    // gutter or a neighbouring island's: the point is moved up to SAMPLE_INSET texels toward the
    // triangle's middle, into its own island.
    let u = (uvs[ia * 2]! * hit.u + uvs[ib * 2]! * hit.v + uvs[ic * 2]! * hit.w) * width;
    let v =
      (uvs[ia * 2 + 1]! * hit.u + uvs[ib * 2 + 1]! * hit.v + uvs[ic * 2 + 1]! * hit.w) * height;
    const du = ((uvs[ia * 2]! + uvs[ib * 2]! + uvs[ic * 2]!) / 3) * width - u;
    const dv = ((uvs[ia * 2 + 1]! + uvs[ib * 2 + 1]! + uvs[ic * 2 + 1]!) / 3) * height - v;
    const step = Math.min(1, SAMPLE_INSET / (Math.hypot(du, dv) || 1));
    u += du * step;
    v += dv * step;
    // The texel the point lies in, not a blend: a blend would mix in the bare gutter at an island's edge.
    const tx = Math.min(width - 1, Math.max(0, Math.floor(u)));
    const ty = Math.min(height - 1, Math.max(0, Math.floor(v)));
    paint.set(data.subarray((ty * width + tx) * 4, (ty * width + tx) * 4 + 4), vertex * 4);
  }
  return paint;
}

/** Rings of texels a test paint is spread into around every island, as the bake does. */
const PAINT_DILATION = 2;
const EMPTY = 0;
const NEAR = 1;
const INSIDE = 2;

/**
 * A paint texture for tests and tooling: `colour` (RGBA bytes) on every texel of `table`'s islands
 * whose point on the surface passes `where`, bare elsewhere, spread PAINT_DILATION texels past
 * each island's edge. The table application paints its own; this one proves the paths.
 */
export function paintWhere(
  table: IndexedMesh,
  size: number,
  where: (x: number, y: number, z: number) => boolean,
  colour: readonly [number, number, number, number],
): Albedo {
  const uvs = table.uvs;
  if (!uvs) throw new Error('Painting needs the table level’s texture coordinates');
  const data = new Uint8Array(size * size * 4);
  /** EMPTY outside every island, else whether a triangle holds the texel's centre (painted or not). */
  const written = new Uint8Array(size * size);
  const { positions, indices } = table;
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const [ax, ay, bx, by, cx, cy] = corners.flatMap((i) => [
      uvs[i * 2]! * size,
      uvs[i * 2 + 1]! * size,
    ]) as [number, number, number, number, number, number];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) + 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) + 0.5));
    // As the bake: texels whose centre is just outside are painted too, so a sliver that covers
    // no texel centre still gets its texels; one inside a triangle is not taken by a neighbour.
    const slack = 0.75 / Math.sqrt(Math.abs(area));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let wb = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / area;
        let wc = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / area;
        let wa = 1 - wb - wc;
        if (wa < -slack || wb < -slack || wc < -slack) continue;
        const texel = y * size + x;
        const inside = wa >= 0 && wb >= 0 && wc >= 0;
        if (written[texel] === INSIDE || (written[texel] === NEAR && !inside)) continue;
        written[texel] = inside ? INSIDE : NEAR;
        wa = Math.max(0, wa);
        wb = Math.max(0, wb);
        wc = Math.max(0, wc);
        const sum = wa + wb + wc;
        const at = (axis: number): number =>
          (positions[corners[0]! * 3 + axis]! * wa +
            positions[corners[1]! * 3 + axis]! * wb +
            positions[corners[2]! * 3 + axis]! * wc) /
          sum;
        if (where(at(0), at(1), at(2))) data.set(colour, texel * 4);
        else data.fill(0, texel * 4, texel * 4 + 4);
      }
  }
  // Spread each island outward, so a texel that a vertex or a filter reads at the edge is the island's.
  for (let ring = 0; ring < PAINT_DILATION; ring++) {
    const before = written.slice();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const texel = y * size + x;
        if (before[texel] !== EMPTY) continue;
        search: for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= size || sy >= size || before[sy * size + sx] === EMPTY)
              continue;
            data.copyWithin(texel * 4, (sy * size + sx) * 4, (sy * size + sx) * 4 + 4);
            written[texel] = NEAR;
            break search;
          }
      }
  }
  return { width: size, height: size, data };
}
