import { describe, expect, it } from 'vitest';
import { ConversionProblem, PROBLEM_MESSAGES } from '../pipeline/problems';
import type { ConversionResult } from '../pipeline/run';
import { ConversionCancelled, Converter, type WorkerLike } from './client';
import type { Question, UpAnswer, UpQuestion } from '../pipeline/ask';
import type { WorkerRequest, WorkerResponse } from './protocol';

type ConvertRequest = Extract<WorkerRequest, { type: 'convert' }>;

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  readonly requests: WorkerRequest[] = [];
  /** The convert requests only. */
  get converts(): ConvertRequest[] {
    return this.requests.filter((r): r is ConvertRequest => r.type === 'convert');
  }
  readonly transfers: Transferable[][] = [];

  postMessage(
    request: WorkerRequest,
    transfer?: Transferable[] | StructuredSerializeOptions,
  ): void {
    this.requests.push(request);
    this.transfers.push(Array.isArray(transfer) ? transfer : []);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: WorkerResponse): void {
    this.onmessage?.call(this as unknown as Worker, { data: response } as MessageEvent);
  }
}

function setUp(): { converter: Converter; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const converter = new Converter(() => {
    workers.push(new FakeWorker());
    return workers.at(-1)!;
  });
  return { converter, workers };
}

const result = { stats: {} } as ConversionResult;

describe('Converter', () => {
  it('sends the options along and resolves with the result', async () => {
    const { converter, workers } = setUp();
    const seen: string[] = [];
    const job = converter.convert(new ArrayBuffer(84), (p) => seen.push(p.step), {
      bake: 512,
      kind: 'prop',
    });
    const request = workers[0]!.converts[0]!;
    expect(request.options).toEqual({ bake: 512, kind: 'prop' });

    workers[0]!.reply({ type: 'progress', id: request.id, progress: { step: 'read', percent: 0 } });
    workers[0]!.reply({ type: 'done', id: request.id, result });
    await expect(job).resolves.toBe(result);
    expect(seen).toEqual(['read']);
  });

  it('transfers both files of a pair to the worker', () => {
    const { converter, workers } = setUp();
    const stl = new ArrayBuffer(84);
    const secondStl = new ArrayBuffer(84);
    void converter.convert(stl, () => {}, { secondStl, pairing: { swap: true } });
    expect(workers[0]!.transfers[0]).toEqual([stl, secondStl]);
    expect(workers[0]!.converts[0]!.options).toMatchObject({ secondStl, pairing: { swap: true } });
    void converter.convert(new ArrayBuffer(84), () => {});
    expect(workers[0]!.transfers[1]).toHaveLength(1);
  });

  it('transfers every file of a figure in parts, in the order given (#93)', () => {
    const { converter, workers } = setUp();
    const [stl, secondStl, third, fourth] = [84, 84, 84, 84].map((n) => new ArrayBuffer(n));
    const moreStl = [third!, fourth!];
    void converter.convert(stl!, () => {}, { secondStl, moreStl });
    expect(workers[0]!.transfers[0]).toEqual([stl, secondStl, third, fourth]);
    expect(workers[0]!.converts[0]!.options).toMatchObject({ secondStl, moreStl });
  });

  it('cancels by ending the worker, and converts the next file in a fresh one', async () => {
    const { converter, workers } = setUp();
    const progress: string[] = [];
    const job = converter.convert(new ArrayBuffer(84), (p) => progress.push(p.step));
    converter.cancel();

    await expect(job).rejects.toBeInstanceOf(ConversionCancelled);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);

    // Whatever the old worker still had in flight is ignored.
    workers[0]!.reply({ type: 'progress', id: 1, progress: { step: 'weld', percent: 10 } });
    expect(progress).toEqual([]);

    const next = converter.convert(new ArrayBuffer(84), () => {});
    expect(workers[1]!.requests).toHaveLength(1);
    workers[1]!.reply({ type: 'done', id: workers[1]!.requests[0]!.id, result });
    await expect(next).resolves.toBe(result);
  });

  it('leaves the worker alone when nothing is being converted', () => {
    const { converter, workers } = setUp();
    converter.cancel();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(false);
  });

  it('rejects a refused file with the message for the user', async () => {
    const { converter, workers } = setUp();
    const job = converter.convert(new ArrayBuffer(84), () => {});
    workers[0]!.reply({ type: 'error', id: 1, code: 'truncated', detail: '84 bytes' });
    const problem = await job.catch((error: unknown) => error);
    expect(problem).toBeInstanceOf(ConversionProblem);
    expect(problem).toMatchObject({ code: 'truncated', message: PROBLEM_MESSAGES.truncated });
    expect(workers).toHaveLength(1);
  });

  it('starts a fresh worker after memory ran out, and converts the next file there', async () => {
    const { converter, workers } = setUp();
    const job = converter.convert(new ArrayBuffer(84), () => {});
    workers[0]!.reply({ type: 'error', id: 1, code: 'out-of-memory' });
    await expect(job).rejects.toMatchObject({ code: 'out-of-memory' });
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    void converter.convert(new ArrayBuffer(84), () => {});
    expect(workers[1]!.requests).toHaveLength(1);
  });

  it('ends every job still waiting for a worker that ran out of memory', async () => {
    const { converter, workers } = setUp();
    const first = converter.convert(new ArrayBuffer(84), () => {});
    const second = converter.convert(new ArrayBuffer(84), () => {});
    workers[0]!.reply({ type: 'error', id: 1, code: 'out-of-memory' });
    await expect(first).rejects.toMatchObject({ code: 'out-of-memory' });
    await expect(second).rejects.toMatchObject({ code: 'out-of-memory' });
  });

  it('turns a worker that dies without a word into a problem, and starts a fresh one', async () => {
    const { converter, workers } = setUp();
    const job = converter.convert(new ArrayBuffer(84), () => {});
    workers[0]!.onerror?.call(
      workers[0] as unknown as Worker,
      { message: 'out of memory' } as ErrorEvent,
    );
    await expect(job).rejects.toMatchObject({
      code: 'out-of-memory',
      message: PROBLEM_MESSAGES['too-large'],
    });
    expect(workers).toHaveLength(2);
  });
});

