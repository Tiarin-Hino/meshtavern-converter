import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gradientTexture, noiseTexture } from '../../regression/textures';
import { compressDetail, DETAIL_EFFORT, KTX2_ZSTANDARD, readKtx2Header } from './compress';

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

/**
 * What the encoder writes for two generated textures at the pipeline's settings, recorded
 * 2026-09-27 from ktx2-encoder 0.6.0 (Basis Universal 1b33fd50, Emscripten 4.0.15) before #38
 * replaced it with our own build of the same commit. Same sources, same defines, same
 * optimisation level: the files are expected to stay identical byte for byte.
 */
const KTX2_FIXTURE_SHA256 = {
  gradient64: '79322dc3db706aa0fa45a33a4d8e01bd0c01481ad1d9f4518255aa3d4965ca72',
  noise256: '16a0f5caad352bab45755345d7122be0e151d2e30fea5d821f7500a7dbfe0717',
};

describe('compressDetail fixture', () => {
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  it('writes the same file as before for a 64² gradient', async () => {
    const ktx2 = await compressDetail(gradientTexture(64), 64, DETAIL_EFFORT);
    expect(sha256(ktx2)).toBe(KTX2_FIXTURE_SHA256.gradient64);
  }, 60_000);

  it('writes the same file as before for a seeded 256² noise', async () => {
    const ktx2 = await compressDetail(noiseTexture(256), 256, DETAIL_EFFORT);
    expect(sha256(ktx2)).toBe(KTX2_FIXTURE_SHA256.noise256);
  }, 60_000);
});

describe('readKtx2Header', () => {
  it('refuses bytes that are not a KTX2 file', () => {
    expect(() => readKtx2Header(new Uint8Array(100))).toThrow('Not a KTX2 file');
    expect(() => readKtx2Header(new Uint8Array(4))).toThrow('Not a KTX2 file');
  });
});
