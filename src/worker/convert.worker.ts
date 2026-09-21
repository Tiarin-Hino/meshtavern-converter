import type { IslandFinder } from '../pipeline/unwrap-parts';
import { handleRequest } from './handle';
import { startIslandPool } from './island-pool';
import type { WorkerRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Spike #34: started with the first conversion that asks for slabs, and kept. */
let islandPool: IslandFinder | undefined;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const variant = event.data.options?.unwrapVariant;
  if (variant && variant.cut > 0) islandPool ??= startIslandPool(variant.workers ?? variant.cut);
  void handleRequest(
    event.data,
    (response, transfer = []) => scope.postMessage(response, transfer),
    islandPool,
  );
};
