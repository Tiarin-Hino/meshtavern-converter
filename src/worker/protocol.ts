import type { UpAxis } from '../pipeline/orient';
import type { ProblemCode } from '../pipeline/problems';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { SizingOptions } from '../pipeline/size';

/** What the page may ask for. Everything is optional: the defaults give a baked, compressed mini. */
export interface ConvertOptions {
  up?: UpAxis;
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
}

/** Messages between the page and the conversion worker. Every job carries an id so replies can be matched. */
export type WorkerRequest = {
  type: 'convert';
  id: number;
  stl: ArrayBuffer;
  options?: ConvertOptions;
};

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'done'; id: number; result: ConversionResult }
  /** A file that did not become a mini: why, for the user, and what happened, for developers. */
  | { type: 'error'; id: number; code: ProblemCode; detail?: string };

export type Post = (response: WorkerResponse, transfer?: Transferable[]) => void;
