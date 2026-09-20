import { meshBuffers } from '../pipeline/mesh';
import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
  try {
    const result = await runPipeline(
      request.stl,
      (progress) => post({ type: 'progress', id: request.id, progress }),
      request.up ?? null,
      request.bakeResolution ?? 0,
    );
    // Transfer instead of copy: mesh buffers can be hundreds of megabytes.
    const meshes = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    const transfer = meshes.flatMap(meshBuffers);
    if (result.baked) {
      const { mesh, maps } = result.baked;
      transfer.push(...meshBuffers(mesh), maps.detail.buffer);
    }
    post({ type: 'done', id: request.id, result }, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  }
}
