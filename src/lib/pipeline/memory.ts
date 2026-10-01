/**
 * Whether a file fits the device's memory, decided from its size before converting. A
 * tab that runs out of memory crashes without a word, so a file that will not fit is
 * refused up front; the check needs no more than the file's size and format.
 */
import { ConversionProblem } from './problems';
import type { StlFormat } from './stl';

const BINARY_HEADER_BYTES = 84;
const BINARY_TRIANGLE_BYTES = 50;
/**
 * Bytes an ASCII STL spends on one triangle, on the small side: exporters write 200–260
 * ("facet normal …", "outer loop", three "vertex" lines, "endloop", "endfacet"). A low
 * figure overestimates the triangles, which errs towards refusing.
 */
export const ASCII_BYTES_PER_TRIANGLE = 150;
/**
 * Memory a conversion needs per source triangle, on top of the file itself: the triangle
 * soup, welding, the placed mesh with normals, the simplifier's copy, the levels and the
 * bake. Fitted to the peak memory of the page's process in Chrome while it converts
 * (`scripts/measure-memory.mjs`): 440–460 bytes per triangle with the file included, so
 * 50 for a binary file plus this. The estimate stays above every measured peak.
 */
export const BYTES_PER_TRIANGLE = 400;
/**
 * Memory the page needs whatever the file: three.js, the WebAssembly modules, the texture
 * being baked. Measured: 333 MB for a 3,200-triangle file.
 */
export const FIXED_BYTES = 360 * 1024 ** 2;

/**
 * The search tree and the tap's vertex-to-triangle index of a file at the meet questions (#93,
 * patches design note §4), per triangle: the tree's order, and per node of six triangles its box,
 * child, first and count (28 bytes); the index's list, stamp and offsets (about 18). Every file of
 * a pair or a kit gets both; the trees are released before the size step.
 */
export const TREE_BYTES_PER_TRIANGLE = 46;

/** Share of the device's memory a conversion may use: the system and other tabs need the rest. */
export const DEVICE_SHARE = 0.5;
/**
 * Assumed when the browser does not say (only Chromium reports `navigator.deviceMemory`,
 * and it never reports more than 8 GB): an ordinary laptop.
 */
export const UNKNOWN_DEVICE_GB = 4;

/** Triangles in a file of this size: exact for binary STL, an upper estimate for ASCII. */
export function estimateTriangles(byteLength: number, format: StlFormat): number {
  return format === 'binary'
    ? Math.max(0, Math.floor((byteLength - BINARY_HEADER_BYTES) / BINARY_TRIANGLE_BYTES))
    : Math.ceil(byteLength / ASCII_BYTES_PER_TRIANGLE);
}

/** Peak memory a conversion of this file is expected to need. */
export function estimateConversionBytes(byteLength: number, format: StlFormat): number {
  return byteLength + estimateTriangles(byteLength, format) * BYTES_PER_TRIANGLE + FIXED_BYTES;
}

/** How much memory a conversion may use on a device that reports `deviceMemoryGb` (undefined: it does not say). */
export function memoryBudgetBytes(deviceMemoryGb: number | undefined): number {
  const gb = deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : UNKNOWN_DEVICE_GB;
  return gb * 1024 ** 3 * DEVICE_SHARE;
}

/**
 * Peak memory a conversion of a figure and its base file is expected to need (#70): both
 * files' estimates, with the memory every conversion needs counted once, and both files'
 * search trees for the meet questions (#93).
 */
export function estimatePairBytes(
  byteLength: number,
  format: StlFormat,
  secondByteLength: number,
  secondFormat: StlFormat,
): number {
  return (
    estimateConversionBytes(byteLength, format) +
    estimateConversionBytes(secondByteLength, secondFormat) -
    FIXED_BYTES +
    (estimateTriangles(byteLength, format) + estimateTriangles(secondByteLength, secondFormat)) *
      TREE_BYTES_PER_TRIANGLE
  );
}

/**
 * Peak memory a conversion of a figure in several files is expected to need (#93): every file's
 * estimate with the memory every conversion needs counted once, and the union of the parts once
 * more, which lives beside the parts' own meshes until the last question is answered, and every
 * file's search tree for the meet questions. The roles
 * are not known before the files are read, so every file counts as a part: an upper bound.
 */
export function estimateAssemblyBytes(
  files: readonly { byteLength: number; format: StlFormat }[],
): number {
  let bytes = 0;
  for (const { byteLength, format } of files)
    bytes +=
      estimateConversionBytes(byteLength, format) +
      estimateTriangles(byteLength, format) * (BYTES_PER_TRIANGLE + TREE_BYTES_PER_TRIANGLE);
  return bytes - (files.length - 1) * FIXED_BYTES;
}

/** Refuses a file whose conversion is expected to need more than `budgetBytes`. */
export function checkFits(byteLength: number, format: StlFormat, budgetBytes: number): void {
  checkNeeded(estimateConversionBytes(byteLength, format), budgetBytes);
}

/** Refuses a conversion expected to need `needed` bytes when it may use `budgetBytes`. */
export function checkNeeded(needed: number, budgetBytes: number): void {
  if (needed > budgetBytes) {
    const mb = (bytes: number): string => `${Math.round(bytes / 1024 ** 2)} MB`;
    throw new ConversionProblem(
      'too-large',
      `needs about ${mb(needed)}, may use ${mb(budgetBytes)}`,
    );
  }
}
