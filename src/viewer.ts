import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { IndexedMesh } from './pipeline/mesh';

/**
 * Coordinate conventions (keep in sync with CLAUDE.md):
 * the scene is Y-up and 1 unit = 1 mm. The pipeline delivers meshes already converted
 * to that convention, standing on y = 0 and centred on the origin.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  private readonly controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private readonly size = new THREE.Vector3(1, 1, 1);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8,
    roughness: 0.75,
    metalness: 0,
  });

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x1b1d22);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(60, 120, 80);
    this.scene.add(key);
    this.scene.add(new THREE.GridHelper(200, 20, 0x4a4f5a, 0x2c3038));

    this.camera.position.set(60, 60, 90);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Shows a mesh. With `reframe` false the camera stays put, so versions of one mini can be compared. */
  showMesh(mesh: IndexedMesh, sizeMm: [number, number, number], reframe = true): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
    this.size.set(...sizeMm);
    if (reframe) this.setCamera(34, 22, 1);
  }

  setWireframe(wireframe: boolean): void {
    this.material.wireframe = wireframe;
  }

  /**
   * Puts the camera on a sphere around the mini: `azimuthDeg` around the vertical axis
   * (0 = front, looking down -z), `elevationDeg` above the horizon, `zoom` 1 = whole mini
   * in frame, 2 = twice as close. Fixed positions make screenshots comparable.
   */
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void {
    const radius = Math.max(this.size.x, this.size.y, this.size.z, 1);
    const distance = (radius * 2.3) / zoom;
    const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
    const elevation = THREE.MathUtils.degToRad(elevationDeg);
    const target = new THREE.Vector3(0, this.size.y * (zoom > 1 ? 0.7 : 0.5), 0);
    this.controls.target.copy(target);
    this.camera.position.set(
      target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      target.y + distance * Math.sin(elevation),
      target.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    this.camera.near = radius / 100;
    this.camera.far = radius * 100;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
