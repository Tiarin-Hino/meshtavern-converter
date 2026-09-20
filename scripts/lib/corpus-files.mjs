// The local corpus: every STL under corpus/, also in the folders that sort it by kind of
// mini (see scripts/corpus.mjs). Paths are relative to corpus/ and sorted.
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

export const corpusFiles = () =>
  existsSync(CORPUS)
    ? stlsIn(CORPUS)
        .map((file) => relative(CORPUS, file))
        .sort()
    : [];
