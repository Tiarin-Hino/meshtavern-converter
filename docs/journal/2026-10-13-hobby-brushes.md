---
title: The hobby brushes
date: 2026-10-13
phase: 2
issues: [128]
prs: [132]
topics: [look, textures, testing, performance]
---

## What we did

The painting engine of #127 has the brushes a mini painter reaches for: a **wash** that runs into the creases and leaves the raised surface nearly bare, an **ink** that stains everything it covers and the creases most, a **dry brush** that catches only the raised edges, and an **airbrush** that sprays softly, builds up over passes and, with a direction, reaches only the surfaces that face it: sprayed from above, a zenithal highlight in one pass. Each stroke is one undo step, as before. The page still does not offer painting; the team's `?dev` Paint tool shows each brush's own sliders and the airbrush's direction.

## Why

The table application (Phase 2) paints minis the way people paint real ones, and those brushes are what make a mini look painted rather than coloured in. The engine already holds what they need: the bake's detail texture has every texel's cavity (crease or edge) and its surface normal, and the table level carries how buried each point is (occlusion). Design note `docs/design/painting-engine.md` §6 fixed the four masks; this is its step 11.

## How

- **A mask per brush, read from the surface.** Every brush paints through the same passes; what differs is how much of its colour a texel takes. The wash takes a faint 15 % on flat, open surface, more where the cavity is negative or the occlusion low, and sheds 80 % on a raised edge. The ink takes half on flat and all in a crease. The dry brush takes nothing below a cavity threshold that its pressure lowers, so more pressure reaches further down an edge. The airbrush's direction mask compares the surface normal with the direction. The numbers are named constants beside the look's in `look.ts`, all proposals for the PM.
- **The shader and its twin cannot drift.** Each mask is GLSL text in `src/lib/painting/tools.ts` and a function `toolMask` in `src/lib/pipeline/brush.ts`. The unit test turns the GLSL into JavaScript (`float` becomes `let`, the five GLSL functions it uses are given) and compares the two over a grid of cavities, occlusions, normals, pressures and directions.
- **The airbrush adds.** The other brushes keep the largest coverage a texel has had in the stroke, so going over a spot again does not darken it. The airbrush adds every dab's share instead. Two things make that exact. Each dab adds a whole number of 1/255 steps, so sums in any grouping are the same bytes: the live stroke draws a few dabs a frame, an undo replays them all at once, and both give the same paint. And a stencil lets one fragment per texel add in each draw, because a texel on an island's edge is reached by both a triangle and an edge line, and would otherwise count twice.
- **Pixel tests that separate reach from mask.** Where a stroke lands is #127's and tested there. Each brush test paints its stroke twice on the bare generated figure: first with the flat brush at full opacity, which records how far the stroke reached every texel, then with the brush under test. A read-back of what the masks see at every texel (`view.surface()`, for tests) gives the cavity, occlusion and normal, and every texel must hold reach × opacity × `toolMask` within the rounding. On top, the issue's lines: the dry brush changes not a byte in a crease, the wash keeps the disc's rim under a tenth of a coat and darkens the creases more than any edge, the ink stains every reached texel, and an airbrush from above changes no texel whose normal faces down, then builds up on a second pass.

## Problems and how we solved them

- **The airbrush sprayed by the pointer's sample rate.** A first pass saturated where it should have laid about a third of a coat. **Cause:** dabs are laid every quarter brush width, but a pointer sample closer than that is a dab itself; for brushes that keep the largest coverage that costs nothing, for one that adds it means more paint the faster the pointer reports. **Fix:** an adding brush lays its dabs exactly a spacing apart and nothing while the pointer is nearer than one (`spaceDabs(…, even)`); the stroke may end short of the last sample by less than a spacing.
- **A second airbrush pass painted surfaces facing down.** The first pass left them bare; after the second, 563 texels had paint. **Cause:** the composite pass reads the detail texture after returning early for untouched texels, and a texture read there takes its mip level from derivatives that the shading language leaves undefined in such code. Which neighbours the stroke covered changed the normal a texel read. **Fix:** the read names level 0 (`textureLod`). The flat brush, the fill and the eraser never looked at the value, which is why #127 did not see it.
- **The first pixel tests failed on four texels of 1,461.** Under the brush's core, in sight and facing the camera, yet bare, with the flat brush too. **Cause:** the stroke's depth map, one pixel per screen pixel, holds a nearer surface there (near the junction of the body and the disc), so the depth test of #127 skips them. That is the engine's reach, not a mask; the tests now take the reach from the flat brush's stroke instead of guessing it from distances.

## Dead ends

- Guessing each texel's coverage in the test from its distance to the dabs, with filters for facing and for island borders. Every filter let through a texel the engine treats otherwise; measuring the reach with the flat brush replaced them all.

## Numbers

Development PC: i7-11700F, RTX 3060 (ANGLE, Direct3D 11), Windows 11, Chrome, a 165 Hz display, window in front, 1,920 × 1,080 viewport, `scripts/measure-painting.mjs` (which now strokes with every brush). Each brush three strokes of 120 pointer samples across the whole canvas at 16 mm, one sample a frame; the airbrush sprayed from above.

| Mini                                                       | `open` | Every brush at 16 mm, between frames: median, worst | Counter (`state.perf`): median, worst | GPU process, view open − closed |
| ---------------------------------------------------------- | -----: | --------------------------------------------------: | ------------------------------------: | ------------------------------: |
| Generated figure (35,012 triangles, 1,024 px detail)       | 382 ms |                                      6.1 ms, 6.7 ms |            0.1–0.2 ms, 0.8 ms, 0 slow |                          126 MB |
| large-01 with its base (59,954 triangles, 2,048 px detail) | 575 ms |                                      6.1 ms, 6.5 ms |                0.1 ms, 1.3 ms, 0 slow |                          125 MB |

Every frame of every brush came at the display's 6.1 ms, as the flat brush's did in #127: the frame-rate criterion holds on this PC. The stencil adds 4 MB to the stroke layer; the README's table says so.

Tests, software rendering in Chromium (as CI): the full e2e suite on two workers, 72 tests in 13.6 minutes, the painting spec 5.8 of them. On the default number of workers on the development PC the suite timed out in 14 tests of other files (conversions in software rendering starving each other); alone and on two workers they pass. Unit tests: 638.

## Still open

- The masks are proposals to judge by eye on the corpus in the `?dev` Paint tool; their constants are the PM's.
- The reference laptop's numbers, for #127's brushes and these.
- Screenshots of each brush on the generated figure: `docs/design/hobby-brushes-*.png` (bare, wash, ink, dry, airbrush from above).

## Story angle

"A wash that knows where the creases are": how the maps a converter bakes for lighting become the brushes of a painting app, and why an airbrush in a shader has to count in whole steps.
