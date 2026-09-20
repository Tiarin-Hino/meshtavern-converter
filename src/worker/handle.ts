import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
  try {
    const result = await runPipeline(
      request.stl,
      (progress) => post({ type: 'progress', id: request.id, progress }),
      request.up ?? null,
    );
    // Transfer instead of copy: mesh buffers can be hundreds of megabytes.
    const meshes = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    post(
      { type: 'done', id: request.id, result },
      meshes.flatMap((mesh) => [
        mesh.positions.buffer,
        mesh.indices.buffer,
        ...(mesh.normals ? [mesh.normals.buffer] : []),
      ]),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  }
}
