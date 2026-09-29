import type { AskOptions, UpAnswer, UpQuestion } from '../pipeline/ask';
import type { OrientationOptions } from '../pipeline/orient';
import type { PairingOptions } from '../pipeline/pair';
import type { PlacementOptions } from '../pipeline/place';
import type { ProblemCode } from '../pipeline/problems';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { SizingOptions } from '../pipeline/size';

/** What the page may ask for. Everything is optional: the defaults give a baked, compressed mini. */
export interface ConvertOptions {
  /** The six-way axis or a free turn, set down unless asked not to; left out, it is detected. */
  orientation?: OrientationOptions;
  /** Units, creature size, scale to a base diameter and a plain base; left out, they are guessed. */
  sizing?: SizingOptions;
  /** Development only: a fixed texture size for the baked detail maps, or 0 for none. Default: the size policy. */
  bake?: number | 'auto';
  /** Development only: UASTC effort, or null to keep the raw texture. Default: see compress.ts. */
  compress?: number | null;
  /** Largest texture the device can hold; a mini that needs more keeps the per-vertex look. */
  maxTextureSize?: number;
  /** Memory the conversion may use; a file expected to need more is refused. See memory.ts. */
  memoryBudgetBytes?: number;
  /**
   * The second STL of a figure-plus-base pair (#70). Transferred to the worker like the first
   * and unusable on the page afterwards. Which of the two is the base is guessed.
   */
  secondStl?: ArrayBuffer;
  /** For a pair: the user swapped figure and base. */
  pairing?: PairingOptions;
  /** For a pair: the user moved, turned, raised or lowered the figure, relative to the detection. */
  placement?: PlacementOptions;
  /** For a pair: the user's axis or turn for the base file; left out, it stands on its underside. */
  baseOrientation?: OrientationOptions;
  /**
   * Stop after the orient step and ask which way is up (#92): the worker posts a `question` and
   * waits for an `answer`. Set by the client when the page gives it a callback, never by hand.
   */
  ask?: AskOptions;
}

/** Messages between the page and the conversion worker. Every job carries an id so replies can be matched. */
export type WorkerRequest =
  | { type: 'convert'; id: number; stl: ArrayBuffer; options?: ConvertOptions }
  /** The answer to the question last asked by job `id`. */
  | { type: 'answer'; id: number; answer: UpAnswer };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: Progress }
  /** The conversion waits until an `answer` with the same id arrives. The mesh's buffers are transferred. */
  | { type: 'question'; id: number; question: UpQuestion }
  | { type: 'done'; id: number; result: ConversionResult }
  /** A file that did not become a mini: why, for the user, and what happened, for developers. */
  | { type: 'error'; id: number; code: ProblemCode; detail?: string };

export type Post = (response: WorkerResponse, transfer?: Transferable[]) => void;
