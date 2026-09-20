import type { UpAxis } from '../pipeline/orient';
import type { ConversionResult, Progress } from '../pipeline/run';

/** Messages between the page and the conversion worker. Every job carries an id so replies can be matched. */
export type WorkerRequest = {
  type: 'convert';
  id: number;
  stl: ArrayBuffer;
  up?: UpAxis;
  /** Texture size for baked detail maps; 0 or absent means none. */
  bakeResolution?: number;
};

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'done'; id: number; result: ConversionResult }
  | { type: 'error'; id: number; message: string };

export type Post = (response: WorkerResponse, transfer?: Transferable[]) => void;
