import { meshBuffers } from '../pipeline/mesh';
import { toProblem } from '../pipeline/problems';
import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
  try {
    const result = await runPipeline(request.stl, {
      ...request.options,
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
    const { code, detail } = toProblem(error);
    post({ type: 'error', id: request.id, code, detail });
  }
}
