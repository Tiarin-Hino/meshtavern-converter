---
title: The paint file, a painting saved as its steps
date: 2026-10-20
phase: 2
issues: [165]
prs: [186]
topics: [look, regression, testing, performance]
---

## What we did

A painting can now be saved as a small file of what made it rather than a picture of it: the strokes and fills, the files the mini was converted from (by a fingerprint of their contents, never their names), the choices of the conversion and the look. Opened again with the same files, the mini converts without a question, the steps replay, and the painter opens where the person stopped, with undo back to the bare mini. Given other files, the paint file is refused in one sentence that says which file is missing or different. This is the library's part; the panel and the page come in the next two issues.

## Why

The PM decided on 2026-10-13 to publish the converter with its painter before the table exists, so people can try colour schemes now and bring their painting to the table later (`2026-10-13-published-before-the-table.md`). A picture of the paint fits one unwrap of one conversion; the strokes fit the sculpt. The engine already kept every step as data and replayed it for undo, deterministically on one GPU, so the steps are the painting's source.

## How

- **Pure and in the main entry.** `src/lib/pipeline/paint-file.ts` writes and reads the file without three.js or the DOM: JSON, gzip-compressed above 1 MiB with the browser's own `CompressionStream` (also in workers and Node 20), so no compression library is added. The reader checks the shape of every step, since a file can come from anyone.
- **The fingerprint is SHA-256 and size per file, with its role** (figure, part, base), in the order the conversion takes the files, so that file indices in the choices (which file is the base, which part goes where) mean the same thing on reopening. Matching is by contents, so the person may drop the files in any order.
- **Two version numbers.** The file's own shape, and the brushes' engine. A painting reopened from an older engine and continued is painted on two engines, so the file records runs of steps per engine rather than one number; a future brush change that would alter old paintings keeps its old branch for the steps of an older engine.
- **Undo through everything.** The application's spec asks for undo back through all replayed steps; before, undo reached 50. Keeping a keyframe every ten steps for the whole history would grow without bound (7 MB each). Instead the 50-step window stays as it was, and an undo below it restores the paint as opened (now always kept) and replays up to there once, taking the window's keyframes on the way, so the next undos are cheap again. Memory: one keyframe more than before.
- **The regression net compares in the mini's space.** A recorded painting of the generated figure, with a step of every kind, is replayed in every e2e run and its colours compared at points on the surface (each dab's centre, rings on the base) within 8 of 255. Comparing the texture itself was the first idea and was dropped: any intended change to the unwrap would move every texel without changing how the mini looks.

## Problems and how we solved them

- **A unit test that never finished.** **Cause:** the test's stand-in for the person answered a placement question with the next "which way is up" answer and in a shape the worker does not know, so the conversion waited for an answer forever. **Fix:** the same answering helper the pipeline's own tests use: meet questions confirmed as shown.
- **The first timings said an undo takes a second and opening twenty.** **Cause:** they were taken in Playwright's headless Chromium, which draws in software here. **Fix:** measured with the engine's script in real Chrome on the GPU (below).

## Dead ends

- Comparing replayed textures tile by tile for the regression net (see How).
- A single engine number in the file: it cannot describe a painting continued on a newer engine.

## Numbers

Development PC, Chrome, 1,920 × 1,080, `scripts/measure-painting.mjs` (which now also replays and undoes):

| Mini                                               | Steps | JSON    | Replay at open | Undo of every step: median, worst       |
| -------------------------------------------------- | ----: | ------- | -------------: | --------------------------------------- |
| Generated figure on its disc                       |   118 | 80 KiB  |         689 ms | 6 ms, 33 ms                             |
| Large creature with its base (60 k triangles, 2 K) |   111 | 448 KiB |       1,217 ms | 12 ms, 190 ms (the one past the window) |

The painting of every step kind, saved and reopened, gave the same paint, mask and groups byte for byte (e2e, development PC).

## Still open

- Not measured on the reference laptop.
- The panel (next issue) and the page's Save and Open (the one after) are what people will see; this adds no button.
- The undo reach (all steps) is this PR's proposal, as the issue asked.

## Story angle

A painting as a recipe: why we save the brush strokes, not the picture, and what it takes for a replay to give the same bytes years later. "Your paint job is a file of brush strokes."
