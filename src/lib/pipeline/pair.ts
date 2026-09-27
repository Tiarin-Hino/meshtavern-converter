/**
 * A figure and its base as two files (issue #70, design note docs/design/base-file.md §4.1):
 * which of the two is the base, guessed from the shapes. Where the figure is set down on
 * the base is place.ts.
 */
import type { Orientation, UpAxis } from './orient';
import { ConversionProblem } from './problems';

/**
 * Both files have a flat underside: the one lower than this (height over the longer side of
 * the footprint) looks like a base. A 25 mm base 4 mm tall is 0.16, a 32 mm scenic base with
 * a 15 mm rock 0.47, a hound on an integral oval base about 0.6, a standing figure on its
 * base about 1.5. _(proposal)_
 */
export const BASE_MAX_ASPECT = 0.5;

export type PairWarning =
  /** Both files have a flat underside and are low and wide; the lower one was taken as the base. */
  | 'both-look-like-bases'
  /** The figure has a flat underside of its own (an integral base); it was set on the base anyway. */
  | 'figure-has-its-own-base';

export interface FileShape {
  /** Width, height and depth in file units after the file's own orientation. */
  sizeMm: [number, number, number];
  up: UpAxis;
  upMethod: Orientation['method'];
  /** Height over the longer side of the footprint: low and wide is small. */
  aspect: number;
  /** A flat underside covering `MIN_BASE_COVERAGE` of the footprint: what a base has. */
  flatUnderside: boolean;
}

export interface Pairing {
  /** Which of the two files is the base: 0 the first given, 1 the second. */
  baseFile: 0 | 1;
  method: 'guessed' | 'manual';
  warnings: PairWarning[];
  files: [FileShape, FileShape];
}

/** What the user chose about the pair. */
export interface PairingOptions {
  /** The other file is the base: the user swapped the guess. */
  swap?: boolean;
}

/**
 * The shape of one file after its own detection and placing: a flat underside is what the
 * detection calls a base (`method === 'base'`).
 *
 * @param orientation The file's own detection, without any of the user's options.
 * @param sizeMm Its size after `orientAndPlace`, Y-up.
 */
export function fileShape(orientation: Orientation, sizeMm: [number, number, number]): FileShape {
  const across = Math.max(sizeMm[0], sizeMm[2]);
  return {
    sizeMm,
    up: orientation.up,
    upMethod: orientation.method,
    aspect: across > 0 ? sizeMm[1] / across : Infinity,
    flatUnderside: orientation.method === 'base',
  };
}

/**
 * Which file is the base (design note §4.1). With one flat underside, that file, whatever its
 * aspect; with two, the lower aspect, with a warning; with none, a `not-a-pair` problem,
 * because two figures cannot be set on each other. `swap` exchanges the roles after the guess;
 * the warnings stay as computed.
 */
export function guessRoles(files: [FileShape, FileShape], options: PairingOptions = {}): Pairing {
  const [a, b] = files;
  let baseFile: 0 | 1;
  const warnings: PairWarning[] = [];
  if (a.flatUnderside && b.flatUnderside) {
    // Equal aspects keep the first file as the figure: the order the user gave them.
    baseFile = b.aspect <= a.aspect ? 1 : 0;
    const figure = files[1 - baseFile]!;
    warnings.push(
      figure.aspect <= BASE_MAX_ASPECT ? 'both-look-like-bases' : 'figure-has-its-own-base',
    );
  } else if (a.flatUnderside || b.flatUnderside) {
    baseFile = a.flatUnderside ? 0 : 1;
  } else {
    throw new ConversionProblem(
      'not-a-pair',
      `aspects ${a.aspect.toFixed(2)} and ${b.aspect.toFixed(2)}, no flat underside`,
    );
  }
  if (options.swap) baseFile = baseFile === 0 ? 1 : 0;
  return { baseFile, method: options.swap ? 'manual' : 'guessed', warnings, files };
}
