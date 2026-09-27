---
title: Our own build of the Basis Universal encoder
date: 2026-09-27
phase: 1
issues: [38]
prs: [88]
topics: [textures, compression, tooling]
---

## What we did

Every baked mini's detail texture is compressed to a KTX2 file before it is stored or sent to other players. That compression now runs on a WebAssembly module this project compiles itself from the Basis Universal source, instead of on a binary that came inside an npm package. For someone using the converter nothing changes: the files it writes are the same, byte for byte, and the step is a few per cent faster. What changed is that the 3.1 MB of machine code that handles every user's texture is something anyone can rebuild from a pinned commit and get the same bytes, and CI proves it on every change.

## Why

KTX2 is a container for GPU textures; UASTC is the block format inside it that every GPU can be served from (three.js turns it into BC7 on desktops and ASTC or ETC2 on phones), and Zstandard squeezes it further for storage. Since #42 the pipeline wrote these files with `ktx2-encoder` 0.6.0. The PM decided on 2026-09-20 that young dependencies were fine during development and had to be reviewed or replaced before the first public release (#38, with #33).

The review (design note `docs/design/own-basis-encoder-build.md`, §1) found the package's own JavaScript small and fine, and its working part, a 3.3 MB WebAssembly file with one-letter imports, unauditable. Its notice says the file is a redistribution of Basis Universal's own binary for commit `1b33fd50`; it is not: upstream commits its own build of that commit, and the bytes differ. The package's build script explains why honestly (one extra Emscripten flag, run on the maintainer's machine) and says in its header that it never runs in CI. So nobody could say what exactly the encoder was, only that it was the file one person had built once. That fails the standard #33 set for xatlas: a module in the critical path is compiled by this project from pinned sources in a pinned toolchain, proven byte for byte, or it goes. Upstream itself is healthy (Apache-2.0, active, every build flag public), so the work started with a design pass on Fable 5.1 (the design note, the first commit of PR #88), and Opus 5.5 built it in the same PR.

## How

- **The same commit, a different compiler.** `wasm/basis-encoder/build.sh` fetches upstream commit `1b33fd50`, the one the package was built from, so the only thing that changed is who compiles it. Thirty-one files are too many to hash one by one as the xatlas build does; the build fetches the commit with git (shallow, blobless, sparse) and the commit id is the hash of every file. It refuses any other or a dirty checkout.
- **One toolchain for both modules.** The same pinned `emscripten/emsdk:6.0.10` image as xatlas (the package used Emscripten 4.0.15). Upstream's Release flags from its `webgl/encoder/CMakeLists.txt`, one concern per line: `-O3`, `NDEBUG`, `-fno-strict-aliasing`, its twelve feature defines, its 128 MB initial heap and 2 MB stack. Added: `-flto`.
- **Standalone WebAssembly, no generated JavaScript.** Upstream exposes the encoder to JavaScript through embind, which needs about 100 KB of generated glue. `shim.cpp` exposes four plain C functions instead (`mt_init`, `mt_encode`, `mt_output`, `mt_release`) and fills the encoder's parameters in C exactly the way upstream's own JavaScript wrapper fills them for the options the package set. The module's imports are then the whole list of what the encoder can reach outside itself, and a test pins it: a memory-growth notice, a clock (the encoder times its own stages), an empty environment, and standard input and output. It cannot open a file.
- **A wrapper of our own.** `src/lib/pipeline/basis-encoder.ts` copies the pixels in, the file out, and frees both at once, as the xatlas wrapper does. A trap drops the instance; a failed allocation reads as "cannot enlarge memory", which the page already turns into "too large for this device"; anything else is "Encode failed:" with the encoder's own last words.
- **Same results first.** Before touching anything, the files the package wrote for two generated textures were pinned by SHA-256 in `compress.test.ts`, and the package was timed with a new harness, `scripts/measure-encoder.mjs`. Only then was it replaced. `compressDetail` keeps its name and its settings, including one that is wrong for our data (next section).
- **The binary is committed, CI proves it.** `npm ci && npm run dev` needs no Docker. The `basis encoder build` workflow rebuilds the module in the image on every PR that touches the folder and fails on one differing byte; when it fails it keeps CI's module as a download for a day, so a first commit never needs a working local Docker.

## Problems and how we solved them

