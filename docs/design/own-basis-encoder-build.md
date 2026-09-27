# Design: our own build of the Basis Universal encoder (#38)

Status: design pass by Fable 5.1, 2026-09-27, for Opus 5.5 to build · Spec: Phase 1, story 2 (with #42) · Issue: #38

What is left of #38 is the review of `ktx2-encoder` as a dependency, to the standard set by #33: a WebAssembly module in the critical path is either something this project compiles from pinned sources in a pinned toolchain and proves byte for byte in CI, or it goes. Section 1 is the review and its verdict; the rest fixes the decisions the build should not have to make, in the shape of [own-xatlas-build.md](own-xatlas-build.md), whose folder convention this note reuses. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§10). Thresholds are named constants marked _(proposal)_; the PM can change them on the PR.

Read first: the issue, then `src/lib/pipeline/compress.ts` (the only user of the encoder, 60 lines), then `wasm/xatlas/build.sh`, `wasm/xatlas/shim.c` and `src/lib/pipeline/xatlas.ts` (the shape to copy), then the journal entries [Our own build of xatlas](../journal/2026-09-27-own-xatlas-build.md) (what bit last time, including the Docker workaround on the development PC) and [One packed, compressed detail texture within a budget](../journal/2026-09-20-texture-memory.md) (why KTX2 at all).

## 1. The review: `ktx2-encoder` 0.6.0

Everything below was checked on 2026-09-27 against the installed package, the npm registry, and the two GitHub repositories.

**What it is.** An MIT package by one person (23 versions since 2023-02-22, 0.6.0 published 2026-07-19; the repository has 37 stars and four contributors with 77, 3, 1 and 1 commits). It has one dependency, `ktx-parse` (Don McCurdy, MIT), used only for a key-value option we do not pass. Its own JavaScript is fourteen small readable files, about 20 KB in all; `compress.ts` reaches two of them. That part passes any review.

**What it ships that cannot be read.** `dist/basis/basis_encoder.wasm`, 3,288,143 bytes (1.23 MB gzipped, what a user downloads on the first conversion), and `dist/basis/basis_encoder.js`, 103,927 bytes of minified Emscripten glue with embind, environment sniffing (`new Function`, `require`, `XMLHttpRequest`, `process`) and the module's loader. The module imports 52 functions, all from a module named `a` with one-letter names, and exports 8 with names like `aa`: without the glue its import list says nothing, so the auditable object #33 relied on, the list of everything the code can reach outside itself, does not exist here.

**Where it came from.** The package's `THIRD_PARTY_NOTICES.md` records the provenance: upstream `BinomialLLC/basis_universal` commit `1b33fd5098c6e7b58324146b8f5518cbb4cdfb72` (2026-07-06), Emscripten 4.0.15, wasm32 single-threaded Release with Zstandard on and astcenc off, plus `-s EXPORT_ES6=1`, and the SHA-256 `9807719e…`, which matches the installed file. It then says the build "is a redistribution of the upstream binary". It is not: upstream commits its own build of that commit in `webgl/encoder/build/`, and that file is 3,287,448 bytes with SHA-256 `5c5a9e79…`; the glue differs too (103,878 bytes upstream, `d225ce1e…`). The package's `scripts/build-basis-wasm.sh` explains the difference honestly (it adds `EXPORT_ES6` and needs "Emscripten SDK 4.0.15 active in the shell") and states in its header that it "does NOT run in CI". So the encoder that handles every user's texture is one maintainer's local build, from a documented recipe nobody re-runs, and no published artefact matches it byte for byte.

**Upstream is healthy.** Basis Universal is Apache-2.0 with a NOTICE file (Binomial LLC), 3,114 stars, one main author (1,232 commits) and a handful of regular contributors, last pushed 2026-09-01, releases v2.10 (2026-05-09) and v2.50 (2026-08-03). No submodules. The web encoder is 30 C++ files plus `zstd/zstd.c` (Zstandard, BSD-3-Clause, one 1.99 MB amalgamation) and one CMake file whose flags are all visible (§3).

**Verdict.** The package fails the standard for the same reason `xatlas-wasm` did: a young single-maintainer package whose working part is a binary we cannot audit or reproduce. Its readable part is thin enough to replace with a wrapper of our own in an afternoon, and its binary is built from sources and flags that are all public. Recommendation: build the encoder ourselves, same as #33, and remove the package. Keeping it with more pins (a hash test on the module, the lockfile's integrity, a documented bump) was considered and rejected: a hash proves the bytes did not change, not what they are.

Two things the review noticed and leaves alone, recorded here so they are not lost:

- The package never sets the encoder's `m_mip_srgb`, which defaults to true since upstream's change of 2026-04-26. Our detail texture is linear data (normals and cavity), so its mipmaps are today filtered in sRGB space. The switch keeps that (§5: same results first); the fix is one flag and its own decision (§11).
- three.js's Basis _transcoder_ (`basis_transcoder.wasm`, 527 KB, served under `/basis/`) is also a prebuilt binary, but from a large old project with many maintainers, and it only reads. It falls outside this issue and is filed separately, because in Phase 2 it will read files other players made.

## 2. What we have today, and what changes

`compressDetail(detail, resolution, effort)` in `compress.ts` hands the encoder a raw RGBA texture and gets back one KTX2 file: UASTC LDR 4x4 at pack level `effort` (`DETAIL_EFFORT = 0`), Zstandard supercompression, mipmaps, `isPerceptual: false`, sRGB transfer function off, and the package's defaults for everything else. The pipeline drops the raw texture and keeps only the file; a failing encode leaves the mini with the per-vertex look and `stats.bakeSkipped = { reason: 'failed', step: 'compress' }`. None of that changes.

After this issue:

- `wasm/basis-encoder/` holds the build: `build.sh` (fetches the pinned commit, checks it, runs `emcc` inside the pinned Docker image), `shim.cpp` (the C-callable side of our interface), `README.md` (how to rebuild and how to bump), upstream's `LICENSE`, `NOTICE` and the Zstandard licence, and the built `basis_encoder.wasm`, committed.
- `src/lib/pipeline/basis-encoder.ts` is the typed wrapper. `compress.ts` keeps its exported names and calls it; its two tests keep passing, with one addition (§7).
- A CI job rebuilds the module in the same image and fails when a single byte differs from the committed file.
- `ktx2-encoder` and, with it, `ktx-parse` leave `package.json` and the lockfile.

## 3. Pinning and reproducibility

**Sources.** Upstream commit `1b33fd5098c6e7b58324146b8f5518cbb4cdfb72` of `BinomialLLC/basis_universal`, the commit the package was built from, so the only thing that changes in this issue is who compiles the code and how. Not the newer v2.50 release: changing code and compiler at once would muddle the "same results" comparison of §7; bumping to a release tag afterwards is the procedure in the folder's README, and the PM may ask for it on this PR or later.

Thirty-one source files and their headers are too many to hash one by one as `build.sh` does for xatlas. The build fetches the commit with git instead, and the commit id is the hash: `git init`, `git fetch --depth 1 origin $BASIS_COMMIT`, `git checkout FETCH_HEAD`, then `git rev-parse HEAD` must equal `BASIS_COMMIT` or the build refuses. (GitHub serves a fetch by commit id.) A sparse checkout of `encoder/`, `transcoder/`, `zstd/`, `LICENSE`, `NOTICE` and `LICENSES/` keeps it small _(proposal; a full checkout is acceptable if sparse mode fights back)_. The checkout lands in the git-ignored `out/basis-encoder/src/`, never in the repo. No submodule (upstream has none).

**Toolchain.** The same image as xatlas, `emscripten/emsdk:6.0.10` pinned by its manifest digest, one constant `EMSDK_IMAGE` copied from `wasm/xatlas/build.sh`; one toolchain for both modules. No CMake: upstream's `webgl/encoder/CMakeLists.txt` is a list of files, defines and flags, and one `emcc` line per file plus one link line say the same. `cmake` is in the image if the builder prefers it, but then the flags are spread over two files, and the point of §3 is that one file shows them all.

```sh
npm run basis:build             # docker run … bash wasm/basis-encoder/build.sh --inside
npm run basis:build -- --check  # builds to out/basis-encoder/ and compares with the committed file; exit 1 on a difference
npm run basis:build -- --variant <name>
```

**Proof.** `.github/workflows/basis-encoder.yml`, a copy of `xatlas.yml` with its paths: on pull requests and pushes to `main` that touch `wasm/basis-encoder/**` or the workflow, and by hand; not a required check; `timeout-minutes: 30`, because thirty-one files with LTO take longer than xatlas's one (the xatlas job takes 53 s). Two workflows rather than one matrix, so a change to one module never recompiles the other _(proposal)_. Before the first commit of the binary, the builder runs the build twice and compares with `cmp`, as for xatlas. A build that cannot be made byte-identical fails the criterion: stop and ask (§10).

**Docker on the development PC** does not start (journal of #33); the rootless WSL workaround there worked and produced the same bytes as CI. The builder can use it or let CI build first and copy the artefact: the CI job may upload `out/basis-encoder/plain.wasm` as a workflow artefact when the check fails _(proposal, so that the first commit of the binary does not need a working local Docker)_.

**Bumping** Basis Universal or Emscripten later means changing the constants, rebuilding, committing, letting the CI job prove it, and explaining any change in the KTX2 files in the PR. Written into `wasm/basis-encoder/README.md`.

## 4. The module: standalone WebAssembly, no embind, no glue

Built with `-sSTANDALONE_WASM --no-entry`: one `.wasm`, no JavaScript. The import list becomes the complete, readable list of what the encoder can reach outside itself, and a unit test pins it (§7). Upstream's build uses embind (`--bind`) to expose a `BasisEncoder` class to JavaScript; embind needs the generated glue, so the shim (§5) exposes plain C functions instead and the module needs none of it.

Flags, each a named line in `build.sh`, taken from upstream's `webgl/encoder/CMakeLists.txt` at the pinned commit so that "same results" compares like with like:

- **Sources:** the 30 files of upstream's `SRC_LIST` minus `webgl/transcoder/basis_wrappers.cpp` (the embind wrapper, replaced by our shim), plus `zstd/zstd.c`. Include path `transcoder/`.
- `-std=c++17 -O3 -fno-strict-aliasing` and `-DNDEBUG`: upstream's Release configuration. `-O3` is the baseline here, unlike xatlas, because that is what the package was built with.
- `-flto`: not upstream, added so that the loaders, the ETC1S and HDR encoders and the transcoder's tables that our shim never reaches are dropped at link time. A `no-lto` variant (§6) proves it changes nothing but size.
- Defines, exactly upstream's `COMMON_DEFS`: `BASISU_SUPPORT_ENCODING=1 BASISU_SUPPORT_SSE=0 BASISD_SUPPORT_KTX2_ZSTD=1 BASISD_SUPPORT_UASTC=1 BASISD_SUPPORT_BC7=1 BASISD_SUPPORT_XUASTC=1 BASISU_SUPPORT_ASTCENC=0 BASISD_SUPPORT_ATC=0 BASISD_SUPPORT_ASTC_HIGHER_OPAQUE_QUALITY=0 BASISD_SUPPORT_PVRTC2=0 BASISD_SUPPORT_FXT1=0 BASISD_SUPPORT_ETC2_EAC_RG11=0`. Single-threaded: no `-pthread`; the encoder's `job_pool` spawns no thread when it is created with one, and upstream's own non-threaded target proves the sources compile that way. Threads in a module need headers GitHub Pages cannot send (spec, story 9).
- `-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sSTACK_SIZE=2MB`: upstream's values, so the worker's memory behaviour, which `memory.ts` was fitted to, does not move (`HEAP_INITIAL_MB = 128`, `STACK_MB = 2`). `MAXIMUM_MEMORY` stays at the default.
- `-sEXPORTED_FUNCTIONS=_malloc,_free`; the `mt_*` functions are kept by `EMSCRIPTEN_KEEPALIVE`.
- Not set: `-fno-exceptions` and `-fno-rtti` (upstream does not set them and the code has not been checked for `throw` or `dynamic_cast`; they are size variants in §6, not the baseline), `-msimd128` (a variant).

Expected size: 1.5–2.5 MB _(a guess: today's 3.29 MB carries the embind glue's tables, every image loader, the HDR encoders and the whole transcoder)_. It must not be larger than today's 3,288,143 bytes (`SIZE_LIMIT_BYTES`); above that, look for a names section, then try the `slim` variant of §6, then stop and ask. The download is what a user waits for on the first conversion: record the gzipped size next to the raw one (today 1,229,869 bytes gzipped).

Printing: the encoder prints status lines through `printf` when `m_status_output` is true (its default) and errors through `error_printf`; the shim sets status output and debug off, and the wrapper's `fd_write` stub reports every byte as written (the musl lesson of #33) and keeps the text for the error message (§5). Asserts are off with `NDEBUG`. A trap (a failed allocation, an out-of-range access) becomes an `Error` in the wrapper, and the next encode gets a fresh instance.

Fallback, if standalone mode hits a wall within half a day _(proposal)_ (an import that cannot be stubbed, a libc++ piece that needs the runtime): build with `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node`, still without embind, and call the same `mt_*` exports through the module object. Shim and wrapper interface stay; only the loader changes. Say so in the PR; no need to ask.

## 5. The shim and the wrapper

**`wasm/basis-encoder/shim.cpp`**, C++ because the encoder's API is C++, with `extern "C"` and `EMSCRIPTEN_KEEPALIVE` on every export; integers and pointers in and out, no struct crosses the boundary:

```c
/* Calls basisu_encoder_init() and basisu_transcoder_init() once; returns 1 when done. */
int      mt_init(void);
/* Encodes one RGBA image (width * height * 4 bytes, rows top down) to a KTX2 file.
 * effort: UASTC pack level 0..4 (cPackUASTCLevelFastest..VerySlow), the only quality knob the pipeline turns.
 * Flags: zstd supercompression, mipmaps, perceptual, sRGB transfer function in the header, sRGB mip filtering.
 * Returns the file's size in bytes, or a negative code: -1 init failed, -2 no image, -(100 + basis_compressor::error_code) from process(). */
int32_t  mt_encode(const uint8_t *rgba, uint32_t width, uint32_t height, uint32_t effort,
                   int zstd, int mipmaps, int perceptual, int srgb_transfer, int srgb_mips);
/* The last encode's file, valid until the next mt_encode or mt_release. */
const uint8_t *mt_output(void);
void     mt_release(void);
```

Inside `mt_encode`: a `basis_compressor_params` filled the way upstream's `basis_wrappers.cpp` fills it for the options the package sets today, so the switch changes no setting: `set_format_mode(cUASTC_LDR_4x4)`, `m_pack_uastc_ldr_4x4_flags = effort`, `m_ktx2_uastc_supercompression = zstd ? KTX2_SS_ZSTANDARD : KTX2_SS_NONE` (level stays at the default 6), `m_create_ktx2_file = true`, `m_mip_gen`, `m_perceptual`, `m_ktx2_and_basis_srgb_transfer_function`, `m_mip_srgb` from the flags, `m_read_source_images = false`, `m_write_output_basis_or_ktx2_files = false`, `m_status_output = false`, `m_debug = false`, `m_multithreading = false`, a `job_pool jpool(1)` in `m_pJob_pool`, and the image copied into `m_source_images[0]` (`image::init(rgba, width, height, 4)`, as upstream's `set_slice_source_image` does for RAW input). Then `basis_compressor comp; comp.init(params); comp.process();` and the output moved out of `comp.get_output_ktx2_file()` into a static `uint8_vec` that `mt_output` points at. Everything the package set for us is on that list; everything it left at the encoder's default stays at the default, including `m_check_for_alpha` (true) and `m_mip_filter` (`kaiser`). Upstream's wrapper caps the source at 16 million texels for 32-bit WebAssembly; our textures stop at 2048² = 4 million by the size policy, so the shim has no cap.

The allocator trap of #33 is not needed here: Basis Universal checks its allocations and reports `cECFailedInitializing` or aborts; the wrapper treats a trap as a failure either way.

**`src/lib/pipeline/basis-encoder.ts`**, complete:

```ts
export interface EncodeOptions {
  /** UASTC pack level, 0 (fastest) to 4. */
  effort: number;
  supercompress: boolean;
  mipmaps: boolean;
  perceptual: boolean;
  srgbTransfer: boolean;
  srgbMips: boolean;
}
export interface BasisEncoder {
  /** Encodes an RGBA image to a KTX2 file; throws `Error('Encode failed: …')` with the encoder's own message. */
  encodeKtx2(rgba: Uint8Array, width: number, height: number, options: EncodeOptions): Uint8Array;
}
/** Compiles and instantiates the module once per worker; later calls return the same instance. */
export function loadBasisEncoder(): Promise<BasisEncoder>;
```

Decisions inside, all as in `xatlas.ts`: the bytes are loaded through `new URL('../../../wasm/basis-encoder/basis_encoder.wasm', import.meta.url)` (Vite hashes it under `/assets/`, which `e2e/promise.spec.ts` allows; Node reads the `file:` URL with `node:fs/promises` behind the same `/* @vite-ignore */` check); imports provided are `env.emscripten_notify_memory_growth` (drops the cached heap views) and WASI stubs for what the module imports; heap views are re-created when `memory.buffer` changed; the image is copied in with `malloc` + `set()` and freed after the call; the file is copied out of the heap at once and `mt_release` called, so the worker holds one copy of the file, as today. A negative code becomes `Error('Encode failed: ' + reason)` with the code's name and whatever the encoder printed through `fd_write` since the call began; a trap or `RangeError` is rethrown the same way and the cached instance dropped, so the next encode gets a fresh one. `problems.ts` maps memory failures through `isOutOfMemory`; the builder checks that the message of a failed growth still matches, as for xatlas.

**Expected imports** _(the first build decides; the test pins the exact list)_: `env.emscripten_notify_memory_growth`; from `wasi_snapshot_preview1`: `fd_write` (status and error text), `fd_close`, `fd_seek`, `proc_exit`, and `clock_time_get` (the encoder's `interval_timer` reads a clock for its own statistics; a clock leaks nothing), possibly `environ_get` and `environ_sizes_get` from libc start-up. Nothing else: no `random_get` (Basis Universal has its own random generator), no `path_*`, no `fd_read`. An import outside those families is a stop-and-ask, never a blind stub (§10).

**`compress.ts`** then: `compressDetail` calls `loadBasisEncoder()` and `encodeKtx2(detail, resolution, resolution, DETAIL_OPTIONS(effort))` with `supercompress: true, mipmaps: true, perceptual: false, srgbTransfer: false, srgbMips: true` (today's behaviour, see §1; `SRGB_MIPS = true` as a named constant with the comment that says it is wrong for linear data and points at §11); the doc comment's "about 3.3 MB" becomes the measured size; `DETAIL_EFFORT`, `DETAIL_EFFORTS`, `KTX2_ZSTANDARD` and `readKtx2Header` stay as they are.

## 6. The experiments: size and speed, one look

The issue asks for a review, not a faster encoder. One measured look, with the rule that decides, so the numbers exist when someone asks:

**Variants,** `build.sh --variant <name>` into `out/basis-encoder/<name>.wasm`: `plain` (§4), `no-lto` (proves LTO only changes size), `simd` (`-msimd128`; the encoder has no WebAssembly SIMD code, so only auto-vectorisation can gain), `slim` (`-fno-exceptions -fno-rtti` and the transcoder formats the encoder never uses set to 0: `BASISD_SUPPORT_BC7=0 BASISD_SUPPORT_XUASTC=0`; a size experiment, taken only if the outputs are byte-identical to `plain`'s).

**Harness,** `scripts/measure-encoder.mjs <wasm | package> [--runs N]` in Node: encodes a generated 1024² and a 2048² texture (a smooth gradient and a noisy one, from a seeded integer generator so every machine gets the same bytes), fresh instance for the cold number, then warm, and prints ms per encode and the output size. The `package` target runs today's `ktx2-encoder` for the before column, so it must run before the package is removed (build order, §9).

**Rule.** A variant ships only if it is faster by at least `VARIANT_KEEP_IF_FASTER = 5 %` _(proposal)_ on both sizes warm, with byte-identical output to `plain`; otherwise `plain` ships, and `slim` ships if it is at least 10 % smaller _(proposal)_ with byte-identical output. The corpus comparison (§7) is done with whatever ships.

## 7. Tests: what proves each criterion

The issue's open criterion is "`ktx2-encoder` reviewed as a dependency, same standard as #33". The review is §1; the standard means the following, each with its proof:

- **Reproducible build from a pinned commit:** `basis-encoder.yml` green on this PR, plus two identical local (or CI) builds before the first commit of the binary. `build.sh` refuses a checkout whose `HEAD` is not the pinned commit; `README.md` in the folder names the commit and the image.
- **A small typed wrapper of our own:** `src/lib/pipeline/basis-encoder.test.ts`: (a) `WebAssembly.Module.imports(module)` equals the pinned list exactly; (b) the exports include `mt_init`, `mt_encode`, `mt_output`, `mt_release`, `memory`, `malloc`, `free`; (c) a 64² gradient encodes to a file whose header `readKtx2Header` reads as 64 × 64, 7 levels, Zstandard, and whose size is below one byte per texel; (d) `effort` 0 and 3 give files that differ, and `supercompress: false` gives supercompression 0 in the header; (e) a zero-sized image throws `Encode failed:` with the encoder's reason; (f) the input is untouched (already in `compress.test.ts`); (g) encoding a 2048² texture after a 64² one still reads correctly (the heap grew in between; check `memory.buffer.byteLength`).
- **Same results:** before the package is removed, `compress.test.ts` gets a fixture: the SHA-256 of the KTX2 file the package writes for the 64² gradient and for a seeded noisy 256² texture at effort 0 (`KTX2_FIXTURE_SHA256`, recorded in the test with the package version and the date). Same source commit, same defines, same optimisation level, no fast-math, no SIMD, single thread: the expectation is that our module writes the identical bytes, and the test says so. If it does not, find the flag that moved it before accepting anything (LTO and Emscripten 6 against 4.0.15 are the two suspects; `no-lto` is the first thing to try). A difference that stays is not a failure by itself (the encoder may legitimately differ by compiler), but then the proof moves to the corpus: KTX2 sizes per mini within `SIZE_TOLERANCE = 2 %` _(proposal)_ of the run of 2026-09-25 (development PC: 2048 px 3,570–4,874 KB, 1024 px 1,132–1,243 KB, 512 px 315–317 KB), every mini baked and none fallen back, and the comparison sheets attached for the PM (§10). `unwrap.test.ts`, `bake.test.ts`, the regression baseline (which holds no KTX2 figure) and the e2e tests unchanged and green.
- **Not slower:** `scripts/measure-encoder.mjs` package against `plain`, and `npm run corpus` on the development PC, twice, against the run of 2026-09-25 at commit `f96678f` (Chrome 153, all 30 minis baked): compress step 5.3–6.6 s for the 2048 px minis, 1.46–1.55 s at 1024 px, 0.37–0.38 s at 512 px, 110.4 s in total over 30 minis. Passes when the total is not more than `COMPRESS_TOTAL_TOLERANCE = 5 %` higher and no mini more than 10 % slower _(proposal)_; check first that the untouched steps agree with the reference run, as the #33 journal had to.
- **The promise:** `e2e/promise.spec.ts` already refuses anything outside `/assets/` and `/basis/`; extend the xatlas assertion so that two distinct `.wasm` files under `/assets/` are requested after the file is picked (the unwrapper and the encoder), both same-origin.
- **The package is gone:** `npm uninstall ktx2-encoder`; `ktx-parse` disappears from the lockfile with it; a search for `ktx2-encoder` outside `node_modules` and `docs` finds nothing; `npm run check` and `npm run e2e` green; `src/lib/index.test.ts` unchanged (no new public export).
- **As a library (#83):** the throwaway Vite project of the #33 journal converts a baked sheet with the module resolved from `node_modules`, production build and dev server. One run, recorded in the journal.

## 8. Files

New: `wasm/basis-encoder/build.sh`, `shim.cpp`, `README.md`, `LICENSE` (upstream's Apache-2.0), `NOTICE` (upstream's, verbatim: Apache-2.0 §4(d) requires it in redistributions), `LICENSE-zstd` (upstream's `LICENSES/BSD-3-clause.txt`), `basis_encoder.wasm`; `src/lib/pipeline/basis-encoder.ts`, `basis-encoder.test.ts`; `scripts/measure-encoder.mjs`; `.github/workflows/basis-encoder.yml`; `docs/journal/<date>-own-basis-encoder-build.md`.

Changed: `src/lib/pipeline/compress.ts` (§5) and `compress.test.ts` (the fixture); `package.json` (`basis:build` script; `ktx2-encoder` removed) and `package-lock.json`; `e2e/promise.spec.ts` (one assertion); `README.md` ("Third-party content": Basis Universal, Apache-2.0, Copyright 2016–2026 Binomial LLC, "Basis Universal" is a trademark of Binomial LLC, compiled by this project from upstream commit `1b33fd50`, links to the folder's `LICENSE` and `NOTICE`; Zstandard, BSD-3-Clause, Meta Platforms, link to `LICENSE-zstd`; the three.js transcoder line stays as it is); `CONTRIBUTING.md` (the "WebAssembly we build ourselves" paragraph covers both modules); `CLAUDE.md` (layout: `wasm/basis-encoder/`, `basis-encoder.ts`, `measure-encoder.mjs`; commands: `npm run basis:build`); `docs/specs/phase-1-converter.md` (story 2 status: the review is done and what came of it; the risk list's "one young dependency" paragraph becomes "none: both modules are our own builds (#33, #38)"; the exit criteria's "#33, #35 and #38 are closed" gets its tick when the PR merges).

## 9. Build order, with the test that proves each step

1. **The before column.** `scripts/measure-encoder.mjs package` and the fixture hashes in `compress.test.ts`, both with the package still installed. Commit them: they are the reference everything else is compared with.
2. **The build.** `build.sh`, `shim.cpp`, `README.md`, the three licence files; `npm run basis:build` (or the CI artefact of §3) produces `basis_encoder.wasm`; two builds `cmp` identical; the import list printed and checked against §5; size under `SIZE_LIMIT_BYTES`. Commit the binary. Half a day on standalone mode, then the fallback of §4.
3. **The wrapper.** `basis-encoder.ts` and `basis-encoder.test.ts` (§7 a–g) green.
4. **The switch.** `compress.ts` on the wrapper; the fixture test green (or the investigation of §7 recorded); `npm uninstall ktx2-encoder`; the `promise.spec.ts` assertion; `npm run check` and `npm run e2e` green.
5. **The CI job.** `basis-encoder.yml` green on the PR.
6. **The look.** The variants of §6 through the harness; the rule decides; if a variant ships, rebuild the committed file, re-run step 4's tests, keep the CI job green.
7. **The corpus.** Before/after on the development PC (§7), sizes and times into the journal and the PR; the comparison sheets of two minis (one 1024 px, one 2048 px) attached for the PM.
8. **Docs and journal** (§8). `topics: [textures, compression, tooling]`. The journal is written for someone who never saw the code: what KTX2 and UASTC are in one sentence each, why a package that worked was replaced, the provenance finding of §1 in plain words (without blaming the maintainer, who documented the recipe honestly), every number with its device, the dead ends.

Steps 1–5 are the deliverable; 6–7 are the look and can be short if the numbers are clear. Commit per step, Conventional Commits.

## 10. When to stop and ask

- Two builds in the pinned image differ and the cause is not found within the time box of step 2.
- The module imports something outside `env.emscripten_notify_memory_growth` and `wasi_snapshot_preview1.{fd_write, fd_close, fd_seek, proc_exit, clock_time_get, environ_get, environ_sizes_get}`: name it and what in the encoder needs it.
- The fixture hashes differ and no flag explains it, **and** a KTX2 size on the corpus moves by more than 2 %, or a comparison sheet looks different at the closest view: that is the PM's judgement, attach the sheets.
- The module is larger than today's 3,288,143 bytes after the `slim` variant.
- The compress step is slower than the tolerance and no variant closes the gap.
- Anything that would change what a user sees.

## 11. Out of this note

- **sRGB mip filtering on linear data** (§1): flipping `SRGB_MIPS` to false is a one-line change with a visible-in-principle effect on the mipmaps of every mini; it gets its own small issue with comparison sheets, after this PR, so the switch here stays a pure change of who compiles the encoder.
- **The three.js transcoder** as a prebuilt binary: its own issue, for the PM to weigh before Phase 2.
- **Third-party notices on the published page:** when the page is published (#47), the Apache-2.0 NOTICE and the other licences must be reachable from it (an "About" line or a `licenses.txt` next to the page). Noted for #47; nothing to do while nothing is published.
- Threads in the encoder (GitHub Pages cannot send the headers), a bump to v2.50, RDO or higher effort levels, ETC1S, HDR, any change to `bake-policy.ts`.

## 12. PM decisions

- 2026-09-20 (issue #38, with #33): young dependencies are fine during development and are reviewed or replaced before the first public release.
- Open for the PM on the draft PR, before `/continue-pr`: pinning the package's commit rather than the v2.50 release (§3); the thresholds marked _(proposal)_ (5 % to keep a variant, 2 % on KTX2 sizes, 5 % on the compress total); two CI workflows rather than one; and whether the sRGB-mips fix (§11) may ride along in this PR after all, as a separate commit with its sheets, instead of its own issue.
