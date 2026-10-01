import type { Vec3 } from './base';
import type { IndexedMesh } from './mesh';

/**
 * Bounding volume hierarchy over a mesh's triangles, for "closest point on the surface"
 * queries. Built by sorting triangles along a Morton curve and halving the sorted range,
 * which is fast to build (no per-node sorting) and good enough for a static sculpt.
 */

const LEAF_SIZE = 6;
/**
 * Building a file's tree for the meet questions (#93) should take no longer per million
 * triangles, development PC, Node. `scripts/measure-fit.mjs` measures it. _(proposal)_
 */
export const TREE_BUDGET_MS_PER_M = 400;
const MORTON_BITS = 10;

export interface SurfaceHit {
  /** Triangle index (into `indices`, divided by 3). -1 when nothing was found. */
  triangle: number;
  /** Barycentric weights of the closest point, for the triangle's three corners. */
  u: number;
  v: number;
  w: number;
  distanceSquared: number;
}

/** Spreads the low 10 bits of `value` so that two zero bits follow each one. */
function spread(value: number): number {
  let x = value & 0x3ff;
  x = (x | (x << 16)) & 0x30000ff;
  x = (x | (x << 8)) & 0x300f00f;
  x = (x | (x << 4)) & 0x30c30c3;
  x = (x | (x << 2)) & 0x9249249;
  return x;
}

/** Sorts `items` by their 30-bit `keys`, three passes of ten bits. */
function radixSort(keys: Uint32Array, items: Uint32Array): Uint32Array {
  let from: Uint32Array = items;
  let to: Uint32Array = new Uint32Array(items.length);
  const counts = new Uint32Array(1024);
  for (let shift = 0; shift < 30; shift += 10) {
    counts.fill(0);
    for (let i = 0; i < from.length; i++) {
      const bucket = (keys[from[i]!]! >>> shift) & 1023;
      counts[bucket] = counts[bucket]! + 1;
    }
    let total = 0;
    for (let b = 0; b < 1024; b++) {
      const count = counts[b]!;
      counts[b] = total;
      total += count;
    }
    for (let i = 0; i < from.length; i++) {
      const bucket = (keys[from[i]!]! >>> shift) & 1023;
      to[counts[bucket]!] = from[i]!;
      counts[bucket] = counts[bucket]! + 1;
    }
    [from, to] = [to, from];
  }
  return from;
}

export class TriangleBvh {
  /** Triangle indices in tree order; a leaf owns a contiguous run. */
  private readonly order: Uint32Array;
  /** Six numbers per node: min x, y, z, max x, y, z. */
  private readonly bounds: Float32Array;
  /** Per node: first child (the second is first + 1), or -1 for a leaf. */
  private readonly child: Int32Array;
  private readonly first: Uint32Array;
  private readonly count: Uint32Array;
  private nodes = 0;
  private readonly stack = new Int32Array(128);

  constructor(private readonly mesh: IndexedMesh) {
    const { positions, indices } = mesh;
    const triangles = indices.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      if (positions[i]! < min[i % 3]!) min[i % 3] = positions[i]!;
      if (positions[i]! > max[i % 3]!) max[i % 3] = positions[i]!;
    }
    const scale = [0, 1, 2].map((axis) => {
      const extent = max[axis]! - min[axis]!;
      return extent > 0 ? ((1 << MORTON_BITS) - 1) / extent : 0;
    });

    const keys = new Uint32Array(triangles);
    const items = new Uint32Array(triangles);
    for (let t = 0; t < triangles; t++) {
      items[t] = t;
      let key = 0;
      for (let axis = 0; axis < 3; axis++) {
        const centre =
          (positions[indices[t * 3]! * 3 + axis]! +
            positions[indices[t * 3 + 1]! * 3 + axis]! +
            positions[indices[t * 3 + 2]! * 3 + axis]!) /
          3;
        key |= spread(Math.floor((centre - min[axis]!) * scale[axis]!)) << axis;
      }
      keys[t] = key;
    }
    this.order = radixSort(keys, items);

