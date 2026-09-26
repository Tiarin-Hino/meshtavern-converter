/**
 * Synthetic test meshes. Real minis are licensed and never enter the repo, so tests,
 * benchmarks and the demo use generated geometry.
 */

/**
 * A bumpy square sheet as a Z-up triangle soup in mm: `quadsPerSide`² quads, two
 * triangles each. Neighbouring triangles repeat their shared vertices exactly, like an
 * exported STL does. 1000 quads per side gives 2 million triangles.
 */
export function generateBumpySheet(quadsPerSide: number, sideMm = 50): Float32Array {
  const soup = new Float32Array(quadsPerSide * quadsPerSide * 18);
  const step = sideMm / quadsPerSide;
  const height = (ix: number, iy: number): number =>
    2 * Math.sin(ix * step * 0.9) * Math.cos(iy * step * 0.7) + 3;

  let o = 0;
  const put = (ix: number, iy: number): void => {
    soup[o++] = ix * step;
    soup[o++] = iy * step;
    soup[o++] = height(ix, iy);
  };
  for (let iy = 0; iy < quadsPerSide; iy++) {
    for (let ix = 0; ix < quadsPerSide; ix++) {
      put(ix, iy);
      put(ix + 1, iy);
      put(ix + 1, iy + 1);
      put(ix, iy);
      put(ix + 1, iy + 1);
      put(ix, iy + 1);
    }
  }
  return soup;
}
