// Types of colour-literals.mjs, for its unit test.

/** The CSS named colours (CSS Color 4), without `transparent` and `currentColor`. */
export const NAMED_COLOURS: Set<string>;

/** What a source is read as. */
export type SourceKind = 'css' | 'html' | 'ts';

/** The source with its comments blanked out, newlines kept. */
export function stripComments(source: string, kind: SourceKind): string;

/** Every colour literal in a source, in order. */
export function findColourLiterals(
  source: string,
  kind: SourceKind,
): { line: number; text: string }[];
