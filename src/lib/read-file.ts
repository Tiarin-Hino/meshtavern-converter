import {
  checkFits,
  checkNeeded,
  estimateAssemblyBytes,
  estimatePairBytes,
} from './pipeline/memory';
import { SNIFF_BYTES, sniffStl, type StlFormat } from './pipeline/stl';

/**
 * Reads an STL into memory the way the page does: the first `SNIFF_BYTES` and the size
 * decide whether the file is refused (empty, not an STL, cut short, too large for the
 * budget) before all of it is read. Without a budget, only the size check is skipped.
 * Throws a `ConversionProblem`. `Blob` exists in browsers, workers and Node.
 */
export async function readStlFile(file: Blob, memoryBudgetBytes?: number): Promise<ArrayBuffer> {
  return (await readStlFiles([file], memoryBudgetBytes))[0]!;
}

/**
 * Reads the files of one conversion (a figure and its base, or a figure in parts, in the order
 * `convert` takes them): every file is sniffed and the group's estimate, the one the conversion
 * checks, is held against the budget before any file is read in full. Throws a
 * `ConversionProblem`; the count is `convert`'s to refuse.
 */
export async function readStlFiles(
  files: readonly Blob[],
  memoryBudgetBytes?: number,
): Promise<ArrayBuffer[]> {
  const sized: { byteLength: number; format: StlFormat }[] = [];
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    sized.push({ byteLength: file.size, format: sniffStl(head, file.size) });
  }
  if (memoryBudgetBytes !== undefined) {
    const [first, second] = sized;
    if (sized.length > 2) checkNeeded(estimateAssemblyBytes(sized), memoryBudgetBytes);
    else if (first && second)
      checkNeeded(
        estimatePairBytes(first.byteLength, first.format, second.byteLength, second.format),
        memoryBudgetBytes,
      );
    else if (first) checkFits(first.byteLength, first.format, memoryBudgetBytes);
  }
  return Promise.all(files.map((file) => file.arrayBuffer()));
}
