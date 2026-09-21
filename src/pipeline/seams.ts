import type { IndexedMesh } from './mesh';

/**
 * Spike #34. Length in mm of the seams of an unwrapped mesh: the edges where one UV island
 * ends. Unwrapping duplicates the vertices along a seam, so there a seam edge belongs to one
 * triangle only; it is found on both sides, hence the half. Open borders of the surface itself
 * count as well (as they do in every variant), so compare variants of the same mini only.
 */
export function seamLengthMm({ positions, indices }: IndexedMesh): number {
  const uses = new Map<number, number>();
  const vertices = positions.length / 3;
  const keyOf = (a: number, b: number): number => (a < b ? a * vertices + b : b * vertices + a);
  for (let t = 0; t < indices.length; t += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const key = keyOf(indices[t + corner]!, indices[t + ((corner + 1) % 3)]!);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let length = 0;
  for (const [key, count] of uses) {
    if (count !== 1) continue;
    const a = Math.floor(key / vertices) * 3;
    const b = (key % vertices) * 3;
    length += Math.hypot(
      positions[a]! - positions[b]!,
      positions[a + 1]! - positions[b + 1]!,
      positions[a + 2]! - positions[b + 2]!,
    );
  }
  return length / 2;
}
