import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_TRIANGLE,
  checkFits,
  DEVICE_SHARE,
  estimateConversionBytes,
  estimateTriangles,
  FIXED_BYTES,
  memoryBudgetBytes,
  UNKNOWN_DEVICE_GB,
} from './memory';
import { ConversionProblem } from './problems';

const GB = 1024 ** 3;

describe('memory estimate', () => {
  it('knows the triangles of a binary STL exactly and overestimates those of an ASCII one', () => {
    expect(estimateTriangles(84 + 50 * 1000, 'binary')).toBe(1000);
    // 1,000 triangles of ASCII take about 230 KB.
    expect(estimateTriangles(230_000, 'ascii')).toBeGreaterThan(1000);
  });

  it('grows with the file: the file itself, a share per triangle and a fixed part', () => {
    const bytes = 84 + 50 * 1_000_000;
    expect(estimateConversionBytes(bytes, 'binary')).toBe(
      bytes + 1_000_000 * BYTES_PER_TRIANGLE + FIXED_BYTES,
    );
  });

  it('allows a share of what the device reports, and assumes an ordinary laptop when it says nothing', () => {
    expect(memoryBudgetBytes(8)).toBe(8 * GB * DEVICE_SHARE);
    expect(memoryBudgetBytes(undefined)).toBe(UNKNOWN_DEVICE_GB * GB * DEVICE_SHARE);
    expect(memoryBudgetBytes(0)).toBe(memoryBudgetBytes(undefined));
  });

  it('lets the largest corpus file through on an 8 GB device and refuses it on a 2 GB one', () => {
    // AlpharioxDragonForebearer: 281 MB binary, 5.6M triangles.
    const largest = 84 + 50 * 5_625_026;
    expect(() => checkFits(largest, 'binary', memoryBudgetBytes(8))).not.toThrow();
    expect(() => checkFits(largest, 'binary', memoryBudgetBytes(2))).toThrow(ConversionProblem);
  });

  it('lets an ordinary mini through even on a phone that reports 2 GB', () => {
    // A 1.25M-triangle humanoid, 63 MB.
    expect(() => checkFits(84 + 50 * 1_253_530, 'binary', memoryBudgetBytes(2))).not.toThrow();
  });
});
