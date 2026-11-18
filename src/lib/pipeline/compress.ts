import { loadBasisEncoder, type EncodeOptions } from './basis-encoder';
import type { Albedo } from './paint';

/**
 * GPU-compressed detail textures. The raw RGBA texture is encoded to a KTX2 file with UASTC
 * (Basis Universal, our own WebAssembly build in wasm/basis-encoder/, 3.1 MB or 1.2 MB gzipped,
 * loaded on first use) and Zstandard on top; three.js transcodes that to whatever block format
 * the GPU has (BC7 on desktops, ASTC or ETC2 on phones). On the GPU that is 1 byte per texel instead of 4, and the file is what
 * gets stored and sent to other players. DOM-free: runs in the worker and in Node.
 */

/** UASTC effort, 0 (fastest) to 3. Phase 0 found no visible loss at 0, so that is the setting. */
export const DETAIL_EFFORT = 0;
export const DETAIL_EFFORTS = [0, 1, 2, 3] as const;

/** `supercompressionScheme` in a KTX2 header. */
export const KTX2_ZSTANDARD = 2;

/**
 * Mipmaps filtered in sRGB space, as the encoder's default and ktx2-encoder before #38 left them.
 * Wrong for our texture, which holds data (normals and cavity), not colours; kept so that #38
 * changed only who compiles the encoder. Fixing it is #86.
 */
export const SRGB_MIPS = true;

/** The encoder settings for a detail texture. */
export const detailOptions = (effort: number): EncodeOptions => ({
  effort,
  supercompress: true,
  mipmaps: true,
  // Normals and cavity are data, not colours: no perceptual weighting, no sRGB curve in the header.
  perceptual: false,
  srgbTransfer: false,
  srgbMips: SRGB_MIPS,
});

export async function compressDetail(
  detail: Uint8Array,
  resolution: number,
  effort: number = DETAIL_EFFORT,
): Promise<Uint8Array> {
  const encoder = await loadBasisEncoder();
  return encoder.encodeKtx2(detail, resolution, resolution, detailOptions(effort));
}

/**
 * The encoder settings for the paint (#197): a colour texture, so perceptual weighting, the sRGB
 * transfer function in the header and mipmaps filtered in sRGB space; alpha is kept, straight.
 */
export const paintOptions = (effort: number): EncodeOptions => ({
  effort,
  supercompress: true,
  mipmaps: true,
  perceptual: true,
  srgbTransfer: true,
  srgbMips: true,
});

/**
 * The paint as a KTX2 file (#197): UASTC and Zstandard, the sRGB transfer function, alpha kept
 * (straight: 0 bare … 255 painted) and a full mip chain, for `transcodePaint` and the material's
 * `map`: about a quarter of the GPU memory of the paint's own pixels. The painted colour is spread
 * into the bare texels first (`spreadPaintColour`), so that a small mip shows no dark rim where
 * paint meets the bare coat. DOM-free: runs in a worker, on the page and in Node.
 */
export async function compressPaint(
  albedo: Albedo,
  effort: number = DETAIL_EFFORT,
): Promise<Uint8Array> {
  const { width, height, data } = albedo;
  if (width < 1 || height < 1 || data.length !== width * height * 4)
    throw new RangeError('A paint is width × height texels, four bytes each');
  const encoder = await loadBasisEncoder();
  return encoder.encodeKtx2(spreadPaintColour(albedo), width, height, paintOptions(effort));
}

/**
 * The paint with the colour of its painted texels spread into the bare ones (#197): every texel
 * whose alpha is 0 takes the colour (never the alpha) of the painted texels around it, by
 * pull-push: a pyramid of alpha-weighted averages is pulled up to one texel, and each bare texel
 * takes its parent's colour on the way down. A paint with nothing painted is returned as it is.
 * Painted texels (alpha above 0) keep their four bytes. A copy: the paint given is not changed.
 */
export function spreadPaintColour({ width, height, data }: Albedo): Uint8Array {
  const out = data.slice();
  // Level 0: alpha-weighted colour sums and weights, in floats.
  type Level = { w: number; h: number; sum: Float64Array; weight: Float64Array };
  const base: Level = {
    w: width,
    h: height,
    sum: new Float64Array(width * height * 3),
    weight: new Float64Array(width * height),
  };
  for (let t = 0; t < width * height; t++) {
    const a = data[t * 4 + 3]!;
    if (a === 0) continue;
    base.weight[t] = a;
    for (let c = 0; c < 3; c++) base.sum[t * 3 + c] = data[t * 4 + c]! * a;
  }
  // Pull: each level halves (rounding up), its texels the sums of up to four below.
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const below = levels.at(-1)!;
    const w = Math.max(1, Math.ceil(below.w / 2));
    const h = Math.max(1, Math.ceil(below.h / 2));
    const level: Level = {
      w,
      h,
      sum: new Float64Array(w * h * 3),
      weight: new Float64Array(w * h),
    };
    for (let y = 0; y < below.h; y++)
      for (let x = 0; x < below.w; x++) {
        const from = y * below.w + x;
        const to = (y >> 1) * w + (x >> 1);
        level.weight[to]! += below.weight[from]!;
        for (let c = 0; c < 3; c++) level.sum[to * 3 + c]! += below.sum[from * 3 + c]!;
      }
    levels.push(level);
  }
  if (levels.at(-1)!.weight[0] === 0) return out;
  // Push: a texel without weight takes its parent's colour, from the top down; level 0's bare
  // texels are written into the copy.
  const colour = levels.map((level) => new Float64Array(level.w * level.h * 3));
  for (let k = levels.length - 1; k >= 0; k--) {
    const level = levels[k]!;
    const parent = k + 1 < levels.length ? levels[k + 1]! : null;
    for (let y = 0; y < level.h; y++)
      for (let x = 0; x < level.w; x++) {
        const t = y * level.w + x;
        const weight = level.weight[t]!;
        for (let c = 0; c < 3; c++)
          colour[k]![t * 3 + c] =
            weight > 0
              ? level.sum[t * 3 + c]! / weight
              : colour[k + 1]![((y >> 1) * parent!.w + (x >> 1)) * 3 + c]!;
      }
  }
  for (let t = 0; t < width * height; t++) {
    if (data[t * 4 + 3] !== 0) continue;
    for (let c = 0; c < 3; c++) out[t * 4 + c] = Math.round(colour[0]![t * 3 + c]!);
  }
  return out;
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
