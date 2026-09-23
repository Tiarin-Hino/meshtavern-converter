---
title: Detail levels driven by error in mm, with floor, cap and source normals
date: 2026-09-20
phase: 0
issues: [24]
prs: [25, 23]
topics: [lod, look, performance]
---

## What we did

The three detail levels are no longer fixed triangle counts. Each level now has a limit on how far it may deviate from the original sculpt, in millimetres, plus a minimum and maximum triangle count. A simple mini stays cheap; a detailed one gets the triangles it needs, up to a cap. Every level also keeps the lighting directions of the full sculpt, so creases and faces stay readable. The levels were renamed close, table and far.

## Why

The PM's verdict on the fixed 50k / 15k / 4k levels (`2026-09-20-lods-with-meshoptimizer.md`): fine on the PM's own minis, but on two detailed commercial minis 50k was only acceptable, 15k awful and 4k a disaster. The numbers showed why. To stay within 0.05 mm, one 1.25M-triangle mini needs about 14k triangles, while a 0.5M-triangle giant needs 144k. A triangle count mostly reflects how the file was exported, not how much detail it has. Issue #24 was agreed with the PM on 2026-09-20.

## How

- **Error limit, floor and cap per level** (`LOD_SPECS` in `src/pipeline/simplify.ts`):

  | Level | Error limit | Floor | Cap  |
  | ----- | ----------- | ----- | ---- |
  | close | 0.02 mm     | 50k   | 200k |
  | table | 0.05 mm     | 15k   | 60k  |
  | far   | 0.2 mm      | 4k    | 20k  |

  meshoptimizer reduces towards the floor but stops once the error limit is reached (its `ErrorAbsolute` flag makes the limit plain millimetres). If the result is still above the cap, it reduces again to the cap, error or not: the cap protects frame rate. The figures row shows what decided each level: `error`, `floor`, `cap` or `source` (the source was already small).

- **Source normals.** A **normal** is the direction a surface faces at a point; lighting depends on it. Before, each level recomputed normals from its few remaining triangles, which flattened the shading. meshoptimizer only keeps original vertices, so each kept vertex can carry the normal the full sculpt had there.
- **Normal-aware reduction.** The final pass of each level uses `simplifyWithAttributes` with the normals weighted 0.5 (`NORMAL_WEIGHT`), so it avoids collapsing creases, folds and facial features.
- **Chained levels** stay (table from close, far from table); the error a level inherits counts against its own limit.

## Dead ends

- **Draft PR #23, "sharper LODs by carrying the source normals"**, was the experiment that came first, on the fixed budgets. On the large giant (500k triangles, 77 mm), 50k and 15k were clearly better (the beard got structure, the face features, where 15k had been a smooth blob); 4k was not better, only noisier. Cost: the simplify step roughly doubled (giant 0.8 to 1.5 s, the 1.17M-triangle mini 2.7 to 4.7 s on the development PC) and 12 bytes more per vertex. It showed that normals help but budgets were the real problem, so it was closed and its commit folded into PR #25.

## Problems and how we solved them

- **Error figures stopped being comparable.** With normals in the reduction, meshoptimizer's error mixes shape and shading (0.38 to 1.57 mm at 15k in #23). **Fix:** the error-limited passes run on geometry only and report millimetres; the normal-aware pass reuses their triangle count and its error is not reported.
- **Chaining is conservative.** The 48 mm figure's table level gets 50k triangles where a direct reduction would need 32k. Accepted: chaining is much faster.

## Numbers

Development PC, Chrome 153, the five minis of the local test set:

| Mini                        | Source | close                | table               | far                 | Simplify |
| --------------------------- | ------ | -------------------- | ------------------- | ------------------- | -------- |
| Large detailed giant, 77 mm | 500k   | 200k (cap, ±0.04 mm) | 60k (cap, ±0.14 mm) | 20k (cap, ±0.34 mm) | 3.6 s    |
| Detailed 48 mm figure       | 1,172k | 94k (±0.02)          | 50k (±0.05)         | 8k (±0.20)          | 6.7 s    |
| PM's mini, 60 MB            | 1,253k | 50k (floor)          | 23k (±0.05)         | 4k (floor)          | 2.3 s    |
| PM's mini, 26 MB            | 554k   | 66k (±0.02)          | 32k (±0.05)         | 5k (±0.20)          | 1.0 s    |
| PM's mini, 26 MB            | 546k   | 50k (floor)          | 19k (±0.05)         | 5k (±0.20)          | 0.9 s    |

Simplifying is 2 to 3 times slower than with fixed budgets. On the giant, the new far level (20k) looked better than the old 50k level. Mixed stress scene (80 % small, 20 % giant, same machine, frame cap lifted): 100 minis by distance 1.9M triangles at 1279 fps, 400 minis 3.0M at 352 fps.

The PM approved the looks on 2026-09-20: close and table levels "great to acceptable", also on the detailed commercial minis. The numbers became the Phase 0 decision.

## Still open

- The giant hits every cap and misses its limits (0.14 mm instead of 0.05 mm at table level); whether 60k is the right cap waited for weak-device numbers, as did the 6.7 s worst case.
- Baked normal maps (#10) remained the way to bring the full sculpt's detail to the table level.

## Story angle

Stop asking "how many triangles" and ask "how many millimetres may it be off". Possible title: "Detail in millimetres, not triangles".
