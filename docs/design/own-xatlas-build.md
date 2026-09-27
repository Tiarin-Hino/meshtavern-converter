# Design: our own xatlas build (#33)

Status: design pass by Fable 5.1, 2026-09-26, for Opus 5.5 to build · Spec: Phase 1, story 8 · Issue: #33

This note fixes the decisions the build should not have to make: which upstream commit and toolchain are pinned and how the build proves it is reproducible, the shape of the WebAssembly module (standalone, no generated JavaScript), the C shim and the TypeScript wrapper that replace the `xatlas-wasm` package, the experiments the issue asks for (SIMD, a larger initial heap, the cold-start penalty) with the rule that decides each, the tests that prove every criterion, the build order and where to stop and ask. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§10). Thresholds are named constants marked _(proposal)_; the PM can change them on the PR.

Read first: the issue, then `src/pipeline/unwrap.ts` (the only user of xatlas), then the journal entries [Bake through a BVH, and a warmed-up unwrap](../journal/2026-09-20-bvh-bake-sampling.md) (the cold-start finding of #31) and [Unwrap the table level in slabs](../journal/2026-09-23-slab-unwrap.md) (today's unwrap times).

## 1. What we have today, and what changes

`xatlas-wasm` 0.1.3 is one 289 KB ES module: Emscripten's generated glue, the WebAssembly binary embedded as base64, and a hand-written JavaScript wrapper that fills xatlas's C structs from JavaScript by hard-coded byte offsets. It was built from a fork of xatlas at commit `f700c779`, which is byte-identical to upstream `jpcy/xatlas` master (compared 2026-09-26; upstream's last commit is from 2022-07-25, the library is finished rather than abandoned). The package is MIT, xatlas is MIT (Copyright 2018-2020 Jonathan Young).

Of the package's API, `unwrap.ts` uses: `createAtlas`, `addMesh` (positions, normals, indices, `meshCountHint`), `generate` with `maxCost` and with `resolution`, `padding`, `bilinear`, `blockAlign`, `setProgressCallback`, `getMesh` (each vertex's `xref` and `uv`, plus `indices`), `chartCount`, `getUtilization(0)`, `width`, `height`, `addMeshErrorString`, `destroy`. Nothing else. The new wrapper exposes exactly that.

After this issue:

- `wasm/xatlas/` holds the build: `build.sh` (fetches the pinned sources, checks their hashes, runs `emcc` inside a pinned Docker image), `shim.c` (the C side of our interface), `README.md` (how to rebuild and how to bump), a copy of xatlas's `LICENSE`, and the built `xatlas.wasm`, committed.
- `src/pipeline/xatlas.ts` is the typed wrapper. `unwrap.ts` changes its import and a few lines; its behaviour and its seven tests do not change.
- A CI job rebuilds the module in the same image and fails when a single byte differs from the committed file. That is the proof of "reproducible".
- `xatlas-wasm` leaves `package.json` and the lockfile.

The folder is `wasm/` with `xatlas/` inside because #38 (the KTX2 encoder, the other young dependency in the spec's risk list) should follow the same convention: one folder per module, the same shape of build script.

## 2. Pinning and reproducibility

**Sources.** Upstream commit `f700c7790aaa030e794b52ba7791a05c085faf0c` of `jpcy/xatlas`, the same code the package ships today, so the only thing that changes in this issue is who compiles it and how. The build script downloads four files from `https://raw.githubusercontent.com/jpcy/xatlas/<commit>/` and refuses to build when a SHA-256 does not match (recorded 2026-09-26):

| File                       | Bytes   | SHA-256                                                            |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `source/xatlas/xatlas.cpp` | 332,735 | `0ed0283aad005c94738cb0cc4612dba264379d29dea5b3c9b242f2d4752d5df4` |
| `source/xatlas/xatlas.h`   | 9,904   | `e7675335ad8ab1c1cc9060ad153cf6b8ba2ee914282044eb5f02c49590218fbd` |
| `source/xatlas/xatlas_c.h` | 6,618   | `3aef0438ca395a7c4c215de9fe40460a4530d19654bd21a3f849c76775fbc972` |
| `LICENSE`                  | 1,075   | `2c16d5b1c2808277fe975b4f70f0fd9afc9b3bcf04e6c676665a82cb2d5579e3` |

No git submodule and no clone: four files with hashes are easier to audit and cannot drift. The commit and the hashes are constants at the top of `build.sh` (`XATLAS_COMMIT`, `XATLAS_SHA256_CPP`, …). The downloaded sources land in the git-ignored `out/xatlas/src/`, never in the repo.

**Toolchain.** The Docker image `emscripten/emsdk:6.0.10`, pinned by its manifest digest `sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65` (the newest tag on 2026-09-21; the builder may take a newer one, then records tag and digest the same way). One constant, `EMSDK_IMAGE`. No CMake: xatlas is one translation unit plus our shim, one `emcc` command line says everything. Nothing has to be installed locally but Docker (the development PC has Docker 29.2.1 and neither `emcc` nor `cmake`).

```sh
# wasm/xatlas/build.sh, in outline
npm run xatlas:build            # docker run --rm -v "$PWD":/src -w /src "$EMSDK_IMAGE" bash wasm/xatlas/build.sh --inside
npm run xatlas:build -- --check # builds to out/xatlas/ and compares with wasm/xatlas/xatlas.wasm; exit 1 on a difference
```

**Proof.** A new workflow `.github/workflows/xatlas.yml` runs `npm run xatlas:build -- --check` on `ubuntu-latest` (Docker is present there). It runs on pull requests and pushes to `main` that touch `wasm/xatlas/**` or the workflow itself, and by hand (`workflow_dispatch`) _(proposal)_; it is not a required check, so a PR that does not touch the build is not slowed by a 2–4 minute compile. On this PR it runs and must be green. Before the first commit of the binary, the builder runs the build twice locally and compares the two outputs with `cmp`: Emscripten's output is deterministic for a fixed image and fixed flags, but if the two runs differ, the cause (a `__DATE__`, LTO parallelism, a stray `-g`) is found and removed first. A build that cannot be made byte-identical fails the criterion: stop and ask (§10).

**Bumping** xatlas or Emscripten later means changing the constants, rebuilding, committing, and letting the CI job prove it, with the reason in the PR. That is the whole procedure, written into `wasm/xatlas/README.md`.

## 3. The module: standalone WebAssembly, no generated glue

The module is built with `-sSTANDALONE_WASM --no-entry`, so the artefact is one `.wasm` file and no JavaScript. Its import list is then the complete, machine-readable list of what xatlas can reach outside itself, and a unit test pins that list (§7): no network, no filesystem, no clock, nothing but a progress callback, a memory-growth notice and a few WASI stubs. That is the auditable object the issue asks for, and it is far smaller to read than 289 KB of glue.

Rejected: `-sMODULARIZE -sEXPORT_ES6`, the shape of today's package. It would put 40–60 KB of generated, environment-sniffing JavaScript into the repo (it imports `node:module`, reads `process.argv`, fetches by `import.meta.url`), and the progress callback would need `addFunction` and a growable function table. Fallback, if standalone mode hits a wall in build step 1 (an import that cannot be stubbed, memory growth misbehaving) within half a day _(proposal)_: build the glue variant with `-sENVIRONMENT=web,worker,node`, without `SINGLE_FILE`, and load the `.wasm` through `locateFile`. The shim (§4) and the wrapper's interface (§5) stay the same; only the loader changes. Say so in the PR; no need to ask.

Flags, each a named line in `build.sh`:

- `-std=c++17 -O2 -flto`, as the package today, so that "same results" is compared with the same optimisation level. `-O3` is one of the variants in §6, not the baseline.
- `-fno-exceptions -fno-rtti`: xatlas has no `throw` and no `dynamic_cast` (checked in the pinned `xatlas.cpp`).
- `-DXATLAS_C_API=1 -DXA_MULTITHREADED=0`: the C API the shim calls; single-threaded, because threads in WebAssembly need response headers GitHub Pages cannot send (spec, story 9). `xatlas.cpp` includes `<thread>`, `<mutex>` and `<atomic>` unconditionally, which compiles without `-pthread` as long as nothing spawns a thread; with `XA_MULTITHREADED=0` nothing does, and the package proves it builds.
- `-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=<HEAP_INITIAL_MB>`: Emscripten's 16 MB default for the baseline; §6 tries a larger one. `MAXIMUM_MEMORY` stays at the default (2 GB).
- `-sEXPORTED_FUNCTIONS=_malloc,_free`; the `mt_*` functions are kept by `EMSCRIPTEN_KEEPALIVE`.
- `-msimd128` only in the SIMD variant (§6).

Expected size: 150–300 KB. Above 400 KB _(proposal)_, look for a debug or names section before committing. xatlas prints only through a function set with `xatlasSetPrint`; the shim never sets one, so nothing is printed. `XA_ASSERT` calls `assert`, which aborts: in standalone mode that is a trap, which the wrapper turns into an `Unwrap failed` error (§5). The `srand`/`rand` calls in `xatlas.cpp` sit in debug image-export paths and are not reached.

## 4. The C shim (`wasm/xatlas/shim.c`)

The shim exists so that JavaScript never knows a struct layout: every field xatlas needs is filled in C, where the compiler knows the offsets. Today's package writes `xatlasMeshDecl` from JavaScript at offsets 0, 4, 8, …, which silently misreads the moment upstream reorders a field. Functions, all `EMSCRIPTEN_KEEPALIVE`, plain integers and floats in and out:

```c
xatlasAtlas *mt_atlas_create(void);
void         mt_atlas_destroy(xatlasAtlas *a);
/* Fills an xatlasMeshDecl (positions and indices required, normals may be NULL) and calls xatlasAddMesh. */
int          mt_add_mesh(xatlasAtlas *a, const float *positions, const float *normals, const uint32_t *indices,
                         uint32_t vertexCount, uint32_t indexCount, uint32_t meshCountHint);
const char  *mt_add_mesh_error_string(int error);
/* Inits both option structs with xatlas's defaults, overrides the five fields unwrap.ts sets, registers the
 * progress forwarder, calls xatlasGenerate. */
void         mt_generate(xatlasAtlas *a, float maxCost, uint32_t resolution, uint32_t padding, int bilinear, int blockAlign);
uint32_t     mt_atlas_width(const xatlasAtlas *a);
uint32_t     mt_atlas_height(const xatlasAtlas *a);
uint32_t     mt_atlas_chart_count(const xatlasAtlas *a);
float        mt_atlas_utilization(const xatlasAtlas *a, uint32_t atlasIndex);
uint32_t     mt_mesh_vertex_count(const xatlasAtlas *a, uint32_t mesh);
uint32_t     mt_mesh_index_count(const xatlasAtlas *a, uint32_t mesh);
const xatlasVertex *mt_mesh_vertices(const xatlasAtlas *a, uint32_t mesh);
const uint32_t     *mt_mesh_indices(const xatlasAtlas *a, uint32_t mesh);
/* The wrapper reads vertices straight out of the heap with these, so a layout change cannot misread silently. */
uint32_t     mt_vertex_stride(void);      /* sizeof(xatlasVertex), 20 today */
uint32_t     mt_vertex_uv_offset(void);   /* offsetof(xatlasVertex, uv), 8 */
uint32_t     mt_vertex_xref_offset(void); /* offsetof(xatlasVertex, xref), 16 */
```

The progress callback: the shim declares `__attribute__((import_module("env"), import_name("mt_progress"))) int mt_progress(int category, int progress);` and passes a static forwarder to `xatlasSetProgressCallback`, which returns `mt_progress(...) != 0`. No function table, no `addFunction`.

Not exposed, because nothing uses it: `addUvMesh`, the per-chart arrays, the atlas image, `texelsPerUnit`, the other chart and pack options, separate `computeCharts`/`packCharts`. Adding one later is one shim function, one wrapper method and a rebuild.

## 5. The TypeScript wrapper (`src/pipeline/xatlas.ts`)

The interface, complete:

```ts
export const PROGRESS = { addMesh: 0, computeCharts: 1, packCharts: 2, buildOutput: 3 } as const;
export type ProgressCategory = (typeof PROGRESS)[keyof typeof PROGRESS];

export interface AtlasMeshInput {
  positions: Float32Array; // xyz per vertex
  normals?: Float32Array; // xyz per vertex
  indices: Uint32Array; // three per triangle
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
/** Compiles and instantiates the module once per worker; later calls return the same instance. */
export function loadXatlas(): Promise<Xatlas>;
```

Decisions inside:

- **Loading the bytes.** `const url = new URL('../../wasm/xatlas/xatlas.wasm', import.meta.url)`. Vite rewrites that into a hashed asset under `/assets/` in the page and in the worker chunk (`worker.format: 'es'`), which is what `e2e/promise.spec.ts` allows; nothing is loaded from another origin. In Node (Vitest, `npm run bench`) the URL is `file:` and the wrapper reads it with `node:fs/promises`, imported dynamically behind a `url.protocol === 'file:'` check with `/* @vite-ignore */`; Vite externalises the built-in for the browser build, the same pattern today's package uses (`await import("node:module")`), so its behaviour in the build is known. Browser: `fetch` + `WebAssembly.compile`. Then `WebAssembly.instantiate` with our imports.
- **Imports we provide.** `env.mt_progress` (forwards to the current `generate` callback; `1` when there is none), `env.emscripten_notify_memory_growth` (Emscripten calls it in standalone mode when the heap grows; the wrapper drops its cached heap views), and WASI stubs for what the module imports from `wasi_snapshot_preview1`: expected `fd_write` (returns 0 and writes 0 to `nwritten`), `fd_close`, `fd_seek` (return 0) and `proc_exit` (throws). The test in §7 pins the exact list from the first build; an import outside these two families is a stop-and-ask, never a blind stub.
- **Heap views** (`Uint8Array`, `Float32Array`, `Uint32Array` over `memory.buffer`) are re-created whenever `memory.buffer` is not the cached one, which covers growth from inside a call. `mesh()` copies out immediately, because the next growth detaches the old buffer.
- **Copy-in** with `malloc` + `set()` for positions, normals and indices, freed as soon as `mt_add_mesh` returns: xatlas copies the input into its own structures during `addMesh` (single-threaded, so it has finished when the call returns), as the package's wrapper relies on today.
- **Errors.** A non-zero `mt_add_mesh` code becomes `Error('Unwrap failed: ' + message)`, the message decoded with `TextDecoder` from the NUL-terminated string. A WebAssembly trap or `RangeError` during `generate` is rethrown as `Error('Unwrap failed: ' + original.message)`, so `problems.ts` still maps memory failures through `isOutOfMemory` (its pattern list includes `memory.grow` and `cannot enlarge memory`; check that the message of a failed growth in standalone mode still matches, and extend the pattern if not).
- **One instance per module.** `loadXatlas()` caches its promise, as `unwrapperReady` does today; a fresh worker after `Converter.cancel()` gets a fresh instance.

`unwrap.ts` then: `unwrapperReady` calls `loadXatlas()`; `warmUp` uses the new interface and stays until §6 says otherwise; the output loop reads `uvs` and `xref` as typed arrays instead of an object per vertex; the progress mapping reads `category === PROGRESS.computeCharts` instead of `< 1` and `> 1`; the comment "about 290 KB" becomes the measured size of the `.wasm`. Everything else in the file is untouched.

## 6. The experiments: SIMD, initial heap, cold start

The issue asks for a look, not a result. This section fixes how the look is taken so its numbers are comparable, and the rule that decides what ships.

**Variants.** `build.sh --variant <name>` writes `out/xatlas/<name>.wasm` without touching the committed file: `plain` (the flags of §3), `simd` (`-msimd128`), `heap` (`-sINITIAL_MEMORY=256MB`, `HEAP_LARGE_MB = 256` _(proposal)_), `simd-heap`, and `o3` (`-O3` instead of `-O2`). xatlas has no SIMD intrinsics, so `-msimd128` can only help through the compiler's auto-vectorisation; expect little.

**Harness.** `scripts/measure-xatlas.mjs <wasm> [--runs N]` in Node, so every variant runs on the same code path: for each mesh, a fresh instance, one unwrap (cold), then the same unwrap again (warm); it prints cold, warm, cold/warm and the heap's final size. Meshes: the `figure` shape from `src/regression/shapes.ts` reduced to its table level (runs on any machine, bit-identical), and, when `corpus/` is present, the table levels of the three slowest corpus minis (today: a large flyer at 8.1 s, a long terrain piece at 7.9 s, a large creature at 4.7 s; unwrap in Chrome, development PC, corpus run of 2026-09-23). The script imports the pipeline like `npm run bench` does. Report every number with the device.

**Cold start.** The #31 finding: a fresh instance ran the giant in 111 s, the second run took 40 s (Node, development PC); growing the heap from JavaScript beforehand did not help, a small throwaway unwrap did. Three hypotheses, each with the run that decides it _(proposal)_:

1. **V8 tiering.** V8 compiles WebAssembly with its baseline compiler first and optimises hot functions in the background; a long first call runs largely in baseline code. Test: run the harness with `node --no-liftoff` (everything optimised before the first call). If cold ≈ warm under that flag, tiering is the cause, no build flag can fix it in a browser, and the warm-up stays.
2. **Memory growth.** Many small `memory.grow` steps during the first run. Test: the `heap` variant. (#31 grew the heap from JavaScript without effect; a link-time initial heap also changes the allocator's starting state, so it is worth one run, not more.)
3. **Something in xatlas itself** (first-use tables, allocator state). If 1 and 2 both fail to explain it, this remains, and the warm-up stays.

Rule: the warm-up is removed only if, for the variant that ships, cold/warm on the slowest mesh is below `COLD_WARM_KEEP_WARMUP = 1.2` _(proposal)_ in Node **and** in Chrome. The Chrome check is done once, by hand: comment out the warm-up locally, convert the slowest corpus mini in a fresh tab, read the unwrap time under `?dev`, restore the code. No new address option for it.

**SIMD and heap.** A variant ships only if it is faster on the corpus unwrap total (§7) by at least `VARIANT_KEEP_IF_FASTER = 5 %` _(proposal)_ and the regression baseline's `charts` and `utilisation` are unchanged. A vectorised or `-O3` build can change floating-point results and with them the chart count; that alone rules the variant out. Otherwise the `plain` build ships: every browser of 2026 runs SIMD, but one plain build is one fewer way for devices to differ. A larger initial heap costs that much memory per worker even for a small mini; it ships only if it buys the 5 % on cold runs and costs nothing warm.

Whatever the outcome, the journal entry records all variants' numbers and the hypothesis that held. If the PM can run the chosen build's corpus check on the reference laptop, the figures go in too; that is not needed for merge.

## 7. Tests: what proves each criterion

- **Reproducible build from a pinned commit (criterion 1):** the `xatlas.yml` job green on this PR (build in the pinned image, compare with the committed binary), plus two identical local builds before the first commit. The hashes in `build.sh` prove the sources; `README.md` in `wasm/xatlas/` names the commit and the image.
- **Small typed wrapper of our own (criterion 1):** `src/pipeline/xatlas.test.ts`: (a) `WebAssembly.Module.imports(module)` equals the pinned list exactly (module and name); (b) the exports include every `mt_*` function of §4; (c) a bumpy sheet unwraps: every `uv` inside `[0, width] × [0, height]`, every `xref` below the input vertex count, every index below `vertexCount`, `chartCount ≥ 1`, `utilisation(0)` in `(0, 1]`; (d) an index out of range throws `Unwrap failed: ` with xatlas's own message; (e) the progress callback sees `PROGRESS.computeCharts` with a non-decreasing percent and, when it returns `false`, is not called again; (f) `mesh()` still reads correctly after a growth (unwrap a mesh large enough to grow the 16 MB heap; check `memory.buffer.byteLength` grew and the result satisfies (c)).
- **Same results on the unit tests (criterion 2):** `unwrap.test.ts` (7 tests) and `bake.test.ts` unchanged and green; `src/regression/baseline.test.ts` green without a baseline update for the `plain` build: `charts` is compared exactly and `utilisation` within 1 % (`compare.ts`). Same source, same optimisation level, no fast-math: the expectation is identical figures. If `charts` moves anyway, find the flag that moved it before accepting anything; a small explained move may go through `npm run baseline:update` with the explanation in the PR, as the repo's rule says; a move of more than 5 % in `charts` _(proposal)_ is a stop-and-ask, because it would show on the comparison sheets.
- **Unwrap time not worse on the corpus (criterion 2):** `npm run corpus` on the development PC, twice (the first run of an unattended Chrome session can be up to twice as slow; take the second), against the reference run of 2026-09-23 at commit `258b35a`: total unwrap over 30 minis 91.5 s, median 3.4 s, slowest 8.1 s. Passes when the total is not more than `UNWRAP_TOTAL_TOLERANCE = 5 %` higher and no mini is more than 10 % slower _(proposal)_; the corpus report already lists every figure that moved.
- **The promise:** `e2e/promise.spec.ts` already fails on any request outside `/assets/` and `/basis/`; add the assertion that a request ending in `.wasm` under `/assets/` happened after the file was picked, as line 76 does for `/basis/`: it proves the module is ours, same-origin, and loaded lazily.
- **`xatlas-wasm` removed (criterion 4):** `npm uninstall xatlas-wasm`; a search for `xatlas-wasm` outside `node_modules` and `docs` finds nothing; `npm run check` (which builds) and `npm run e2e` green.
- **CI time:** `ci.yml` is untouched; the compile happens only in `xatlas.yml`.

## 8. Files

New: `wasm/xatlas/build.sh`, `wasm/xatlas/shim.c`, `wasm/xatlas/README.md`, `wasm/xatlas/LICENSE` (xatlas's), `wasm/xatlas/xatlas.wasm`, `src/pipeline/xatlas.ts`, `src/pipeline/xatlas.test.ts`, `scripts/measure-xatlas.mjs`, `.github/workflows/xatlas.yml`, `docs/journal/<date>-own-xatlas-build.md`.

Changed: `src/pipeline/unwrap.ts` (import, calls, comment), `package.json` (`xatlas:build` script, dependency removed) and `package-lock.json`, `e2e/promise.spec.ts` (one assertion), `README.md` (third-party content: xatlas, MIT, copyright line, commit, link to `wasm/xatlas/LICENSE`), `CONTRIBUTING.md` (one paragraph: rebuilding and bumping need Docker; the CI job proves the binary), `CLAUDE.md` (layout: `wasm/`, `src/pipeline/xatlas.ts`, `scripts/measure-xatlas.mjs`; commands: `npm run xatlas:build`), `docs/specs/phase-1-converter.md` (story 8 status; the risk list's "two young dependencies" becomes one). `out/` is already git-ignored, so `out/xatlas/` needs nothing.

## 9. Build order, with the test that proves each step

1. **The build.** `build.sh`, `shim.c`, `README.md`, `LICENSE`; `npm run xatlas:build` produces `wasm/xatlas/xatlas.wasm`; run it twice, `cmp` identical; print the import list with a five-line Node script and check every entry against §5. Commit the binary. If standalone mode is blocked after half a day, switch to the fallback of §3.
2. **The wrapper.** `xatlas.ts` and `xatlas.test.ts` (§7 a–f) green in Vitest.
3. **The switch.** `unwrap.ts` on the wrapper; `npm uninstall xatlas-wasm`; `unwrap.test.ts`, `bake.test.ts`, `baseline.test.ts` green without a baseline change; the `promise.spec.ts` assertion; `npm run check` and `npm run e2e` green.
4. **The CI job.** `xatlas.yml`; green on the PR.
5. **The experiments.** `measure-xatlas.mjs`; the five variants; the three cold-start runs; the decision by the rules of §6; if a variant ships, rebuild the committed file with its flag as the default, re-run step 3's tests, and keep the CI job green.
6. **The corpus.** Before/after on the development PC (§7); the figures into the journal and the PR.
7. **Docs and journal** (§8). The journal entry is the record of the experiments: every variant's numbers with the device, the hypothesis that held, the dead ends; `topics: [unwrap, tooling, performance]`.

Steps 1–4 are the deliverable; 5–6 are the look the issue asks for and can be short if the numbers are clear. Commit per step, Conventional Commits.

## 10. When to stop and ask

- Two builds in the pinned image differ and the cause is not found within the time box of step 1: the criterion cannot be ticked. Say what differs.
- The module imports something outside `env.{mt_progress, emscripten_notify_memory_growth}` and `wasi_snapshot_preview1.{fd_write, fd_close, fd_seek, proc_exit}`: name it and what in xatlas needs it. Do not stub it to make the test pass.
- The `plain` build moves `charts` in the baseline by more than 5 %, or moves it at all without a found cause.
- The `plain` build is slower than today's package on the corpus beyond the tolerance, and `o3` does not close the gap.
- The binary is larger than 400 KB after checking for debug sections.
- Anything that would change what a user sees on the comparison sheets: that is the PM's judgement, attach the sheets.

## 11. Out of this note

- Threads in the module (spec, story 9: not possible on GitHub Pages).
- Any change to unwrap settings (`MAX_CHART_COST`, `SLAB_COUNT`, `WHOLE_UNWRAP_BELOW`) or to what is unwrapped.
- The KTX2 encoder (#38); it reuses this folder convention when its turn comes.
- Publishing the module as a package of its own.
- A newer xatlas: there is none; upstream's last commit is the one pinned here.

## 12. PM decisions

- 2026-09-20 (issue #33): build xatlas from source before the first public release; the pinned package is fine until then.
- Open for the PM on the draft PR, before `/continue-pr`: the thresholds marked _(proposal)_ (5 % to keep a variant, 1.2 to drop the warm-up, 5 % on the corpus total), and committing the binary with a CI proof rather than building it in every CI run (chosen here so `npm ci && npm run dev` needs no Docker).
