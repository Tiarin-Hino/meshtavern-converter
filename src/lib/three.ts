/**
 * Drawing a baked mini with three.js: the material whose GLSL matches look.ts, and the
 * transcode of the KTX2 detail texture. Apart from index.ts so a consumer without three.js
 * never loads it. transcodeDetail needs three.js's Basis transcoder served (see vite.config.ts).
 */
export {
  createBakedMaterial,
  createBakedGeometry,
  createDetailTexture,
  createLookUniforms,
  updateLookUniforms,
  disposeBakedMaterial,
  bakedTextureBytes,
  type LookUniforms,
} from './three/baked-material';
export { transcodeDetail, ownCopy, compressedTextureBytes } from './three/compressed-texture';
