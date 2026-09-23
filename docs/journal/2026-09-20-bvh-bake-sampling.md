---
title: Bake through a BVH, and a warmed-up unwrap
date: 2026-09-20
phase: 0
issues: [29, 31]
prs: [32]
topics: [bake, unwrap, performance, workflow]
---

## What we did

Baked detail maps now sample the sculpt's actual surface instead of its nearest vertices. The blotchy, noisy patches on densely detailed sculpts, such as a giant's beard, are gone. Unwrapping the largest test mini got more than twice as fast, and the progress line now shows how far the unwrap has got.

## Why

After the PM decided that baked maps ship on all minis (see the unwrap-and-bake spike entry), two release blockers came first: #29, because nearest-vertex sampling made dense sculpts look worse baked than unbaked, and #31, because the unwrap took over two minutes on the large giant. One PR covered both because the work overlapped: testing the sampling on the giant needed the faster unwrap.

## How

**Sampling (#29).** `src/pipeline/bvh.ts` builds a bounding volume hierarchy (BVH): a tree of nested boxes over the sculpt's triangles, so a query only visits the few triangles near a point. Triangles are sorted along a Morton curve, a standard way to build such a tree quickly. The query returns the closest point on a triangle and supports a distance limit, a facing test (the inside of a cloak must not answer for its outside) and a hint triangle to start from. `bake.ts` then interpolates normal and cavity across the triangle that was hit, and each texel's search starts from the previous texel's answer, which prunes most of the tree. Seven unit tests check it against a brute-force search.

**Unwrap (#31).** Three changes in `src/pipeline/unwrap.ts`:

- **Warm-up.** A fresh WebAssembly instance ran its first unwrap two to three times slower than later ones. The cause is unknown; growing the WebAssembly heap up front did not help, but a real small unwrap did. So a throwaway unwrap of a small generated mesh (0.6 s) now takes the penalty instead of the user's mini.
- **`maxCost` 8** instead of xatlas's default 2. It lets islands grow larger before a new one starts: about 40 % faster, slightly fewer islands, no visible difference. Higher values changed nothing.
- **Progress.** xatlas's progress callback feeds the progress line ("unwrap… 75% (40% of this step)").

## Problems and how we solved them

- **Problem.** The spec had lost three sections: GLB export, stress scene and reference hardware. **Cause:** in #28, the agent recorded the PM's go decision with a scripted string edit that replaced one paragraph and dropped everything after it. It went unnoticed and was merged with #28. **Fix:** restored in this PR, checked with `diff` to be identical to the text before #28. From then on, every PR that edits docs by script compares the headings before and after, and says so in its checklist (#37, #39 and #48 do).
- **Problem.** Exact sampling is slower. **Cause:** a tree search per texel instead of a hash lookup. **Fix:** accepted; the hint from the previous texel keeps it at about three times the old cost.

## Dead ends

- **Other xatlas settings.** Limits on island area or border length made the unwrap slower; a higher normal-deviation weight made it eight times slower.
- **Unwrapping a lower level and transferring the coordinates** does not work: the island borders of a coarse mesh do not follow the edges of a finer one, so triangles would straddle seams.
- **Parallel workers per connected part** were assessed but not built: xatlas in WebAssembly is single-threaded, so this could help multi-part sculpts on multi-core machines. Filed as a later spike (#34).

## Numbers

Chrome 153, development PC:

| Mini                  | Table triangles | UV islands | Unwrap           | Bake 2K | Bake 1K | Whole conversion 2K / 1K |
| --------------------- | --------------- | ---------- | ---------------- | ------- | ------- | ------------------------ |
| Large detailed giant  | 59,974          | 6,457      | 61 s (was 132 s) | 17.5 s  | 6.0 s   | 84 s / 67 s              |
| Detailed 48 mm figure | 49,636          | 3,431      | 21 s (was 23 s)  | 18.8 s  | 7.0 s   | 48 s / 32 s              |
| 554k-triangle mini    | 32,054          | 996        | 5.2 s            | 13.5 s  | 4.0 s   | 21 s / 10 s              |
| Smooth goblin sculpt  | 22,632          | 1,162      | 4.0 s            | 16.3 s  | 5.5 s   | 24 s / 12 s              |
| 546k-triangle mini    | 18,686          | 1,774      | 5.0 s            | 15.7 s  | 4.3 s   | 22 s / 10 s              |

- Cold against warm unwrap of the giant, same settings, in Node on the development PC: 111 s against 40 s.
- BVH build: about 0.2 s, 13 to 33 MB.
- Bake at 2K: 14 to 19 s with exact sampling, against 4 to 6 s with nearest vertices.
- Tests at merge: 81 unit, 7 end-to-end.

Visually: on all five corpus minis, the baked table level is at least as good as the per-vertex look at the closest view, including the giant's beard. The final visual call was left to the PM.

## Still open

- #31 was closed after this PR, and what it still asked for moved to its own issues: the measurement on a weak device (none existed yet) to #35, and the xatlas dependency to #33, where the PM decided to build xatlas from source before release.
- One minute for the giant's unwrap was still long; parallel unwrapping became its own spike, #34.
- Texture memory (#30) was untouched by this PR and remained the biggest open problem; see the texture memory entry.

## Story angle

A BVH turns a blotchy beard into clean detail, and a 0.6-second throwaway job plus one setting halve a two-minute wait. Plus the day a script quietly deleted three sections of a spec. Possible title: "Warm up your WebAssembly".
