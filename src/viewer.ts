import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  bakedTextureBytes,
  createBakedGeometry,
  createBakedMaterial,
  createDetailTexture,
  createLookUniforms,
  disposeBakedMaterial,
  updateLookUniforms,
} from './baked-material';
import { compressedTextureBytes, ownCopy } from './compressed-texture';
import { DEFAULT_LOOK, vertexColours, type Look } from './pipeline/look';
import type { IndexedMesh } from './pipeline/mesh';
import type { Rotation } from './pipeline/rotation';
import { GRID_SQUARE_MM } from './pipeline/size';

/** Squares the grid shows along each side. */
const GRID_SQUARES = 40;
/**
 * Camera distance (mm) from which each LOD is used, highest detail first. Provisional:
 * tuned by eye on a 1080p screen, to be fixed in the Phase 0 write-up.
 */
export const LOD_DISTANCES_MM = [0, 250, 600] as const;
/** Frames averaged for the performance read-out. */
const PERF_WINDOW = 120;
/** A baked table level as the viewer draws it. */
export interface BakedMini {
  /** The unwrapped mesh. */
  mesh: IndexedMesh;
  resolution: number;
  /** The transcoded KTX2 texture; raw RGBA texels only when compression is switched off for development. */
  texture: THREE.CompressedTexture | Uint8Array;
}

const detailTextureBytes = ({ texture, resolution }: BakedMini): number =>
  texture instanceof Uint8Array
    ? bakedTextureBytes(resolution)
    : compressedTextureBytes(resolution);

/** Which stress-scene level (0 = close, 1 = table, 2 = far) is drawn from baked data. */
const BAKED_LOD = 1;

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
  /** Distance between neighbouring stress-scene minis: their footprint on the grid. 0 without a stress scene. */
  stressSpacingMm: number;
  /** How many minis currently show each LOD, highest detail first. */
  minisPerLod: number[];
  /** Minis drawn with a baked detail texture, and the GPU memory those textures take (with mipmaps). */
  bakedMinis: number;
  textureBytes: number;
}

