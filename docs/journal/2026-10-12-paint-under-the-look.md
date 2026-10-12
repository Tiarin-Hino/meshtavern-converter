---
title: A paint under the look
date: 2026-10-12
phase: 2
issues: [125]
prs: [129]
topics: [look, textures, testing]
---

## What we did

A baked mini can now be drawn with a colour texture, a paint, under its look: where it is painted the paint replaces the grey base coat, and the wash still darkens the creases and the edges still catch the light on top of it. The far and close levels, which have no texture coordinates, take the same paint as one colour per vertex, sampled once. The thumbnail can show the paint. Each mini can have its own look. The converter page does not change: it paints nothing and shares one look, as before.

## Why

Painting is part of the table application's plans (its spec 10). The table paints, the converter has to draw it. The baked material computed the look from the detail texture (normal and cavity) and had no colour of its own, the look's two uniforms were described as shared by every mini, and only the table level carries texture coordinates (`TEXCOORD_0`, #109).

## How

- **One rule, in two places.** `pointColour` in `src/lib/pipeline/look.ts` gained an optional paint (linear RGB and alpha) and `paintedBase`, the coat under the look: `base + (paint - base) × alpha`. The baked material's GLSL does the same with `mix(uBase, paint.rgb, paint.a)` and then runs the unchanged look on that coat. Without a paint the arithmetic is the same as before, bit for bit (`base + 0`), so the GLB colours and the regression baseline did not move.
- **Alpha between 0 and 1 mixes.** The issue says the paint replaces the base coat where its alpha is above zero. A texture's alpha is filtered, so at a painted area's edge it is 0.5 or 0.2. A hard "above zero" there would put the full paint colour on the edge, and that colour has been filtered with the bare texels' black, so the edge would get a dark rim. Mixing by alpha gives exactly the issue's rule at 0 and 1 and a soft edge in between. The PM kept the mix (PM decision, 2026-10-12, on PR #129).
- **The look is per material.** It already was in three.js: a material asks `onBeforeCompile` for its uniforms once per program it compiles, and it keeps its own list even when the program is shared with other materials (`WebGLRenderer.getProgram`, three.js 0.186). So a mini with its own `createLookUniforms` set has its own look, and passing one set to every material keeps the page's "change one, change all". `baked-material.test.ts` proves both with three.js's own standard shaders. A painted material compiles a second program (`meshtavern-baked-painted`): two programs in all, not one per mini.
- **Per-vertex paint through the closest point.** The issue offered "nearest vertex" or "shared vertex order". Neither holds well: the close level has more vertices than the table level, and the unwrap splits vertices at seams. `paintAtVertices` (`src/lib/pipeline/paint.ts`) instead takes, for each vertex, the closest point on the table level's surface with the search tree the bake already uses (`TriangleBvh`), facing the vertex's way, within `PAINT_REACH_MM` = 1 mm _(proposal)_, and reads the texel under that point's texture coordinates. It reads one texel, no blend, so the bare gutter around an island never mixes in. The point is moved one texel toward its triangle's middle, so a vertex on an island's corner reads its own island.
- **A test brush.** `paintWhere` (dev.ts) paints a texture on the table level's islands where a condition on the surface point holds. The unit test paints the generated figure's +x half red and checks every vertex more than 0.5 mm from the line, on the far and close levels: red on that side, bare on the other.
- **The thumbnail** takes `albedo` and passes it as the material's `map`; asked for a paint without the detail texture it refuses (`RangeError`), because the per-vertex mesh has no texture coordinates to put it on. The pixel test (`e2e/thumbnail.spec.ts`) draws the generated figure four times: bare, the +x half painted, the -x half, all of it. Each half's changes must not overlap the other's except on the line where they meet (both halves seen within 4 px), and together they must be the "all of it" change.

## Problems and how we solved them

- **1.5 % of the vertices came out bare on the painted side.** **Cause:** the test brush painted only texels whose centre lies inside a triangle, and xatlas makes some slivers that cover no texel centre; the vertex then reads an empty texel. **Fix:** the brush paints with the bake's half-texel slack (a texel inside a triangle is never taken by a neighbour) and spreads each island two texels outward. 0 bare vertices on the three levels at 512².
- **Specks where both half-paints changed the picture.** At 256 px, and fewer at 512, single pixels inside a half changed under the other half's paint too. **Cause:** mipmaps. The smaller mip levels average neighbouring islands of the atlas, and an island from the other half is often packed next to one from this half. **Fix:** the test hook's paint has no mipmaps. Pixels changed by both halves away from their line went from 353 (0.49 % of the mini) to 27 (0.04 %). A table that paints with mipmaps has to spread each island's colour past its edge, as the bake does with the detail texture (README).

- **The brush and the bake share their code (the follow-up PR).** The first brush copied the bake's texel walk and its spreading. The automatic review pointed out that the two copies would drift, and the PM asked for a separate PR. `bake.ts` now exports `forEachIslandTexel` (every texel of the islands, with the triangle and its weights at the texel's centre), `dilate` (with the number of rings as a parameter) and `MIN_NORMAL_AGREEMENT`; `bake` and `paintWhere` both use them. The bake's output did not change: the detail texture of the generated figure has the same SHA-256 at 256² and 1024², with the same coverage. Two bare vertices came back on the tip of a thin sliver: the bake's spreading reaches the four neighbours a ring, the old brush reached eight. Three rings instead of two put them back (0 bare vertices again).

## Dead ends

- **Spreading the test paint four texels, as the bake does.** It made the specks worse (507 pixels instead of 353): islands packed close together overwrite each other's spread.

## Numbers

- Unit tests (`paint.test.ts`, whole conversion of the generated figure with a 256² bake): about 5 s, cloud container, Node 22.
- Pixel test (512 px thumbnail, a 1024² paint without mipmaps, software rendering in Chromium, cloud container): 72,596 pixels of mini; 51,773 changed by the +x paint only, 21,500 by the -x paint only, 446 by both, 27 of those away from the line; the paint all over changed 73,721.

- Bake after the shared walk (the generated figure's table level at 1024², 7 runs each, two rounds, cloud container, Node 22): median 1482 and 1457 ms, against 1376 and 1439 ms before. The runs of one round spread over 300 ms, so 1–8 % slower is within the noise; the bake now calls a function per texel.
- Pixel test after the shared walk (three rings): 439 pixels changed by both halves (446 before), 27 of them away from the line (27).

## Still open

- The GLSL and `pointColour` are compared in the tests by their rule (`look.test.ts`) and by the paint's shader text (`baked-material.test.ts`), not by running the shader against `pointColour`.
- A table that paints with mipmaps needs to spread each island's paint, or to blend the seams; the converter does not do it for the table.

## Story angle

"Primer, then paint": how a paint texture sits under a shader-made wash and drybrush, and why a texture atlas makes speckles at small sizes.
