// The local corpus: every STL under corpus/, also in the folders that sort it by kind of
// mini (see scripts/corpus.mjs). Paths are relative to corpus/ and sorted. A figure's base
// file sits next to it as `<name>-base.stl` (#70): it is left out of the list and found with
// `baseFileFor`, so every script that walks the corpus converts figures.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const CORPUS = 'corpus';

const stlsIn = (folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? stlsIn(join(folder, entry.name))
      : entry.name.toLowerCase().endsWith('.stl')
        ? [join(folder, entry.name)]
        : [],
  );

const BASE_SUFFIX = '-base.stl';

const isBaseFile = (file) => file.toLowerCase().endsWith(BASE_SUFFIX);

export const corpusFiles = () =>
  existsSync(CORPUS)
    ? stlsIn(CORPUS)
        .map((file) => relative(CORPUS, file))
        .filter((file) => !isBaseFile(file))
        .sort()
    : [];

/** The base file of a corpus figure (a path relative to corpus/), or null when it has none. */
export function baseFileFor(figure) {
  const base = figure.replace(/\.stl$/i, BASE_SUFFIX);
  return base !== figure && existsSync(join(CORPUS, base)) ? base : null;
}
