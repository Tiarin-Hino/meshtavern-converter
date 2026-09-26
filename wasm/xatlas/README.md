# xatlas as our own WebAssembly module

The unwrap (`src/pipeline/unwrap.ts`) gives the table level texture coordinates with [xatlas](https://github.com/jpcy/xatlas) (MIT, Copyright 2018-2020 Jonathan Young, see `LICENSE` here). This folder builds it to WebAssembly from a pinned upstream commit, in a pinned Emscripten image, so what runs in the browser is something we compiled and can rebuild byte for byte. Why and how: `docs/design/own-xatlas-build.md`.

- `build.sh` — fetches four files of xatlas commit `f700c779` and refuses to build when a SHA-256 differs, then compiles them with `shim.c` in `emscripten/emsdk:6.0.10` (pinned by digest). All pins are constants at the top.
- `shim.c` — the C side of our interface: fills xatlas's structs in C, so JavaScript never reads or writes one by offset.
- `xatlas.wasm` — the built module, committed so that `npm ci && npm run dev` needs no Docker. Standalone WebAssembly: no generated JavaScript. Its imports are the complete list of what xatlas can reach outside itself (a progress callback, a memory-growth notice and three WASI stubs that are never called with data); `src/pipeline/xatlas.test.ts` pins that list.
- `src/pipeline/xatlas.ts` — the typed wrapper that loads it.

## Rebuilding

Needs Docker, nothing else (no local Emscripten, no CMake).

```sh
npm run xatlas:build              # rebuild wasm/xatlas/xatlas.wasm
npm run xatlas:build -- --check   # rebuild into out/xatlas/ and fail if one byte differs from the committed file
```

The CI job `.github/workflows/xatlas.yml` runs the check on every PR that touches this folder. On Windows, run the command from Git Bash or WSL.

`--variant <name>` builds an experiment into `out/xatlas/<name>.wasm` without touching the committed file: `simd` (`-msimd128`), `heap` (256 MB initial heap), `simd-heap`, `o3`. `scripts/measure-xatlas.mjs` times them.

## Bumping xatlas or Emscripten

1. Change the constants at the top of `build.sh`: `XATLAS_COMMIT` and the four `XATLAS_SHA256_*` (hash the files of the new commit), or `EMSDK_IMAGE` (tag and manifest digest: `docker buildx imagetools inspect emscripten/emsdk:<tag>`).
2. `npm run xatlas:build`, then `npm run check`. If the regression baseline moves, explain why in the PR as for any pipeline change.
3. Commit the new `xatlas.wasm` with the constants; the CI job proves the two belong together. If xatlas changed, copy its `LICENSE` here again.
