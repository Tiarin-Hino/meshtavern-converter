---
title: Our own build of xatlas
date: 2026-09-27
phase: 1
issues: [33]
prs: [85]
topics: [unwrap, tooling, performance]
---

## What we did

The unwrap, the step that lays a mini's surface flat so a detail texture can be painted onto it, now runs on a WebAssembly module we compile ourselves from the xatlas library, instead of on a package from npm. For someone using the converter nothing changes: the same islands, the same textures, the same times. What changed is that the 149 KB of machine code that handles every user's mini is something this project built from a pinned, hashed copy of the source, and anyone can rebuild it and get the same bytes.

## Why

Since Phase 0 the unwrap used `xatlas-wasm` 0.1.3: a young package with one maintainer, shipped as one 289 KB file of generated JavaScript with the binary embedded. The PM decided on 2026-09-20 that it was fine during development and had to be replaced before the first public release (#33, Phase 1 spec, story 8). xatlas itself is MIT-licensed C++ and has not changed upstream since 2022. The work started with a design pass on Fable 5.1 (`docs/design/own-xatlas-build.md`, the start of PR #85), and Opus 5.5 built it in the same PR.

## How

- **Four files, four hashes.** `wasm/xatlas/build.sh` downloads `xatlas.cpp`, two headers and the licence of upstream commit `f700c779` (the commit the package was built from) and refuses to build when a SHA-256 differs. No submodule, no clone.
- **A pinned compiler.** It compiles inside the Docker image `emscripten/emsdk:6.0.10`, pinned by its manifest digest, with one `emcc` line per file and no CMake. `-O2 -flto` and `NDEBUG`, as the package was built, so "same results" compares like with like.
- **Standalone WebAssembly, no generated JavaScript.** The module's imports are the complete list of what xatlas can reach outside itself, and a unit test pins it: a progress callback, a notice that the heap grew, and a `fd_write` that is never called. No network, no files, no clock.
- **A C shim instead of byte offsets.** The package filled xatlas's C structs from JavaScript at hard-coded offsets. `wasm/xatlas/shim.c` fills them in C, where the compiler knows the layout, and `src/lib/pipeline/xatlas.ts` only moves typed arrays in and out.
- **A failed allocation stops the module.** xatlas does not check what its allocator returns, and address 0 is ordinary memory in WebAssembly, so an allocation that fails would be written through silently. The shim's allocator traps instead, the wrapper reports "cannot enlarge memory" (which the page already turns into "too large for this device"), and the next atlas gets a fresh instance.
- **The binary is committed, CI proves it.** `npm ci && npm run dev` needs no Docker. The `xatlas build` workflow rebuilds the module on every PR that touches `wasm/xatlas/` and fails if one byte differs.

## Problems and how we solved them

- **Docker Desktop would not start on the development PC.** Windows refused access to every socket file it created ("The file cannot be accessed by the system"), from two leftover files to fresh ones. **Fix, for this PR:** the pinned image was pulled by its digest straight from the registry and unpacked in WSL, and the build ran in it rootless (`unshare` and `chroot`). The CI build in real Docker then produced the identical file, so the workaround changed nothing. The PC's Docker still needs a look.
- **xatlas prints.** The design note assumed xatlas prints nothing unless told to; its print function defaults to `printf`. The shim switches printing off. The one remaining `fd_write` stub reports every byte as written, because musl retries a write that wrote nothing, forever.
- **Debug asserts trapped.** The first build had xatlas's debug asserts live, and one fired when an atlas was destroyed after a refused mesh. The package had been built with `NDEBUG` (its binary has xatlas's warning texts but no C assertion message), so ours is too. It also made the module 14 KB smaller and dropped two imports.
- **Cancelling calls back once more.** xatlas closes the stage it was cancelled in with a last 100 %. The test states that instead of "never called again".

## Dead ends

- **SIMD, a larger heap, `-O3`.** None was 5 % faster on real minis (the rule the design set), so the plain build ships (numbers below). SIMD was 20 % faster on the generated figure and not at all on the corpus: xatlas has no SIMD code, only what the compiler vectorises by itself.
- **Dropping the warm-up.** The throwaway unwrap from #31 stays. In Node the cold start is gone, but one Chrome run without it was 25 % slower on the first mini (numbers below).

