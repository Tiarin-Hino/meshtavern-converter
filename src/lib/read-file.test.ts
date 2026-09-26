import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from './pipeline/generate';
import { estimateConversionBytes } from './pipeline/memory';
import { ConversionProblem } from './pipeline/problems';
import { encodeBinaryStl } from './pipeline/stl';
import { readStlFile } from './read-file';

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConversionProblem);
  return (error as ConversionProblem).code;
}

describe('readStlFile', () => {
  const stl = encodeBinaryStl(generateBumpySheet(20));

  it('refuses an empty file', async () => {
    expect(await refusal(readStlFile(new Blob([])))).toBe('empty');
  });

  it('refuses a file of zeros: not an STL', async () => {
    expect(await refusal(readStlFile(new Blob([new Uint8Array(4096)])))).toBe('not-stl');
  });

  it('refuses a valid STL too large for the budget, before reading all of it', async () => {
    const needed = estimateConversionBytes(stl.byteLength, 'binary');
    const blob = new Blob([stl]);
    let fullReads = 0;
    const read = blob.arrayBuffer.bind(blob);
    blob.arrayBuffer = () => {
      fullReads++;
      return read();
    };
    expect(await refusal(readStlFile(blob, needed - 1))).toBe('too-large');
    expect(fullReads).toBe(0);
  });

  it('reads a valid STL that fits the budget, or when no budget is given', async () => {
    const needed = estimateConversionBytes(stl.byteLength, 'binary');
    for (const budget of [needed, undefined]) {
      const buffer = await readStlFile(new Blob([stl]), budget);
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array(stl));
    }
  });
});
