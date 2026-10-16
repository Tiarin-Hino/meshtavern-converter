---
title: A mask that protects the mini from every tool
date: 2026-10-16
phase: 2
issues: [138]
prs: [177]
topics: [painting, mask, fill]
---

## What we did

The painter has a mask now, the digital liquid mask: paint it over the face, and no brush, wash, fill or eraser changes the paint there until the mask is taken away. It is made with its own brush, eraser and fill, can be cleared or inverted ("paint only the face"), and every one of those is a step that undo and redo take back and put again. While painting it shows as a blue tint, which can be switched off. A fill also stops at the mask, so a band of mask across a wrist keeps a fill of the hand on the hand. The mask is kept beside the paint as pixels, so a painting can go on later with the same mask.

## Why

The PM asked for it after testing the hobby brushes (#128): mask the face, then wash the whole figure freely, as on a real mini. On the issue (2026-10-13) the PM decided that the mask is kept with the mini (pixels in and out, as the paint), that it can be inverted, and that it cuts the fill, a triangle counting as cut when the mask covers its middle. The issue asked for a design pass first; the PM said to build it on Opus, so the design note (`docs/design/paint-mask.md`) and the build are one PR, as for the lift (#137).

## How

- **One byte a texel, read by every composite.** The mask is an R8 target beside the paint (and a live copy for the stroke in progress, as `paint` and `live`). The paint composite multiplies the tool's alpha by `1 − mask` at the texel's owner. A fully masked texel then has alpha 0, and the composite already returns the paint's bytes untouched there (the same path that leaves a crease untouched under the dry brush), so "keeps its bytes" holds exactly, the lift's composite included.
- **Tools, not a mode.** The mask is made with three tools in `TOOL_IDS` (`mask`, `unmask`, `mask-fill`) rather than a "paint the mask" switch on the existing tools. Each is an ordinary stroke or fill step with its own composite onto the mask (laid over it, or taken from it, by the stroke's coverage), so the history, replay, the dab pass and the panel's tool row needed nothing new. Clear and invert change the mask whole and are a new step kind, `MaskChange`. The alternative, a `target: 'mask'` field on every step, would have put a branch in every place that reads a step's tool.
- **The keyframes hold the mask.** Undo restores a keyframe and replays, so the mask must be in the keyframe for a mask step to be undone; it is 1 MB more each. Mask steps write no stamp (they change no paint), so a lift never takes one away.
- **The fill's cut on the GPU.** The flood runs on the CPU over triangles, the mask lives on the GPU, and an undo replays a fill synchronously. So at every picked fill the view draws one point per triangle, at the texture coordinates of its middle, into a small target (`⌈√T⌉` texels square), each 1 where the mask there is at least `MASK_CUT` (0.5), and reads that back at once. That is a few hundred kilobytes once per fill instead of the whole 1 MB mask, and in RGBA, which every GPU can read back. `fillRegion` (pipeline, Node-tested) only takes the bytes as `cut`.
- **In and out.** `open` takes the mask's bytes (an R8 upload); `mask()` draws it into an RGBA scratch target and reads that, because reading R8 back is not guaranteed on every GPU. `paint()` never contains it.
- **The tint** is an option of the baked material (`tint`: a texture and a colour with a strength), mixed in after the look, so it is lit like the mini. Its colour is paint-like data beside the default paint colour in `brush.ts`, not a theme role.

## Problems and how we solved them

- **The fill-cut test laid no mask.** The first version stroked the band from eight sides along a ring of points 8 mm out at 10 mm height, cast onto the body; every one of the eight strokes found no hit and the fill went straight through. **Cause:** at elevation 0 the camera still looks down a little, and the 8 mm ring is wider than the 5 mm body at the sides, so the casts landed at 12 mm or missed. A diagnostic run that listed the body's triangles in the band with the mask at their middle showed all 428 of them open. **Fix:** stroke along the table level's own vertices in the band, each side keeping those it has in sight; then all 428 were masked and the fill stopped.
- **Which step a lift takes depends on the brushes.** The first test expected a lift started beside the mask to take away the last flat stroke; it took the fill before it. The brush's soft edge did not change those bytes where the lift started. The test now asserts only that the lift took a step away; that masked texels keep their bytes is the point of the test.
- **Line endings.** Editing files with Python on Windows wrote CRLF; they were converted back before the first commit.

## Dead ends

None in the engine. The ring of cast points in the test is the one dropped approach (above).

## Numbers

- **Frame counter, development PC (RTX 3060, Chrome through ANGLE/D3D11, 1,920 × 1,080, `scripts/measure-painting.mjs`, 3 strokes of 120 samples across the canvas per brush):** on large-01 (59,954 triangles, 2,048 px detail) every brush, the mask's two included, at 16 mm had a median of 0.1–0.2 ms and a worst of 0.4–1.7 ms of CPU per frame, no slow frame (`FRAME_BUDGET_MS` 33), and frames came every 6.1 ms (the display's rate); the mask brush 0.2 ms median, 0.8 ms worst; the mask eraser 0.2 / 1.6 ms. On the generated figure (35,012 triangles, 1,024 px) the same within 0.1 ms. The frame-rate criterion of #127 holds.
- **Memory there:** the GPU process grew by 193 MB with the view open on large-01 after all those strokes (130 MB measured for #127 before any stroke; the keyframes of 27 steps and three lifts' pins are in the difference). The mask adds 2 MB of targets and 1 MB a keyframe (README's table).
- **The first measurement lifted nothing**: the mask runs went first along the same canvas paths, so every brush after them painted over mask and changed no byte, and the lift found no step under its start (`nothing-painted`), which is the mask working. The mask eraser now runs right after the mask brush, and the lift took the flat strokes away (`lifted` 6, 7, 8: the later brushes of the same stroke index lay the same colour over them at full alpha, which changes no byte and so stamps nothing).
- **Correctness, Linux container (software rendering, `npm run docker:e2e`):** the four mask tests pass in 3.6 min; under every tool, a 16 mm wash, ink, dry brush, airbrush, flat brush and eraser down the whole figure, a fill of the figure and a lift beside the mask, every one of the masked texels kept its bytes while more than 10,000 others changed; the band of mask 10 mm up the body covered all 428 of the body's triangles there and stopped a fill from the chest.

## Still open

- Whether a hidden part (#139) is also masked is #139's decision; nothing here assumes it.
- When the paint file (#165) lands, the mask's steps are in the history it saves; the mask's pixels go with the paint's where a consumer keeps pixels.
- The tint's colour and strength (`MASK_TINT`, `MASK_TINT_STRENGTH`), `MASK_CUT` and the words in `PAINT_COPY` are proposals for the PM.
