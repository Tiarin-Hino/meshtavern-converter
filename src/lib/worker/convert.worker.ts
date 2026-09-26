import { handleRequest } from './handle';
import type { WorkerRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data, (response, transfer = []) =>
    scope.postMessage(response, transfer),
  );
};
