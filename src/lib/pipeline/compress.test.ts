import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gradientTexture, noiseTexture } from '../../regression/textures';
import {
  compressDetail,
  compressPaint,
  DETAIL_EFFORT,
  KTX2_ZSTANDARD,
  readKtx2Header,
  spreadPaintColour,
} from './compress';

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

/** The transfer function a KTX2 file's data format descriptor names: 1 linear, 2 sRGB. */
function transferOf(ktx2: Uint8Array): number {
  const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
  // dfdTotalSize, then the basic block's header (8 bytes), colour model and primaries.
  return ktx2[view.getUint32(48, true) + 4 + 8 + 2]!;
}

/** A 64² paint: a red square in the middle (alpha 255), a soft edge of alpha 128 around it, the rest bare. */
function squarePaint(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  for (let y = 0; y < RESOLUTION; y++)
    for (let x = 0; x < RESOLUTION; x++) {
      const inner = x >= 24 && x < 40 && y >= 24 && y < 40;
      const edge = !inner && x >= 23 && x < 41 && y >= 23 && y < 41;
      if (inner || edge) data.set([200, 30, 20, inner ? 255 : 128], (y * RESOLUTION + x) * 4);
    }
  return { width: RESOLUTION, height: RESOLUTION, data };
}

describe('spreadPaintColour (#197)', () => {
  it('gives every bare texel the painted colour, alpha 0, and leaves painted texels as they are', () => {
    const paint = squarePaint();
    const spread = spreadPaintColour(paint);
    for (let t = 0; t < RESOLUTION * RESOLUTION; t++) {
      if (paint.data[t * 4 + 3] !== 0)
        expect([...spread.subarray(t * 4, t * 4 + 4)]).toEqual([
          ...paint.data.subarray(t * 4, t * 4 + 4),
        ]);
      // One colour painted: every bare texel takes it, and stays bare.
      else expect([...spread.subarray(t * 4, t * 4 + 4)]).toEqual([200, 30, 20, 0]);
    }
    expect(paint.data).toEqual(squarePaint().data);
  });

  it('takes the nearer colour where two meet, and leaves a paint with nothing painted bare', () => {
    const data = new Uint8Array(RESOLUTION * RESOLUTION * 4);
    data.set([255, 0, 0, 255], (10 * RESOLUTION + 2) * 4);
    data.set([0, 0, 255, 255], (50 * RESOLUTION + 60) * 4);
    const spread = spreadPaintColour({ width: RESOLUTION, height: RESOLUTION, data });
    expect([...spread.subarray((11 * RESOLUTION + 3) * 4, (11 * RESOLUTION + 3) * 4 + 4)]).toEqual([
      255, 0, 0, 0,
    ]);
    expect([
      ...spread.subarray((49 * RESOLUTION + 59) * 4, (49 * RESOLUTION + 59) * 4 + 4),
    ]).toEqual([0, 0, 255, 0]);
    const bare = new Uint8Array(RESOLUTION * RESOLUTION * 4);
    expect(spreadPaintColour({ width: RESOLUTION, height: RESOLUTION, data: bare })).toEqual(bare);
  });
});

describe('compressPaint (#197)', () => {
  it('writes an sRGB KTX2 with a full mip chain and Zstandard, the paint untouched', async () => {
    const paint = squarePaint();
    const ktx2 = await compressPaint(paint);
    expect(readKtx2Header(ktx2)).toEqual({
      width: RESOLUTION,
      height: RESOLUTION,
      levels: Math.log2(RESOLUTION) + 1,
      supercompression: KTX2_ZSTANDARD,
    });
    expect(transferOf(ktx2)).toBe(2);
    // The detail texture's is linear: data, not colour.
    expect(transferOf(await compressDetail(gradient(), RESOLUTION))).toBe(1);
    expect(paint.data).toEqual(squarePaint().data);
  }, 60_000);

  it('refuses a paint whose bytes are not four a texel', async () => {
    await expect(compressPaint({ width: 4, height: 4, data: new Uint8Array(10) })).rejects.toThrow(
      RangeError,
    );
  });
});
