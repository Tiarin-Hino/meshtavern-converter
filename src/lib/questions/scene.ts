import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { DEFAULT_LOOK } from '../pipeline/look';
import type { IndexedMesh } from '../pipeline/mesh';
import type { Rotation } from '../pipeline/rotation';
import { GRID_SQUARE_MM } from '../pipeline/size';
import { addTableLights, MINI_METALNESS, MINI_ROUGHNESS } from '../three/thumbnail';
import { chunkRanges } from './mesh-chunks';

/** The pairs' colours: the patches in the scene, and `--pair-1` … `--pair-4` on the view's hosts for the chips. _(proposal, #93)_ */
export const PAIR_COLOURS = [0xf0b35e, 0x7ee0c3, 0xd78ae6, 0x8fb8f5] as const;
type Vec3 = [number, number, number];

/** Squares the grid shows along each side, as the page's viewer. */
const GRID_SQUARES = 40;
/** The scene's background, the page's (`--bg`). */
const BACKGROUND = 0x1b1d22;

/**
 * The question's scene (#119): what the page's viewer drew at a question (#92, #93, #108),
 * moved from `src/page/viewer.ts` with what the viewer's constructor made for it. A canvas of its
 * own in the host the view was given, a camera, OrbitControls, the grid and the table's light;
 * at a question the full-detail meshes, the patches, the brush and the turn gizmo. The render
 * loop runs only while a question's meshes are held (`showShown` until `clear`).
 *
 * Coordinate conventions as the viewer's: Y-up, 1 unit = 1 mm.
 */
