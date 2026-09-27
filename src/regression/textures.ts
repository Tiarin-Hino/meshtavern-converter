/**
 * Generated RGBA textures for the encoder's fixture test and timing harness (issue #38). Integer
 * arithmetic only, so every machine gets the same bytes and the encoder's output can be hashed.
 */

/** A smooth gradient, like a real detail texture: x in red, y in green, then blue 255 and alpha 128. */
export function gradientTexture(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let texel = 0; texel < size * size; texel++) {
    const x = texel % size;
    const y = Math.floor(texel / size);
    rgba.set([(x * 256) / size, (y * 256) / size, 255, 128], texel * 4);
  }
  return rgba;
}

/** Every byte from a seeded xorshift32 generator: the worst case for the encoder. */
export function noiseTexture(size: number, seed = 38): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < rgba.length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    rgba[i] = state & 0xff;
  }
  return rgba;
}
