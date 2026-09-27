/**
 * Our typed wrapper around our own WebAssembly build of the Basis Universal encoder
 * (`wasm/basis-encoder/`). The module is standalone: no generated JavaScript, and the encoder's
 * parameters are filled on the C side (`shim.cpp`), so this file only moves bytes in and out of
 * the heap. Design: docs/design/own-basis-encoder-build.md, sections 4 and 5.
 */

export interface EncodeOptions {
  /** UASTC pack level, 0 (fastest) to 4. */
  effort: number;
  /** Zstandard on top of UASTC. */
  supercompress: boolean;
  mipmaps: boolean;
  /** Perceptual (sRGB) error weighting; off for data such as normals. */
  perceptual: boolean;
  /** The sRGB transfer function in the KTX2 header. */
  srgbTransfer: boolean;
  /** Filters the mipmaps in sRGB space. */
  srgbMips: boolean;
}

export interface BasisEncoder {
  /** Encodes an RGBA image to a KTX2 file; throws `Error('Encode failed: …')` with the encoder's own message. */
  encodeKtx2(rgba: Uint8Array, width: number, height: number, options: EncodeOptions): Uint8Array;
  /** The size of the module's heap now; it grows and never shrinks. */
  readonly heapBytes: number;
}

/** What `shim.cpp` and Emscripten export. Pointers are byte offsets into `memory`. */
interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  mt_init(): number;
  mt_encode(
    rgba: number,
    width: number,
    height: number,
    effort: number,
    zstd: number,
    mipmaps: number,
    perceptual: number,
    srgbTransfer: number,
    srgbMips: number,
  ): number;
  mt_output(): number;
  mt_release(): void;
}

/** The module's own file: Vite turns this into a hashed asset under /assets/ in the page and the worker. */
const WASM_URL = new URL('../../../wasm/basis-encoder/basis_encoder.wasm', import.meta.url);

/** Contains "cannot enlarge memory", so `isOutOfMemory` in problems.ts recognises it. */
const OUT_OF_MEMORY = 'cannot enlarge memory: the encoder ran out of WebAssembly memory';

/** What the encoder prints when an allocation fails, just before it stops (basisu_containers_impl.h). */
const ALLOCATION_FAILED = /failed allocating|out of memory/i;

/** The last few hundred characters the encoder printed are enough to say why it failed. */
const PRINTED_KEEP = 500;

/** `basis_compressor::error_code`, in its order; the shim returns -(100 + code). */
const COMPRESSOR_ERRORS = [
  'success',
  'failed initializing',
  'failed reading source images',
  'failed validating',
  'failed encoding UASTC',
  'failed in the front end',
  'failed extracting the front end',
  'failed in the back end',
  'failed creating the basis file',
  'failed writing output',
  'failed in the UASTC RDO post-process',
  'failed creating the KTX2 file',
  'invalid parameters',
];

/** WASI error numbers the stubs return. */
const WASI_EBADF = 8;
const WASI_ESPIPE = 70;

let loaded: Promise<BasisEncoder> | null = null;

/** Compiles and instantiates the module once per worker; later calls return the same instance. */
export function loadBasisEncoder(): Promise<BasisEncoder> {
  return (loaded ??= compile().then((module) => new Instance(module)));
}

/** A fresh, uncached instance of a given build: for measuring variants (scripts/measure-encoder.mjs). */
export async function instantiateBasisEncoder(wasm: BufferSource): Promise<BasisEncoder> {
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
    throw new Error(`Encode failed: could not load the encoder (${response.status})`);
  return WebAssembly.compile(await response.arrayBuffer());
}

/**
 * One instance of the module. A trap leaves the encoder's heap in an unknown state, so after one
 * the next encode gets a fresh instance of the same compiled module.
 */
class Instance implements BasisEncoder {
  private exports!: Exports;
  private broken = false;
  private views: { buffer: ArrayBuffer; u8: Uint8Array; view: DataView } | null = null;
  /** What the encoder printed since the current call began (its error messages). */
  private printed = '';

  constructor(private readonly module: WebAssembly.Module) {
    this.instantiate();
  }

