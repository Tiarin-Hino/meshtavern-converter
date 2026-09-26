import { computeVertexNormals, type IndexedMesh } from './mesh';

/**
 * Per-vertex measurements the "primed and washed" look is built from. They are stored as
 * plain numbers, not colours, so the look can be re-tinted without converting again.
 *
 * Both assume the scene convention: Y-up, standing on y = 0, units in mm.
 */

/** Longest grid side, in voxels. 160³ bytes = 4 MB. */
const OCCLUSION_GRID = 160;
/** Rays per vertex. */
const OCCLUSION_RAYS = 32;
/** How far a ray looks for blockers, as a share of the mini's largest dimension. */
const OCCLUSION_REACH = 0.15;
/** Rays start this many voxels above the surface, so a vertex does not block itself. */
const OCCLUSION_LIFT_VOXELS = 1.6;
/** Neighbour-averaging passes that widen the cavity signal from single edges to small features. */
const CAVITY_SMOOTHING = 2;

interface Adjacency {
  /** Neighbours of vertex v are `neighbours[start[v] .. start[v + 1])`. Shared edges appear twice. */
  start: Uint32Array;
  neighbours: Uint32Array;
}

function buildAdjacency(vertexCount: number, indices: Uint32Array): Adjacency {
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i++) start[indices[i]! + 1] = start[indices[i]! + 1]! + 2;
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v + 1]! + start[v]!;
  const cursor = start.slice(0, vertexCount);
  const neighbours = new Uint32Array(indices.length * 2);
  for (let t = 0; t < indices.length; t += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const v = indices[t + corner]!;
      neighbours[cursor[v]!] = indices[t + ((corner + 1) % 3)]!;
      neighbours[cursor[v]! + 1] = indices[t + ((corner + 2) % 3)]!;
      cursor[v] = cursor[v]! + 2;
    }
  }
  return { start, neighbours };
}

/**
 * Signed local curvature per vertex, -1..1: positive on edges and bumps (where a drybrush
 * would catch), negative in creases (where a wash would pool). It is the average sine of
 * the angle by which neighbours drop below (or rise above) the vertex's tangent plane.
 */
export function computeCavity(mesh: IndexedMesh, smoothing = CAVITY_SMOOTHING): Float32Array {
  const { positions, indices } = mesh;
  const normals = mesh.normals ?? computeVertexNormals(mesh);
  const vertexCount = positions.length / 3;
  const { start, neighbours } = buildAdjacency(vertexCount, indices);

  let cavity = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let sum = 0;
    for (let k = start[v]!; k < start[v + 1]!; k++) {
      const n = neighbours[k]! * 3;
      const dx = positions[v * 3]! - positions[n]!;
      const dy = positions[v * 3 + 1]! - positions[n + 1]!;
      const dz = positions[v * 3 + 2]! - positions[n + 2]!;
      const length = Math.hypot(dx, dy, dz);
      if (length === 0) continue;
      sum += (dx * normals[v * 3]! + dy * normals[v * 3 + 1]! + dz * normals[v * 3 + 2]!) / length;
    }
    const degree = start[v + 1]! - start[v]!;
    cavity[v] = degree > 0 ? sum / degree : 0;
  }

  for (let pass = 0; pass < smoothing; pass++) {
    const smoothed = new Float32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      let sum = cavity[v]!;
      for (let k = start[v]!; k < start[v + 1]!; k++) sum += cavity[neighbours[k]!]!;
      smoothed[v] = sum / (start[v + 1]! - start[v]! + 1);
    }
    cavity = smoothed;
  }
  return cavity;
}

/** Evenly spread directions over the upper hemisphere (local +z), denser towards the pole. */
function hemisphereDirections(count: number): Float32Array {
  const directions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    // Cosine-weighted: z = sqrt(u) puts more rays near the normal, as diffuse light does.
    const z = Math.sqrt((i + 0.5) / count);
    const radius = Math.sqrt(1 - z * z);
    directions[i * 3] = Math.cos(golden * i) * radius;
    directions[i * 3 + 1] = Math.sin(golden * i) * radius;
    directions[i * 3 + 2] = z;
  }
  return directions;
}

/**
 * How open each vertex is to its surroundings, 0 (buried) to 1 (fully open). The mesh is
 * rasterised into a coarse voxel grid, the table it stands on counts as solid,
 * and short rays are marched through the grid from every vertex. Coarse on purpose: this
 * catches large-scale shadowing (under arms, inside cloaks); fine creases are `computeCavity`'s job.
 */
