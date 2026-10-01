import type { Answer, AskUp, Question } from '../pipeline/ask';
import { meshBuffers } from '../pipeline/mesh';
import { toProblem } from '../pipeline/problems';
import { runPipeline } from '../pipeline/run';
import type { Post, WorkerRequest } from './protocol';

/** What a question transfers: the meshes not sent yet, and the triangles of the patches drawn (#93). */
function questionBuffers(question: Question): ArrayBufferLike[] {
  const buffers = question.meshes.flatMap(({ mesh }) => meshBuffers(mesh));
  if (question.kind === 'meet')
    for (const { on, of } of question.pairs)
      for (const patch of [on, of]) if (patch) buffers.push(patch.triangles.buffer);
  return buffers;
}

/** The jobs waiting at a question, by id: what resolves their answer. */
const waiting = new Map<number, (answer: Answer) => void>();

/** Everything the worker does, kept free of `self` so it can be unit-tested. */
export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
  if (request.type === 'answer') {
    // An answer for a job that is not waiting (ended, or asked nothing) is ignored.
    const resolve = waiting.get(request.id);
    waiting.delete(request.id);
    resolve?.(request.answer);
    return;
  }
  const { id } = request;
  // The pipeline awaits the answer between steps, so the worker's message loop is free for it.
  const askUp: AskUp | undefined = request.options?.ask
    ? (question) =>
        new Promise((resolve) => {
          waiting.set(id, resolve);
          post({ type: 'question', id, question }, questionBuffers(question));
        })
    : undefined;
  try {
    const result = await runPipeline(request.stl, {
      ...request.options,
      askUp,
      onProgress: (progress) => post({ type: 'progress', id, progress }),
    });
    // Transfer instead of copy: mesh buffers can be hundreds of megabytes.
    const meshes = [result.mesh, ...result.lods.map((lod) => lod.mesh)];
    const transfer = meshes.flatMap(meshBuffers);
    if (result.baked) {
      const { mesh, ktx2, detail } = result.baked;
      transfer.push(...meshBuffers(mesh));
      for (const texture of [ktx2, detail]) if (texture) transfer.push(texture.buffer);
    }
    post({ type: 'done', id, result }, transfer);
  } catch (error) {
    const { code, detail } = toProblem(error);
    post({ type: 'error', id, code, detail });
  } finally {
    waiting.delete(id);
  }
}
