import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  flipRows,
  frameBox,
  framePoints,
  linearToSrgb,
  renderThumbnail,
  THUMBNAIL_FOV_DEG,
  THUMBNAIL_MARGIN,
  unpremultiply,
} from './thumbnail';

type Vec3 = [number, number, number];

/** Where each corner of the box lands in the frame, -1 to 1 on both axes, through a real camera. */
function projectedCorners(min: Vec3, max: Vec3): [number, number][] {
  const frame = frameBox(min, max);
  const camera = new THREE.PerspectiveCamera(THUMBNAIL_FOV_DEG, 1, frame.near, frame.far);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);
  camera.updateMatrixWorld();
  const corners: [number, number][] = [];
  for (let corner = 0; corner < 8; corner++) {
    const point = new THREE.Vector3(
      corner & 1 ? max[0] : min[0],
      corner & 2 ? max[1] : min[1],
      corner & 4 ? max[2] : min[2],
    ).project(camera);
    corners.push([point.x, point.y]);
  }
  return corners;
}

const distanceOf = (min: Vec3, max: Vec3): number => {
  const { position, target } = frameBox(min, max);
  return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
};

describe('frameBox', () => {
  it('puts the box in the middle of the picture', () => {
    for (const [min, max] of [
      [
        [-10, 0, -5],
        [10, 30, 5],
      ],
      [
        [-50, 0, -50],
        [50, 1, 50],
      ],
    ] as [Vec3, Vec3][]) {
      const corners = projectedCorners(min, max);
      for (const axis of [0, 1]) {
        const values = corners.map((corner) => corner[axis]!);
        expect(Math.min(...values) + Math.max(...values)).toBeCloseTo(0, 2);
      }
    }
  });

  it('frames the points, not their box: a pyramid is seen from closer than its box', () => {
    const pyramid = [-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10, 0, 30, 0];
    const { position, target } = framePoints(pyramid);
    const distance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    expect(distance).toBeLessThan(distanceOf([-10, 0, -10], [10, 30, 10]));
  });

  it('stands twice as far from a box twice as large', () => {
    const near = distanceOf([-10, 0, -10], [10, 30, 10]);
    expect(distanceOf([-20, 0, -20], [20, 60, 20])).toBeCloseTo(near * 2, 9);
  });

  it('keeps every corner inside the frame less the margin, and touches it with one', () => {
    for (const [min, max] of [
      [
        [-10, 0, -10],
        [10, 30, 10],
      ],
      [
        [-50, 0, -50],
        [50, 1, 50],
      ],
      [
        [-2, 0, -40],
        [2, 80, 40],
      ],
    ] as [Vec3, Vec3][]) {
      const corners = projectedCorners(min, max);
      const reach = Math.max(...corners.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
      expect(reach).toBeLessThanOrEqual(1 - 2 * THUMBNAIL_MARGIN + 1e-9);
      expect(reach).toBeCloseTo(1 - 2 * THUMBNAIL_MARGIN, 6);
    }
  });

  it('frames a flat plate by its width', () => {
    const corners = projectedCorners([-50, 0, -50], [50, 1, 50]);
    const xs = corners.map(([x]) => Math.abs(x));
    const ys = corners.map(([, y]) => Math.abs(y));
    expect(Math.max(...xs)).toBeCloseTo(1 - 2 * THUMBNAIL_MARGIN, 6);
    expect(Math.max(...ys)).toBeLessThan(Math.max(...xs));
  });

  it('puts near and far around the distance as the viewer does', () => {
    const frame = frameBox([-10, 0, -10], [10, 30, 10]);
    const distance = distanceOf([-10, 0, -10], [10, 30, 10]);
    expect(frame.near).toBeCloseTo(distance / 100, 9);
    expect(frame.far).toBeCloseTo(distance * 100, 6);
  });
});

describe('the read-back corrections', () => {
  it('turns linear bytes into sRGB, alpha untouched', () => {
    const pixels = linearToSrgb(new Uint8Array([0, 255, 128, 77, 128, 0, 255, 200]));
    expect([...pixels]).toEqual([0, 255, 188, 77, 188, 0, 255, 200]);
  });

  it('flips the rows of a picture', () => {
    // 2 × 2: the bottom row first, as WebGL reads it.
    const pixels = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    expect([...flipRows(pixels, 2)]).toEqual([3, 3, 3, 3, 4, 4, 4, 4, 1, 1, 1, 1, 2, 2, 2, 2]);
    // An odd number of rows keeps the middle one.
    const three = new Uint8Array(3 * 3 * 4).map((_, i) => Math.floor(i / 12));
    expect([...flipRows(three, 3)].filter((_, i) => i % 12 === 0)).toEqual([2, 1, 0]);
  });

  it('un-premultiplies a partly covered pixel and leaves full and empty ones', () => {
    const pixels = unpremultiply(
      new Uint8Array([50, 100, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0, 200, 200, 200, 100]),
    );
    expect([...pixels]).toEqual([
      100, 199, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0, 255, 255, 255, 100,
    ]);
  });
});

describe('renderThumbnail', () => {
  it('refuses a size above 512 px, never drawing a larger picture', async () => {
    const mesh = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
    await expect(renderThumbnail(mesh, { size: 1024 })).rejects.toThrow(RangeError);
    await expect(renderThumbnail(mesh, { size: 0 })).rejects.toThrow(RangeError);
  });
});
