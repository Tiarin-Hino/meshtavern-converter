import { cavityToByte } from './look';
import type { IndexedMesh } from './mesh';
import { computeCavity } from './shade';

/**
 * Transfers fine detail from the full sculpt onto the texture of a reduced, unwrapped mesh.
 * For every texel it finds the point on the reduced surface, looks up the nearest vertices
 * of the full sculpt, and stores their blended normal and cavity.
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
  /** Share of covered texels for which no sculpt vertex was close enough (flat areas). */
  fallback: number;
}

/** Neighbour-averaging passes on the sculpt's cavity before it is baked. */
const SCULPT_CAVITY_SMOOTHING = 3;
/** Sculpt vertices facing away from the reduced surface belong to another layer (inside of a cloak). */
const MIN_NORMAL_AGREEMENT = 0.2;
/** Grid cell size as a multiple of the sculpt's average vertex spacing. */
const CELL_SPACING = 2.5;
/** Rings of texels filled in around every island, so filtering never reads an empty texel. */
const DILATION = 4;

/** Spatial hash over vertices: all vertices of a cell sit next to each other in `items`. */
class VertexGrid {
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  private readonly mask: number;
  readonly cell: number;

  constructor(
    private readonly positions: Float32Array,
    cell: number,
  ) {
    this.cell = cell;
    const count = positions.length / 3;
    let size = 1024;
    while (size < count * 2) size *= 2;
    this.mask = size - 1;
    this.start = new Uint32Array(size + 1);
    const keys = new Uint32Array(count);
    for (let v = 0; v < count; v++) {
      keys[v] = this.key(
        Math.floor(positions[v * 3]! / cell),
        Math.floor(positions[v * 3 + 1]! / cell),
        Math.floor(positions[v * 3 + 2]! / cell),
      );
      this.start[keys[v]! + 1] = this.start[keys[v]! + 1]! + 1;
    }
    for (let k = 0; k < size; k++) this.start[k + 1] = this.start[k + 1]! + this.start[k]!;
    const cursor = this.start.slice(0, size);
    this.items = new Uint32Array(count);
    for (let v = 0; v < count; v++) {
      this.items[cursor[keys[v]!]!] = v;
      cursor[keys[v]!] = cursor[keys[v]!]! + 1;
    }
  }

  private key(x: number, y: number, z: number): number {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
  }

  /** Calls `visit` for every vertex in the 27 cells around the point. Hash collisions add far vertices; callers filter by distance. */
  near(
    x: number,
    y: number,
    z: number,
    visit: (vertex: number, distanceSquared: number) => void,
  ): void {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = this.key(cx + dx, cy + dy, cz + dz);
          for (let i = this.start[bucket]!; i < this.start[bucket + 1]!; i++) {
            const v = this.items[i]!;
            const px = this.positions[v * 3]! - x;
            const py = this.positions[v * 3 + 1]! - y;
            const pz = this.positions[v * 3 + 2]! - z;
            visit(v, px * px + py * py + pz * pz);
          }
        }
      }
    }
  }
}

function surfaceArea({ positions, indices }: IndexedMesh): number {
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
  const sculptVertices = sculpt.positions.length / 3;
  const spacing = Math.sqrt(surfaceArea(sculpt) / Math.max(1, sculptVertices));
  const grid = new VertexGrid(sculpt.positions, Math.max(spacing * CELL_SPACING, 1e-4));
  const reach = grid.cell * grid.cell;

  const { positions, indices, uvs } = reduced;
  const normals = reduced.normals;
  let covered = 0;
  let fallback = 0;

  // The three nearest agreeing sculpt vertices, kept across the visit callback.
  const best = new Int32Array(3);
  const bestDistance = new Float64Array(3);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const visit = (vertex: number, distance: number): void => {
    if (distance >= bestDistance[2]! || distance > reach) return;
    const agreement =
      sculpt.normals![vertex * 3]! * nx +
      sculpt.normals![vertex * 3 + 1]! * ny +
      sculpt.normals![vertex * 3 + 2]! * nz;
    if (agreement < MIN_NORMAL_AGREEMENT) return;
    let slot = 2;
    while (slot > 0 && bestDistance[slot - 1]! > distance) {
      best[slot] = best[slot - 1]!;
      bestDistance[slot] = bestDistance[slot - 1]!;
      slot--;
    }
    best[slot] = vertex;
    bestDistance[slot] = distance;
  };

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
        nx = normals[ia * 3]! * wa + normals[ib * 3]! * wb + normals[ic * 3]! * wc;
        ny = normals[ia * 3 + 1]! * wa + normals[ib * 3 + 1]! * wb + normals[ic * 3 + 1]! * wc;
        nz = normals[ia * 3 + 2]! * wa + normals[ib * 3 + 2]! * wb + normals[ic * 3 + 2]! * wc;

        bestDistance.fill(Infinity);
        best.fill(-1);
        grid.near(sx, sy, sz, visit);

        let ox = 0;
        let oy = 0;
        let oz = 0;
        let cavitySum = 0;
        let weightSum = 0;
        for (let k = 0; k < 3 && best[k]! >= 0; k++) {
          const weight = 1 / (bestDistance[k]! + spacing * spacing * 0.05);
          const v = best[k]!;
          ox += sculpt.normals[v * 3]! * weight;
          oy += sculpt.normals[v * 3 + 1]! * weight;
          oz += sculpt.normals[v * 3 + 2]! * weight;
          cavitySum += sculptCavity[v]! * weight;
          weightSum += weight;
        }
        if (weightSum === 0) {
          // Nothing of the sculpt nearby: a large flat face. The reduced mesh's own normal is right there.
          ox = nx;
          oy = ny;
          oz = nz;
          fallback++;
        } else {
          cavity[texel] = cavityToByte(cavitySum / weightSum);
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
