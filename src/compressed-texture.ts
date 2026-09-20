import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * Spike, issue #30: GPU-compressed detail textures. The raw RGBA texture is encoded to a
 * KTX2 file with UASTC (Basis Universal, WebAssembly, about 3.3 MB, loaded on first use),
 * and three.js transcodes that to whatever block format the GPU has (BC7 on desktops,
 * ASTC or ETC2 on phones). On the GPU that is 1 byte per texel instead of 4.
 */

/** Where the build serves three.js's Basis transcoder (see vite.config.ts). */
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}basis/`;

export interface CompressedDetail {
  ktx2: Uint8Array;
  encodeMs: number;
}

export async function encodeDetail(
  detail: Uint8Array,
  resolution: number,
  /** UASTC effort, 0 (fastest) to 3. */
  quality = 1,
): Promise<CompressedDetail> {
  const { encodeToKTX2 } = await import('ktx2-encoder');
  const start = performance.now();
  // The encoder expects an image file; its decoder hook lets us hand over raw pixels instead.
  const ktx2 = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: true,
    uastcLDRQualityLevel: quality,
    generateMipmap: true,
    // Normals and cavity are data, not colours: no sRGB curve, no perceptual weighting.
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    isKTX2File: true,
    imageDecoder: async () => ({ width: resolution, height: resolution, data: detail }),
  });
  return { ktx2, encodeMs: performance.now() - start };
}

let loader: KTX2Loader | null = null;

/** One transcode; the result can be duplicated with `ownCopy` for minis that must each own their texture. */
export function transcodeDetail(
  ktx2: Uint8Array,
  renderer: THREE.WebGLRenderer,
): Promise<THREE.CompressedTexture> {
  loader ??= new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
  const copy = ktx2.slice();
  return new Promise((resolve, reject) => {
    loader!.parse(
      copy.buffer,
      (texture) => {
        texture.colorSpace = THREE.NoColorSpace;
        resolve(texture);
      },
      reject,
    );
  });
}

/** A second GPU texture from the same transcoded blocks. */
export function ownCopy(texture: THREE.CompressedTexture): THREE.CompressedTexture {
  const copy = new THREE.CompressedTexture(
    texture.mipmaps,
    texture.image.width,
    texture.image.height,
    texture.format as THREE.CompressedPixelFormat,
    texture.type,
  );
  copy.minFilter = texture.minFilter;
  copy.magFilter = texture.magFilter;
  copy.colorSpace = texture.colorSpace;
  copy.needsUpdate = true;
  return copy;
}

/** GPU memory of a block-compressed texture at 1 byte per texel, with mipmaps. */
export const compressedTextureBytes = (resolution: number): number =>
  Math.round((resolution * resolution * 4) / 3);
