---
title: The painting engine
date: 2026-10-13
phase: 2
issues: [126, 127]
prs: [131]
topics: [look, textures, ui, performance, testing]
---

## What we did

The library can now paint. A fifth entry, `meshtavern-converter/painting`, mounts a 3D view into an element of the consumer's: a baked mini, drawn as the table draws it, on which a person paints with the left button, a pen or one finger. The strokes are written into a 1,024 px colour texture over the mini's unwrap, the paint of #125, and come back as pixels. This build has the flat brush, the fill (a tap fills up to a fold or a crease; "the base" and "the figure" fill in one tap where the converter found a base) and the eraser, with undo and redo at least 50 steps back. The page does not offer painting; under `?dev` a plain Paint tool mounts the view for the team's tests and for judging the brushes. The hobby brushes (wash, ink, dry brush, airbrush) are #128.

## Why

The table application (Phase 2) paints minis. The engine has to know the bake's maps and conventions, so it belongs beside `look.ts` and `baked-material.ts`, as the question view does since #119. The work started with a design pass on Fable 5.1 (`docs/design/painting-engine.md`, #126, the first commit of PR #131) and was built on Opus 5.5 in the same PR, in the note's steps.

## How

- **A stroke lands in texture space.** Once per frame the table level is drawn with its texture coordinates as positions, so every fragment is a texel of the paint and knows its point on the surface. It is painted when that point lies within the sphere of a dab (the brush's size in mm, the same at every zoom), was in sight of the camera the stroke started from (a depth map rendered once per stroke, `DEPTH_BIAS_MM` = 0.25) and faces it (`FACING_MIN_COS` = 0.15). The stroke layer keeps the largest coverage so far, so a stroke crossing itself does not darken. The alternatives in the note were a draw per dab (cost grows with the dabs) and painting in screen space (cheap, but a pixel's texels are a blob at grazing angles and the size changes with the zoom).
- **No seam.** Two things fill the edge of every island. The triangles' edges are drawn as lines too, so a texel whose centre lies just outside an island (the rasteriser skips it) is still painted. And every gutter texel within two rings of an island takes the colour of an island texel (the owner map, computed once on the CPU at `open`: ring 1 takes a neighbour inside an island before one on its border, ring 2 a ring-1 texel's owner, so nothing copies a copy).
- **Composite and dilation in one pass.** The note had a composite pass and a dilate pass. A texel's composite depends only on that texel's inputs (paint, coverage, detail texture, occlusion), so evaluating it at the texel's owner gives the dilated result directly. One full-screen pass instead of two, and no scratch target.
- **Copies, not a swap.** The note said a commit swaps `live` and `paint`. The material holds `live`'s texture object, so after a swap it would show the wrong one. Instead a commit copies `live` into `paint` with `copyTextureToTexture`, which between two render targets is a `copyTexSubImage2D`: a byte copy, no sRGB round trip. A cancel, a keyframe and a restore are the same copy. The paint comes in by the same call from a `DataTexture` (a `texSubImage2D` of the bytes) and goes out by `readRenderTargetPixelsAsync`: a paint opened and read back is the same bytes. Untouched texels in the composite are passed through without arithmetic, so the sRGB decode and encode give them back exactly.
- **Strokes are data, undo is replay.** A stroke is its tool, colour, brush, the camera it was painted from (with the drawing buffer's size) and its dabs as points on the surface; a fill is its seed and its brush. Undo restores the nearest keyframe (one every 10 steps, plus the paint as opened) and replays the steps since; at most six keyframes, 24 MB. A replayed stroke renders its depth map from its own camera and draws all its dabs at once. The live stroke drew them a few per frame, but the largest coverage over dabs does not depend on the order, so the result is the same bytes. `history.ts` is the schedule over four operations, tested in Node on a fake paint; the e2e test checks undo and redo against the live bytes.
- **The fill** floods the table level's triangles across shared edges. The unwrap splits vertices at its seams, so edges are matched by their corners' positions (bit for bit, as the unwrap copies them). An edge stops the flood when its faces meet at more than 40° or both its corners' cavity is below −0.1, both loosened by the tolerance. **The ready regions** (`regionsOf`) come from what the conversion knows: the base file of a pair (table-level triangles within 1 mm of it, facing its way), the plain base the converter added (everything at or below its height), or a base in the file whose top the kind guess saw (the up-facing height band with the most area).
- **Input** is the question view's rule with the brush always on: the left button, a pen's tip and one finger paint; the right button and two fingers turn the mini; the middle button pans; `setNavigating(true)` gives one finger to turning. A second finger during a finger's stroke cancels the stroke. The cursor is a ring as wide as the brush at the surface under the pointer.
- **One camera function.** The viewer, the question scene and the painting scene all put the camera on a sphere the same way; the third copy became `placeCameraOnSphere` in `src/lib/three/camera.ts`, in a commit of its own. The maths did not change; the full e2e run after it passed, 57 of 57.

## Problems and how we solved them

- **The fill's tolerance tightened the crease bound.** The note scaled it by `(1 − tolerance)`: −0.1 at tolerance 0, 0 at 1, so a loose fill would stop at every slightly concave edge. That contradicts the note's own "0 strict … 1 loose" and its test. Built as `(1 + tolerance)`, the same way round as the angle bound; asked on the PR.
- **The fill test's "disc" caught the figure's foot.** A flood on the chest seemed to reach the base. **Cause:** the body's buried foot reaches 2.1 mm from the middle below the disc's top, and the test called everything below 3 mm and 2 mm out "the disc". **Fix:** the test's disc starts 3 mm out. The flood was right: figure and base are separate shells.
- **The seam test passed without the dilation.** Probing half a texel and one texel past an island's edge, it passed with `PAINT_DILATION_RINGS = 0` too: those texels are the border texels the edge lines stamp. Measured on both sides of a seam on the generated figure: with two rings the paint reaches 2 texels past the edge and not 2.5; with none, 1. The test now probes ½, 1, 1.5 and 2 texels; with no rings it fails on 1.5 and 2, and with the edge lines switched off it fails on one island's ½-texel texel. So the test fails without either part.
- **The plate stood on its edge, in inches.** The "behind the surface" test converts a bare 30 mm plate 2 mm thick. Without a base, the up detection took the tallest axis, and 2 mm tall it was guessed to be in inches (50.8 mm). The test sets up `+z` and millimetres through the page's hooks, as a person would.
- **Two of 81 rays slipped through the plate.** Sample points on the plate's 1 mm grid lay exactly on triangle edges. Moved a quarter millimetre off.
- **The second finger hit a button.** On the phone layout the page's level buttons lie over the foot of the canvas, and the test's second finger landed there, so no second pointer reached the canvas. The finger goes above the first now.
- **A close during `open` let the mini in anyway.** Found in review (GPT Astra): while `open` waited for the atlas's read-back nothing was open yet, so `close` did nothing, and the read-back's continuation installed the mini and started drawing; a second `open` in that wait shared the passes with the first. **Fix:** opens run one after another, `close` and `dispose` count up a generation, and an open that is no longer the latest drops its geometry and texture copy after the read-back; the passes stop preparing when they were closed meanwhile. E2e: `stays closed when closed while it opens, and the later of two opens wins`. Its first version closed the view in the same task as the open, so the open was dropped before it reached the GPU and the read-back path never ran (both reviewers, round 2). The test now holds WebGL's `clientWaitSync`, which three.js polls during `readRenderTargetPixelsAsync`, waits until an open is stuck there, then closes or opens again and lets go. With the check after the read-back removed, the test fails.
- **The automatic review failed on the auto-fix's push.** The fix job pushes as `claude[bot]`, and `claude-code-action` refuses a run started by a bot unless it is allowed. `claude-code-review.yml` now allows `claude`.
- **Two Playwright runs, one server.** A test run started while the full suite was running reused its preview server, built before the newest code. Lesson: never run a second Playwright command while one is running.

## Dead ends

- None built and dropped. The swap of the note was replaced by a copy before it was written (above).

## Numbers

Development PC: i7-11700F, RTX 3060 (ANGLE, Direct3D 11), 64 GB, Windows 11, Chrome, a 165 Hz display, window in front, 1,920 × 1,080 viewport, `scripts/measure-painting.mjs`. Each brush size three strokes of 120 pointer samples across the whole canvas, one sample a frame.

| Mini                                                             | `open` | Brush 16 mm, between frames: median, worst | Brush 2 mm, between frames | Counter (`state.perf`): median, worst | GPU process, view open − closed |
| ---------------------------------------------------------------- | -----: | -----------------------------------------: | -------------------------: | ------------------------------------: | ------------------------------: |
| Generated figure (table level 35,012 triangles, 1,024 px detail) | 308 ms |                             6.1 ms, 6.3 ms |             6.1 ms, 6.4 ms |                0.1 ms, 0.5 ms, 0 slow |                          111 MB |
| large-01 with its base (59,954 triangles, 2,048 px detail)       | 493 ms |                             6.1 ms, 6.3 ms |             6.1 ms, 6.3 ms |                0.1 ms, 0.5 ms, 0 slow |                          130 MB |

Every frame came at the display's 6.1 ms: no frame was missed while painting. The counter's 0.1 ms is the CPU's part only: WebGL calls return before the GPU does the work, so the counter the note specified cannot see a GPU that falls behind. The script measures the time between frames as well; the PR asks whether the counter should report it too. The page's process grew by 40–50 MB with the view open (the owner map, the readbacks, the search tree and the adjacency).

The GPU memory is above the note's estimate of about 32 MB plus a context's 40 MB (#119): the view's own antialiased canvas at 1,920 × 1,080 with its depth buffer is most of the difference.

The reference laptop (Intel Iris Xe) is not measured yet: the frame-rate criterion of #127 needs `node scripts/measure-painting.mjs` run there (after `npm run build`).

Tests, software rendering in Chromium (as CI): `e2e/painting.spec.ts`, 13 tests, about 4 min on one worker. Unit tests: 630, `npm run check` about 3 min.

## Still open

- The laptop's numbers (above) and the counter question.
- A fast stroke with a small brush on a large mini breaks where the straight line between two pointer samples leaves the surface (a gap between a wing and the body, a curved feather): the dabs are laid on the chord, and the sphere does not reach the surface. Real pointers send samples a few pixels apart, the harness's samples are 16 px apart; seen on large-01 with a 1.5 mm brush.
- The hobby brushes, #128.

## Story angle

"Painting in texture space": how a brush stroke on a 3D mini finds its texels without painting through the model, and why the seams of a texture atlas need a map of who owns each empty texel.