- **Emscripten's C link does not bring libc++.** The first link failed with a page of missing `std::string` and `operator new` symbols. **Cause:** the encoder is C++ and was linked with `emcc`. **Fix:** compile C++ and link with `em++`; `zstd.c` stays on `emcc`.
- **setjmp brings generated JavaScript back.** The first module imported `invoke_vi`, `invoke_iii` and five more, plus `_emscripten_throw_longjmp`: Emscripten's way of doing `setjmp`/`longjmp`, which calls back into its generated JavaScript. **Cause:** upstream's JPEG loader (`jpgd.cpp`) is the only code in Basis Universal that uses `setjmp`, and link-time optimisation cannot drop it because the loaders are reachable through a flag checked at run time. `-sSUPPORT_LONGJMP=0` only turned the trampolines into `env.setjmp` and `env.longjmp` imports. **Fix:** the build leaves `jpgd.cpp` out and `no-jpeg.cpp` defines its two entry points to return nothing, so a JPEG fails to load like a corrupt one. The shim never loads a file. Asked on the PR, because the design note makes any change to the import list a question for a human.
- **`fd_read` is in the import list.** The design note expected none. **Cause:** `fread` in upstream's other file loaders (PNG, DDS, EXR and the generic file reader), reachable for the same reason. The module has no `path_open`, so it can only ever name standard input, and the wrapper refuses the read. Kept, pinned by the test, and asked on the PR.
- **One setting the design note missed.** The package also set `m_quality_level = 150` through its defaults. Upstream reads it only for ETC1S and XUASTC, never for UASTC LDR 4x4, so the shim leaves it at the default; the identical hashes agree.
- **The package printed.** Every encode wrote a dozen status lines to the console ("Encoding slice 7", …): the encoder's status output defaults to on and the package never turned it off. The shim does.
- **Git Bash rewrites sparse-checkout paths.** `/encoder/` became `C:/Program Files/Git/encoder/` and the checkout came out empty. Only on the Windows side; inside the image the script's paths are left alone.
- **Docker Desktop on the development PC still does not start** (journal of #33). The pinned image's file system, unpacked in WSL for #33, ran the build rootless again (`unshare`, `chroot`, the repo bind-mounted at `/src`), with `resolv.conf` bound in this time because the build fetches its sources. CI in real Docker produced the identical file.
- **A smoke test times out in the full e2e run on this PC.** "keeps the page responsive while a large mesh converts" hits its 30 s limit when the whole suite runs, and passes alone in 2.5 s. It fails the same way on the commit before this work, so it is not caused by it, and it passes in CI.
- **The corpus was deleted by accident, and restored.** To run the corpus against the old package, the package's commit was checked out as a second worktree with the corpus linked in by a Windows directory junction (the corpus is not in git). Removing that worktree with `git worktree remove --force` followed the junction and deleted all 30 STLs. **Fix:** restored the same day from the PM's libraries (the bought minis from the downloaded packs, the PM's own from the miniature database) and checked against the last run: every file's byte size and triangle count match. **Lesson:** never link a data folder into a worktree; remove a junction with `rmdir` before removing anything around it.

## Dead ends

- **`slim`, as planned.** Turning the transcoder's BC7 or XUASTC support off, to drop code the encoder never uses, does not compile at this commit: the encoder's XBC7 code needs the transcoder's BC7 helpers. What is left of the variant (no exceptions, no RTTI) saves 0.7 %, far below the 10 % the rule asks for.
- **SIMD.** 3 % faster in total, 7 % on one texture, not 5 % on both sizes: the rule keeps the plain build. It is also 8 % larger. Basis Universal has no WebAssembly SIMD code; what gain there is comes from the compiler vectorising by itself.
- **Link-time optimisation does not make it smaller.** The note added `-flto` to drop code the shim never reaches. The build without it is 0.6 % smaller and 2 % slower, so LTO stays for speed, not size. Nearly everything is reachable through the run-time flags anyway.

## Numbers

**Module:** 3,137,177 bytes (1,163,121 gzipped, what a user downloads on the first conversion), against 3,288,143 (1,229,869 gzipped) for the package: 5 % smaller. Two local builds and the CI build are byte-identical (sha256 `50c513a1…`). A build takes about 2 min 10 s in the rootless image on the development PC and 2 min 56 s in CI, including the fetch.

**Same results:** the package and our build write byte-identical KTX2 files for every texture tried: the two fixtures (64² gradient, seeded 256² noise) and the four harness textures below, at the pipeline's settings. So the corpus sizes cannot move, and the comparison sheets are the same pictures.

**Encoder alone,** `scripts/measure-encoder.mjs`, Node 20.19.2, **development PC**, 3 runs each, ms per encode, warm (cold includes compiling the module):

| build         | gradient 1024 | noise 1024 | gradient 2048 | noise 2048 | total warm | total cold | size      | gzipped   |
| ------------- | ------------- | ---------- | ------------- | ---------- | ---------- | ---------- | --------- | --------- |
| package       | 453           | 1,475      | 688           | 5,893      | 8,509      | 9,377      | 3,288,143 | 1,229,869 |
| plain (ships) | 425           | 1,464      | 668           | 5,709      | 8,265      | 9,014      | 3,137,177 | 1,163,121 |
| plain, again  | 419           | 1,439      | 663           | 5,742      | 8,263      | 9,011      |           |           |
| no-lto        | 433           | 1,472      | 687           | 5,862      | 8,453      | 9,381      | 3,119,124 | 1,157,516 |
| simd          | 419           | 1,408      | 615           | 5,570      | 8,012      | 8,678      | 3,402,730 | 1,217,079 |
| slim          | 414           | 1,430      | 672           | 5,708      | 8,225      | 9,062      | 3,115,448 | 1,155,884 |

The package row was measured interleaved with two runs of `plain` (8,191 and 8,220 ms warm); the first package-only run of the session gave 9,791 ms warm, on a busier machine. Output sizes: 266,014, 1,367,790, 491,913 and 5,466,060 bytes, the same for every build.

**As a library (#83):** a throwaway Vite 8.3 project with the packed library converts a 7,200-triangle sheet, baked, KTX2 857,066 bytes (the size #33's check recorded with the package), from a production build (both modules under `/assets/`) and from the dev server (both straight from `node_modules`). Nothing needed on the consumer's side.

**Corpus,** `npm run corpus`, **development PC**, Chrome 153, all 30 minis baked, none fell back. Three runs back to back, this branch, the package (a worktree at the commit before the build), this branch again, so the session's speed cancels out. The session ran near full speed this time: weld, simplify, shade and bake took 446–462 s against 418 s in the reference run of 2026-09-23.

| run               | compress total | 512 px      | 1024 px     | 2048 px     | untouched steps |
| ----------------- | -------------- | ----------- | ----------- | ----------- | --------------- |
| reference, 09-23  | 104.4 s        | 0.34–0.36 s | 1.34–1.46 s | 5.02–6.25 s | 418 s           |
| our build, first  | 109.7 s        | 0.35–0.37 s | 1.40–1.50 s | 5.17–7.68 s | 452 s           |
| package           | 112.9 s        | 0.37–0.39 s | 1.46–1.76 s | 5.18–7.26 s | 462 s           |
| our build, second | 107.5 s        | 0.36 s      | 1.37–1.55 s | 5.20–6.43 s | 446 s           |

Our build is 3–5 % faster in total than the package in the same session; the design's reference total of the 2026-09-25 run was 110.4 s. The mini that moved most is 2.0 % slower than the package (mean of our two runs), inside the 10 % tolerance. Every mini's KTX2 file has the same size in all three runs (512 px 315–317 KB, 1024 px 1,132–1,243 KB, 2048 px 3,570–4,874 KB, as in the reference), and all 30 comparison sheets are byte-identical PNGs between our build and the package.

## Still open

- The two import questions on the PR (`fd_read`, the JPEG loader left out).
- The PM questions of the design note §12 were not answered before the build; it followed the note's proposals (pin `1b33fd50`, thresholds as proposed, two workflows, sRGB mips unchanged).
- The mipmaps of our detail texture are filtered in sRGB space, which is wrong for normals and cavity: the package left the encoder's default on, and so does this PR (`SRGB_MIPS` in `compress.ts`), so that it changes only who compiles the encoder. #86.
- three.js's Basis transcoder is still a prebuilt binary (#87). When the page is published (#47), the Apache-2.0 NOTICE must be reachable from it.
- Docker Desktop on the development PC.

## Story angle

"The notice said it was the upstream binary. It wasn't." How a working dependency was replaced by the same library built in the open, and how two SHA-256 hashes taken before touching anything turned "should be the same" into "is the same". Title idea: "Same bytes, different builder".
