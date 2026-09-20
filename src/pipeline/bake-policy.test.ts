import { describe, expect, it } from 'vitest';
import { detailResolutionFor, surfaceAreaMm2 } from './bake-policy';

describe('surfaceAreaMm2', () => {
  it('adds up triangle areas', () => {
    // A 10 × 10 mm square as two triangles.
    const square = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    expect(surfaceAreaMm2(square)).toBeCloseTo(100);
  });
});

describe('detailResolutionFor', () => {
  it('gives small minis a small texture and large ones a large texture', () => {
    expect(detailResolutionFor(800)).toBe(512); // a familiar or a swarm base
    expect(detailResolutionFor(3000)).toBe(1024); // a 32 mm humanoid
    expect(detailResolutionFor(18_000)).toBe(2048); // a giant
  });

  it('never goes beyond the largest size on offer', () => {
    expect(detailResolutionFor(1_000_000)).toBe(2048);
  });

  it('switches where the texel size would pass 0.1 mm', () => {
    // 1024 texels at 0.1 mm with half the texture covered: 1024² × 0.01 × 0.5 mm².
    const limit = 1024 * 1024 * 0.01 * 0.5;
    expect(detailResolutionFor(limit - 1)).toBe(1024);
    expect(detailResolutionFor(limit + 1)).toBe(2048);
  });
});
