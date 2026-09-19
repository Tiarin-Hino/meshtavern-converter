import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from '../pipeline/generate';
import { STEPS } from '../pipeline/run';
import { encodeBinaryStl } from '../pipeline/stl';
import { handleRequest } from './handle';
import type { WorkerResponse } from './protocol';

function collect(stl: ArrayBuffer, id = 7) {
  const posted: { response: WorkerResponse; transfer?: Transferable[] }[] = [];
  handleRequest({ type: 'convert', id, stl }, (response, transfer) =>
    posted.push({ response, transfer }),
  );
  return posted;
}

describe('handleRequest', () => {
  it('posts one progress message per step, in order, then the result', () => {
    const posted = collect(encodeBinaryStl(generateBumpySheet(4)));
    expect(posted.map((p) => p.response.type)).toEqual([
      'progress',
      'progress',
      'progress',
      'done',
    ]);
    const progress = posted.flatMap((p) =>
      p.response.type === 'progress' ? [p.response.progress] : [],
    );
    expect(progress.map((p) => p.step)).toEqual([...STEPS]);
    expect(progress.map((p) => p.percent)).toEqual([0, 33, 67]);
  });

  it('echoes the job id on every message', () => {
    const posted = collect(encodeBinaryStl(generateBumpySheet(2)), 42);
    expect(posted.every((p) => p.response.id === 42)).toBe(true);
  });

  it('returns the mesh with its statistics and transfers the mesh buffers', () => {
    const last = collect(encodeBinaryStl(generateBumpySheet(4))).at(-1)!;
    if (last.response.type !== 'done') throw new Error('expected done');
    const { mesh, stats } = last.response.result;
    expect(stats.format).toBe('binary');
    expect(stats.sourceTriangles).toBe(32);
    expect(stats.triangles).toBe(32);
    expect(stats.vertices).toBe(25);
    expect(stats.sizeMm[0]).toBeCloseTo(50);
    expect(stats.timings.map((t) => t.step)).toEqual([...STEPS]);
    expect(stats.peakBufferBytes).toBeGreaterThan(0);
    expect(last.transfer).toEqual([mesh.positions.buffer, mesh.indices.buffer]);
  });

  it('converts an empty STL without failing', () => {
    expect(collect(new ArrayBuffer(84)).at(-1)!.response.type).toBe('done');
  });

  it('reports a failure as an error message instead of throwing', () => {
    const posted = collect(undefined as unknown as ArrayBuffer);
    expect(posted.at(-1)!.response).toMatchObject({ type: 'error', id: 7 });
  });
});
