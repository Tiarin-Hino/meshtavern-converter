/**
 * A large mesh drawn as chunks, each handed to the GPU in a frame of its own (#108). Handing a
 * sculpt of 5.6 million triangles to WebGL at once (about 100 MB of positions and indices)
 * stalled the page for 170–200 ms on the reference laptop. Slicing one buffer over frames does
 * not help: Chrome clears a new buffer, which costs as much as filling it (about 1.3 ms per MB on
 * the laptop), so the buffers themselves must be smaller. A chunk is a range of the triangles,
 * drawn over the file's positions; giving each chunk only its own vertices was tried and dropped:
 * a sculpt's triangles come in no spatial order, and picking out their vertices took 56–80 ms per
 * chunk of the largest corpus mini.
 */

/**
 * Bytes handed to the GPU per frame, beyond a file's positions. _(proposal, #108)_ 8 MB of
 * indices are about 700,000 triangles and took about 10 ms of a frame on the reference laptop.
 */
export const UPLOAD_BYTES_PER_FRAME = 8 * 1024 * 1024;

/** Bytes of indices per triangle. */
const TRIANGLE_BYTES = 12;

/**
 * Where each chunk starts and ends, in triangles: `[from, to)`. The first chunk goes to the GPU
 * with the file's positions (`positionBytes`), which cannot be split, so it takes only what is
 * left of a frame's bytes, at least one triangle; every other chunk a frame's bytes. An ordinary
 * mini is one chunk, drawn as before.
 */
export function chunkRanges(
  triangles: number,
  positionBytes: number,
  perFrame = UPLOAD_BYTES_PER_FRAME,
): { from: number; to: number }[] {
  const perChunk = Math.max(1, Math.floor(perFrame / TRIANGLE_BYTES));
  const first = Math.max(1, Math.floor((perFrame - positionBytes) / TRIANGLE_BYTES));
  const ranges: { from: number; to: number }[] = [];
  for (let from = 0; from < triangles;) {
    const to = Math.min(triangles, from + (from === 0 ? first : perChunk));
    ranges.push({ from, to });
    from = to;
  }
  return ranges;
}
