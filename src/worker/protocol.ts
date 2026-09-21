import type { UpAxis } from '../pipeline/orient';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { UnwrapVariant } from '../pipeline/unwrap-parts';

/** What the page may ask for. Everything is optional: the defaults give a baked, compressed mini. */
export interface ConvertOptions {
  up?: UpAxis;
  /** Development only: a fixed texture size for the baked detail maps, or 0 for none. Default: the size policy. */
  bake?: number | 'auto';
  /** Development only: UASTC effort, or null to keep the raw texture. Default: see compress.ts. */
  compress?: number | null;
  /** Largest texture the device can hold; a mini that needs more keeps the per-vertex look. */
  maxTextureSize?: number;
  /** Spike #34, development only: another way to unwrap the table level. */
  unwrapVariant?: UnwrapVariant;
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
  | { type: 'error'; id: number; message: string };

export type Post = (response: WorkerResponse, transfer?: Transferable[]) => void;
