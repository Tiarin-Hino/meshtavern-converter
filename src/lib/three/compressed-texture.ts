import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * The page's side of GPU-compressed detail textures: three.js transcodes the KTX2 file the
 * worker made (pipeline/compress.ts) to whatever block format the GPU has, in workers of
 * its own.
 */

let loader: KTX2Loader | null = null;
let loaderPath = '';

/**
 * One transcode; the result can be duplicated with `ownCopy` for minis that must each own their texture.
 * `transcoderPath` is where three.js's `basis_transcoder.{js,wasm}` are served; by default where
 * this page's build serves them (see vite.config.ts).
 */
export function transcodeDetail(
  ktx2: Uint8Array,
  renderer: THREE.WebGLRenderer,
  transcoderPath = `${import.meta.env.BASE_URL}basis/`,
): Promise<THREE.CompressedTexture> {
  if (loader && loaderPath !== transcoderPath) {
    loader.dispose();
    loader = null;
  }
  loader ??= new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);
  loaderPath = transcoderPath;
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