    const maxNodes = Math.max(1, 2 * Math.ceil(triangles / LEAF_SIZE) * 2);
    this.bounds = new Float32Array(maxNodes * 6);
    this.child = new Int32Array(maxNodes).fill(-1);
    this.first = new Uint32Array(maxNodes);
    this.count = new Uint32Array(maxNodes);
    if (triangles > 0) this.build(this.nodes++, 0, triangles);
  }

  private build(node: number, lo: number, hi: number): void {
    const { positions, indices } = this.mesh;
    this.first[node] = lo;
    this.count[node] = hi - lo;
    const b = node * 6;
    if (hi - lo <= LEAF_SIZE) {
      for (let axis = 0; axis < 3; axis++) {
        let low = Infinity;
        let high = -Infinity;
        for (let i = lo; i < hi; i++) {
          for (let corner = 0; corner < 3; corner++) {
            const value = positions[indices[this.order[i]! * 3 + corner]! * 3 + axis]!;
            if (value < low) low = value;
            if (value > high) high = value;
          }
        }
        this.bounds[b + axis] = low;
        this.bounds[b + 3 + axis] = high;
      }
      return;
    }
    const mid = (lo + hi) >> 1;
    const left = this.nodes;
    this.nodes += 2;
    this.child[node] = left;
    this.build(left, lo, mid);
    this.build(left + 1, mid, hi);
    for (let axis = 0; axis < 3; axis++) {
      this.bounds[b + axis] = Math.min(
        this.bounds[left * 6 + axis]!,
        this.bounds[left * 6 + 6 + axis]!,
      );
      this.bounds[b + 3 + axis] = Math.max(
        this.bounds[left * 6 + 3 + axis]!,
        this.bounds[left * 6 + 9 + axis]!,
      );
    }
  }

  /** Memory held by the tree, in bytes. */
  get byteLength(): number {
    return (
      this.order.byteLength +
      this.bounds.byteLength +
      this.child.byteLength +
      this.first.byteLength +
      this.count.byteLength
    );
  }

  private boxDistanceSquared(node: number, x: number, y: number, z: number): number {
    const b = node * 6;
    const dx = Math.max(this.bounds[b]! - x, 0, x - this.bounds[b + 3]!);
    const dy = Math.max(this.bounds[b + 1]! - y, 0, y - this.bounds[b + 4]!);
    const dz = Math.max(this.bounds[b + 2]! - z, 0, z - this.bounds[b + 5]!);
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Closest point on the surface to (x, y, z), no further than sqrt(`maxDistanceSquared`).
   * With `facing` set, only surface that faces the same way counts: the interpolated normal
   * at the closest point must have a dot product of at least `minAgreement` with (nx, ny, nz).
   * That keeps the inside of a cloak from answering for its outside. `hint` is a triangle
   * worth trying first (the previous query's answer); a good first guess prunes most of the tree.
   */
  closest(
    out: SurfaceHit,
    x: number,
    y: number,
    z: number,
    maxDistanceSquared: number,
    facing: { nx: number; ny: number; nz: number; minAgreement: number } | null = null,
    hint = -1,
  ): SurfaceHit {
    out.triangle = -1;
    out.distanceSquared = maxDistanceSquared;
    if (this.nodes === 0) return out;
    if (hint >= 0) this.tryTriangle(out, hint, x, y, z, facing);

    let top = 0;
    this.stack[top++] = 0;
    while (top > 0) {
      const node = this.stack[--top]!;
      if (this.boxDistanceSquared(node, x, y, z) >= out.distanceSquared) continue;
      const left = this.child[node]!;
      if (left < 0) {
        const end = this.first[node]! + this.count[node]!;
        for (let i = this.first[node]!; i < end; i++) {
          this.tryTriangle(out, this.order[i]!, x, y, z, facing);
        }
        continue;
      }
      // Nearer child last, so it is popped first.
      const dl = this.boxDistanceSquared(left, x, y, z);
      const dr = this.boxDistanceSquared(left + 1, x, y, z);
      if (dl < dr) {
        this.stack[top++] = left + 1;
        this.stack[top++] = left;
      } else {
        this.stack[top++] = left;
        this.stack[top++] = left + 1;
      }
    }
    return out;
  }

  /**
   * The nearest triangle a ray hits, from either side (#93: a tap is a ray from the camera).
   * `t` is the distance along `direction` in its own length; only hits with `t >= 0` count.
   * Ties go to the lower triangle index. Null when the ray misses.
   */
  raycast(origin: Vec3, direction: Vec3): { triangle: number; t: number } | null {
    if (this.nodes === 0) return null;
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    // Slab test; a zero component makes its inverse infinite, which the min/max handle.
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    let best = -1;
    let bestT = Infinity;
    let top = 0;
    this.stack[top++] = 0;
    while (top > 0) {
      const node = this.stack[--top]!;
      const entry = this.boxEntry(node, ox, oy, oz, ix, iy, iz);
      if (entry > bestT) continue;
      const left = this.child[node]!;
      if (left < 0) {
        const end = this.first[node]! + this.count[node]!;
        for (let i = this.first[node]!; i < end; i++) {
          const triangle = this.order[i]!;
          const t = this.rayTriangle(triangle, ox, oy, oz, dx, dy, dz);
          if (t < bestT || (t === bestT && triangle < best)) {
            bestT = t;
            best = triangle;
          }
        }
        continue;
      }
      const el = this.boxEntry(left, ox, oy, oz, ix, iy, iz);
      const er = this.boxEntry(left + 1, ox, oy, oz, ix, iy, iz);
      // Nearer child last, so it is popped first.
      if (el < er) {
        if (er <= bestT) this.stack[top++] = left + 1;
        if (el <= bestT) this.stack[top++] = left;
      } else {
        if (el <= bestT) this.stack[top++] = left;
        if (er <= bestT) this.stack[top++] = left + 1;
      }
    }
    return best < 0 ? null : { triangle: best, t: bestT };
  }

  /** Where a ray enters a node's box (0 when it starts inside); Infinity when it misses. */
  private boxEntry(
    node: number,
    ox: number,
    oy: number,
    oz: number,
    ix: number,
    iy: number,
    iz: number,
  ): number {
    const b = node * 6;
    let near = 0;
    let far = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? ox : axis === 1 ? oy : oz;
      const inv = axis === 0 ? ix : axis === 1 ? iy : iz;
      const lo = this.bounds[b + axis]!;
      const hi = this.bounds[b + 3 + axis]!;
      if (!Number.isFinite(inv)) {
        // Parallel to this slab: inside it or never.
        if (o < lo || o > hi) return Infinity;
        continue;
      }
      let t1 = (lo - o) * inv;
      let t2 = (hi - o) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > near) near = t1;
      if (t2 < far) far = t2;
      if (near > far) return Infinity;
    }
    return near;
  }

  /** Möller–Trumbore, both sides: the ray's `t` at the triangle, or Infinity. */
  private rayTriangle(
    triangle: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    const { positions, indices } = this.mesh;
    const ia = indices[triangle * 3]! * 3;
    const ib = indices[triangle * 3 + 1]! * 3;
    const ic = indices[triangle * 3 + 2]! * 3;
    const ax = positions[ia]!;
    const ay = positions[ia + 1]!;
    const az = positions[ia + 2]!;
    const e1x = positions[ib]! - ax;
    const e1y = positions[ib + 1]! - ay;
    const e1z = positions[ib + 2]! - az;
    const e2x = positions[ic]! - ax;
    const e2y = positions[ic + 1]! - ay;
    const e2z = positions[ic + 2]! - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det === 0) return Infinity;
    const inv = 1 / det;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return Infinity;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return Infinity;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : Infinity;
  }

  /**
   * Every triangle whose centroid lies within `radius` of (x, y, z) (#93: a tap's reach, a brush
   * dab). Visited in tree order; a caller that needs an order sorts.
   */
  within(x: number, y: number, z: number, radius: number, visit: (triangle: number) => void): void {
    if (this.nodes === 0) return;
    const { positions, indices } = this.mesh;
    const r2 = radius * radius;
    let top = 0;
    this.stack[top++] = 0;
    while (top > 0) {
      const node = this.stack[--top]!;
      // A centroid lies inside its triangle's box, so inside every box above it.
      if (this.boxDistanceSquared(node, x, y, z) > r2) continue;
      const left = this.child[node]!;
      if (left >= 0) {
        this.stack[top++] = left;
        this.stack[top++] = left + 1;
        continue;
      }
      const end = this.first[node]! + this.count[node]!;
      for (let i = this.first[node]!; i < end; i++) {
        const t = this.order[i]!;
        const a = indices[t * 3]! * 3;
        const b = indices[t * 3 + 1]! * 3;
        const c = indices[t * 3 + 2]! * 3;
        const gx = (positions[a]! + positions[b]! + positions[c]!) / 3 - x;
        const gy = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3 - y;
        const gz = (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3 - z;
        if (gx * gx + gy * gy + gz * gz <= r2) visit(t);
      }
    }
  }

  /** Closest point on one triangle (Ericson, Real-Time Collision Detection 5.1.5); updates `out` if nearer and facing. */
  private tryTriangle(
    out: SurfaceHit,
    triangle: number,
    px: number,
    py: number,
    pz: number,
    facing: { nx: number; ny: number; nz: number; minAgreement: number } | null,
  ): void {
    const { positions, indices, normals } = this.mesh;
    const ia = indices[triangle * 3]! * 3;
    const ib = indices[triangle * 3 + 1]! * 3;
    const ic = indices[triangle * 3 + 2]! * 3;
    const ax = positions[ia]!;
    const ay = positions[ia + 1]!;
    const az = positions[ia + 2]!;
    const abx = positions[ib]! - ax;
    const aby = positions[ib + 1]! - ay;
    const abz = positions[ib + 2]! - az;
    const acx = positions[ic]! - ax;
    const acy = positions[ic + 1]! - ay;
    const acz = positions[ic + 2]! - az;
    const apx = px - ax;
    const apy = py - ay;
    const apz = pz - az;

    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let v: number;
    let w: number;
    if (d1 <= 0 && d2 <= 0) {
      v = 0;
      w = 0;
    } else {
      const bpx = apx - abx;
      const bpy = apy - aby;
      const bpz = apz - abz;
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) {
        v = 1;
        w = 0;
      } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          v = d1 / (d1 - d3);
          w = 0;
        } else {
          const cpx = apx - acx;
          const cpy = apy - acy;
          const cpz = apz - acz;
          const d5 = abx * cpx + aby * cpy + abz * cpz;
          const d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) {
            v = 0;
            w = 1;
          } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              v = 0;
              w = d2 / (d2 - d6);
            } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                w = (d4 - d3) / (d4 - d3 + (d5 - d6));
                v = 1 - w;
              } else {
                const denominator = 1 / (va + vb + vc);
                v = vb * denominator;
                w = vc * denominator;
              }
            }
          }
        }
      }
    }

    const dx = apx - (abx * v + acx * w);
    const dy = apy - (aby * v + acy * w);
    const dz = apz - (abz * v + acz * w);
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance >= out.distanceSquared) return;

    const u = 1 - v - w;
    if (facing && normals) {
      const agreement =
        (normals[ia]! * u + normals[ib]! * v + normals[ic]! * w) * facing.nx +
        (normals[ia + 1]! * u + normals[ib + 1]! * v + normals[ic + 1]! * w) * facing.ny +
        (normals[ia + 2]! * u + normals[ib + 2]! * v + normals[ic + 2]! * w) * facing.nz;
      if (agreement < facing.minAgreement) return;
    }
    out.triangle = triangle;
    out.u = u;
    out.v = v;
    out.w = w;
    out.distanceSquared = distance;
  }
}
