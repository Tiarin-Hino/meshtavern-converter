---
title: The unwrap spike - smaller pieces, not more threads
date: 2026-09-21
phase: 1
issues: [34, 35]
prs: [56, 58, 59]
topics: [unwrap, performance, planning, devices]
---

## What we did

The unwrap, which lays a mini's surface flat into islands on a texture, took up to a minute and a half for large minis. The PM moved the fix into Phase 1 as a time-boxed spike (an experiment that decides, not ships). Cutting the table level into 8 slabs, handed to xatlas as 8 meshes of one atlas, turned 7.5 to 85.6 s into 2.3 to 4.7 s. The PM confirmed it on the reference laptop; #57 built it.

## Why

Two corpus runs on 2026-09-21, after baking became the default (figures on #34), put the unwrap at 52 % of all conversion time (bake 25 %, simplify 11 %, encode 9 %). None of the 16 minis with a 2048 px texture converted within 15 s. Forcing 1024 px did not shorten the unwrap: the time goes into finding islands, the same work at any texture size. So the plan to wait for the laptop measurement (see 2026-09-20-phase-1-spec.md) was dropped.

PR #56 added story 9 to the [spec](../specs/phase-1-converter.md). Merging it confirmed the agent's proposals: every corpus mini except the largest file unwraps in 15 s or less on the development PC with no sheet looking worse (more seams count as worse, since texture coordinates carry painting later); three days; and an "ordinary mini" is a single figure on a base up to 32 mm.

## How

The issue named three variants: (a) split into connected parts, unwrap them in several workers, pack once; (b) cheaper island finding through xatlas's chart options; (c) both. Threads inside one WebAssembly module were ruled out: they need response headers GitHub Pages cannot send. The spike ran on `xatlas-wasm` 0.1.3 behind a development option, `?unwrap=`, with a Node sweep and a real-Chrome measurement.

The finding: **xatlas's time grows roughly with the square of the mesh it is given**; half the mesh takes about a quarter of the time. Parallel work was never the lever; smaller pieces are. The mesh is cut across its longest side into slabs of equal triangle count and passed as separate meshes of one atlas: xatlas finds islands per mesh and packs once. One thread, no workers, about 60 lines.

## Problems and how we solved them

- **Problem.** Variant (a) as written gained nothing. **Cause:** 27 of 30 corpus table levels are one connected piece, swarms included (they stand on one base). **Fix:** cut slabs instead; every cut becomes a seam.
- **Problem.** An early Chrome run was up to twice as slow. **Cause:** the machine; untouched steps (weld, simplify, shade) moved too. **Fix:** repeated; that run is used only as ratios.
- **Problem.** The laptop run of 2026-09-22 was at half speed. **Cause:** battery. **Fix:** repeated on the power cord.
- **Problem.** On a flat base the slab boundary scatters, as many triangles share one height. Invisible in the bake; noted on #57.

## Dead ends

- **Workers** (a): 0.1 s faster to 0.9 s slower than one atlas, at five times the memory (144 MB with eight). The second packing pass cost 1.8 s and about 3 points of texture use.
- **Chart options** (b): none faster beyond noise; two were 1.4 to 2.5 times slower. (c) was no better than slabs alone.
- **16 slabs:** one more second saved at about twice the seam cost.

## Numbers

**Development PC**, Chrome 153, window in front, fresh page per conversion, nine minis:

- Unwrap, today → 8 slabs: a swarm of many small creatures 85.6 → 4.7 s; a large giant 49.5 → 4.0 s; ordinary minis 7.5 to 12.3 → 2.3 to 3.0 s.
- Whole conversion: 62 to 110 s → 23 to 40 s for large minis; 15.5 to 19.6 → 9.4 to 10.8 s for ordinary ones.
- Islands +6 to +26 %, seam length +5 to +12 %, texture use within a point; unwrapper memory 19 to 34 MB before, 16 to 28 MB after.
- All 30 minis, Node, one core: 0.7 to 9.2 s, median 3.5 s.

**Reference laptop**, on the power cord, PM, 2026-09-23 (#59):

- The smooth goblin sculpt (1.25M triangles, 1024 px): unwrap 2.4 → 1.7 s, whole 9.0 → 8.3 s.
- The large giant (2048 px): unwrap 33.8 → 3.2 s, whole 54.4 → 20.5 s. This was also the run #35 still owed: 54 s before slabs, far under the 3-minute criterion.

## Still open

- One of three days used. About 1,000 lines of development-only code were merged so the laptop could run the slab variant; #57 removed them.
- With slabs, bake and encode are the longest steps of a large mini: at 2048 px the bake takes 11 to 17 s on the development PC and 10 s on the reference laptop.
- Not studied: why xatlas is quadratic (#33), a shape-following cut, whether cuts show when painted.
- The merge of `main` into #56's branch restored a risk line #55 had narrowed (see 2026-09-21-messy-files-scope.md).

## Story angle

We went looking for parallelism and found a quadratic algorithm. Title idea: "Cut it into eight".

Later: see 2026-09-23-slab-unwrap.md
