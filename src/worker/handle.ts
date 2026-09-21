import { meshBuffers } from '../pipeline/mesh';
import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
  try {
    const { up, ...options } = request.options ?? {};
    const result = await runPipeline(request.stl, {
      ...options,
      forcedUp: up ?? null,
      onProgress: (progress) => post({ type: 'progress', id: request.id, progress }),
    });
    // Transfer instead of copy: mesh buffers can be hundreds of megabytes.
    const meshes = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    const transfer = meshes.flatMap(meshBuffers);
    if (result.baked) {
      const { mesh, ktx2, detail } = result.baked;
      transfer.push(...meshBuffers(mesh));
      for (const texture of [ktx2, detail]) if (texture) transfer.push(texture.buffer);
    }
    post({ type: 'done', id: request.id, result }, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  }
}
