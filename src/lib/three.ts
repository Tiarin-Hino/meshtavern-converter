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
// A picture of the table level, drawn by the consumer after the conversion (issue #99).
export {
  renderThumbnail,
  addTableLights,
  MINI_METALNESS,
  MINI_ROUGHNESS,
  THUMBNAIL_AZIMUTH_DEG,
  THUMBNAIL_ELEVATION_DEG,
  THUMBNAIL_FOV_DEG,
  THUMBNAIL_MARGIN,
  THUMBNAIL_SIZE,
  type ThumbnailOptions,
} from './three/thumbnail';
