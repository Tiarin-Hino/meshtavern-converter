import { describe, expect, it } from 'vitest';
import { compressDetail, KTX2_ZSTANDARD, readKtx2Header } from './compress';

const RESOLUTION = 64;

/** A smooth gradient, like a real detail texture: compresses well. */
function gradient(): Uint8Array {
  const detail = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  for (let texel = 0; texel < RESOLUTION * RESOLUTION; texel++) {
    detail.set([texel % RESOLUTION, Math.floor(texel / RESOLUTION), 255, 128], texel * 4);
  }
  return detail;
}

describe('compressDetail', () => {
  it('writes a KTX2 file of the right size with mipmaps and Zstandard on top', async () => {
    const ktx2 = await compressDetail(gradient(), RESOLUTION);
    expect(readKtx2Header(ktx2)).toEqual({
      width: RESOLUTION,
      height: RESOLUTION,
      levels: Math.log2(RESOLUTION) + 1,
      supercompression: KTX2_ZSTANDARD,
    });
    // UASTC is 1 byte a texel before Zstandard; a gradient must end up well below that.
    expect(ktx2.byteLength).toBeLessThan(RESOLUTION * RESOLUTION);
  }, 60_000);

  it('leaves the texture it was given untouched', async () => {
    const detail = gradient();
    await compressDetail(detail, RESOLUTION);
    expect(detail).toEqual(gradient());
  }, 60_000);
});

describe('readKtx2Header', () => {
  it('refuses bytes that are not a KTX2 file', () => {
    expect(() => readKtx2Header(new Uint8Array(100))).toThrow('Not a KTX2 file');
    expect(() => readKtx2Header(new Uint8Array(4))).toThrow('Not a KTX2 file');
  });
});
