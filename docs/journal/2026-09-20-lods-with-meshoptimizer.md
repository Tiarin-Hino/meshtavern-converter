---
title: Build 50k, 15k and 4k detail levels with meshoptimizer
date: 2026-09-20
phase: 0
issues: [8]
prs: [19]
topics: [lod, performance, tooling]
---

## What we did

Every conversion now also produces three reduced versions of the mini, at 50,000, 15,000 and 4,000 triangles. Buttons on the page switch between the full sculpt and each level without moving the camera, and the figures row shows the triangle count and estimated error of each level. A script renders side-by-side comparisons of every mini in the local test set.

## Why

A print sculpt has 0.5 to 2 million triangles; a table with 100 minis cannot draw that many sculpts. Games solve this with **levels of detail (LODs)**: lighter copies of a model shown when it is farther away. Issue #8 was a spike to pick the reduction library and see whether the result looks good enough, the second question of the Phase 0 spike (`docs/specs/phase-0-spike.md`).

## How

- **meshoptimizer** (npm `meshoptimizer` 1.2, MIT) runs as WebAssembly inside the worker, directly on our typed arrays. It is maintained and has an attribute-aware mode we expected to need for normals, colours or texture coordinates.
- **Each LOD is simplified from the previous one** (source to 50k to 15k to 4k). Simplifying each from the source gave about 30 % lower error at 15k and 4k (0.15 mm instead of 0.22 mm on the largest mini) but took 2 to 3 times as long (2.7 s instead of 1.3 s).
- The `Prune` flag drops tiny floating bits, which otherwise eat the budget because a closed piece cannot shrink below a few triangles. It changed nothing on these minis; it is there for messier files.
- Test hooks `showLevel`, `setCamera` and `setWireframe`, and `scripts/compare-lods.mjs`, which converts every STL in the git-ignored `corpus/` in real Chrome and writes one comparison image per mini to `out/`. Renders of real minis are sent to the PM, never committed.

## Dead ends

- **Fast-Quadric-Mesh-Simplification** was the planned second candidate, and the issue first asked for a head-to-head comparison. It was dropped before integration: it has no npm package, and its only WebAssembly builds are unmaintained (2022) and exchange data through temporary files, which costs 60 to 100 MB of extra copies per mini. The PM agreed on 2026-09-20 to go meshoptimizer-first and bring the other one in only if the quality disappointed. It never was.

## Problems and how we solved them

- **A notch in thin base rims.** At 15k the front rim of one mini's base showed a notch, and in the stress scene the same notch showed on many copies. **Cause:** thin, flat rims are where this simplifier gives up detail first. **Fix:** none in this PR; flagged for the PM to look at.

## Numbers

Chrome 153 on the development PC, three of the PM's own minis. The ± figure is meshoptimizer's own estimate of the largest deviation from the source surface, not an independent measurement.

| Mini       | Source triangles | 50k      | 15k      | 4k       | Simplify | Whole conversion |
| ---------- | ---------------- | -------- | -------- | -------- | -------- | ---------------- |
| 60 MB mini | 1,253,380        | ±0.02 mm | ±0.07 mm | ±0.22 mm | 1288 ms  | 1698 ms          |
| 26 MB mini | 554,316          | ±0.03 mm | ±0.09 mm | ±0.28 mm | 377 ms   | 526 ms           |
| 26 MB mini | 546,406          | ±0.01 mm | ±0.06 mm | ±0.25 mm | 371 ms   | 533 ms           |

What the comparison images showed, in the agent's reading: 50k indistinguishable at table distance and slightly softened wrinkles in close-up; 15k fine at table distance but small details gone in close-up; 4k a readable silhouette only, with a faceted face and a lumpy base rim.

## Still open

- **The PM's visual verdict** came after the PR and changed the plan. On the PM's own minis: 50k great, 15k acceptable, 4k awful. On two detailed commercial minis added to the local test set: 50k acceptable, 15k awful, 4k a disaster. A fixed triangle budget was the wrong measure; see `2026-09-20-error-driven-detail-levels.md`. The commercial minis also exposed an orientation bug; see `2026-09-20-up-axis-from-the-base.md`.
- These LODs are geometry only; baked normal maps (#10) were the expected way to bring fine detail back at 15k.
- All numbers are from the fast desktop.

## Story angle

A triangle count sounds like a quality setting, but a simple mini and a detailed one need very different counts to look the same. Possible title: "50,000 triangles is not a quality level".

Later: see `2026-09-20-error-driven-detail-levels.md`.
