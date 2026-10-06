import * as THREE from 'three';
import { DEFAULT_LOOK, vertexColours, type Look } from '../pipeline/look';
import { computeVertexNormals, type IndexedMesh } from '../pipeline/mesh';
import { createBakedGeometry, createBakedMaterial, createLookUniforms } from './baked-material';

/**
 * A small picture of a converted mini (issue #99, design note `docs/design/thumbnail-and-kind.md`
 * §4): the table level drawn from the viewer's angle, in the viewer's light, on a transparent
 * background, as a PNG. Made by the consumer after the conversion, with its own renderer: the
 * pipeline never needs a GPU.
 */

/** The default and the largest size: the table's list and an agent's token view show at most 512 px (table ADR-0006, decision 8). */
export const THUMBNAIL_SIZE = 512;
/** The viewer's framing of a freshly loaded mini (Viewer.setCamera(34, 22, 1)), so the picture shows what the person saw. */
export const THUMBNAIL_AZIMUTH_DEG = 34;
export const THUMBNAIL_ELEVATION_DEG = 22;
export const THUMBNAIL_FOV_DEG = 40;
/** Share of the frame left free on each side. _(proposal)_ */
export const THUMBNAIL_MARGIN = 0.06;

/** The surface of a mini, in the viewer and in the thumbnail. */
export const MINI_ROUGHNESS = 0.75;
export const MINI_METALNESS = 0;

/** The table's light, in the viewer and in the thumbnail: a sky-and-ground fill and one key light, both fixed in the world. */
export function addTableLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(60, 120, 80);
  scene.add(key);
}

export interface ThumbnailOptions {
  /** Width and height in pixels, square. THUMBNAIL_SIZE by default; more is a RangeError, never a larger picture. */
  size?: number;
  /** The look to draw with. DEFAULT_LOOK. */
  look?: Look;
  /**
   * The detail texture of `result.baked`, transcoded (transcodeDetail) or uncompressed
   * (createDetailTexture), when the consumer has one: the mesh is then `result.baked.mesh`, the
   * table level with texture coordinates, and the picture shows the baked mini as the table
   * does. Without it the per-vertex look is drawn, which is what the table shows when the bake
   * was skipped. The texture is not disposed.
   */
  texture?: THREE.Texture | null;
  /** Draw with this renderer, into a render target: the screen is not touched. Without one a private renderer is made and disposed. */
  renderer?: THREE.WebGLRenderer;
}

type Vec3 = [number, number, number];

/** Rounds of re-aiming at the middle of the picture: perspective moves it a little each time. */
const AIM_ROUNDS = 3;

/**
 * Where a camera with THUMBNAIL_FOV_DEG and a square frame stands to frame the points (x, y, z
 * after one another) at the thumbnail's angle: on the ray at the azimuth (about the vertical, 0
 * on +z) and elevation from a target that puts the points in the middle of the picture, at the
 * smallest distance at which every point projects inside the frame less the margin on each side.
 * The points, not their box: a round base or a figure's head leaves the box's corners empty, and
 * framing those would leave the picture a quarter empty.
 */
