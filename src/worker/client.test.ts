import { describe, expect, it } from 'vitest';
import { ConversionProblem, PROBLEM_MESSAGES } from '../pipeline/problems';
import type { ConversionResult } from '../pipeline/run';
import { ConversionCancelled, Converter, type WorkerLike } from './client';
import type { WorkerRequest, WorkerResponse } from './protocol';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  readonly requests: WorkerRequest[] = [];

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
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
    const job = converter.convert(new ArrayBuffer(84), (p) => seen.push(p.step), { bake: 512 });
    const request = workers[0]!.requests[0]!;
    expect(request.options).toEqual({ bake: 512 });

    workers[0]!.reply({ type: 'progress', id: request.id, progress: { step: 'read', percent: 0 } });
    workers[0]!.reply({ type: 'done', id: request.id, result });
    await expect(job).resolves.toBe(result);
    expect(seen).toEqual(['read']);
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
