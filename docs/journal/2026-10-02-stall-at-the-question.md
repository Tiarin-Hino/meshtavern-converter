---
title: The stall at the question, located and taken apart
date: 2026-10-02
phase: 2
issues: [108]
prs: [111]
topics: [viewer, performance, devices]
---

## What we did

Converting the largest corpus mini (a 281 MB sculpt, 5.6 million triangles) froze the page for 170–200 ms on the reference laptop, against a limit of 100 ms. We found the moment: the first frame of the question "which way is up", when the page hands the full-detail sculpt to the graphics card. The sculpt now goes to the card in pieces over about ten frames, and the longest stall is 78–92 ms.

## Why

Phase 1 story 2 says the page never freezes for more than 100 ms. The run on the laptop for #103 (`2026-10-02-largest-mini-on-the-laptop.md`) measured 168–203 ms for this file and could not say where; the two smaller minis measured on the laptop stalled 17 and 33 ms. #108 asked to find the moment, fix it or let the PM set a limit for files of this size.

## How

**Locating it.** A one-off script (git-ignored `out/laptop/trace.mjs`, made from #103's measurement script) converted large-01 in real Chrome with a Chrome trace running (`devtools.timeline`, later with the V8 sampling profiler), and logged the page's long tasks and state changes. Over the whole conversion there was one task over 55 ms: a 362 ms animation frame right when the question appeared. Inside it the page waited about 190 ms for the GPU process (`WaitForToken`: the browser's shared buffer to the GPU process was full while 100 MB of geometry went through it), 24 ms for the question's shader to link, about 80 ms of JavaScript and 23 ms of layout. Receiving the result, transcoding the 2048 px texture and building the done state were all under 55 ms.

**What the frame did.** `showShown` gave three.js the file's welded mesh as one geometry: 34 MB of positions (2.8 million vertices) and 67 MB of indices. three.js uploads a geometry in the first frame that draws it, compiles a material's shader the first time it is drawn, and measures a geometry's bounding sphere over all its vertices the first time it sorts or culls it.

**The fix** (`src/page/mesh-chunks.ts`, `src/page/viewer.ts`):

- A file at a question is a group of chunks (`QuestionFile`). Each chunk is a range of the triangles: a `subarray` of the index array, no copy, drawn over the file's positions, which all chunks share. The positions go to the GPU in the first frame with a chunk of one triangle, then one chunk of 8 MB of indices (`UPLOAD_BYTES_PER_FRAME`, about 700,000 triangles) per frame. The largest corpus mini takes 10 frames. A file whose positions and indices fit in 8 MB (an ordinary mini) is one chunk, added at once as before.
- The chunks of a large file start on the frame after the question arrives, so the question's other first draws (the turn gizmo) are not in the same frame as the positions.
- Every chunk gets the file's bounds, measured once when the file arrives, instead of three.js measuring each chunk over all the file's vertices.
- The question's material is compiled at start-up (`compileAsync`) and drawn once with a triangle without area, so its first use is not in a question's frame either.
- `questionMs` (time to the question) now waits until the last chunk is added, and two frames more.

## Problems and how we solved them

- **The laptop was on battery for the first traces.** `cat /sys/class/power_supply/AC*/online` said 0, and the conversion took 175 s instead of 104 s. **Fix:** the traces were only used to find the moment and compare approaches; every figure in "Numbers" was measured again on the power cord, together with the unchanged code under the same conditions.
- **Slicing one buffer did not help.** The first fix created each buffer empty (`bufferData` with a size) and filled it with `bufferSubData` a slice per frame, through three.js's `GLBufferAttribute`. The stall fell from 350 ms to 117 ms under tracing, but one 100 ms flush remained in the GPU process, at the moment the empty buffers were made. **Cause:** Chrome clears a new buffer, and that costs as much as filling it. A micro-benchmark on the laptop (battery): making an empty 32 MB buffer 54–58 ms, 64 MB 89–95 ms, 100 MB 129–140 ms; filling an existing buffer with 8 MB 6–19 ms. **Fix:** smaller buffers, hence the chunks.
- **Three.js measured every chunk over the whole file.** With the chunks sharing the file's positions, each chunk's first frame spent about 150 ms in `computeBoundingSphere`, because three.js measures the bounds over the position attribute, not over the chunk's indices, and does so to sort objects even when culling is off. **Fix:** the bounds are given.
- **`compileAsync` was not enough.** After it, the frame still spent about 20 ms in the shader's first use (three.js reads its uniforms and its info log then). **Fix:** one draw at start-up with a triangle without area.

## Dead ends

- **Slicing one buffer over frames** (`GLBufferAttribute`, `bufferSubData`): see above, the empty buffer costs as much as a full one.
- **Each chunk with only its own vertices.** Copying the vertices a range of triangles uses into a compact chunk would split the positions too. Measured in Node on large-01: 56–80 ms per chunk of 400,000 triangles, and each chunk used 680,000–960,000 vertices, 2.4 per triangle. **Cause:** a sculpt's triangles come in no spatial order, so a range of them touches vertices all over the mesh, and every lookup misses the cache. Doing it on the page's main thread would just move the stall.

## Numbers

Reference laptop: i7-1265U, Intel Iris Xe, 32 GB, Ubuntu 24.04, Chrome 149, on the power cord (power profile `balanced`), window in front, a fresh browser per conversion, the build served by `vite preview` on the laptop. The longest stall is the page's own figure (`window.__mt.state.longestFrameGapMs`), from the start of the conversion until the mini is on screen; frames come at 60 Hz, so it moves in steps of about 17 ms. The question confirmed as detected by script.

| large-01 (281 MB, 5,625,026 triangles)   | Longest stall | Time to the question |
| ---------------------------------------- | ------------: | -------------------: |
| Before (#103, c282d0f), runs 1 and 2     |  203 / 168 ms |        4.4 s / 4.4 s |
| Before, again today (this branch's base) |        175 ms |                4.3 s |
| After, runs 1 and 2                      |    81 / 85 ms |        4.3 s / 4.3 s |
| With its base file, before (#103)        |        189 ms |                5.6 s |
| With its base file, after, runs 1 and 2  |    92 / 78 ms |        5.4 s / 5.4 s |

The whole conversion took 102 s alone and 109–110 s with its base (104–113 s in #103): the pipeline is untouched.

Traced on the laptop on battery, with tracing on (both make every frame slower): the question's first frame took 362 ms before; with the chunks and the given bounds, but before the start-up draw of the shader, the frame with the positions took 135 ms (about 90 ms of it handing over the positions, 25 ms the shader's first use) and each chunk frame 4–17 ms.

**The whole corpus on the laptop** (`npm run corpus -- --out corpus-108`, baked, the questions confirmed as detected, on the power cord, the build of this branch): 32 conversions, none failed, every mini baked. Longest stall per mini 40–71 ms, large-01 with its base 65 ms, except **large-02 with its base, 176 ms**. That one did not come back: converted again outside the corpus run, it stalled 78 and 88 ms with this change, 81 and 85 ms with the unchanged code, and 67 and 85 ms in two runs with a trace, where no task in the conversion was over 82 ms. Its question mesh fits in one chunk, so the change does not touch it. The cause of the one 176 ms frame was not found.

**The whole corpus on the development PC** (2026-10-03, `npm run corpus`, commit 03930e9, i7-11700F, RTX 3060, 64 GB, Windows 11, Chrome 154, baked, the questions confirmed as detected): 32 conversions, none failed, every mini baked. large-01 with its base stalled 42 ms; on the unchanged code it stalled 97–109 ms in every PC corpus run since #92 (four runs, 2026-09-30 to 2026-10-02). Every other mini 7–79 ms, except **humanoid-03 with its base, 146 ms**. Like large-02 on the laptop, it did not come back: converted again alone, four runs stalled 42–55 ms; then three runs each of the unchanged code (510556c) and this branch, alternated, with humanoid-03 and large-02 and their bases: 42–43 / 30 ms before, 36–42 / 24–30 ms after. Time to the question was the same or a little shorter after (humanoid-03 0.72–0.74 s against 0.76–0.78 s, large-02 1.08–1.09 s against 1.10–1.12 s), so the longer question times of the overnight corpus run (large-02 1.8 s, large-04 3.2 s) came from that run, not from the chunks.

## Still open

- **The margin is thin.** The frame with the file's 34 MB of positions is the one left, and it takes most of the 78–92 ms. A file with about twice large-01's vertices would be over the limit again. Splitting the positions too needs each chunk's own vertices, which costs too much on the page's main thread (see "Dead ends"); it could be done in the conversion's worker, which has the mesh anyway, as a change of what the question sends.
- **One frame over the limit, once per corpus run.** large-02 with its base on the laptop (176 ms) and humanoid-03 with its base on the development PC (146 ms), each once, neither again in later runs (six and seven), both with question meshes the change barely touches. The cause was not found; a trace of a full corpus run would be the way to catch it.
- No e2e test can measure the stall where it matters: CI draws in software. The e2e test checks that a mesh in two chunks is drawn whole and that the time to the question waits for it.

## Story angle

A frozen page is often blamed on the computing, but here the computing ran in a worker the whole time: the freeze was handing 100 MB to the graphics card in one go, and learning that the browser's empty buffer costs as much as a full one.
