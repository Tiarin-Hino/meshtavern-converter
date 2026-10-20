import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../pipeline/base';
import { GRID_SQUARE_MM } from '../pipeline/size';
import { FRAME_DISTANCE, placeCameraOnSphere } from '../three/camera';
import { readSceneColours } from '../three/scene-colours';
import { addTableLights } from '../three/thumbnail';

/** Squares the grid shows along each side, as the page's viewer. */
const GRID_SQUARES = 40;
/** The drawing buffer's pixels per CSS pixel, at most: the depth map follows it (§11.1). */
const MAX_PIXEL_RATIO = 2;

/** An axis-aligned box in the mini's coordinates, mm. */
export interface SceneBox {
  min: Vec3;
  max: Vec3;
}

/**
 * The painting view's scene (issue #127, design note `docs/design/painting-engine.md` §10.3): the
 * question scene's frame without the question. A canvas of its own in the host, a renderer, a
 * camera, OrbitControls with damping and zoom to the pointer, the grid and the table's light, and
 * the mini at the origin in its own coordinates (Y-up, 1 unit = 1 mm). The loop runs only while a
 * mini is shown; `onFrame` is called before each draw.
 */
export class PaintScene {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly grid: THREE.GridHelper;
  private readonly resizer: ResizeObserver;
  /** The box the camera frames (the groups as drawn, #180) and its size. */
  private readonly size = new THREE.Vector3(1, 1, 1);
  private framed: SceneBox = { min: [0, 0, 0], max: [1, 1, 1] };
  /** The mini's own box: where the camera's sphere sits while nothing is apart. */
  private own: SceneBox = { min: [0, 0, 0], max: [1, 1, 1] };
  private readonly raycaster = new THREE.Raycaster();
  private mini: THREE.Mesh | null = null;
  private running = false;
  private navigating = false;
  /** Called at the start of every frame, before the draw. */
  onFrame: (() => void) | null = null;
  /** Called at the end of every frame with its time in ms, by `performance.now()` around the frame's body (§11.3). */
  onFrameTimed: ((ms: number) => void) | null = null;
  private frameWaiters: (() => void)[] = [];
  /** Pixel reads waiting for the next frame: called with true after its draw, false when the mini is taken off. */
  private pixelReads: ((drawn: boolean) => void)[] = [];

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    host.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    // The backdrop and the grid of the --scene-* roles, dark in both themes (#143).
    const colours = readSceneColours();
    this.scene.background = new THREE.Color(colours.backdrop);
    addTableLights(this.scene);
    this.grid = new THREE.GridHelper(
      GRID_SQUARE_MM * GRID_SQUARES,
      GRID_SQUARES,
      colours.gridCentre,
      colours.gridLine,
    );
    this.scene.add(this.grid);
    this.camera.position.set(60, 60, 90);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.zoomToCursor = true;
    this.setNavigating(false);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.canvas);
    this.resize();
  }

  /** Shows the mini, whose box is `box`, and starts the loop; the camera frames it. */
  show(mesh: THREE.Mesh, box: SceneBox): void {
    this.clear();
    this.mini = mesh;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.own = box;
    this.frameBox(box);
    this.setCamera(34, 22, 1);
    this.start();
  }

  /**
   * Frames `box`, the groups as they are drawn (#180): the camera keeps its azimuth, elevation
   * and zoom and moves to where the box is in frame. With the mini's own box, the camera is where
   * `show` put it for that view.
   */
  reframe(box: SceneBox): void {
    const azimuth = THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle());
    const elevation = 90 - THREE.MathUtils.radToDeg(this.controls.getPolarAngle());
    const radius = Math.max(this.size.x, this.size.y, this.size.z, 1);
    const distance = this.camera.position.distanceTo(this.controls.target);
    const zoom = (radius * FRAME_DISTANCE) / Math.max(distance, 1e-6);
    this.frameBox(box);
    this.setCamera(azimuth, elevation, zoom);
  }

  private frameBox(box: SceneBox): void {
    this.framed = box;
    this.size.set(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  }

  /** Takes the mini off and stops the loop. */
  clear(): void {
    if (this.mini) this.scene.remove(this.mini);
    this.mini = null;
    this.stop();
    for (const read of this.pixelReads.splice(0)) read(false);
    for (const resolve of this.frameWaiters.splice(0)) resolve();
  }

  /** Resolves after the next frame is drawn (at once when nothing is shown). */
  nextFrame(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => this.frameWaiters.push(resolve));
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame(): void {
    const start = performance.now();
    this.resize();
    this.controls.update();
    this.onFrame?.();
    this.renderer.render(this.scene, this.camera);
    this.onFrameTimed?.(performance.now() - start);
    // Read in the frame that drew them: the drawing buffer is not kept after it is shown.
    for (const read of this.pixelReads.splice(0)) read(true);
    for (const resolve of this.frameWaiters.splice(0)) resolve();
  }

  /**
   * The canvas's pixel under point (x, y), CSS pixels, as the next frame draws it: sRGB bytes,
   * lighting and all (#135). Null when nothing is shown or the point is off the canvas.
   */
  pixelAt(x: number, y: number): Promise<[number, number, number] | null> {
    if (!this.running) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pixelReads.push((drawn) => {
        if (!drawn) {
          resolve(null);
          return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const column = Math.floor((x / rect.width) * buffer.x);
        const row = buffer.y - 1 - Math.floor((y / rect.height) * buffer.y);
        if (column < 0 || column >= buffer.x || row < 0 || row >= buffer.y) {
          resolve(null);
          return;
        }
        const gl = this.renderer.getContext();
        const bytes = new Uint8Array(4);
        this.renderer.setRenderTarget(null);
        gl.readPixels(column, row, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        resolve([bytes[0]!, bytes[1]!, bytes[2]!]);
      });
    });
  }

  /**
   * The pointer's buttons and fingers (§9): the left button and one finger paint, the right
   * button and two fingers orbit, the middle button pans. Navigating, the left button and one
   * finger orbit too.
   */
  setNavigating(on: boolean): void {
    this.navigating = on;
    const none = -1 as unknown as THREE.MOUSE;
    this.controls.mouseButtons = {
      LEFT: on ? THREE.MOUSE.ROTATE : none,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: on ? THREE.TOUCH.ROTATE : (-1 as unknown as THREE.TOUCH),
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
  }

  get isNavigating(): boolean {
    return this.navigating;
  }

  /** The camera's ray through canvas point (x, y), CSS pixels, in the mini's coordinates. */
  rayAt(x: number, y: number): { origin: Vec3; direction: Vec3 } {
    this.resize();
    this.camera.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((x / rect.width) * 2 - 1, 0 - ((y / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  }

  /** Where a point of the mini is on the canvas, CSS pixels. */
  screenOf(point: Vec3): [number, number] {
    this.resize();
    this.camera.updateMatrixWorld();
    const projected = new THREE.Vector3(...point).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return [((projected.x + 1) / 2) * rect.width, ((1 - projected.y) / 2) * rect.height];
  }

  /** CSS pixels per mm at a point of the mini: how large the cursor ring draws a brush there. */
  pixelsPerMm(point: Vec3): number {
    this.camera.updateMatrixWorld();
    const distance = this.camera.position.distanceTo(new THREE.Vector3(...point));
    const rect = this.canvas.getBoundingClientRect();
    const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return rect.height / Math.max(height, 1e-6);
  }

  /** The camera as a stroke records it (§4): what decides the texels it reaches. */
  strokeCamera(): {
    position: Vec3;
    target: Vec3;
    fovDeg: number;
    near: number;
    far: number;
    viewport: [number, number];
  } {
    this.resize();
    const { position } = this.camera;
    const { target } = this.controls;
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      fovDeg: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      viewport: [buffer.x, buffer.y],
    };
  }

  /**
   * Puts the camera on its sphere (`placeCameraOnSphere`) around the framed box. An orbit's
   * momentum is spent first: with damping on, the controls keep turning after a drag, and while
   * no mini is shown the loop does not run to let it die away, so it would turn the camera away
   * from where it was put. The sphere sits where the mini stands; with groups apart (#180) it
   * moves by the change from the mini's own box to the framed one, so that nothing apart leaves
   * the camera exactly where it was.
   */
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void {
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    placeCameraOnSphere(this.camera, this.controls, this.size, azimuthDeg, elevationDeg, zoom);
    const { own, framed } = this;
    const shift = new THREE.Vector3(
      (framed.min[0] + framed.max[0] - own.min[0] - own.max[0]) / 2,
      framed.min[1] - own.min[1],
      (framed.min[2] + framed.max[2] - own.min[2] - own.max[2]) / 2,
    );
    if (shift.lengthSq() > 0) {
      this.camera.position.add(shift);
      this.controls.target.add(shift);
    }
    this.controls.update();
  }

  dispose(): void {
    this.clear();
    this.resizer.disconnect();
    this.controls.dispose();
    this.grid.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** Fits the drawing buffer and the camera to the canvas's size; nothing while it is hidden. */
  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    const drawn = this.renderer.getSize(new THREE.Vector2());
    if (drawn.x === clientWidth && drawn.y === clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
