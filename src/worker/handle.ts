import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export function handleRequest(request: WorkerRequest, post: Post): void {
  try {
    const result = runPipeline(request.stl, (progress) =>
      post({ type: 'progress', id: request.id, progress }),
    );
    // Transfer instead of copy: mesh buffers can be hundreds of megabytes.
    post({ type: 'done', id: request.id, result }, [
      result.mesh.positions.buffer,
      result.mesh.indices.buffer,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  }
}