/**
 * Coordinate conventions (keep in sync with CLAUDE.md):
 * the scene is Y-up and 1 unit = 1 mm. The pipeline delivers meshes already converted
 * to that convention, standing on y = 0 with the origin at the centre of the base (of the
 * bounding box when there is none), measured in x and z.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  private readonly controls: OrbitControls;
  private readonly grid: THREE.GridHelper;
  private mesh: THREE.Mesh | null = null;
  private stress: THREE.LOD[] = [];
  private stressSpacingMm = 0;
  private imported: THREE.Group | null = null;
  /** Every baked material on screen: each owns a texture that has to be released. */
  private bakedMaterials: THREE.MeshStandardMaterial[] = [];
  private textureBytes = 0;
  private readonly size = new THREE.Vector3(1, 1, 1);
  /** A turn the user is trying out (issue #72): shown on the mini, not converted. */
  private readonly turn = new THREE.Quaternion();
  /** Holds the single mini at half its height, so a turn pivots about its middle, not its feet. */
  private readonly pivot = new THREE.Group();
  private gizmo: TransformControls | null = null;
  private onTurn: ((turn: Rotation) => void) | null = null;
  private look: Look = { ...DEFAULT_LOOK };
  private readonly lookUniforms = createLookUniforms(DEFAULT_LOOK);
  // The colour comes from the vertices (see look.ts), so the material itself stays white.
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
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
    this.grid = new THREE.GridHelper(
      GRID_SQUARE_MM * GRID_SQUARES,
      GRID_SQUARES,
      0x4a4f5a,
      0x2c3038,
    );
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
    this.showSingle(sizeMm, reframe);
  }

  /** Adds the single mini to the scene, with the turn being tried out and the gizmo if shown. */
  private showSingle(sizeMm: [number, number, number], reframe: boolean): void {
    this.pivot.position.set(0, sizeMm[1] / 2, 0);
    this.pivot.quaternion.copy(this.turn);
    this.mesh!.position.set(0, -sizeMm[1] / 2, 0);
    this.pivot.add(this.mesh!);
    this.scene.add(this.pivot);
    this.gizmo?.attach(this.pivot);
    this.size.set(...sizeMm);
    if (reframe) this.setCamera(34, 22, 1);
  }

  /**
   * Turns the shown mini by `turn` (scene axes, about the middle of its height) to preview
   * a correction: nothing is converted. Null turns it back.
   */
  setTurn(turn: Rotation | null): void {
    if (turn) this.turn.set(...turn);
    else this.turn.identity();
    this.pivot.quaternion.copy(this.turn);
  }

  /**
   * Shows a rotate gizmo on the mini, without the ring that turns it about the vertical:
   * which way it faces is the table's job. `onTurn` hears every change; null hides it.
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
    if (this.mesh) this.gizmo.attach(this.pivot);
  }

  /**
   * Fills the table with `count` copies of a mini, each with its own GPU buffers and its
   * own draw calls, so the cost equals that many different minis of this size. `lods` runs
   * from highest to lowest detail. With `forcedLod` every mini shows that level at any
   * distance; otherwise the level follows the camera distance. Several minis can be mixed:
   * `sets` holds the LODs of each, and `setFor` says which one stands at position i.
   *
   * With `baked`, the table level (index 1) of a mini is drawn from its baked mesh and its
   * own copy of the detail texture, as long as `textureBudgetBytes` allows; minis beyond the
   * budget fall back to the per-vertex look. That is the policy for weak devices.
   *
   * Every mini stands in its own footprint of `footprintSquares` × `footprintSquares` grid
   * squares, as on the table; a mix of sizes is spaced by the largest.
   */
  showStress(
    sets: IndexedMesh[][],
    count: number,
    forcedLod: number | null = null,
    setFor: (index: number) => number = () => 0,
    baked: (BakedMini | null)[] = [],
    textureBudgetBytes = Infinity,
    footprintSquares = 1,
  ): void {
    this.clear();
    const spacing = footprintSquares * GRID_SQUARE_MM;
    this.stressSpacingMm = spacing;
    const bakedTemplates = baked.map((entry) => entry && createBakedGeometry(entry.mesh));
    const templateSets = sets.map((lods) => lods.map((lod) => this.toGeometry(lod)));
    const side = Math.ceil(Math.sqrt(count));
    // Footprints start on grid lines, so a mini stands centred in its squares.
    const cell = (column: number): number =>
      (column - Math.floor(side / 2)) * spacing + spacing / 2;

    for (let i = 0; i < count; i++) {
      const mini = new THREE.LOD();
      const set = setFor(i);
      const entry = baked[set];
      const cost = entry ? detailTextureBytes(entry) : 0;
      const fits = entry && this.textureBytes + cost <= textureBudgetBytes;
      templateSets[set]!.forEach((template, level) => {
        if (forcedLod !== null && level !== forcedLod) return;
        // clone() copies the vertex data, so every mini uploads its own buffers.
        const distance = forcedLod === null ? LOD_DISTANCES_MM[level]! : 0;
        const mesh =
          level === BAKED_LOD && entry && fits
            ? new THREE.Mesh(bakedTemplates[set]!.clone(), this.addBakedMaterial(entry, true))
            : new THREE.Mesh(template.clone(), this.material);
        mini.addLevel(mesh, distance);
      });
      mini.position.set(cell(i % side), 0, cell(Math.floor(i / side)));
      mini.rotation.y = (i * 2.399963) % (Math.PI * 2);
      this.scene.add(mini);
      this.stress.push(mini);
    }
    templateSets.flat().forEach((template) => template.dispose());
    bakedTemplates.forEach((template) => template?.dispose());

    const span = side * spacing;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(span * 0.55, span * 0.5, span * 0.75);
    this.camera.near = 1;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 4;
  }

  /**
   * Shows a GLB file as it is, colours included: the check that an export opens again.
   * glTF is in metres, the scene in millimetres.
   */
  async showGlb(
    glb: ArrayBuffer,
  ): Promise<{ triangles: number; sizeMm: [number, number, number] }> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(glb, '');
    this.clear();
    this.imported = new THREE.Group();
    this.imported.add(gltf.scene);
    this.imported.scale.setScalar(1000);
    this.scene.add(this.imported);

    let triangles = 0;
    this.imported.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (geometry) triangles += (geometry.index?.count ?? geometry.attributes.position!.count) / 3;
    });
    const size = new THREE.Box3().setFromObject(this.imported).getSize(new THREE.Vector3());
    this.size.copy(size);
    this.setCamera(34, 22, 1);
    return { triangles, sizeMm: [size.x, size.y, size.z] };
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
      stressSpacingMm: this.stress.length > 0 ? this.stressSpacingMm : 0,
      bakedMinis: this.bakedMaterials.length,
      textureBytes: this.textureBytes,
      minisPerLod: LOD_DISTANCES_MM.map(
        (_, level) => this.stress.filter((mini) => mini.getCurrentLevel() === level).length,
      ),
    };
  }

  /**
   * Shows an unwrapped mesh with its baked detail texture instead of per-vertex data.
   */
  showBaked(mini: BakedMini, sizeMm: [number, number, number], reframe = false): void {
    this.clear();
    this.mesh = new THREE.Mesh(createBakedGeometry(mini.mesh), this.addBakedMaterial(mini, false));
    this.showSingle(sizeMm, reframe);
  }

  /** The renderer, for code that has to ask it which compressed formats the GPU supports. */
  get webglRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** `own`: the mini gets its own GPU texture, as different minis on a real table would. */
  private addBakedMaterial(mini: BakedMini, own: boolean): THREE.MeshStandardMaterial {
    const { texture: source, resolution } = mini;
    const texture =
      source instanceof Uint8Array
        ? createDetailTexture(own ? source.slice() : source, resolution)
        : own
          ? ownCopy(source)
          : source;
    const material = createBakedMaterial(texture, this.lookUniforms);
    material.wireframe = this.material.wireframe;
    this.bakedMaterials.push(material);
    this.textureBytes += detailTextureBytes(mini);
    return material;
  }

  /** Re-colours everything on screen. Cheap: no conversion, just new vertex colours. */
  setLook(look: Look): void {
    this.look = { ...look };
    // Baked minis read the look from shared uniforms: nothing to rebuild.
    updateLookUniforms(this.lookUniforms, this.look);
    const recolour = (object: THREE.Object3D): void => {
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const source = geometry?.userData.source as IndexedMesh | undefined;
      if (!geometry || !source) return;
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(vertexColours(source, this.look), 3),
      );
    };
    this.mesh?.traverse(recolour);
    // Copies of one mini share their source mesh, so compute each colour set once.
    const done = new Map<IndexedMesh, Float32Array>();
    for (const mini of this.stress) {
      mini.traverse((object) => {
        const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        const source = geometry?.userData.source as IndexedMesh | undefined;
        if (!geometry || !source) return;
        if (!done.has(source)) done.set(source, vertexColours(source, this.look));
        geometry.setAttribute('color', new THREE.BufferAttribute(done.get(source)!.slice(), 3));
      });
    }
  }

  setWireframe(wireframe: boolean): void {
    this.material.wireframe = wireframe;
    for (const material of this.bakedMaterials) material.wireframe = wireframe;
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
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColours(mesh, this.look), 3));
    geometry.userData.source = mesh;
    return geometry;
  }

  private clear(): void {
    this.gizmo?.detach();
    if (this.mesh) {
      this.pivot.remove(this.mesh);
      this.scene.remove(this.pivot);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.bakedMaterials.forEach(disposeBakedMaterial);
    this.bakedMaterials = [];
    this.textureBytes = 0;
    for (const mini of this.stress) {
      this.scene.remove(mini);
      for (const level of mini.levels) (level.object as THREE.Mesh).geometry.dispose();
    }
    this.stress = [];
    if (this.imported) {
      this.scene.remove(this.imported);
      this.imported.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.imported = null;
    }
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
