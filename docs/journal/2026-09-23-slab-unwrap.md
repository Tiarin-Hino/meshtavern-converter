---
title: Unwrap the table level in 8 slabs of one atlas
date: 2026-09-23
phase: 1
issues: [57, 35]
prs: [61, 62]
topics: [unwrap, performance, regression]
---

## What we did

Converting a mini is now much faster. The unwrap, which used to take up to 84 s, takes 0.6 to 8.5 s on every corpus mini. Large minis convert in 21 to 36 s instead of 42 to 107 s, ordinary ones in 5 to 15 s, and the baked mini looks the same at the comparison-sheet views. This is the spike's winning variant made the normal path (see 2026-09-21-unwrap-spike.md), with everything the spike tried and lost removed.

## Why

The spike (#34) found that xatlas's time grows roughly with the square of the mesh, and that the table level cut into 8 slabs, passed as 8 meshes of one atlas, unwraps in seconds. Issue #57 turned that into a build; it waited for the PM to look at the spike's comparison sheets and choose "8 slabs, one atlas" over 16. The target is story 9 of the [spec](../specs/phase-1-converter.md): every corpus mini except the largest file unwraps in 15 s or less on the development PC, and none looks worse.

## How

- `src/pipeline/slabs.ts` cuts the table level across its longest side into `SLAB_COUNT` (8) slabs of equal triangle count, by where each triangle's centre lies. `src/pipeline/unwrap.ts` passes them to xatlas as meshes of one atlas: one thread, one packing pass.
- **Small meshes are unwrapped whole:** `WHOLE_UNWRAP_BELOW = 8_000` triangles, chosen by measurement. Table levels have at least 15,000 triangles unless the file has fewer, so this only affects small files.
- The step stays in the same place and the same try/catch: in the worker, timed, with progress, cancellable, per-vertex look on failure.
- **Removed:** the island workers, the second packing pass, the `?unwrap=` options, the seam measure, connected-part splitting and the spike scripts; 1,179 lines out, 301 in. The spec says how to get them back from commit `c69dd1b`.
- **Tests** on a generated 8,712-triangle sheet: every triangle comes back exactly once with its winding; per-vertex data carries over; every texture coordinate stays inside the texture; every slab gets the same texture area per mm², within ±10 % of the mean.

## Problems and how we solved them

- **Problem.** The regression baseline moved. **Cause:** cuts add islands and vertices on the baked level. **Fix:** updated on purpose and explained in the PR: on the baked `figure` case islands 1,593 → 1,895 (+19 %), vertices 29,557 → 30,721 (+3.9 %), texture use 0.830 → 0.837. Triangles, error and file sizes of every level unchanged.
- **Problem.** The first laptop run of the built path looked twice as slow as the spike. **Cause:** the power cord was not plugged in; untouched steps had doubled too. **Fix:** repeated on the cord; the clean run matched the spike.
- The automated review (Astra) found no issues, without running the tests (no dependencies installed in its workspace).

## Dead ends

None new; the losing variants are in the spike entry. Below about 2,000 triangles slabs were no faster and added 40 to 70 % islands, which is where the threshold came from.

## Numbers

**Threshold**, Node, one core, **development PC**, five table levels reduced to 500 to 15,000 triangles: slabs save 0.05 to 0.26 s at 4,000 triangles, 0.15 to 0.37 s at 8,000.

**Corpus run**, **development PC**, Chrome 153, window visible, against the 2026-09-21 run. Weld, simplify and shade within 0.3 s of it on every mini, so the times hold.

- 30 of 30 baked, none fell back; every unwrap 8.5 s or less.
- A swarm of many small creatures: unwrap 84.1 → 4.1 s, whole 106.8 → 26.7 s.
- A large giant: unwrap 48.5 → 3.5 s, whole 72.3 → 27.1 s.
- The largest file, a 281 MB dragon: unwrap 27.3 → 4.9 s, whole 137.4 → 114.1 s.
- Slowest now, a large bat and a long cave-wall terrain piece: 8.5 s each.
- Islands −3 % to +31 %; texture use within 3 points; page stalls 6 to 55 ms. 121 unit tests, e2e 11 of 11.

**Reference laptop**, PM, on the power cord, no address options (#35):

- The smooth goblin sculpt: unwrap 2.4 → 1.6 s, whole 8.3 s.
- The large giant, 2048 px: unwrap 33.8 → 3.1 s, whole 20.1 s (bake 10.1 s, encode 4.5 s).
- Both phase exit criteria hold for these two minis: 8.3 s against 15 s, 20.1 s against 3 minutes.

PR #62 wrote these laptop figures into both specs and closed #35, the device measurements carried over from Phase 0. No cap or budget had to change: 100 baked minis still run at 60 fps on the reference laptop and the phone.

## Still open

- Straight slabs scatter the cut across a flat base; invisible in the bake. A shape-following cut stays out of scope until painting arrives.
- Equal triangle counts are not equal work, hence the 8.5 s outliers; within target.
- The largest file still takes 114 s, 70 s of it before the unwrap (weld, simplify, shade).
- The 8,000-triangle threshold is a judgement call left to the PM.
- The largest file (281 MB) has not been converted on the reference laptop, so the exit criterion "the largest corpus mini in 3 minutes or less" stays open there; whether it fits the laptop's memory belongs to #43.
- Thermal throttling over a long session was never measured. It was never one of #35's criteria; the Phase 0 spec now says so.

## Story angle

Turning a spike into production code mostly meant deleting it: 1,179 lines out, 301 in, and the slowest unwrap 20 times faster. Title idea: "The best spike code is the code you remove".
