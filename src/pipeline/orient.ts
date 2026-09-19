import type { IndexedMesh } from './mesh';

export type UpAxis = 'y' | 'z';

export interface PlacedMesh {
  mesh: IndexedMesh;
  /** Width (x), height (y) and depth (z) in mm, after conversion to Y-up. */
  sizeMm: [number, number, number];
}

/**
 * Converts a mesh to the scene convention: Y-up, standing on y = 0, centred on the
 * origin in x and z. Print STLs are Z-up, so that is the default source axis; the
 * conversion is a rotation (x, y, z) -> (x, z, -y), which keeps triangle winding.
 * Units are never changed. Returns a new mesh; the input is left untouched.
 */
export function orientAndPlace(mesh: IndexedMesh, sourceUp: UpAxis = 'z'): PlacedMesh {
  const positions = new Float32Array(mesh.positions.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i]!;
    const y = sourceUp === 'z' ? mesh.positions[i + 2]! : mesh.positions[i + 1]!;
    // `0 - value` rather than `-value` so a zero coordinate does not become -0.
    const z = sourceUp === 'z' ? 0 - mesh.positions[i + 1]! : mesh.positions[i + 2]!;
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
    if (x < min[0]!) min[0] = x;
    if (y < min[1]!) min[1] = y;
    if (z < min[2]!) min[2] = z;
    if (x > max[0]!) max[0] = x;
    if (y > max[1]!) max[1] = y;
    if (z > max[2]!) max[2] = z;
  }

  if (positions.length === 0)
    return { mesh: { positions, indices: mesh.indices }, sizeMm: [0, 0, 0] };

  const centreX = (min[0]! + max[0]!) / 2;
  const centreZ = (min[2]! + max[2]!) / 2;
  const floor = min[1]!;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i]! - centreX;
    positions[i + 1] = positions[i + 1]! - floor;
    positions[i + 2] = positions[i + 2]! - centreZ;
  }

  return {
    mesh: { positions, indices: mesh.indices },
    sizeMm: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!],
  };
}
