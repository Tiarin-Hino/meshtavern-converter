/**
 * Why a file did not become a mini, in words a hobbyist understands. Every failure of a
 * conversion ends in one of these; the technical detail stays with the developer.
 */

export type ProblemCode =
  | 'empty'
  | 'not-stl'
  | 'truncated'
  | 'no-surface'
  | 'too-large'
  /** The safety net: the estimate let the file through, but memory ran out anyway. */
  | 'out-of-memory'
  /** Anything else: a bug, or damage nobody foresaw. */
  | 'unexpected';

const TOO_LARGE =
  "This file is too large for this device's memory. Try a smaller or reduced version of the " +
  'model (many creators offer one, and slicers and sculpting tools can reduce a model), or ' +
  'convert it on a device with more memory.';

export const PROBLEM_MESSAGES: Record<ProblemCode, string> = {
  empty: 'This file is empty: there is no model in it. Download or export it again.',
  'not-stl':
    'This is not an STL file, or not one the converter can read. Export the model from your ' +
    'slicer or sculpting tool as STL and try again.',
  truncated:
    'This file ends too early: it was probably cut off while downloading or copying. ' +
    'Download or export it again.',
  'no-surface':
    'This file has no usable surface: every triangle in it is broken or flat. ' +
    'Export the model again.',
  'too-large': TOO_LARGE,
  'out-of-memory': TOO_LARGE,
  unexpected:
    'Something went wrong while converting this file. Try again; if it happens again, the ' +
    'file may be damaged, so download or export it again.',
};

/** A file the converter refuses, with the reason for the user. */
export class ConversionProblem extends Error {
  constructor(
    readonly code: ProblemCode,
    /** What went wrong technically, for developers; the user sees `message`. */
    readonly detail?: string,
  ) {
    super(PROBLEM_MESSAGES[code]);
    this.name = 'ConversionProblem';
  }
}

/**
 * Whether an error is the engine refusing memory. A failed allocation of a typed array
 * or of WebAssembly memory is an ordinary exception that can be caught; running out of
 * JavaScript heap is not, which is why files are measured before converting.
 */
export function isOutOfMemory(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /out of memory|allocation failed|array buffer allocation|invalid (typed )?array length|cannot enlarge memory|memory\.grow|maximum memory size|OOM/i.test(
    text,
  );
}

/** Turns anything thrown during a conversion into a problem the page can show. */
export function toProblem(error: unknown): ConversionProblem {
  if (error instanceof ConversionProblem) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ConversionProblem(isOutOfMemory(error) ? 'out-of-memory' : 'unexpected', detail);
}
