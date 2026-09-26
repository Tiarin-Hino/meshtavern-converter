import { describe, expect, it } from 'vitest';
import { ConversionProblem, isOutOfMemory, PROBLEM_MESSAGES, toProblem } from './problems';

describe('problems', () => {
  it('recognises the ways engines report running out of memory', () => {
    for (const message of [
      'Array buffer allocation failed',
      'Invalid typed array length: 4294967296',
      'WebAssembly.Memory.grow(): Maximum memory size exceeded',
      'Cannot enlarge memory arrays to size 2147483648 bytes (OOM)',
      'out of memory',
    ]) {
      expect(isOutOfMemory(new RangeError(message)), message).toBe(true);
    }
    for (const message of [
      "Cannot read properties of undefined (reading 'x')",
      "Cannot read properties of undefined (reading 'zoom')",
      'no room left in the atlas',
    ]) {
      expect(isOutOfMemory(new TypeError(message)), message).toBe(false);
    }
  });

  it('turns anything thrown into a problem with a message for the user and the detail kept', () => {
    const oom = toProblem(new RangeError('Array buffer allocation failed'));
    expect(oom.code).toBe('out-of-memory');
    expect(oom.message).toBe(PROBLEM_MESSAGES['too-large']);
    const bug = toProblem(new TypeError('x is undefined'));
    expect(bug).toMatchObject({ code: 'unexpected', detail: 'x is undefined' });
    const problem = new ConversionProblem('empty');
    expect(toProblem(problem)).toBe(problem);
    expect(toProblem('a string').code).toBe('unexpected');
  });

  it('says what to do in every message, without technical words', () => {
    for (const message of Object.values(PROBLEM_MESSAGES)) {
      expect(message).toMatch(/again|smaller|reduced|device/);
      expect(message).not.toMatch(/buffer|array|heap|wasm|worker|exception|NaN|manifold/i);
    }
  });
});
