/**
 * Our typed wrapper around our own WebAssembly build of xatlas (`wasm/xatlas/`). The module is
 * standalone: no generated JavaScript, and every struct is filled on the C side (`shim.c`), so
 * this file only moves typed arrays in and out of the heap. Design: docs/design/own-xatlas-build.md.
 */

/** xatlas's stages, as the progress callback names them. Finding the charts is nearly all of the time. */
export const PROGRESS = { addMesh: 0, computeCharts: 1, packCharts: 2, buildOutput: 3 } as const;
export type ProgressCategory = (typeof PROGRESS)[keyof typeof PROGRESS];

export interface AtlasMeshInput {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex. */
  normals?: Float32Array;
  /** Three per triangle. */
  indices: Uint32Array;
}

export interface AtlasOptions {
  maxCost: number;
  resolution: number;
  padding: number;
  bilinear: boolean;
  blockAlign: boolean;
}

export interface AtlasMeshOutput {
  vertexCount: number;
  /** Two per vertex, in texels of the atlas (divide by width and height for 0..1). */
  uvs: Float32Array;
  /** For every output vertex, the input vertex it came from. */
  xref: Uint32Array;
  indices: Uint32Array;
}

export interface Atlas {
  /** Throws `Error('Unwrap failed: <xatlas's message>')` when xatlas refuses the mesh. */
  addMesh(mesh: AtlasMeshInput, meshCountHint: number): void;
  /** Runs chart finding and packing. The callback returns false to cancel. */
  generate(
    options: AtlasOptions,
    onProgress?: (category: ProgressCategory, percent: number) => boolean,
  ): void;
  readonly width: number;
  readonly height: number;
  readonly chartCount: number;
  utilisation(atlasIndex?: number): number;
  /** Copies the result out of the WebAssembly heap; valid after generate. */
  mesh(index: number): AtlasMeshOutput;
  destroy(): void;
}

export interface Xatlas {
  createAtlas(): Atlas;
}

/** What `shim.c` and Emscripten export. Pointers are byte offsets into `memory`. */
interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  mt_out_of_memory(): number;
  mt_atlas_create(): number;
  mt_atlas_destroy(atlas: number): void;
  mt_add_mesh(
    atlas: number,
    positions: number,
    normals: number,
    indices: number,
    vertexCount: number,
    indexCount: number,
    meshCountHint: number,
  ): number;
  mt_add_mesh_error_string(error: number): number;
  mt_generate(
    atlas: number,
    maxCost: number,
    resolution: number,
    padding: number,
    bilinear: number,
    blockAlign: number,
  ): void;
  mt_atlas_width(atlas: number): number;
  mt_atlas_height(atlas: number): number;
  mt_atlas_chart_count(atlas: number): number;
  mt_atlas_utilization(atlas: number, atlasIndex: number): number;
  mt_mesh_vertex_count(atlas: number, mesh: number): number;
  mt_mesh_index_count(atlas: number, mesh: number): number;
  mt_mesh_vertices(atlas: number, mesh: number): number;
  mt_mesh_indices(atlas: number, mesh: number): number;
  mt_vertex_stride(): number;
  mt_vertex_uv_offset(): number;
  mt_vertex_xref_offset(): number;
}

/** The module's own file: Vite turns this into a hashed asset under /assets/ in the page and the worker. */
const WASM_URL = new URL('../../../wasm/xatlas/xatlas.wasm', import.meta.url);

/** Contains "cannot enlarge memory", so `isOutOfMemory` in problems.ts recognises it. */
const OUT_OF_MEMORY = 'cannot enlarge memory: xatlas ran out of WebAssembly memory';

let loaded: Promise<Xatlas> | null = null;

/** Compiles and instantiates the module once per worker; later calls return the same instance. */
export function loadXatlas(): Promise<Xatlas> {
  return (loaded ??= compile().then((module) => new Instance(module)));
}

/** A fresh, uncached instance of a given build: for measuring variants (scripts/measure-xatlas.mjs). */
export async function instantiateXatlas(wasm: BufferSource): Promise<Xatlas> {
  return new Instance(await WebAssembly.compile(wasm));
}

