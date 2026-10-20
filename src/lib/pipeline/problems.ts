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
  /** Two files, and neither has a flat underside: no base to set the other on (issue #70). */
  | 'not-a-pair'
  /** More files than one mini is made of (`MAX_PARTS`, issue #93). */
  | 'too-many-files'
  /** A paint file that cannot be read: not one, damaged, or of a shape this converter does not know (#165). */
  | 'not-a-paint-file'
  /** A paint file saved by a newer converter, whose file version or engine this one does not have (#165). */
  | 'paint-file-newer'
  /**
   * A paint file given files that are not the ones it names (#165): one is missing, different or
   * extra. The message says which (`sourcesMessage` in paint-file.ts); this one is the fallback.
   */
  | 'paint-file-sources'
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
  'not-a-pair':
    'Neither of these files has a flat underside, so neither can be the base of the other. ' +
    'Drop the figure on its own, or drop it together with its base file.',
  // Six is `MAX_PARTS` in assemble.ts; problems.test.ts keeps the two in step.
  'too-many-files': 'Drop up to 6 files: a figure, its base and its parts.',
  'not-a-paint-file':
    'This is not a paint file, or it is damaged: save the painting again, or drop the paint ' +
    'file it was saved as.',
  'paint-file-newer':
    'This paint file was saved by a newer version of the converter: reload the page and try again.',
  'paint-file-sources':
    'This paint file was painted on other files: drop it again with the files it was painted on.',
  'out-of-memory': TOO_LARGE,
  unexpected:
    'Something went wrong while converting this file. Try again; if it happens again, the ' +
    'file may be damaged, so download or export it again.',
};

/**
 * What a paint file given other files says (#165), one sentence each: which of the files it was
 * painted on is missing or different, by its role, or that a file is not one of them. Paint files
 * name no files, so the role is all there is to say.
 */
export const PAINT_SOURCE_MESSAGES = {
  missing: {
    figure:
      'The figure this paint file was painted on is not among these files: drop its file with the paint file.',
    part: 'A part of the figure this paint file was painted on is not among these files: drop its file with the paint file.',
    base: 'The base this paint file was painted on is not among these files: drop its file with the paint file.',
  },
  different: {
    figure:
      'The figure is not the file this paint file was painted on: drop the file it was painted on, unchanged, and try again.',
    part: 'A part of the figure is not the file this paint file was painted on: drop the file it was painted on, unchanged, and try again.',
    base: 'The base is not the file this paint file was painted on: drop the file it was painted on, unchanged, and try again.',
  },
  extra:
    'One of these files is not part of the mini this paint file was painted on: drop only the files it was painted on.',
} as const;

/** A file the converter refuses, with the reason for the user. */
export class ConversionProblem extends Error {
  constructor(
    readonly code: ProblemCode,
    /** What went wrong technically, for developers; the user sees `message`. */
    readonly detail?: string,
    /** The sentence the user reads, when it says more than the code's (which file, #165). */
    message: string = PROBLEM_MESSAGES[code],
  ) {
    super(message);
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
  return (
    /out of memory|allocation failed|array buffer allocation|invalid (typed )?array length|cannot enlarge memory|memory\.grow|maximum memory size/i.test(
      text,
    ) ||
    // "OOM" only as a word in capitals: "zoom" or "room" in a message is not about memory.
    /\bOOM\b/.test(text)
  );
}

/** Turns anything thrown during a conversion into a problem the page can show. */
export function toProblem(error: unknown): ConversionProblem {
  if (error instanceof ConversionProblem) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ConversionProblem(isOutOfMemory(error) ? 'out-of-memory' : 'unexpected', detail);
}
