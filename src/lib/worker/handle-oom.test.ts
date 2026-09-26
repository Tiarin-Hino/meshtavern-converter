import { describe, expect, it, vi } from 'vitest';
import { encodeBinaryStl } from '../pipeline/stl';
import { handleRequest } from './handle';
import type { WorkerResponse } from './protocol';

// Running out of memory for real would take gigabytes; the engine's error is thrown instead.
vi.mock('../pipeline/run', () => ({
  runPipeline: vi.fn(() => Promise.reject(new RangeError('Array buffer allocation failed'))),
}));

describe('handleRequest when memory runs out', () => {
  it('ends in the too-large message instead of an uncaught error', async () => {
    const posted: WorkerResponse[] = [];
    await handleRequest({ type: 'convert', id: 3, stl: encodeBinaryStl([]) }, (response) =>
      posted.push(response),
    );
    expect(posted).toEqual([
      { type: 'error', id: 3, code: 'out-of-memory', detail: 'Array buffer allocation failed' },
    ]);
  });
});
