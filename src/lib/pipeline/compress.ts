/**
 * GPU-compressed detail textures. The raw RGBA texture is encoded to a KTX2 file with UASTC
 * (Basis Universal, WebAssembly, about 3.3 MB, loaded on first use) and Zstandard on top;
 * three.js transcodes that to whatever block format the GPU has (BC7 on desktops, ASTC or
 * ETC2 on phones). On the GPU that is 1 byte per texel instead of 4, and the file is what
 * gets stored and sent to other players. DOM-free: runs in the worker and in Node.
 */

/** UASTC effort, 0 (fastest) to 3. Phase 0 found no visible loss at 0, so that is the setting. */
export const DETAIL_EFFORT = 0;
export const DETAIL_EFFORTS = [0, 1, 2, 3] as const;

/** `supercompressionScheme` in a KTX2 header. */
export const KTX2_ZSTANDARD = 2;

export async function compressDetail(
  detail: Uint8Array,
  resolution: number,
  effort: number = DETAIL_EFFORT,
): Promise<Uint8Array> {
  const { encodeToKTX2 } = await import('ktx2-encoder');
  // The encoder expects an image file; its decoder hook lets us hand over raw pixels instead.
  return encodeToKTX2(new Uint8Array(1), {
    isUASTC: true,
    uastcLDRQualityLevel: effort,
    needSupercompression: true,
    generateMipmap: true,
    // Normals and cavity are data, not colours: no sRGB curve, no perceptual weighting.
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    isKTX2File: true,
    imageDecoder: async () => ({ width: resolution, height: resolution, data: detail }),
  });
}

export interface Ktx2Header {
  width: number;
  height: number;
  levels: number;
  supercompression: number;
}

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** The few header fields we check; throws when the bytes are not a KTX2 file. */
export function readKtx2Header(ktx2: Uint8Array): Ktx2Header {
  if (ktx2.byteLength < 48 || KTX2_IDENTIFIER.some((byte, i) => ktx2[i] !== byte)) {
    throw new Error('Not a KTX2 file');
  }
  const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
  return {
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    levels: view.getUint32(40, true),
    supercompression: view.getUint32(44, true),
  };
}