## Numbers

**Module:** 149,036 bytes (64 KB gzipped), against 289 KB for the package. Two builds with a cold and a warm compiler cache, and the CI build, byte-identical (sha256 `3fc1cddd…`). The CI job takes 53 s.

**As a library (#83):** a throwaway Vite 8.3 project with the packed library converts a 7,200-triangle sheet, baked, KTX2 857,066 bytes, as in #83's check, from a production build (module under `/assets/`) and from the dev server (module straight from `node_modules`). Nothing needed on the consumer's side.

**Same results:** the unit tests of unwrap and bake and the regression baseline pass without a baseline update; charts of the three slowest corpus minis are identical to the package's in every variant (2611, 1496, 4160).

**Variants,** `scripts/measure-xatlas.mjs`, Node 20.19, **development PC**, 3 runs each, the three slowest corpus unwraps (about 60,000 triangles each, in slabs), mean total in s:

| build                 | cold  | warm  | worst cold/warm |
| --------------------- | ----- | ----- | --------------- |
| package               | 32.85 | 32.73 | 1.05            |
| plain (ships)         | 33.02 | 31.17 | 1.68 ¹          |
| simd                  | 33.59 | 33.15 | 1.19            |
| heap (256 MB)         | 33.99 | 33.50 | 1.12            |
| simd-heap             | 32.70 | 32.54 | 1.04            |
| o3                    | 33.83 | 33.85 | 1.05            |
| plain, `--no-liftoff` | 32.66 | 32.20 | 1.05            |

¹ One run of one mesh; its other two runs were 1.03 and 1.04.

**Cold start (#31):** the penalty of 111 s cold against 40 s warm came from unwrapping a giant whole. On today's slabbed table levels neither the package nor our build shows it in Node, and turning V8's baseline compiler off (`--no-liftoff`) changes nothing, so none of the three hypotheses of the design note has anything left to explain there. In Chrome, fresh tab, slowest mini, first against second conversion: without the warm-up 16.2/13.0 s (1.25) and 12.6/12.1 s (1.04); with it 13.0/12.5 s and 14.0/12.2 s.

**Corpus,** `npm run corpus`, **development PC**, Chrome 153, all 30 minis baked, none fell back, chart counts identical to the package on every mini. This session ran at about 60 % speed (weld, simplify, shade and bake together took 722–808 s against 418 s in the reference run of 2026-09-23), so the three runs were made back to back, this branch, the commit before it, this branch again:

| run               | unwrap total | median | slowest | untouched steps |
| ----------------- | ------------ | ------ | ------- | --------------- |
| reference, 09-23  | 91.5 s       | 3.4 s  | 8.1 s   | 418 s           |
| our build, first  | 152.2 s      | 5.3 s  | 16.1 s  | 743 s           |
| package           | 142.8 s      | 4.5 s  | 13.9 s  | 722 s           |
| our build, second | 158.1 s      | 5.7 s  | 13.8 s  | 809 s           |

Raw, our build is 7 to 11 % slower; scaled by the steps it does not touch, +3.6 % and −1.1 %. The mini that moved most in Chrome (a flying creature, 4.6 → 6.6 s) took 6.4–6.9 s with both builds in Node, interleaved; on that run the package's simplify was slower too. The evidence says "not worse", but a clean corpus run at full speed is still owed.

## Still open

- Docker Desktop on the development PC (the socket-file error above).
- The corpus figures of this entry come from a session running at reduced speed; a clean run from the PM's own session is owed, as for #42 (target: unwrap total not more than 5 % above 91.5 s, no mini more than 10 % slower).
- The KTX2 encoder (#38) can follow the same folder convention, `wasm/<module>/`.

## Story angle

Replacing a dependency by building the same library yourself sounds like busywork, until the build proves itself byte for byte in CI and the whole list of what the code can touch fits in one test. Title idea: "Three imports: auditing the code that touches every mini".
