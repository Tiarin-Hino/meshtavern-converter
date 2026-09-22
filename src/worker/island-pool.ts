// Spike #34: workers that find UV islands, started from inside the conversion worker.
import { meshBuffers } from '../pipeline/mesh';
import type { IslandFinder, PartIslands } from '../pipeline/unwrap-parts';
import type { IslandsRequest, IslandsResponse } from './islands.worker';

/**
 * Starts `size` workers at once, so that their unwrappers compile and warm up while the
 * conversion is still busy with earlier steps. Slabs are handed out largest first; a worker
 * that is done takes the next one.
 */
export function startIslandPool(size: number): IslandFinder {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL('./islands.worker.ts', import.meta.url), { type: 'module' }),
  );
  return (meshes, options, texelsPerUnit, onProgress) =>
    new Promise((resolve, reject) => {
      const results = new Array<PartIslands>(meshes.length);
      const queue = meshes
        .map((mesh, id) => ({ id, mesh }))
        .sort((a, b) => b.mesh.indices.length - a.mesh.indices.length);
      let finished = 0;
      const next = (worker: Worker): void => {
        const job = queue.shift();
        if (!job) return;
        const request: IslandsRequest = { ...job, options, texelsPerUnit };
        worker.postMessage(request, meshBuffers(job.mesh) as ArrayBuffer[]);
      };
      for (const worker of workers) {
        worker.onerror = (event) => reject(new Error(event.message || 'Island worker crashed'));
        worker.onmessage = (event: MessageEvent<IslandsResponse>) => {
          if ('error' in event.data) return reject(new Error(event.data.error));
          results[event.data.id] = event.data.islands;
          finished++;
          onProgress(Math.round((finished / meshes.length) * 100));
          if (finished === meshes.length) resolve(results);
          else next(worker);
        };
        next(worker);
      }
    });
}
