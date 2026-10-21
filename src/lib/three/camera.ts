import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Puts a camera on a sphere around what is shown, a box of `size` standing on y = 0 with its
 * middle on the vertical axis: `azimuthDeg` around the vertical axis (0 = in front, on +z),
 * `elevationDeg` above the horizon, `zoom` 1 = all of it in frame, 2 = twice as close. The orbit's
 * centre goes to half the height (0.7 of it when zoomed in), the near and far planes follow the
 * size. Fixed positions make screenshots comparable. The page's viewer, the question scene and the
 * painting scene frame the same way (#127, design note `docs/design/painting-engine.md` §10.3).
 */
/** The camera's distance at zoom 1, in the largest side of what is shown. */
export const FRAME_DISTANCE = 2.3;

export function placeCameraOnSphere(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  size: THREE.Vector3,
  azimuthDeg: number,
  elevationDeg: number,
  zoom: number,
): void {
  const radius = Math.max(size.x, size.y, size.z, 1);
  const distance = (radius * FRAME_DISTANCE) / zoom;
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const target = new THREE.Vector3(0, size.y * (zoom > 1 ? 0.7 : 0.5), 0);
  controls.target.copy(target);
  camera.position.set(
    target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
    target.y + distance * Math.sin(elevation),
    target.z + distance * Math.cos(elevation) * Math.cos(azimuth),
  );
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
}
