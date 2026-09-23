---
title: Files that are not clean
date: 2026-09-23
phase: 1
issues: [43]
prs: [68]
topics: [stl-import, robustness, memory]
---

## What we did

The converter now copes with the files people actually have. A file with broken, flat or repeated triangles, with loose parts or odd edges, or written as text (ASCII STL) becomes a mini, and the figures say how many triangles were dropped. A file that cannot become a mini, because it is empty, cut off, not an STL at all or too large for the device, is refused with one sentence that says what happened and what to do. Before this, an empty file got a blank baked texture and a cut-off file became a mini with holes.

## Why

Story 3 of the [Phase 1 spec](../specs/phase-1-converter.md) (#43): whatever a slicer or sculpting tool produces must end in a mini or in a message a hobbyist understands, never in a frozen page, an uncaught error or a crashed tab. Phase 0 only ever saw five clean minis. The PM defined "too large" on 2026-09-21 (see [the scope entry](2026-09-21-messy-files-scope.md)): estimate the memory first, refuse politely, and catch running out of memory as a safety net.

## How

- **One vocabulary of refusals** (`src/pipeline/problems.ts`). Every failure becomes a `ConversionProblem` with a code (`empty`, `not-stl`, `truncated`, `no-surface`, `too-large`, `out-of-memory`, `unexpected`) and a fixed message for the user. The technical detail goes to the console and `state.errorDetail`, never into the sentence the user reads. Anything thrown that is not one of these becomes `unexpected`, or `out-of-memory` when the engine said it could not allocate.
- **Reading.** `sniffStl` decides from the first 8 KB and the file size whether a file is binary STL, ASCII STL, or neither. A binary file whose size does not match its triangle count is only taken for a cut-off STL when its first triangles look like coordinates (finite, under a kilometre); random bytes and images almost never pass that. An ASCII file must end with `endsolid` after its last vertex, otherwise it was cut off.
- **Cleaning** in the weld step: triangles with a NaN or infinite coordinate, triangles without area (corners welded together or on one line) and repeats of a triangle already kept (same three corners in any order) are dropped and counted. Non-manifold edges and loose parts needed no change: generated test meshes with boxes sharing an edge, fins, a lone triangle and six separate blobs convert and bake as they are.
- **Too large.** `memory.ts` estimates the peak memory from the file size alone: 360 MB fixed, plus 400 bytes per triangle, plus the file itself. A conversion may use half of what `navigator.deviceMemory` reports; browsers that do not report it (Firefox, Safari) are treated as a 4 GB device. The page checks this before it reads the whole file, so a file that would not fit is never loaded; the worker checks again for meshes that did not come from a file. If memory still runs out, a failed allocation is caught in the worker, and a worker that dies is caught on the page; both end in the same message, and a fresh worker takes over.

## Problems and how we solved them

- **The new ASCII reader was four times slower.** Reading bytes directly instead of decoding the whole file into one string saves a copy of the file, but turning each number into a string for `Number()` took 2.4 s for 103 MB, against 0.56 s for the old regular expression. **Cause:** one small string allocation per coordinate, 4.5 million of them. **Fix:** a hand-written decimal parser on the bytes, with `Number()` only for oddities such as `nan`. 0.37 s, and every float identical to the old reader's.
- **The review found three gaps** (Claude Fable 5.1 and GPT Astra on PR #68). The page's "Dropped" figure and the corpus report still showed only one of the three kinds of dropped triangle; they now show all three. An allocation failure during unwrap, bake or compression was caught by the bake's own fallback and quietly became "per-vertex look"; it now ends in the memory message and a fresh worker like any other. And the test for out-of-memory messages matched "OOM" in any case, so an error about "zoom" would have told the user the file was too large; it now matches only the word in capitals. Two figures in the table below were also 20 MB off the formula and were corrected.
- **The automatic fix job could not start.** Adding the `astra-review` label ran the job that applies review findings for the first time, and it stopped at once. **Cause:** the GitHub action installs Claude Code 2.1.278, and the fix job's model, Opus 5.5, needs 2.1.280. **Fix:** the findings were applied by hand here; the workflow is fixed in its own PR.
- **An empty STL was converted.** Found in #53: a file with no triangles went through the whole pipeline and got a blank texture. It is now refused as empty, and the old test that expected it to convert was changed.

## Dead ends

- **Treating a cut-off file as a smaller mini.** The old ASCII reader dropped the incomplete last triangle and carried on. That gives a mini with a hole where the file ended, which is exactly the "broken mini" the story rules out, so cut-off files are refused.

## Numbers

Peak memory of the page's process (the renderer, which also runs the worker) during a conversion with baking, measured with `scripts/measure-memory.mjs`, one fresh Chrome per file, on the **development PC** (Chrome 153, Windows):

| File                          | Triangles | Peak MB | Estimate MB |
| ----------------------------- | --------: | ------: | ----------: |
| Generated sheet, binary       |     3,200 |     333 |         361 |
| Terrain piece, binary         |      144k |     387 |         422 |
| Winged humanoid, binary       |      500k |     487 |         575 |
| Humanoid, binary              |     1.25M |     695 |         898 |
| Large dragon, 281 MB binary   |      5.6M |   2,630 |       2,774 |
| Generated sheet, 103 MB ASCII |      500k |     555 |         720 |

The GPU process stayed at 177–191 MB in every run. With these figures the large dragon converts on a device that reports 8 GB and is refused at 4 GB or less; a 63 MB humanoid still converts on a device that reports 2 GB.

ASCII reading, 500k triangles, 103 MB, in Node 20 on the development PC: 0.56 s before, 0.37 s after.

## Still open

- The reference laptop: whether the large dragon is refused there and nothing crashes (the PM measures, as in #35).
- The 4 GB assumed for browsers that do not report memory is a guess for an ordinary laptop, not a measurement; a phone with Safari may still run out, which the safety net catches only when the browser throws instead of closing the tab.
- Running out of JavaScript heap (as opposed to typed arrays or WebAssembly memory) cannot be caught by any page; only the estimate protects against it.

## Story angle

Real files are messy, and the worst failure is a silent one: a mini with holes or a tab that vanishes. Title idea: "Your file ends too early: error messages for people who print minis".
