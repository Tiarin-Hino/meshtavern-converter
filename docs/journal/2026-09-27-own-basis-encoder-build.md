---
title: Our own build of the Basis Universal encoder
date: 2026-09-27
phase: 1
issues: [38]
prs: [88]
topics: [textures, compression, tooling]
---

## What we did

Every baked mini's detail texture is compressed to a KTX2 file before it is stored or sent to other players. That compression now runs on a WebAssembly module this project compiles itself from Basis Universal, instead of a binary inside an npm package. Nothing changes for users: the files are the same, byte for byte, and the step is a few per cent faster. What changed is that anyone can rebuild the 3.1 MB of code that touches every texture and get the same bytes, and CI proves it.

## Why

KTX2 is a container for GPU textures; UASTC is the block format inside it, which three.js turns into whatever the GPU reads. Since #42 the pipeline wrote these files with `ktx2-encoder` 0.6.0, a young dependency the PM wanted reviewed before release (#38). The review (design note `docs/design/own-basis-encoder-build.md` §1) found its encoder unauditable: its notice calls it upstream's binary for commit `1b33fd50`, but the bytes differ, and its own build script says it never runs in CI. That fails the standard #33 set for xatlas. The work started with a design pass on Fable 5.1 (the note, the first commit of PR #88); Opus 5.5 built it in the same PR.

## How

As the design note says: the same upstream commit, the pinned `emsdk:6.0.10` image shared with xatlas, upstream's Release flags plus `-flto`, standalone WebAssembly with a C shim and a typed wrapper, and a CI job that rebuilds and compares. Two things were done before touching the code: the files the package wrote for two generated textures were pinned by SHA-256 in `compress.test.ts`, and the package was timed with the new `scripts/measure-encoder.mjs`. Those two made "same results" a test instead of a hope.

## Problems and how we solved them

- **setjmp brings generated JavaScript back.** The first module imported Emscripten's `invoke_*` trampolines. **Cause:** upstream's JPEG loader, the only `setjmp` user, cannot be dropped by LTO because the file loaders are reachable through a run-time flag. **Fix:** the build leaves `jpgd.cpp` out; `no-jpeg.cpp` returns nothing, so a JPEG fails like a corrupt file. The shim never loads files. Asked on the PR.
- **`fd_read` is imported,** from the other loaders' `fread`. There is no `path_open`, so only standard input could be read, and the wrapper refuses it. Kept, pinned by the test, asked on the PR.
- **C++ needs `em++` to link** (libc++ was missing with `emcc`).
- **A missed setting:** the package also set `m_quality_level = 150`, which UASTC never reads; the identical hashes agree.
- **The package printed** a dozen status lines per encode; the shim switches that off.
- **Docker Desktop still does not start** on the development PC; the rootless WSL workaround from #33 ran the build, and CI in real Docker produced the identical file.
- **The corpus was deleted by accident, and restored.** A second worktree held a directory junction to `corpus/`; `git worktree remove --force` followed it and deleted all 30 STLs. Restored the same day from the PM's libraries and checked against the last run (byte size and triangle count of every file). Lesson: never link a data folder into a worktree.

## Dead ends

- **`slim`:** turning the transcoder's BC7 or XUASTC off does not compile at this commit (the encoder needs the BC7 helpers). No exceptions and no RTTI alone save 0.7 %.
- **SIMD:** 3 % faster in total but under 5 % on one size, and 8 % larger, so the plain build ships.
- **LTO for size:** the build without it is 0.6 % smaller and 2 % slower; LTO stays for speed.

## Numbers

**Module:** 3,137,177 bytes, 1,163,121 gzipped (package: 3,288,143 and 1,229,869). Two local builds and CI byte-identical (sha256 `50c513a1…`); CI job 2 min 56 s.

**Same results:** byte-identical KTX2 files for the two fixtures, the four harness textures and all 30 corpus minis; all 30 comparison sheets are identical PNGs.

**Encoder alone,** `measure-encoder.mjs`, Node 20.19.2, **development PC**, 3 runs, total warm over four textures (1024² and 2048², gradient and noise): package 8,509 ms, ours 8,191–8,265 ms, interleaved. Variants in the PR.

**Corpus,** **development PC**, Chrome 153, three runs back to back, all 30 minis baked, none fell back:

| run               | compress total | untouched steps |
| ----------------- | -------------- | --------------- |
| our build, first  | 109.7 s        | 452 s           |
| package           | 112.9 s        | 462 s           |
| our build, second | 107.5 s        | 446 s           |

The worst mini is 2.0 % slower than with the package. The reference run of 2026-09-23 took 104.4 s and 418 s.

**As a library (#83):** a throwaway Vite 8.3 project converts a 7,200-triangle sheet, baked, KTX2 857,066 bytes, from a production build and the dev server.

## Still open

- The two import questions on the PR, and the design note's §12 PM questions (built to its proposals).
- sRGB mip filtering on our linear data, unchanged here (#86); three.js's prebuilt transcoder (#87); the NOTICE on the published page (#47).
- Docker Desktop on the development PC.

## Story angle

"The notice said it was the upstream binary. It wasn't." Two hashes taken before touching anything turned "should be the same" into "is the same". Title idea: "Same bytes, different builder".
