import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { IndexedMesh } from './pipeline/mesh';

/** One inch: the usual tabletop grid square. */
const GRID_SQUARE_MM = 25.4;
/** Stress-scene minis stand on every second square. */
const STRESS_SPACING_MM = GRID_SQUARE_MM * 2;
/**
 * Camera distance (mm) from which each LOD is used, highest detail first. Provisional:
 * tuned by eye on a 1080p screen, to be fixed in the Phase 0 write-up.
 */
export const LOD_DISTANCES_MM = [0, 250, 600] as const;
/** Frames averaged for the performance read-out. */
const PERF_WINDOW = 120;

export interface Perf {
  /** Frames per second, averaged over the last frames. Capped by the display refresh rate. */
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  /** CPU time spent submitting one frame. GPU time is not measurable from a web page. */
  renderCpuMs: number;
  triangles: number;
  drawCalls: number;
  minis: number;
  /** How many minis currently show each LOD, highest detail first. */
  minisPerLod: number[];
}

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
  private readonly grid: THREE.GridHelper;
  private mesh: THREE.Mesh | null = null;
  private stress: THREE.LOD[] = [];
  private readonly size = new THREE.Vector3(1, 1, 1);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8,
    roughness: 0.75,
    metalness: 0,
  });

  private readonly frameTimes = new Float32Array(PERF_WINDOW);
  private readonly renderTimes = new Float32Array(PERF_WINDOW);
  private frameIndex = 0;
  private lastFrame = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x1b1d22);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(60, 120, 80);
    this.scene.add(key);
    this.grid = new THREE.GridHelper(GRID_SQUARE_MM * 40, 40, 0x4a4f5a, 0x2c3038);
    this.scene.add(this.grid);

    this.camera.position.set(60, 60, 90);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop((now) => {
      this.controls.update();
      const start = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.renderTimes[this.frameIndex] = performance.now() - start;
      this.frameTimes[this.frameIndex] = now - this.lastFrame;
      this.frameIndex = (this.frameIndex + 1) % PERF_WINDOW;
      this.lastFrame = now;
    });
  }

  /** Shows a mesh. With `reframe` false the camera stays put, so versions of one mini can be compared. */
  showMesh(mesh: IndexedMesh, sizeMm: [number, number, number], reframe = true): void {
    this.clear();
    this.mesh = new THREE.Mesh(this.toGeometry(mesh), this.material);
    this.scene.add(this.mesh);
    this.size.set(...sizeMm);
    if (reframe) this.setCamera(34, 22, 1);
  }

  /**
   * Fills the table with `count` copies of a mini, each with its own GPU buffers and its
   * own draw calls, so the cost equals that many different minis of this size. `lods` runs
   * from highest to lowest detail. With `forcedLod` every mini shows that level at any
   * distance; otherwise the level follows the camera distance.
   */
  showStress(lods: IndexedMesh[], count: number, forcedLod: number | null = null): void {
    this.clear();
    const templates = lods.map((lod) => this.toGeometry(lod));
    const side = Math.ceil(Math.sqrt(count));
    const offset = ((side - 1) * STRESS_SPACING_MM) / 2;

    for (let i = 0; i < count; i++) {
      const mini = new THREE.LOD();
      templates.forEach((template, level) => {
        if (forcedLod !== null && level !== forcedLod) return;
        // clone() copies the vertex data, so every mini uploads its own buffers.
        const distance = forcedLod === null ? LOD_DISTANCES_MM[level]! : 0;
        mini.addLevel(new THREE.Mesh(template.clone(), this.material), distance);
      });
      mini.position.set(
        (i % side) * STRESS_SPACING_MM - offset,
        0,
        Math.floor(i / side) * STRESS_SPACING_MM - offset,
      );
      mini.rotation.y = (i * 2.399963) % (Math.PI * 2);
      this.scene.add(mini);
      this.stress.push(mini);
    }
    templates.forEach((template) => template.dispose());

    const span = side * STRESS_SPACING_MM;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(span * 0.55, span * 0.5, span * 0.75);
    this.camera.near = 1;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 4;
  }

  perf(): Perf {
    const mean = (values: Float32Array): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const frameMs = mean(this.frameTimes);
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      worstFrameMs: this.frameTimes.reduce((max, value) => Math.max(max, value), 0),
      renderCpuMs: mean(this.renderTimes),
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      minis: this.stress.length,
      minisPerLod: LOD_DISTANCES_MM.map(
        (_, level) => this.stress.filter((mini) => mini.getCurrentLevel() === level).length,
      ),
    };
  }

  setWireframe(wireframe: boolean): void {
    this.material.wireframe = wireframe;
  }

  /**
   * Puts the camera on a sphere around the mini: `azimuthDeg` around the vertical axis
   * (0 = in front of the mini, on +z), `elevationDeg` above the horizon, `zoom` 1 = whole
   * mini in frame, 2 = twice as close. Fixed positions make screenshots comparable.
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

  private toGeometry(mesh: IndexedMesh): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (mesh.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    else geometry.computeVertexNormals();
    return geometry;
  }

  private clear(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    for (const mini of this.stress) {
      this.scene.remove(mini);
      for (const level of mini.levels) (level.object as THREE.Mesh).geometry.dispose();
    }
    this.stress = [];
    this.controls.autoRotate = false;
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
