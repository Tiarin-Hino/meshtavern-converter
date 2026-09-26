import { checkFits } from './pipeline/memory';
import { SNIFF_BYTES, sniffStl } from './pipeline/stl';

/**
 * Reads an STL into memory the way the page does: the first `SNIFF_BYTES` and the size
 * decide whether the file is refused (empty, not an STL, cut short, too large for the
 * budget) before all of it is read. Without a budget, only the size check is skipped.
 * Throws a `ConversionProblem`. `Blob` exists in browsers, workers and Node.
 */
export async function readStlFile(file: Blob, memoryBudgetBytes?: number): Promise<ArrayBuffer> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const format = sniffStl(head, file.size);
  if (memoryBudgetBytes !== undefined) checkFits(file.size, format, memoryBudgetBytes);
  return file.arrayBuffer();
}
