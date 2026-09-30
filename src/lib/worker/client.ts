import type { AskUp, UpQuestion } from '../pipeline/ask';
import { ConversionProblem, toProblem } from '../pipeline/problems';
import type { ConversionResult, Progress } from '../pipeline/run';
import type { ConvertOptions, WorkerRequest, WorkerResponse } from './protocol';

interface Job {
  onProgress: (progress: Progress) => void;
  resolve: (result: ConversionResult) => void;
  reject: (error: Error) => void;
  /** Answers the job's questions (#92); without it the job asks none. */
  askUp?: AskUp;
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
   * The STL buffer, and a base file's in `options.secondStl`, are transferred to the worker
   * and are unusable on the page afterwards. A file that does not become a mini rejects with
   * a `ConversionProblem`.
   *
   * With `askUp` the conversion stops after the orient step and asks which way is up (#92), for
   * the files `options.ask` names (all by default); its answer continues the conversion. When
   * it rejects, the job rejects with that error and the worker is started afresh, as on cancel.
   * Without it nothing is asked, whatever `options.ask` says.
   */
  convert(
    stl: ArrayBuffer,
    onProgress: (progress: Progress) => void,
    options: ConvertOptions = {},
    askUp?: AskUp,
  ): Promise<ConversionResult> {
    const id = this.nextId++;
    const { ask, ...rest } = options;
    const sent = askUp ? { ...rest, ask: ask ?? { up: true, baseUp: true } } : rest;
    const request: WorkerRequest = { type: 'convert', id, stl, options: sent };
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { onProgress, resolve, reject, askUp });
      this.worker.postMessage(request, options.secondStl ? [stl, options.secondStl] : [stl]);
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
    if (response.type === 'question') return this.ask(response.id, job, response.question);
    this.jobs.delete(response.id);
    if (response.type === 'done') return job.resolve(response.result);
    job.reject(new ConversionProblem(response.code, response.detail));
    // After running out of memory the worker's heap may be left full: start afresh, and
    // end whatever else was waiting for the old worker.
    if (response.code === 'out-of-memory') {
      this.failAll(new ConversionProblem('out-of-memory', response.detail));
      this.restart();
    }
  }

  /** Passes a question to the job's callback and its answer back, unless the job ended meanwhile. */
  private ask(id: number, job: Job, question: UpQuestion): void {
    if (!job.askUp) return;
    job.askUp(question).then(
      (answer) => {
        if (this.jobs.get(id) !== job) return;
        const request: WorkerRequest = { type: 'answer', id, answer };
        this.worker.postMessage(request);
      },
      (error: unknown) => {
        if (this.jobs.get(id) !== job) return;
        this.jobs.delete(id);
        job.reject(error instanceof Error ? error : new Error(String(error)));
        // The conversion cannot go on, and its memory should be freed: as on cancel.
        this.failAll(new ConversionCancelled());
        this.restart();
      },
    );
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
