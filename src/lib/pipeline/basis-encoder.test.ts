import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { gradientTexture, noiseTexture } from '../../regression/textures';
import { loadBasisEncoder, type BasisEncoder, type EncodeOptions } from './basis-encoder';
import { KTX2_ZSTANDARD, readKtx2Header } from './compress';

const WASM = new URL('../../../wasm/basis-encoder/basis_encoder.wasm', import.meta.url);

/**
 * Everything the module may reach outside itself (design note, section 5). A new entry is a
 * question for a human, not a stub. fd_read comes from the file loaders' fread; without
 * path_open no file can be opened, and the wrapper refuses the read.
 */
const ALLOWED_IMPORTS = [
  'env.emscripten_notify_memory_growth',
  'wasi_snapshot_preview1.clock_time_get',
  'wasi_snapshot_preview1.environ_get',
  'wasi_snapshot_preview1.environ_sizes_get',
  'wasi_snapshot_preview1.fd_close',
  'wasi_snapshot_preview1.fd_read',
  'wasi_snapshot_preview1.fd_seek',
  'wasi_snapshot_preview1.fd_write',
];

const EXPORTS = ['mt_init', 'mt_encode', 'mt_output', 'mt_release', 'memory', 'malloc', 'free'];

const OPTIONS: EncodeOptions = {
  effort: 0,
  supercompress: true,
  mipmaps: true,
  perceptual: false,
  srgbTransfer: false,
  srgbMips: true,
};

describe('the basis encoder module', () => {
  const module = new WebAssembly.Module(readFileSync(WASM));

  it('imports nothing but the pinned list', () => {
    const imports = WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`);
    expect(imports.sort()).toEqual(ALLOWED_IMPORTS);
  });

  it('exports the shim and the allocator', () => {
    const exports = WebAssembly.Module.exports(module).map((e) => e.name);
    expect(exports).toEqual(expect.arrayContaining(EXPORTS));
  });
});

describe('BasisEncoder', () => {
  let encoder: BasisEncoder;
  beforeAll(async () => {
    encoder = await loadBasisEncoder();
  });

  it('encodes a 64² gradient to a small KTX2 file with mipmaps and Zstandard', () => {
    const ktx2 = encoder.encodeKtx2(gradientTexture(64), 64, 64, OPTIONS);
    expect(readKtx2Header(ktx2)).toEqual({
      width: 64,
      height: 64,
      levels: 7,
      supercompression: KTX2_ZSTANDARD,
    });
    expect(ktx2.byteLength).toBeLessThan(64 * 64);
  });

  it('follows the effort and the supercompression it is given', () => {
    const rgba = noiseTexture(64);
    const fastest = encoder.encodeKtx2(rgba, 64, 64, OPTIONS);
    const slower = encoder.encodeKtx2(rgba, 64, 64, { ...OPTIONS, effort: 3 });
    expect(slower).not.toEqual(fastest);
    const plain = encoder.encodeKtx2(rgba, 64, 64, { ...OPTIONS, supercompress: false });
    expect(readKtx2Header(plain).supercompression).toBe(0);
    const single = encoder.encodeKtx2(rgba, 64, 64, { ...OPTIONS, mipmaps: false });
    expect(readKtx2Header(single).levels).toBe(1);
  });

  it('refuses an empty image with its reason', () => {
    expect(() => encoder.encodeKtx2(new Uint8Array(0), 0, 0, OPTIONS)).toThrow(
      'Encode failed: no image',
    );
    expect(() => encoder.encodeKtx2(new Uint8Array(10), 4, 4, OPTIONS)).toThrow(
      /^Encode failed: 10 bytes is not a 4 × 4 RGBA image/,
    );
  });

  it('leaves the texture it was given untouched', () => {
    const rgba = gradientTexture(64);
    encoder.encodeKtx2(rgba, 64, 64, OPTIONS);
    expect(rgba).toEqual(gradientTexture(64));
  });

  it('writes the same file for the same texture every time', () => {
    const rgba = noiseTexture(128);
    expect(encoder.encodeKtx2(rgba, 128, 128, OPTIONS)).toEqual(
      encoder.encodeKtx2(rgba, 128, 128, OPTIONS),
    );
  });

  it('still reads correctly after the heap has grown for a 2048² texture', async () => {
    const fresh = await import('./basis-encoder').then((m) =>
      m.instantiateBasisEncoder(readFileSync(WASM)),
    );
    const small = fresh.encodeKtx2(gradientTexture(64), 64, 64, OPTIONS);
    const before = fresh.heapBytes;
    const large = fresh.encodeKtx2(gradientTexture(2048), 2048, 2048, OPTIONS);
    expect(readKtx2Header(large)).toMatchObject({ width: 2048, height: 2048, levels: 12 });
    // The heap started at 128 MB; a 2048² texture with its working copies needs more.
    expect(fresh.heapBytes).toBeGreaterThan(before);
    const again = fresh.encodeKtx2(gradientTexture(64), 64, 64, OPTIONS);
    expect(again).toEqual(small);
  }, 60_000);
});
