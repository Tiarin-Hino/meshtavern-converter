import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from '../pipeline/generate';
import { meshBuffers } from '../pipeline/mesh';
import { STEPS } from '../pipeline/run';
import { encodeBinaryStl } from '../pipeline/stl';
import { handleRequest } from './handle';
import type { WorkerResponse } from './protocol';

async function collect(stl: ArrayBuffer, id = 7) {
  const posted: { response: WorkerResponse; transfer?: Transferable[] }[] = [];
  await handleRequest({ type: 'convert', id, stl }, (response, transfer) =>
    posted.push({ response, transfer }),
  );
  return posted;
}

describe('handleRequest', () => {
  it('posts one progress message per step, in order, then the result', async () => {
    const posted = await collect(encodeBinaryStl(generateBumpySheet(4)));
    expect(posted.map((p) => p.response.type)).toEqual([...STEPS.map(() => 'progress'), 'done']);
    const progress = posted.flatMap((p) =>
      p.response.type === 'progress' ? [p.response.progress] : [],
    );
    expect(progress.map((p) => p.step)).toEqual([...STEPS]);
    expect(progress.map((p) => p.percent)).toEqual([0, 17, 33, 50, 67, 83]);
  });

  it('echoes the job id on every message', async () => {
    const posted = await collect(encodeBinaryStl(generateBumpySheet(2)), 42);
    expect(posted.every((p) => p.response.id === 42)).toBe(true);
  });

  it('returns the mesh and its LODs with statistics, and transfers every buffer', async () => {
    const last = (await collect(encodeBinaryStl(generateBumpySheet(4)))).at(-1)!;
    if (last.response.type !== 'done') throw new Error('expected done');
    const { mesh, lods, stats } = last.response.result;
    expect(stats.format).toBe('binary');
    expect(stats.sourceTriangles).toBe(32);
    expect(stats.triangles).toBe(32);
    expect(stats.vertices).toBe(25);
    expect(stats.sizeMm[0]).toBeCloseTo(50);
    expect(stats.timings.map((t) => t.step)).toEqual([...STEPS]);
    expect(stats.peakBufferBytes).toBeGreaterThan(0);
    expect(stats.lods.map((lod) => lod.triangles)).toEqual(lods.map((lod) => lod.triangles));
    expect(last.transfer).toEqual([mesh, ...lods.map((lod) => lod.mesh)].flatMap(meshBuffers));
    // Shading is computed on the close level and inherited by the lower ones.
    for (const lod of lods) {
      expect(lod.mesh.occlusion?.length).toBe(lod.mesh.positions.length / 3);
      expect(lod.mesh.cavity?.length).toBe(lod.mesh.positions.length / 3);
    }
  });

  it('converts an empty STL without failing', async () => {
    expect((await collect(new ArrayBuffer(84))).at(-1)!.response.type).toBe('done');
  });

  it('reports a failure as an error message instead of throwing', async () => {
    const posted = await collect(undefined as unknown as ArrayBuffer);
    expect(posted.at(-1)!.response).toMatchObject({ type: 'error', id: 7 });
  });
});