async function compile(): Promise<WebAssembly.Module> {
  if (WASM_URL.protocol === 'file:') {
    // Node (Vitest, benchmarks, scripts). A variable specifier keeps the bundler away from it.
    const fs = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as typeof import('node:fs/promises');
    return WebAssembly.compile(await readFile(WASM_URL));
  }
  const response = await fetch(WASM_URL);
  if (!response.ok)
    throw new Error(`Unwrap failed: could not load the unwrapper (${response.status})`);
  return WebAssembly.compile(await response.arrayBuffer());
}

/**
 * One instance of the module. A trap leaves xatlas's heap in an unknown state, so after one the
 * next atlas gets a fresh instance of the same compiled module.
 */
class Instance implements Xatlas {
  private exports!: Exports;
  private broken = false;
  /** Counts instantiations, so an atlas of a replaced instance cannot touch the new heap. */
  generation = 0;
  private views: {
    buffer: ArrayBuffer;
    u8: Uint8Array;
    f32: Float32Array;
    u32: Uint32Array;
  } | null = null;
  private onProgress: ((category: ProgressCategory, percent: number) => boolean) | null = null;

  constructor(private readonly module: WebAssembly.Module) {
    this.instantiate();
  }

  private instantiate(): void {
    const stdio = {
      // The shim switches xatlas's printing off, so nothing should arrive here. If something does,
      // it is dropped, but reported as written: musl retries a write that wrote nothing, forever.
      fd_write: (_fd: number, iovs: number, iovCount: number, written: number): number => {
        const u32 = this.heap().u32;
        let bytes = 0;
        for (let i = 0; i < iovCount; i++) bytes += u32[(iovs >> 2) + i * 2 + 1]!;
        u32[written >> 2] = bytes;
        return 0;
      },
    };
    const env = {
      mt_progress: (category: number, percent: number): number =>
        this.onProgress ? Number(this.onProgress(category as ProgressCategory, percent)) : 1,
      emscripten_notify_memory_growth: (): void => {
        this.views = null;
      },
    };
    const instance = new WebAssembly.Instance(this.module, {
      env,
      wasi_snapshot_preview1: stdio,
    });
    this.exports = instance.exports as unknown as Exports;
    this.exports._initialize();
    this.views = null;
    this.broken = false;
    this.generation++;
  }

  /** Views over the heap, re-created whenever it has grown (growth detaches the old buffer). */
  heap(): { u8: Uint8Array; f32: Float32Array; u32: Uint32Array } {
    const buffer = this.exports.memory.buffer;
    if (this.views?.buffer !== buffer) {
      this.views = {
        buffer,
        u8: new Uint8Array(buffer),
        f32: new Float32Array(buffer),
        u32: new Uint32Array(buffer),
      };
    }
    return this.views;
  }

