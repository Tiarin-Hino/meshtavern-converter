import { describe, expect, it } from 'vitest';
import { chunkRanges, UPLOAD_BYTES_PER_FRAME } from './mesh-chunks';

describe('chunkRanges', () => {
  it('covers every triangle once, in order, a frame of bytes each', () => {
    // 48 bytes a frame: 4 triangles; the first chunk shares its frame with 24 bytes of positions.
    expect(chunkRanges(10, 24, 48)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 6 },
      { from: 6, to: 10 },
    ]);
    expect(chunkRanges(0, 0, 48)).toEqual([]);
  });

  it('gives positions larger than a frame a chunk of one triangle', () => {
    expect(chunkRanges(3, 100, 48)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 3 },
    ]);
  });

  it('leaves an ordinary mini whole', () => {
    // 200,000 triangles over 100,000 vertices: 1.2 MB of positions, 2.4 MB of indices.
    expect(chunkRanges(200_000, 1_200_000)).toEqual([{ from: 0, to: 200_000 }]);
  });

  it('cuts the largest corpus mini into a frame of positions and 9 of indices', () => {
    const triangles = 5_624_997;
    const ranges = chunkRanges(triangles, 2_812_124 * 12);
    expect(ranges[0]).toEqual({ from: 0, to: 1 });
    expect(ranges).toHaveLength(1 + Math.ceil((triangles - 1) / (UPLOAD_BYTES_PER_FRAME / 12)));
    expect(ranges).toHaveLength(10);
  });
});