export function framePoints(
  points: ArrayLike<number>,
  margin = THUMBNAIL_MARGIN,
): { position: Vec3; target: Vec3; near: number; far: number } {
  const azimuth = (THUMBNAIL_AZIMUTH_DEG * Math.PI) / 180;
  const elevation = (THUMBNAIL_ELEVATION_DEG * Math.PI) / 180;
  // Toward the camera, the camera's right and its up.
  const toward: Vec3 = [
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ];
  const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up: Vec3 = [
    toward[1] * right[2] - toward[2] * right[1],
    toward[2] * right[0] - toward[0] * right[2],
    toward[0] * right[1] - toward[1] * right[0],
  ];
  const t = Math.tan(((THUMBNAIL_FOV_DEG / 2) * Math.PI) / 180) * (1 - 2 * margin);
  const count = Math.floor(points.length / 3);

  // Start from the box's centre.
  const target: Vec3 = [0, 0, 0];
  if (count > 0) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count * 3; i += 3)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, points[i + axis]!);
        max[axis] = Math.max(max[axis]!, points[i + axis]!);
      }
    for (let axis = 0; axis < 3; axis++) target[axis] = (min[axis]! + max[axis]!) / 2;
  }
  /** Each point's offset from the target along right, up and toward the camera. */
  const offsets = (): Float64Array => {
    const out = new Float64Array(count * 3);
    for (let k = 0; k < count; k++) {
      const x = points[k * 3]! - target[0];
      const y = points[k * 3 + 1]! - target[1];
      const z = points[k * 3 + 2]! - target[2];
      out[k * 3] = x * right[0] + y * right[1] + z * right[2];
      out[k * 3 + 1] = x * up[0] + y * up[1] + z * up[2];
      out[k * 3 + 2] = x * toward[0] + y * toward[1] + z * toward[2];
    }
    return out;
  };
  // A point at depth w toward the camera fits when |lateral| / (distance - w) ≤ t.
  const distanceFor = (o: Float64Array): number => {
    let distance = 0;
    for (let k = 0; k < o.length; k += 3)
      distance = Math.max(distance, Math.max(Math.abs(o[k]!), Math.abs(o[k + 1]!)) / t + o[k + 2]!);
    // Nothing to frame, or a single point: from 1 mm away rather than from inside it.
    return distance > 0 ? distance : 1;
  };

  let o = offsets();
  let distance = distanceFor(o);
  for (let round = 0; round < AIM_ROUNDS && count > 0; round++) {
    // The middle of the picture as it would be drawn, moved to the target's depth.
    const lo = [Infinity, Infinity];
    const hi = [-Infinity, -Infinity];
    for (let k = 0; k < o.length; k += 3) {
      const scale = distance / (distance - o[k + 2]!);
      for (let a = 0; a < 2; a++) {
        const v = o[k + a]! * scale;
        if (v < lo[a]!) lo[a] = v;
        if (v > hi[a]!) hi[a] = v;
      }
    }
    const dx = (lo[0]! + hi[0]!) / 2;
    const dy = (lo[1]! + hi[1]!) / 2;
    for (let axis = 0; axis < 3; axis++)
      target[axis] = target[axis]! + right[axis]! * dx + up[axis]! * dy;
    o = offsets();
    distance = distanceFor(o);
  }
  return {
    position: [
      target[0] + toward[0] * distance,
      target[1] + toward[1] * distance,
      target[2] + toward[2] * distance,
    ],
    target,
    near: distance / 100,
    far: distance * 100,
  };
}

/** framePoints for the eight corners of a box. */
export function frameBox(
  min: Vec3,
  max: Vec3,
  margin = THUMBNAIL_MARGIN,
): ReturnType<typeof framePoints> {
  const corners: number[] = [];
  for (let corner = 0; corner < 8; corner++)
    corners.push(
      corner & 1 ? max[0] : min[0],
      corner & 2 ? max[1] : min[1],
      corner & 4 ? max[2] : min[2],
    );
  return framePoints(corners, margin);
}

/**
 * Divides each pixel's colour by its alpha where it is partly covered: the edge was blended
 * against the transparent black clear, and would keep a dark fringe on a light page. In place.
 */
export function unpremultiply(rgba: Uint8Array): Uint8Array {
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    if (alpha === 0 || alpha === 255) continue;
    for (let c = 0; c < 3; c++)
      rgba[i + c] = Math.min(255, Math.round((rgba[i + c]! * 255) / alpha));
  }
  return rgba;
}

/** Linear to sRGB for each byte value, the transfer function of the sRGB standard. */
const SRGB_OF_LINEAR = Uint8Array.from({ length: 256 }, (_, byte) => {
  const c = byte / 255;
  const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
});

/**
 * Converts the colour channels from linear to sRGB, alpha untouched. In place. three.js draws into
 * a render target in its linear working colour space; only the canvas gets the output colour space.
 */
export function linearToSrgb(rgba: Uint8Array): Uint8Array {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = SRGB_OF_LINEAR[rgba[i]!]!;
    rgba[i + 1] = SRGB_OF_LINEAR[rgba[i + 1]!]!;
    rgba[i + 2] = SRGB_OF_LINEAR[rgba[i + 2]!]!;
  }
  return rgba;
}