  private instantiate(): void {
    // The module can reach nothing but these. No file can be opened (there is no path_open), so
    // the fd_* functions only ever see standard input, output and error.
    const wasi = {
      // Keeps the text for the error message and reports every byte as written: musl retries a
      // write that wrote nothing, forever.
      fd_write: (_fd: number, iovs: number, iovCount: number, written: number): number => {
        const { u8, view } = this.heap();
        let bytes = 0;
        for (let i = 0; i < iovCount; i++) {
          const pointer = view.getUint32(iovs + i * 8, true);
          const length = view.getUint32(iovs + i * 8 + 4, true);
          this.printed = (
            this.printed + new TextDecoder().decode(u8.subarray(pointer, pointer + length))
          ).slice(-PRINTED_KEEP);
          bytes += length;
        }
        view.setUint32(written, bytes, true);
        return 0;
      },
      // The file loaders' fread, never reached: the shim hands over pixels, not files.
      fd_read: (): number => WASI_EBADF,
      fd_close: (): number => WASI_EBADF,
      fd_seek: (): number => WASI_ESPIPE,
      // The encoder times its own stages for its statistics; a clock leaks nothing.
      clock_time_get: (_id: number, _precision: bigint, time: number): number => {
        const nanoseconds = BigInt(Math.round(performance.now() * 1e6));
        this.heap().view.setBigUint64(time, nanoseconds, true);
        return 0;
      },
      // libc start-up asks for the environment: there is none.
      environ_sizes_get: (count: number, size: number): number => {
        const { view } = this.heap();
        view.setUint32(count, 0, true);
        view.setUint32(size, 0, true);
        return 0;
      },
      environ_get: (): number => 0,
    };
    const env = {
      emscripten_notify_memory_growth: (): void => {
        this.views = null;
      },
    };
    const instance = new WebAssembly.Instance(this.module, {
      env,
      wasi_snapshot_preview1: wasi,
    });
    this.exports = instance.exports as unknown as Exports;
    this.views = null;
    this.broken = false;
    this.exports._initialize();
    if (this.exports.mt_init() !== 1) throw new Error('Encode failed: the encoder did not start');
  }

  /** Views over the heap, re-created whenever it has grown (growth detaches the old buffer). */
  private heap(): { u8: Uint8Array; view: DataView } {
    const buffer = this.exports.memory.buffer;
    if (this.views?.buffer !== buffer) {
      this.views = { buffer, u8: new Uint8Array(buffer), view: new DataView(buffer) };
    }
    return this.views;
  }

  get heapBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }

  /** The encoder's own last words, for an error message. */
  private reason(): string {
    const text = this.printed.trim();
    return text ? `: ${text}` : '';
  }

  encodeKtx2(rgba: Uint8Array, width: number, height: number, options: EncodeOptions): Uint8Array {
    if (this.broken) this.instantiate();
    const x = this.exports;
    this.printed = '';
    let input = 0;
    try {
      if (rgba.byteLength !== width * height * 4) {
        throw new Error(
          `Encode failed: ${rgba.byteLength} bytes is not a ${width} × ${height} RGBA image`,
        );
      }
      input = x.malloc(Math.max(1, rgba.byteLength));
      if (input === 0) throw new Error(`Encode failed: ${OUT_OF_MEMORY}`);
      this.heap().u8.set(rgba, input);
      const size = x.mt_encode(
        input,
        width,
        height,
        options.effort,
        Number(options.supercompress),
        Number(options.mipmaps),
        Number(options.perceptual),
        Number(options.srgbTransfer),
        Number(options.srgbMips),
      );
      if (size < 0) throw new Error(`Encode failed: ${codeName(size)}${this.reason()}`);
      const pointer = x.mt_output();
      // Copied out at once, and the encoder's copy freed: the worker holds one copy of the file.
      const ktx2 = this.heap().u8.slice(pointer, pointer + size);
      x.mt_release();
      return ktx2;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Encode failed')) throw error;
      // A trap (or a RangeError from growing the heap): the instance is spent.
      this.broken = true;
      input = 0;
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError || ALLOCATION_FAILED.test(this.printed)) {
        throw new Error(`Encode failed: ${OUT_OF_MEMORY}${this.reason()}`, { cause: error });
      }
      throw new Error(`Encode failed: ${message}${this.reason()}`, { cause: error });
    } finally {
      if (input !== 0 && !this.broken) x.free(input);
    }
  }
}

function codeName(code: number): string {
  if (code === -1) return 'the encoder was not initialised';
  if (code === -2) return 'no image';
  return COMPRESSOR_ERRORS[-code - 100] ?? `error ${code}`;
}
