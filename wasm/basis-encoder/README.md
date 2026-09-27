# The Basis Universal encoder as our own WebAssembly module

The compress step (`src/lib/pipeline/compress.ts`) encodes each mini's detail texture to a KTX2 file with UASTC and Zstandard, using the encoder of [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Apache-2.0, Copyright 2016–2026 Binomial LLC; "Basis Universal" is a trademark of Binomial LLC; see `LICENSE` and `NOTICE` here). This folder builds that encoder to WebAssembly from a pinned upstream commit, in a pinned Emscripten image, so what runs in the browser is something we compiled and can rebuild byte for byte. Why and how: `docs/design/own-basis-encoder-build.md`.

- `build.sh` — fetches upstream commit `1b33fd50` with git (the commit id is the hash of every file in it; the build refuses any other checkout), then compiles 29 of upstream's files, Zstandard and our two files in `emscripten/emsdk:6.0.10` (pinned by digest, the same image as `wasm/xatlas/`). The flags are upstream's Release flags from `webgl/encoder/CMakeLists.txt`, one concern per line; all pins are constants at the top.
- `shim.cpp` — the C side of our interface (`mt_init`, `mt_encode`, `mt_output`, `mt_release`): fills the encoder's parameters in C, the way upstream's own JavaScript wrapper fills them, so no struct crosses the boundary and no generated JavaScript is needed.
- `no-jpeg.cpp` — stands in for upstream's JPEG loader (`encoder/jpgd.cpp`), which is left out: the shim never loads an image file, and the loader is the only code that uses `setjmp`, which in WebAssembly needs Emscripten's generated JavaScript.
- `basis_encoder.wasm` — the built module, committed so that `npm ci && npm run dev` needs no Docker. Standalone WebAssembly: its imports are the complete list of what the encoder can reach outside itself (a memory-growth notice, a clock for its own statistics, the environment, which is empty, and standard input and output; there is no way to open a file). `src/lib/pipeline/basis-encoder.test.ts` pins that list.
- `LICENSE` (Apache-2.0) and `NOTICE` — upstream's, verbatim; Apache-2.0 §4(d) requires the notice in every redistribution. `LICENSE-zstd` — BSD-3-Clause, for Zstandard (Meta Platforms) and tinyexr. `LICENSE-mit` — MIT, for the QOI and DDS readers upstream bundles.
- `src/lib/pipeline/basis-encoder.ts` — the typed wrapper that loads it.

## Rebuilding

Needs Docker, nothing else (no local Emscripten, no CMake).

```sh
npm run basis:build              # rebuild wasm/basis-encoder/basis_encoder.wasm
npm run basis:build -- --check   # rebuild into out/basis-encoder/ and fail if one byte differs from the committed file
```

The CI job `.github/workflows/basis-encoder.yml` runs the check on every PR that touches this folder. On Windows, run the command from Git Bash or WSL. The sources land in the git-ignored `out/basis-encoder/src/` and are reused by later builds.

`--variant <name>` builds an experiment into `out/basis-encoder/<name>.wasm` without touching the committed file: `no-lto` (without link-time optimisation), `simd` (`-msimd128`), `slim` (no exceptions, no RTTI). `scripts/measure-encoder.mjs` times them.

## Bumping Basis Universal or Emscripten

1. Change the constants at the top of `build.sh`: `BASIS_COMMIT` (a release tag's commit), or `EMSDK_IMAGE` (tag and manifest digest: `docker buildx imagetools inspect emscripten/emsdk:<tag>`). Compare upstream's `webgl/encoder/CMakeLists.txt` at the new commit with the flags and the source list in `build.sh`, and `webgl/transcoder/basis_wrappers.cpp` with `shim.cpp`.
2. `npm run basis:build`, then `npm run check`. The fixture test in `src/lib/pipeline/compress.test.ts` pins the files the encoder writes: if it moves, the KTX2 files change, and the PR explains why with the corpus sizes and comparison sheets.
3. Commit the new `basis_encoder.wasm` with the constants; the CI job proves the two belong together. If upstream's `LICENSE`, `NOTICE` or `LICENSES/` changed, copy them here again.
