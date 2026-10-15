---
title: A brush reaches only as deep as a real one
date: 2026-10-15
phase: 2
issues: [134]
prs: []
topics: [look, textures, testing]
---

## What we did

A brush stroke no longer paints a surface that is in sight but lies well behind the spot under the brush. Painting a hand held in front of the body, a big brush used to put paint on the chest behind it, wherever the chest showed past the hand's edge and lay within the brush's size. Now the brush reaches 1.5 mm behind the spot it touches, as a real brush does, and keeps its full width sideways. This holds for the flat brush, the eraser and the hobby brushes. The fill is not a stroke and is unchanged.

## Why

PM feedback after testing the hobby brushes (#128, PR #132): a "stick to surface" option. The issue proposed flooding the mesh from the triangle under each dab. The PM replaced that on the issue (2026-10-13): the physical brush is the measure. A limb touching the body may take paint when the person is careless; a hand or a cape behind the back, in the same line of sight, may not. Then the PM made it the reach of every stroke, not an option.

## How

Before, a dab (one stamp of the brush along a stroke) painted every texel (texture pixel) that was in sight of the stroke's camera, faced it, and lay within a sphere of the brush's size around the dab's centre. The sphere is now cut behind the dab: in the dab shader (`src/lib/painting/passes.ts`) each texel's offset from the dab is measured along the eye's ray through the dab, and beyond `BRUSH_DEPTH_MM` (1.5 mm, a proposal in the PM's 1–2 mm range) the dab's coverage is zero. Over the last `BRUSH_DEPTH_SOFT_MM` (0.5 mm) it fades with a smoothstep, so where a curved surface recedes past the cut the stroke's edge is soft, not a hard line.

The ray through each dab, not the camera's forward axis: in perspective the two differ at the screen's edges, and the ray is what "behind the spot" means. In front of the dab the sphere still bounds the reach, so a raised crest next to the dab is still touched, as a real brush touches it.

Nothing new goes into a stroke's record: the cut follows from the dabs and the camera the stroke already keeps, so undo and redo replay it to the same bytes. A brush up to 2 mm across never reaches past the fade's start (its radius is 1 mm), so it paints bit for bit as before; that is the default brush.

## Problems and how we solved them

- **The test's sample points sat outside the old sphere.** The first grid on the lower plate reached 3.8 mm from the dab, where the old 8 mm brush already gave nothing, so "bare" proved nothing there. **Cause:** the dab lands where the canvas point hits the surface, a little off the asked x. **Fix:** a tighter grid (every point within 3.6 mm of the dab), and the test was run once with the cut disabled (`BRUSH_DEPTH_MM = 100`): those texels came back at alpha 254, so the test fails without the change.

## Dead ends

- **The flood across the mesh** (the issue's proposal): a per-dab flood over the triangles, drawn as the fill draws its region. Dropped by the PM's decision before building: it costs CPU per dab on a large brush, and on a sculpt fused into one shell it floods from a hand into the back it is joined to. The depth cut works the same for fused and separate shells (the PM's point on the issue).

## Numbers

- **CI-like software rendering (cloud container, SwiftShader):** the painting spec, 20 tests including the new one, 5.9 min; all pass, the plate's underside, the seam, every hobby brush and the undo/redo byte comparison among them.
- The shader adds a dot product, a normalise and a smoothstep per dab per texel to a loop that already computes a distance and a smoothstep. Frame times on the reference laptop were not measured in this session (no GPU here).

## Still open

- `scripts/measure-painting.mjs` on the reference laptop, to confirm the frame-rate criterion of #127 with a number.
- Whether 1.5 mm is the right depth: the PM's call after trying it.

## Story angle

How deep does a brush reach? Replacing a geometric flood with one line of physics in the shader. "Painting like a brush, not like a spray can."
