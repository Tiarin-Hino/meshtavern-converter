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
 * bake. Measured as the peak memory of the tab in Chrome (see the journal entry of #43).
 */
export const BYTES_PER_TRIANGLE = 400;
/** Memory the page needs whatever the file: three.js, the WebAssembly modules, a 4K texture being baked. */
export const FIXED_BYTES = 400 * 1024 ** 2;

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

/** Refuses a file whose conversion is expected to need more than `budgetBytes`. */
export function checkFits(byteLength: number, format: StlFormat, budgetBytes: number): void {
  const needed = estimateConversionBytes(byteLength, format);
  if (needed > budgetBytes) {
    const mb = (bytes: number): string => `${Math.round(bytes / 1024 ** 2)} MB`;
    throw new ConversionProblem(
      'too-large',
      `needs about ${mb(needed)}, may use ${mb(budgetBytes)}`,
    );
  }
}