  /** Runs a call into the module; turns a trap into an unwrap error and marks the instance spent. */
  call<T>(run: (exports: Exports) => T): T {
    try {
      return run(this.exports);
    } catch (error) {
      const outOfMemory = this.exports.mt_out_of_memory() !== 0;
      this.broken = true;
      if (outOfMemory) throw new Error(`Unwrap failed: ${OUT_OF_MEMORY}`, { cause: error });
      if (error instanceof Error && error.message.startsWith('Unwrap failed')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unwrap failed: ${message}`, { cause: error });
    }
  }

  /** Copies an array into the heap; the caller frees it. */
  copyIn(values: Float32Array | Uint32Array): number {
    const pointer = this.exports.malloc(values.byteLength);
    if (pointer === 0) throw new Error(`Unwrap failed: ${OUT_OF_MEMORY}`);
    this.heap().u8.set(
      new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
      pointer,
    );
    return pointer;
  }

  text(pointer: number): string {
    const u8 = this.heap().u8;
    let end = pointer;
    while (u8[end] !== 0) end++;
    return new TextDecoder().decode(u8.subarray(pointer, end));
  }

  setProgress(callback: ((category: ProgressCategory, percent: number) => boolean) | null): void {
    this.onProgress = callback;
  }

  createAtlas(): Atlas {
    if (this.broken) this.instantiate();
    return new AtlasHandle(
      this,
      this.call((x) => x.mt_atlas_create()),
    );
  }

  /** Whether an atlas made in the given generation may still call into the heap. */
  holds(generation: number): boolean {
    return !this.broken && generation === this.generation;
  }
}

class AtlasHandle implements Atlas {
  private readonly generation: number;

  constructor(
    private readonly owner: Instance,
    private pointer: number,
  ) {
    this.generation = owner.generation;
  }

  /** The instance, as long as this atlas still lives in it. */
  private get live(): Instance {
    if (!this.pointer || !this.owner.holds(this.generation)) {
      throw new Error('Unwrap failed: the atlas is gone (destroyed, or its instance trapped)');
    }
    return this.owner;
  }

  addMesh(mesh: AtlasMeshInput, meshCountHint: number): void {
    const owner = this.live;
    const pointers: number[] = [];
    try {
      const positions = owner.call(() => owner.copyIn(mesh.positions));
      pointers.push(positions);
      const normals = mesh.normals ? owner.call(() => owner.copyIn(mesh.normals!)) : 0;
      if (normals) pointers.push(normals);
      const indices = owner.call(() => owner.copyIn(mesh.indices));
      pointers.push(indices);
      const error = owner.call((x) =>
        x.mt_add_mesh(
          this.pointer,
          positions,
          normals,
          indices,
          mesh.positions.length / 3,
          mesh.indices.length,
          meshCountHint,
        ),
      );
      if (error !== 0) {
        const message = owner.text(owner.call((x) => x.mt_add_mesh_error_string(error)));
        throw new Error(`Unwrap failed: ${message}`);
      }
    } finally {
      // xatlas has copied the input into its own structures by the time addMesh returns.
      if (owner.holds(this.generation))
        for (const pointer of pointers) owner.call((x) => x.free(pointer));
    }
  }

  generate(
    options: AtlasOptions,
    onProgress?: (category: ProgressCategory, percent: number) => boolean,
  ): void {
    const owner = this.live;
    owner.setProgress(onProgress ?? null);
    try {
      owner.call((x) =>
        x.mt_generate(
          this.pointer,
          options.maxCost,
          options.resolution,
          options.padding,
          Number(options.bilinear),
          Number(options.blockAlign),
        ),
      );
    } finally {
      owner.setProgress(null);
    }
  }

  get width(): number {
    return this.live.call((x) => x.mt_atlas_width(this.pointer));
  }

  get height(): number {
    return this.live.call((x) => x.mt_atlas_height(this.pointer));
  }

  get chartCount(): number {
    return this.live.call((x) => x.mt_atlas_chart_count(this.pointer));
  }

  utilisation(atlasIndex = 0): number {
    return this.live.call((x) => x.mt_atlas_utilization(this.pointer, atlasIndex));
  }

  mesh(index: number): AtlasMeshOutput {
    const owner = this.live;
    return owner.call((x) => {
      const vertexCount = x.mt_mesh_vertex_count(this.pointer, index);
      const indexCount = x.mt_mesh_index_count(this.pointer, index);
      const vertices = x.mt_mesh_vertices(this.pointer, index);
      const indexArray = x.mt_mesh_indices(this.pointer, index);
      const stride = x.mt_vertex_stride() >> 2;
      const uvAt = (vertices + x.mt_vertex_uv_offset()) >> 2;
      const xrefAt = (vertices + x.mt_vertex_xref_offset()) >> 2;
      const { f32, u32 } = owner.heap();
      const uvs = new Float32Array(vertexCount * 2);
      const xref = new Uint32Array(vertexCount);
      for (let v = 0; v < vertexCount; v++) {
        uvs[v * 2] = f32[uvAt + v * stride]!;
        uvs[v * 2 + 1] = f32[uvAt + v * stride + 1]!;
        xref[v] = u32[xrefAt + v * stride]!;
      }
      const indices = u32.slice(indexArray >> 2, (indexArray >> 2) + indexCount);
      return { vertexCount, uvs, xref, indices };
    });
  }

  destroy(): void {
    // A spent instance is replaced as a whole; its heap is not touched again.
    if (this.pointer && this.owner.holds(this.generation)) {
      this.owner.call((x) => x.mt_atlas_destroy(this.pointer));
    }
    this.pointer = 0;
  }
}