/** Puts the rows of a square RGBA picture in the opposite order: WebGL reads them bottom-up. In place. */
export function flipRows(rgba: Uint8Array, size: number): Uint8Array {
  const row = size * 4;
  const spare = new Uint8Array(row);
  for (let top = 0, bottom = size - 1; top < bottom; top++, bottom--) {
    spare.set(rgba.subarray(top * row, top * row + row));
    rgba.copyWithin(top * row, bottom * row, bottom * row + row);
    rgba.set(spare, bottom * row);
  }
  return rgba;
}

/** The per-vertex path: the viewer's geometry and material for a mini without its detail texture. */
function vertexColoured(mesh: IndexedMesh, look: Look): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(mesh.normals ?? computeVertexNormals(mesh), 3),
  );
  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColours(mesh, look), 3));
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: MINI_ROUGHNESS,
    metalness: MINI_METALNESS,
  });
  return new THREE.Mesh(geometry, material);
}

/** A canvas off the page: an OffscreenCanvas where there is one. */
function detachedCanvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

async function encodePng(rgba: Uint8Array, size: number): Promise<Blob> {
  const canvas = detachedCanvas(size);
  const context = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new Error('No 2D canvas to encode the thumbnail');
  const pixels = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length);
  context.putImageData(new ImageData(pixels, size, size), 0, 0);
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The thumbnail could not be encoded'))),
        'image/png',
      ),
    );
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * A PNG with a transparent background, `size` × `size`, of the mesh framed from the viewer's
 * angle in the viewer's light. `mesh` is the table level: `result.baked.mesh` with
 * `options.texture`, else `result.lods[BAKED_LEVEL].mesh`. With `options.renderer` it draws into
 * a render target and leaves the renderer's target and clear colour as they were.
 */
export async function renderThumbnail(
  mesh: IndexedMesh,
  options: ThumbnailOptions = {},
): Promise<Blob> {
  const size = options.size ?? THUMBNAIL_SIZE;
  if (!(Number.isInteger(size) && size >= 1 && size <= THUMBNAIL_SIZE))
    throw new RangeError(`A thumbnail is 1 to ${THUMBNAIL_SIZE} px, not ${size}`);
  const look = options.look ?? DEFAULT_LOOK;
  const texture = options.texture ?? null;

  const scene = new THREE.Scene();
  addTableLights(scene);
  const mini = texture
    ? new THREE.Mesh(
        createBakedGeometry(mesh),
        createBakedMaterial(texture, createLookUniforms(look)),
      )
    : vertexColoured(mesh, look);
  scene.add(mini);

  const frame = framePoints(mesh.positions);
  const camera = new THREE.PerspectiveCamera(THUMBNAIL_FOV_DEG, 1, frame.near, frame.far);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);
  camera.updateMatrixWorld();

  const own = options.renderer
    ? null
    : new THREE.WebGLRenderer({ canvas: detachedCanvas(size), alpha: true, antialias: false });
  const renderer = options.renderer ?? own!;
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4, depthBuffer: true });
  const rgba = new Uint8Array(size * size * 4);
  try {
    const before = {
      target: renderer.getRenderTarget(),
      colour: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
    };
    let read: Promise<unknown>;
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      // The read is issued here; only the wait for the GPU is asynchronous.
      read = renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size, rgba);
    } finally {
      // Restored before waiting: the consumer's next frame must draw to its own target.
      renderer.setRenderTarget(before.target);
      renderer.setClearColor(before.colour, before.alpha);
    }
    await read;
  } finally {
    target.dispose();
    mini.geometry.dispose();
    (mini.material as THREE.Material).dispose();
    if (own) {
      own.dispose();
      own.forceContextLoss();
    }
  }
  // The blend happened in linear, so the edge is un-premultiplied before the conversion.
  linearToSrgb(unpremultiply(flipRows(rgba, size)));
  return encodePng(rgba, size);
}
