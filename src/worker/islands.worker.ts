// Spike #34: finds the UV islands of one slab. Several of these run side by side, each with
// its own WebAssembly unwrapper, started and warmed up before the first slab arrives.
import type { ChartOptions } from 'xatlas-wasm';
import type { IndexedMesh } from '../pipeline/mesh';
import { unwrapperReady } from '../pipeline/unwrap';
import { findIslands, type PartIslands } from '../pipeline/unwrap-parts';

export interface IslandsRequest {
  id: number;
  mesh: IndexedMesh;
  options: ChartOptions;
  texelsPerUnit: number;
}
export type IslandsResponse = { id: number; islands: PartIslands } | { id: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
void unwrapperReady();

scope.onmessage = async (event: MessageEvent<IslandsRequest>) => {
  const { id, mesh, options, texelsPerUnit } = event.data;
  try {
    const islands = await findIslands(mesh, options, texelsPerUnit);
    const response: IslandsResponse = { id, islands };
    scope.postMessage(response, [islands.uvs.buffer, islands.xref.buffer, islands.indices.buffer]);
  } catch (error) {
    const response: IslandsResponse = { id, error: String(error) };
    scope.postMessage(response);
  }
};