export function computeOcclusion(mesh: IndexedMesh): Float32Array {
  const { positions, indices } = mesh;
  const normals = mesh.normals ?? computeVertexNormals(mesh);
  const vertexCount = positions.length / 3;
  const occlusion = new Float32Array(vertexCount).fill(1);
  if (vertexCount === 0) return occlusion;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    if (positions[i]! < min[i % 3]!) min[i % 3] = positions[i]!;
    if (positions[i]! > max[i % 3]!) max[i % 3] = positions[i]!;
  }
  const largest = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  if (!(largest > 0)) return occlusion;

  const voxel = largest / OCCLUSION_GRID;
  const reach = largest * OCCLUSION_REACH;
  // Pad by the reach so rays never leave the grid while they still matter.
  const pad = Math.ceil(reach / voxel) + 2;
  const origin = [min[0]! - pad * voxel, min[1]! - 2 * voxel, min[2]! - pad * voxel];
  const size = [
    Math.ceil((max[0]! - min[0]!) / voxel) + 2 * pad,
    Math.ceil((max[1]! - min[1]!) / voxel) + pad + 2,
    Math.ceil((max[2]! - min[2]!) / voxel) + 2 * pad,
  ];
  const grid = new Uint8Array(size[0]! * size[1]! * size[2]!);
  const cell = (x: number, y: number, z: number): number =>
    (Math.floor((z - origin[2]!) / voxel) * size[1]! + Math.floor((y - origin[1]!) / voxel)) *
      size[0]! +
    Math.floor((x - origin[0]!) / voxel);

  // Surface voxels: sample every triangle densely enough that no voxel it crosses is missed.
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const longest = Math.max(
      Math.hypot(
        positions[b]! - positions[a]!,
        positions[b + 1]! - positions[a + 1]!,
        positions[b + 2]! - positions[a + 2]!,
      ),
      Math.hypot(
        positions[c]! - positions[a]!,
        positions[c + 1]! - positions[a + 1]!,
        positions[c + 2]! - positions[a + 2]!,
      ),
      Math.hypot(
        positions[c]! - positions[b]!,
        positions[c + 1]! - positions[b + 1]!,
        positions[c + 2]! - positions[b + 2]!,
      ),
    );
    const steps = Math.max(1, Math.ceil((longest / voxel) * 2));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        grid[
          cell(
            positions[a]! * w + positions[b]! * u + positions[c]! * v,
            positions[a + 1]! * w + positions[b + 1]! * u + positions[c + 1]! * v,
            positions[a + 2]! * w + positions[b + 2]! * u + positions[c + 2]! * v,
          )
        ] = 1;
      }
    }
  }

  const directions = hemisphereDirections(OCCLUSION_RAYS);
  const marchSteps = Math.ceil(reach / voxel);
  for (let v = 0; v < vertexCount; v++) {
    const nx = normals[v * 3]!;
    const ny = normals[v * 3 + 1]!;
    const nz = normals[v * 3 + 2]!;
    // Any vector not parallel to the normal gives a tangent frame.
    const [hx, hy, hz] = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let tx = hy * nz - hz * ny;
    let ty = hz * nx - hx * nz;
    let tz = hx * ny - hy * nx;
    const tangentLength = Math.hypot(tx, ty, tz) || 1;
    tx /= tangentLength;
    ty /= tangentLength;
    tz /= tangentLength;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    const startX = positions[v * 3]! + nx * voxel * OCCLUSION_LIFT_VOXELS;
    const startY = positions[v * 3 + 1]! + ny * voxel * OCCLUSION_LIFT_VOXELS;
    const startZ = positions[v * 3 + 2]! + nz * voxel * OCCLUSION_LIFT_VOXELS;

    let blocked = 0;
    for (let r = 0; r < OCCLUSION_RAYS; r++) {
      const lx = directions[r * 3]!;
      const ly = directions[r * 3 + 1]!;
      const lz = directions[r * 3 + 2]!;
      const dx = (tx * lx + bx * ly + nx * lz) * voxel;
      const dy = (ty * lx + by * ly + ny * lz) * voxel;
      const dz = (tz * lx + bz * ly + nz * lz) * voxel;
      for (let step = 1; step <= marchSteps; step++) {
        const y = startY + dy * step;
        // The table: everything below the mini's lowest point is solid.
        if (y < min[1]! || grid[cell(startX + dx * step, y, startZ + dz * step)] === 1) {
          // Near blockers darken more than far ones; squared, so only the far end fades.
          blocked += 1 - (step / (marchSteps + 1)) ** 2;
          break;
        }
      }
    }
    occlusion[v] = 1 - blocked / OCCLUSION_RAYS;
  }
  return occlusion;
}

/** Adds both measurements to a mesh, in place. */
export function shade(mesh: IndexedMesh): void {
  mesh.cavity = computeCavity(mesh);
  mesh.occlusion = computeOcclusion(mesh);
}
