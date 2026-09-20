import type { UpAxis } from '../pipeline/orient';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface Job {
  onProgress: (progress: Progress) => void;
  resolve: (result: ConversionResult) => void;
  reject: (error: Error) => void;
}

/** Page-side handle on the conversion worker. */
export class Converter {
  private readonly worker = new Worker(new URL('./convert.worker.ts', import.meta.url), {
    type: 'module',
  });
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || 'Worker crashed'));
  }

  /** The STL buffer is transferred to the worker and is unusable on the page afterwards. */
  convert(
    stl: ArrayBuffer,
    onProgress: (progress: Progress) => void,
    up?: UpAxis,
    sourceNormals = true,
  ): Promise<ConversionResult> {
    const id = this.nextId++;
    const request: WorkerRequest = { type: 'convert', id, stl, up, sourceNormals };
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { onProgress, resolve, reject });
      this.worker.postMessage(request, [stl]);
    });
  }

  private receive(response: WorkerResponse): void {
    const job = this.jobs.get(response.id);
    if (!job) return;
    if (response.type === 'progress') return job.onProgress(response.progress);
    this.jobs.delete(response.id);
    if (response.type === 'done') job.resolve(response.result);
    else job.reject(new Error(response.message));
  }

  private failAll(error: Error): void {
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
  }
}