describe('Converter asking which way is up (#92)', () => {
  const question = { kind: 'up', role: 'mini', file: 0 } as UpQuestion;
  const answer: UpAnswer = { kind: 'up', orientation: { up: '+x' }, confirm: true };
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('asks about every file by default, and passes the answer back to the worker', async () => {
    const { converter, workers } = setUp();
    const asked: Question[] = [];
    const job = converter.convert(
      new ArrayBuffer(84),
      () => {},
      { bake: 0 },
      (q) => {
        asked.push(q);
        return Promise.resolve(answer);
      },
    );
    const worker = workers[0]!;
    expect(worker.converts[0]!.options).toEqual({
      bake: 0,
      ask: { up: true, baseUp: true, parts: true, meet: true },
    });
    worker.reply({ type: 'question', id: 1, question });
    await settle();
    expect(asked).toEqual([question]);
    expect(worker.requests[1]).toEqual({ type: 'answer', id: 1, answer });
    worker.reply({ type: 'done', id: 1, result });
    await expect(job).resolves.toBe(result);
  });

  it('keeps the files named in the options, and strips them without a callback', () => {
    const { converter, workers } = setUp();
    void converter.convert(
      new ArrayBuffer(84),
      () => {},
      { ask: { baseUp: false } },
      () => Promise.resolve(answer),
    );
    expect(workers[0]!.converts[0]!.options).toEqual({ ask: { baseUp: false } });
    void converter.convert(new ArrayBuffer(84), () => {}, { bake: 0, ask: { up: true } });
    expect(workers[0]!.converts[1]!.options).toEqual({ bake: 0 });
  });

  it('posts nothing for a job cancelled while the question was open', async () => {
    const { converter, workers } = setUp();
    let answerNow: (a: UpAnswer) => void = () => {};
    const job = converter.convert(
      new ArrayBuffer(84),
      () => {},
      {},
      () => new Promise((resolve) => (answerNow = resolve)),
    );
    workers[0]!.reply({ type: 'question', id: 1, question });
    converter.cancel();
    await expect(job).rejects.toBeInstanceOf(ConversionCancelled);
    answerNow(answer);
    await settle();
    expect(workers[0]!.requests).toHaveLength(1);
    expect(workers[1]!.requests).toHaveLength(0);
  });

  it('rejects with the callback’s error and starts a fresh worker', async () => {
    const { converter, workers } = setUp();
    const job = converter.convert(
      new ArrayBuffer(84),
      () => {},
      {},
      () => Promise.reject(new Error('the page went away')),
    );
    workers[0]!.reply({ type: 'question', id: 1, question });
    await expect(job).rejects.toThrow('the page went away');
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });
});
