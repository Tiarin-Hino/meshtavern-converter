import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

/**
 * Coordinate conventions (keep in sync with CLAUDE.md):
 * the scene is Y-up and 1 unit = 1 mm. Print STLs are Z-up millimetres,
 * so loaded meshes are rotated -90° around X and keep their scale.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  private readonly controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;

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

  showStl(buffer: ArrayBuffer): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const geometry = new STLLoader().parse(buffer);
    // Normals stored in STL files are often zero or wrong; derive them from the triangles.
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -box.min.y, -centre.z);

    const material = new THREE.MeshStandardMaterial({
      color: 0x9aa0a8,
      roughness: 0.75,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);
    this.frame(box.getSize(new THREE.Vector3()));
  }

  private frame(size: THREE.Vector3): void {
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.controls.target.set(0, size.y / 2, 0);
    this.camera.position.set(radius * 1.2, size.y / 2 + radius * 0.8, radius * 1.8);
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