export class QuestionScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  private readonly controls: OrbitControls;
  private readonly grid: THREE.GridHelper;
  private readonly resizer: ResizeObserver;
  private readonly size = new THREE.Vector3(1, 1, 1);
  /** A turn being tried out at an up question (#92): shown on the meshes, not converted. */
  private readonly turn = new THREE.Quaternion();
  /** Holds the meshes at half their height, so a turn pivots about their middle, not their feet. */
  private readonly pivot = new THREE.Group();
  private gizmo: TransformControls | null = null;
  private onTurn: ((turn: Rotation) => void) | null = null;
  /**
   * The full-detail meshes at a question (#92, #93): each file's in file coordinates at the
   * transform the worker gave it, under `holder`, inside the pivot so a turn previews on them
   * all. A file is a group of chunks (#108). Null when no question is shown.
   */
  private question: {
    holder: THREE.Group;
    meshes: Map<number, QuestionFile>;
  } | null = null;
  /** The files whose chunks are still being added, a chunk per frame (#108), first come first. */
  private chunking: QuestionFile[] = [];
  /** Hooks waiting for `chunking` to empty. */
  private chunkWaiters: (() => void)[] = [];
  /** The patches at a question (#93), each a child of its file's mesh. */
  private patches: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  /** The sculpt as the file has it: flat-shaded in the primer's grey, no look yet (PM decision, #92). */
  private readonly questionMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(DEFAULT_LOOK.base),
    flatShading: true,
    roughness: MINI_ROUGHNESS,
    metalness: MINI_METALNESS,
  });
  private running = false;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    host.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(BACKGROUND);

    // The same light as the page's viewer and the thumbnail (#99).
    addTableLights(this.scene);
    this.grid = new THREE.GridHelper(
      GRID_SQUARE_MM * GRID_SQUARES,
      GRID_SQUARES,
      0x4a4f5a,
      0x2c3038,
    );
    this.scene.add(this.grid);

    this.camera.position.set(60, 60, 90);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;

    // The question's shader is compiled and first drawn now, by a triangle without area, not in
    // the frame that first shows a large question (#108). The loop does not run yet: one draw.
    const warm = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(9), 3),
      ),
      this.questionMaterial,
    );
    warm.frustumCulled = false;
    warm.onAfterRender = () => {
      this.scene.remove(warm);
      warm.geometry.dispose();
    };
    void this.renderer
      .compileAsync(warm, this.camera, this.scene)
      .then(() => {
        this.scene.add(warm);
        if (!this.running) this.renderer.render(this.scene, this.camera);
      })
      .catch(() => undefined);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.canvas);
    this.resize();
  }

  /** The renderer's figures of the last frame: what the page's live figures show at a question. */
  get info(): { triangles: number; drawCalls: number } {
    const { triangles, calls } = this.renderer.info.render;
    return { triangles, drawCalls: calls };
  }

  /** Draws a frame per animation frame, adding a chunk per frame (#108), while a question is held. */
  private start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(() => {
      this.resize();
      this.controls.update();
      this.addNextChunk();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /**
   * Shows the full-detail meshes of a question (#92, #93): each file's welded mesh in file
   * coordinates at the transform the worker gave it, flat-shaded, under one holder in the pivot
   * so a turn being tried out turns them all. A later call with the same files only moves them:
   * the geometries stay on the GPU; a file not shown before is added, one no longer shown is
   * removed. With `reframe` the camera frames them as a new mini.
   */
  showShown(
    entries: readonly {
      file: number;
      mesh: IndexedMesh;
      rotation: Rotation;
      translation: Vec3;
    }[],
    box: { min: Vec3; max: Vec3 },
    reframe: boolean,
  ): void {
    if (!this.question) {
      this.clear();
      const holder = new THREE.Group();
      this.question = { holder, meshes: new Map() };
      this.pivot.add(holder);
      this.scene.add(this.pivot);
      this.gizmo?.attach(this.pivot);
    }
    const { holder, meshes } = this.question;
    const kept = new Set<number>();
    for (const { file, mesh, rotation, translation } of entries) {
      kept.add(file);
      let shown = meshes.get(file);
      if (!shown) {
        shown = new QuestionFile(mesh);
        holder.add(shown);
        meshes.set(file, shown);
        // An ordinary mini now, whole, as before. A large one a chunk per frame from the next
        // (#108): this frame already brings the question's first draw of the turn gizmo.
        if (shown.chunks === 1) shown.addChunk(this.questionMaterial);
        else this.chunking.push(shown);
      }
      shown.quaternion.set(...rotation);
      shown.position.set(...translation);
    }
    for (const [file, shown] of meshes) {
      if (kept.has(file)) continue;
      holder.remove(shown);
      this.dropChunking(shown);
      shown.dispose();
      meshes.delete(file);
    }
    const [minX, minY, minZ] = box.min;
    const [maxX, maxY, maxZ] = box.max;
    // The pivot at half the height, so a turn pivots about the middle; what is shown is centred
    // across, so a figure laid beside its base stays in the frame.
    const middle = (minY + maxY) / 2;
    holder.position.set(0 - (minX + maxX) / 2, 0 - middle, 0 - (minZ + maxZ) / 2);
    this.pivot.position.set(0, middle, 0);
    this.pivot.quaternion.copy(this.turn);
    this.size.set(maxX - minX, maxY - minY, maxZ - minZ);
    holder.updateMatrixWorld(true);
    // At a question the wheel zooms towards what is under the cursor (#93).
    this.controls.zoomToCursor = true;
    if (reframe) this.setCamera(34, 22, 1);
    this.start();
  }

  /** Resolves once every file of the question shown has all its chunks (#108); they are drawn from the next frame. */
  chunksAdded(): Promise<void> {
    return this.chunking.length === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.chunkWaiters.push(resolve));
  }

  /** One frame's share of a question's meshes: the next chunk of the first file waiting (#108). */
  private addNextChunk(): void {
    const first = this.chunking[0];
    if (!first) return;
    first.addChunk(this.questionMaterial);
    if (first.complete) this.dropChunking(first);
  }

  /** Stops adding chunks to `file`; whoever waits is told when no file is left. */
  private dropChunking(file: QuestionFile): void {
    this.chunking = this.chunking.filter((entry) => entry !== file);
    if (this.chunking.length === 0) for (const resolve of this.chunkWaiters.splice(0)) resolve();
  }

  /**
   * The camera's ray through canvas point (x, y), CSS pixels, at a question (#93, patches §7.3):
   * in the coordinates the question's `shown` transforms are given in (the holder's), so the
   * worker can carry it into each file. Null when no question is shown.
   */
  rayAt(x: number, y: number): { origin: Vec3; direction: Vec3 } | null {
    if (!this.question) return null;
    this.resize();
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((x / rect.width) * 2 - 1, 0 - ((y / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(pointer, this.camera);
    const { holder } = this.question;
    this.pivot.updateMatrixWorld(true);
    const toLocal = holder.matrixWorld.clone().invert();
    const origin = this.raycaster.ray.origin.clone().applyMatrix4(toLocal);
    const direction = this.raycaster.ray.direction.clone().transformDirection(toLocal);
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  }

  /** Where a file's point is on the canvas, CSS pixels: what a test taps to mark it. Null when the file is not shown. */
  screenOf(file: number, point: Vec3): [number, number] | null {
    const mesh = this.question?.meshes.get(file);
    if (!mesh) return null;
    this.resize();
    this.pivot.updateMatrixWorld(true);
    // A camera moved since the last frame has not updated its matrices yet.
    this.camera.updateMatrixWorld();
    const world = mesh.localToWorld(new THREE.Vector3(...point));
    world.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return [((world.x + 1) / 2) * rect.width, ((1 - world.y) / 2) * rect.height];
  }

  /**
   * The patches at a question (#93, patches §7.3): per patch one mesh, a child of its file's group
   * sharing its positions, indexed by the patch's triangles. Drawn once solid just in front of
   * the surface and once faint through everything, so a patch under a foot or inside a joint
   * still shows. Both sides of a pair in its colour (`PAIR_COLOURS`); a proposal paler.
   */
  setPatches(
    patches: readonly {
      file: number;
      triangles: Uint32Array;
      pair: number;
      proposed: boolean;
    }[],
  ): void {
    this.clearPatches();
    if (!this.question) return;
    for (const patch of patches) {
      const mesh = this.question.meshes.get(patch.file);
      if (!mesh || patch.triangles.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', mesh.positions);
      const indices = new Uint32Array(patch.triangles.length * 3);
      const source = mesh.source.indices;
      patch.triangles.forEach((t, k) => {
        indices[k * 3] = source[t * 3]!;
        indices[k * 3 + 1] = source[t * 3 + 1]!;
        indices[k * 3 + 2] = source[t * 3 + 2]!;
      });
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      const color = PAIR_COLOURS[patch.pair % PAIR_COLOURS.length]!;
      const solid = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: patch.proposed,
          opacity: patch.proposed ? 0.6 : 1,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      );
      const through = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: patch.proposed ? 0.15 : 0.3,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      through.renderOrder = 10;
      mesh.add(solid, through);
      this.patches.push(solid, through);
    }
  }

  /**
   * Turns the camera about a point of a file at a question (#93): the orbit's centre moves
   * there and the camera keeps its direction, coming closer when it was far. What a right-click
   * or a held finger on a part does, so two parts side by side can each be looked at.
   */
  focusOn(file: number, point: Vec3): void {
    const mesh = this.question?.meshes.get(file);
    if (!mesh) return;
    this.pivot.updateMatrixWorld(true);
    this.lookAt(mesh.localToWorld(new THREE.Vector3(...point)), null);
  }

  /** Frames one file at a question (#93): the orbit's centre at the middle of its box, the camera at its size. */
  focusFile(file: number): void {
    const mesh = this.question?.meshes.get(file);
    if (!mesh) return;
    this.pivot.updateMatrixWorld(true);
    // The file's box, also while chunks are still to come (#108).
    const box = mesh.box.clone().applyMatrix4(mesh.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    this.lookAt(box.getCenter(new THREE.Vector3()), Math.max(size.x, size.y, size.z, 1) * 2.3);
  }

  /** The orbit's centre to `target`, the camera along its present direction at `distance` (null: keep it, at most as far as now). */
  private lookAt(target: THREE.Vector3, distance: number | null): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const length = offset.length();
    const radius = Math.max(this.size.x, this.size.y, this.size.z, 1);
    // A point looked at closely: no further than the size of what is shown.
    const wanted = distance ?? Math.min(length, radius * 1.2);
    offset.setLength(wanted);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
  }

  private clearPatches(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const patch of this.patches) {
      patch.parent?.remove(patch);
      geometries.add(patch.geometry);
      (patch.material as THREE.Material).dispose();
    }
    // The positions are the file's: only the index goes with the geometry.
    for (const geometry of geometries) {
      geometry.deleteAttribute('position');
      geometry.dispose();
    }
    this.patches = [];
  }

  /**
   * The brush at a question (#93, patches §7.4): while on, one finger and the left button are
   * the view's to paint with; two fingers and the right button orbit, the middle button pans.
   */
  setBrush(on: boolean): void {
    const none = -1 as unknown as THREE.MOUSE;
    this.controls.mouseButtons = {
      LEFT: on ? none : THREE.MOUSE.ROTATE,
      MIDDLE: on ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY,
      RIGHT: on ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: on ? (-1 as unknown as THREE.TOUCH) : THREE.TOUCH.ROTATE,
      TWO: on ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN,
    };
  }

  // setTurn, setTurnGizmo and setCamera are the viewer's (src/page/viewer.ts), copied: the page's
  // viewer turns and frames a converted mini, this scene a question (#119 design note §7.2). Keep
  // the two copies doing the same.

  /**
   * Turns the meshes by `turn` (scene axes, about the middle of their height) to preview a
   * correction at an up question: nothing is converted. Null turns them back.
   */
  setTurn(turn: Rotation | null): void {
    if (turn) this.turn.set(...turn);
    else this.turn.identity();
    this.pivot.quaternion.copy(this.turn);
  }

  /**
   * Shows a rotate gizmo on the meshes, without the ring that turns them about the vertical:
   * which way a mini faces is the table's job. `onTurn` hears every change; null hides it.
   * The camera stays still while the gizmo is dragged.
   */
  setTurnGizmo(onTurn: ((turn: Rotation) => void) | null): void {
    this.onTurn = onTurn;
    if (!onTurn) {
      if (this.gizmo) {
        this.gizmo.detach();
        this.scene.remove(this.gizmo.getHelper());
        this.gizmo.dispose();
        this.gizmo = null;
      }
      return;
    }
    if (!this.gizmo) {
      const gizmo = new TransformControls(this.camera, this.canvas);
      gizmo.setMode('rotate');
      gizmo.showY = false;
      gizmo.size = 1.6;
      gizmo.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
      });
      gizmo.addEventListener('objectChange', () => {
        this.turn.copy(this.pivot.quaternion);
        this.onTurn?.(this.turn.toArray() as Rotation);
      });
      this.scene.add(gizmo.getHelper());
      this.gizmo = gizmo;
    }
    if (this.question) this.gizmo.attach(this.pivot);
  }

  setWireframe(wireframe: boolean): void {
    this.questionMaterial.wireframe = wireframe;
  }

  /**
   * Puts the camera on a sphere around what is shown: `azimuthDeg` around the vertical axis
   * (0 = in front, on +z), `elevationDeg` above the horizon, `zoom` 1 = all of it in frame,
   * 2 = twice as close. Fixed positions make screenshots comparable.
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

  /** Removes the question's meshes and releases their GPU buffers; the loop stops. */
  clear(): void {
    this.gizmo?.detach();
    this.clearPatches();
    this.controls.zoomToCursor = false;
    if (this.question) {
      this.pivot.remove(this.question.holder);
      this.scene.remove(this.pivot);
      for (const file of this.question.meshes.values()) {
        this.dropChunking(file);
        file.dispose();
      }
      this.question = null;
    }
    this.stop();
  }

  /** Releases everything: the meshes, the gizmo, the controls, the renderer and its canvas. */
  dispose(): void {
    this.clear();
    this.setTurnGizmo(null);
    this.resizer.disconnect();
    this.controls.dispose();
    this.questionMaterial.dispose();
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

/**
 * A file's full-detail mesh at a question, as chunks of its triangles (#108): an ordinary mini
 * is one chunk, its own arrays as before; a large sculpt gets a chunk per frame, each a range of
 * the index array over the file's positions (shared, handed to the GPU once with the first), so
 * no frame hands the GPU more than the positions or one chunk. Patches are children too.
 */
class QuestionFile extends THREE.Group {
  /** The positions every chunk and patch draws from. */
  readonly positions: THREE.BufferAttribute;
  /** The whole file's box in its own coordinates. */
  readonly box: THREE.Box3;
  private readonly sphere: THREE.Sphere;
  private readonly ranges: { from: number; to: number }[];
  private next = 0;

  constructor(readonly source: IndexedMesh) {
    super();
    this.positions = new THREE.BufferAttribute(source.positions, 3);
    this.ranges = chunkRanges(source.indices.length / 3, source.positions.byteLength);
    this.box = new THREE.Box3().setFromArray(source.positions);
    this.sphere = this.box.getBoundingSphere(new THREE.Sphere());
  }

  /** How many chunks the file is drawn in. */
  get chunks(): number {
    return this.ranges.length;
  }

  /** True once every chunk is added. */
  get complete(): boolean {
    return this.next >= this.ranges.length;
  }

  /** Adds the next chunk, drawn with `material`. */
  addChunk(material: THREE.Material): void {
    const range = this.ranges[this.next++];
    if (!range) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    // Given, not measured: three.js would measure each chunk's bounds over all the file's
    // vertices (to sort what it draws, even when nothing is culled), 150 ms a chunk on the
    // laptop for the largest corpus mini.
    geometry.boundingBox = this.box;
    geometry.boundingSphere = this.sphere;
    geometry.setIndex(
      new THREE.BufferAttribute(this.source.indices.subarray(range.from * 3, range.to * 3), 1),
    );
    this.add(new THREE.Mesh(geometry, material));
  }

  /** Releases the chunks' GPU buffers (the shared positions with the first). */
  dispose(): void {
    this.next = this.ranges.length;
    for (const child of [...this.children]) {
      this.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
  }
}
