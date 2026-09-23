---
title: Stress scene with distance-based detail levels and a live performance read-out
date: 2026-09-20
phase: 0
issues: [12]
prs: [20]
topics: [performance, lod, devices, testing]
---

## What we did

After converting a mini, buttons fill the table with 100 or 400 copies of it, each switching between its detail levels by distance from the camera. A line under the header shows frames per second, frame time, the worst frame, CPU time per frame, triangles, draw calls and how many minis sit at each level. A script runs the same cases in real Chrome and records the numbers.

## Why

The third Phase 0 question (`docs/specs/phase-0-spike.md`, issue #12): can a laptop with integrated graphics show 100 different minis at 30 fps or more? If not, the table application is not viable in the form planned, and we wanted to know before building it.

## How

- **Copies that cost like different minis.** Every copy gets its own GPU buffers and its own **draw call** (one instruction from the CPU to the GPU to draw one object). We deliberately did not use instancing, where the GPU draws many copies of one mesh in a single call: a real table has different minis, and instancing would have made the test look cheaper than reality.
- **Distance-based LODs** with three.js `THREE.LOD`: the 50k level up to 250 mm from the camera, 15k up to 600 mm, 4k beyond. The distances are provisional named constants (`LOD_DISTANCES_MM`).
- The read-out is also on `window.__mt.state.perf`; hooks `startStress(count, forcedLod?)` and `stopStress()`.
- `scripts/measure-stress.mjs` runs four cases once normally and once with Chrome's frame-rate cap lifted. The display caps fps at its refresh rate, so "cap lifted" is the only way to see headroom; a web page cannot measure GPU time.
- The grid became 1-inch squares, the usual battlemap scale.
- The end-to-end test checks structure only (draw calls, mini counts), never speed: CI renders in software.

## Problems and how we solved them

- **No weak device to measure on.** The acceptance criterion needed an integrated GPU, and the only machine was the RTX 3060 desktop. **Cause:** the weak reference device was not yet named. **Fix:** the PR measured what it could, said plainly that desktop headroom is not evidence for a laptop (integrated GPUs share memory and have different per-draw-call overhead), and left #12 open with a three-step recipe for anyone with a laptop. The measurement moved to #35 and was taken later.
- **CPU cost grows with draw calls.** At 400 minis the CPU time per frame rose to 3 ms. **Cause:** one draw call per mini. **Fix:** none needed for 100 minis; noted that on a slow CPU this, not triangle count, may be the limit, and that merging or instancing identical minis is the remedy.

## Numbers

Development PC, Chrome 153, 1920 × 1000, copies of the PM's 1.25M-triangle mini:

| Case                                               | Triangles per frame | Normal                | Cap lifted | CPU per frame |
| -------------------------------------------------- | ------------------- | --------------------- | ---------- | ------------- |
| 100 minis, LOD by distance (0 / 59 / 41 per level) | 1.0 M               | 165 fps (display cap) | 672 fps    | 1.1 ms        |
| 400 minis, LOD by distance (all at 4k)             | 1.6 M               | 165 fps (display cap) | 298 fps    | 3.0 ms        |
| 100 minis, all 50k                                 | 5.0 M               | 165 fps (display cap) | 384 fps    | 2.4 ms        |
| 400 minis, all 50k                                 | 19.4 M              | 113 fps               | 126 fps    | 7.6 ms        |

About 20 times the headroom needed for 30 fps on this GPU. The later measurement on the reference laptop (Iris Xe) gave 60 fps (its display cap) for 100 and 400 minis, holding 60 fps up to 400 table-level minis (8.8 M triangles) and 28 fps at 800. That met the exit criterion; see the spec's "Measurements on other devices".

## Still open

- Whether minis visibly "pop" between levels at these distances was left to the PM to judge by orbiting the scene.
- A mixed table of small and large detailed minis was added with the error-driven levels (`2026-09-20-error-driven-detail-levels.md`).

## Story angle

How to benchmark a game table before the game exists, and why we refused the cheap trick of instancing. Possible title: "100 minis, 100 draw calls, no cheating".
