import { ConversionProblem, toProblem } from '../pipeline/problems';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { ConvertOptions, WorkerRequest, WorkerResponse } from './protocol';

interface Job {
  onProgress: (progress: Progress) => void;
  resolve: (result: ConversionResult) => void;
  reject: (error: Error) => void;
}

/** What a cancelled conversion rejects with. */
export class ConversionCancelled extends Error {
  constructor() {
    super('The conversion was cancelled');
    this.name = 'ConversionCancelled';
  }
}

/** The part of a Worker the converter uses, so tests can stand in for it. */
export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

const startWorker = (): WorkerLike =>
  new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });

/** Page-side handle on the conversion worker. */
export class Converter {
  private worker: WorkerLike;
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;

  constructor(private readonly createWorker: () => WorkerLike = startWorker) {
    this.worker = this.start();
  }

  /**
   * The STL buffer is transferred to the worker and is unusable on the page afterwards.
   * A file that does not become a mini rejects with a `ConversionProblem`.
   */
  convert(
    stl: ArrayBuffer,
    onProgress: (progress: Progress) => void,
    options: ConvertOptions = {},
  ): Promise<ConversionResult> {
    const id = this.nextId++;
    const request: WorkerRequest = { type: 'convert', id, stl, options };
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { onProgress, resolve, reject });
      this.worker.postMessage(request, [stl]);
    });
  }

  /**
   * Stops whatever is being converted; its promise rejects with `ConversionCancelled`.
   * Pipeline steps run for up to minutes without returning to the worker's message loop,
   * so a message could not interrupt them. Ending the worker can, at once, and it frees
   * the conversion's memory with it. A fresh worker takes over for the next file.
   */
  cancel(): void {
    if (this.jobs.size === 0) return;
    this.failAll(new ConversionCancelled());
    this.restart();
  }

  private start(): WorkerLike {
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    // An error nothing in the worker caught, such as running out of memory in some browsers.
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.failAll(toProblem(new Error(event.message || 'The worker stopped')));
      this.restart();
    };
    return worker;
  }

  private receive(response: WorkerResponse): void {
    const job = this.jobs.get(response.id);
    if (!job) return;
    if (response.type === 'progress') return job.onProgress(response.progress);
    this.jobs.delete(response.id);
    if (response.type === 'done') return job.resolve(response.result);
    job.reject(new ConversionProblem(response.code, response.detail));
    // After running out of memory the worker's heap may be left full: start afresh.
    if (response.code === 'out-of-memory') this.restart();
  }

  private restart(): void {
    this.worker.terminate();
    this.worker = this.start();
  }

  private failAll(error: Error): void {
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
  }
}
