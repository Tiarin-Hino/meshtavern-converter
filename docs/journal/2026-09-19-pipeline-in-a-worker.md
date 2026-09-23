---
title: Run the pipeline in a Web Worker with progress, timings and memory figures
date: 2026-09-19
phase: 0
issues: [6]
prs: [18]
topics: [worker, performance, ui, stl-import]
---

## What we did

Converting a mini now happens in the background: the page stays smooth while a large STL is processed, shows a progress bar, and afterwards shows a row of figures (time per step, memory, sizes). The viewer draws the mesh the pipeline produced instead of reading the file a second time.

## Why

A 100 MB sculpt keeps the processor busy for a noticeable time. Done on the page itself, that would freeze scrolling, buttons and the 3D view. A **Web Worker** is a background thread in the browser: it can crunch numbers but cannot touch the page. Issue #6 also asked for every step to be measured, because the Phase 0 spike (`docs/specs/phase-0-spike.md`) existed to produce numbers, not impressions.

## How

- `src/pipeline/run.ts` runs read, weld and orient in order, times each step and tracks memory.
- `src/worker/` holds the worker and its message protocol. The STL buffer is **transferred** to the worker and the finished mesh buffers are transferred back. Transfer hands over ownership of the memory instead of copying it, so no 100 MB copy is made in either direction.
- Progress (step name and percent) is shown in the UI and exposed on `window.__mt.state`, so tests can read it.
- A new end-to-end test checks that the page keeps responding while a large file converts. 5 new unit tests cover the message protocol (26 in total).

## Problems and how we solved them

- **Picking the same file twice did nothing.** **Cause:** a file input only fires a change event when the selection changes. **Fix:** the input is reset after each pick.
- **"Peak memory" cannot be measured in a worker.** **Cause:** Chrome does not expose heap size inside workers. **Fix:** we report the calculated size of the pipeline's own buffers alive at the same time, labelled as a lower bound, not a measurement. The Phase 0 write-up still says "peak memory is calculated, not measured".
- **Hard edges went soft.** Welded meshes get smooth normals (the per-vertex direction used for lighting), so the demo pyramid's edges looked rounded. **Cause:** a shared vertex averages the directions of all its faces. **Fix:** none here. That is right for sculpted minis and wrong for hard-edged models, so crease-aware normals were handed to the look work (#9).

## Numbers

Chrome 153 on the development PC, generated 100 MB binary STL with 2,000,000 triangles, opened through the file picker:

| Figure                                      | Value            |
| ------------------------------------------- | ---------------- |
| read / weld / orient                        | 54 / 479 / 36 ms |
| total in the worker                         | 569 ms           |
| building normals and GPU upload on the page | 190 ms           |
| longest gap between frames while converting | 6 ms             |
| pipeline buffers alive at once (calculated) | 404 MB           |

The browser was faster than Node for the same steps (weld 479 ms against 620 ms in the Node benchmark of `2026-09-19-weld-orient-place.md`).

Real-file check, same machine, three of the PM's own minis kept in the git-ignored `corpus/` folder:

| Mini  | Source triangles | Vertices after weld | Dropped triangles | Size (mm)          | Worker total | Longest stall |
| ----- | ---------------- | ------------------- | ----------------- | ------------------ | ------------ | ------------- |
| 60 MB | 1,253,530        | 626,628             | 150               | 21.0 × 31.9 × 19.6 | 453 ms       | 37 ms         |
| 26 MB | 554,400          | 277,130             | 84                | 26.8 × 30.3 × 24.3 | 167 ms       | 24 ms         |
| 26 MB | 546,662          | 273,165             | 256               | 21.7 × 28.8 × 20.5 | 206 ms       | 37 ms         |

All three stood upright, on the grid, centred and at 28 to 32 mm scale.

## Still open

- Progress moves per step (0, 33, 67 %), not within a step. Fine for sub-second steps; reduction and baking would need finer progress.
- Weak-device numbers were still owed. They came later: the same 100 MB file converts in 3.4 s on the reference laptop and 5.5 s on the phone (spec, "Measurements on other devices").

## Story angle

The browser can chew through a 100 MB sculpt in about half a second without dropping a frame, if the work moves off the page and nothing gets copied. Possible title: "Half a second, zero copies: a 2M-triangle mini in a Web Worker".
