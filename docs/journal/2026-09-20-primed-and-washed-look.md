---
title: A primed-and-washed look from per-vertex occlusion and cavity
date: 2026-09-20
phase: 0
issues: [9]
prs: [26]
topics: [look, performance]
---

## What we did

A converted mini no longer shows up as flat grey plastic. It now looks like a primed mini that has had a wash: recesses are darker, raised edges are lighter, and there is a soft shadow where the figure meets its base. A "Look" panel lets you switch the effect off, pick the base coat colour and move sliders for shadows, wash and edges; changes show instantly.

## Why

This is "Variant A" of the Phase 0 spike (`docs/specs/phase-0-spike.md`, issue #9): a grey mini must read well at table distance without any textures. It is the release baseline look, and later became the far level's look and the fallback wherever textures do not fit.

## How

A new pipeline step, `shade` (`src/pipeline/shade.ts`), runs in the Web Worker on the close level. The table and far levels are built from that level's vertices, so they inherit its numbers. Two numbers are stored per vertex, as plain numbers rather than colours, so the look can be re-tinted without converting again:

- **Occlusion**: how buried a vertex is, from 0 (buried) to 1 (open). The mesh is rasterised into a voxel grid whose longest side is 160 voxels (160³ bytes, 4 MB). From each vertex, 32 short rays are marched through the grid, spread over the hemisphere around the normal and weighted towards it the way diffuse light is. Rays reach 15 % of the mini's largest dimension and start 1.6 voxels above the surface so a vertex does not block itself. Everything below the mini's lowest point counts as solid: that is the "table", and it gives the contact shadow at the base.
- **Cavity**: signed curvature from -1 to 1. It is the average angle by which a vertex's neighbours drop below or rise above its tangent plane, smoothed over two neighbour passes. Creases come out negative (where a wash pools), edges positive (where a drybrush catches).

Occlusion is coarse on purpose: with voxels of about 0.2 to 0.5 mm it catches large-scale shadowing such as under arms or inside cloaks. Fine creases are the cavity term's job. The whole step costs one 4 MB grid plus 8 bytes per vertex.

`src/pipeline/look.ts` turns the two numbers into vertex colours: base coat, darkened by occlusion and creases, lightened on edges. It deliberately has no dependency on three.js, so the GLB export that came next (see the GLB export entry) could reuse it. Because the slider changes only recompute colours, never the conversion, the panel is instant. The defaults recorded in the spec are shadows 0.75, wash 0.6, edges 0.45 and base coat #9aa0a8.

Building the remaining detail levels became its own timed step, so the timings row now reads read / weld / orient / simplify / shade / levels. `scripts/compare-look.mjs` renders before-and-after images for every mini in the local test corpus.

## Problems and how we solved them

- **Problem.** Per-vertex data cannot be sharper than the mesh it sits on. On the far level (4k to 20k triangles), the wash looks blotchy in close-up. **Cause:** a vertex colour is spread across whole triangles, and at that level the triangles are large. **Fix:** none at this level; the defaults were kept moderate, and baked detail maps (issue #10, see the unwrap-and-bake entry) were named as the real fix.
- **Problem.** The "Full" level (the unreduced sculpt) shows a flat base coat. **Cause:** shading is computed only on the close level and inherited downwards. **Fix:** accepted as a limit; the full sculpt is for inspection, not play.

## Numbers

Shade step, Chrome 153, development PC, one run per mini:

| Mini                                  | Close-level vertices | Shade step |
| ------------------------------------- | -------------------- | ---------- |
| Large detailed giant, 77 mm           | 99,768               | 859 ms     |
| 554k-triangle mini                    | 32,926               | 542 ms     |
| Smooth goblin sculpt, 1.25M triangles | 24,938               | 364 ms     |
| Detailed 48 mm figure                 | 46,902               | 358 ms     |
| 546k-triangle mini                    | 24,963               | 160 ms     |

Memory: 4 MB for the grid plus 8 bytes per vertex. Test suite at merge: 58 unit tests and 5 end-to-end tests.

## Still open

- The visual call on the look was left to the PM (`needs-human` on the PR). Before-and-after sheets were sent to the PM and not committed, because the minis are the PM's own or licensed.
- The close-up weakness of per-vertex data led straight into the baked detail maps spike (#10).

## Story angle

How to make a grey mesh look painted without a single texture: voxel occlusion plus curvature, computed once and re-tinted for free. Possible title: "Priming a mini in a Web Worker".
