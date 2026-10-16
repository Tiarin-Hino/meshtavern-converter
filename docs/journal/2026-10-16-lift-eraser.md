---
title: The lift, an eraser that takes a stroke away and shows the paint beneath
date: 2026-10-16
phase: 2
issues: [137]
prs: [175]
topics: [painting, library, textures]
---

## What we did

The painting engine has a new tool, the lift. A stroke with it takes away the stroke it starts on and shows the paint that was beneath, instead of erasing back to the bare mini. A stray edge of a wash over a painted cloak can now be taken back without erasing the cloak. Started again on the same spot, the lift takes the layer under that, and so on back through the history that undo still reaches. Where nothing was painted since the mini was opened, or the stroke is older than undo reaches, it takes nothing and the view says why.

## Why

PM feedback after testing the hobby brushes (#128, PR #132): the eraser lowers the paint's alpha toward bare, so correcting a stroke that went over the line also erased what was there before. The PM decided on #137 (2026-10-13) that the eraser should take away what the strokes under it laid, as long as they are in the recorded history, and proposed the mechanism: a per-texel map of the newest step to change each texel, written at every commit; at a lift stroke's start, the step under it; the paint brought back to what it was without that step, from the keyframe before it; the step recorded in the stroke so undo and redo replay it; and a reason when there is nothing to take. The design and the build were done in one pass on Opus 5.5 (the PM said to go on without a Fable design pass); the decisions are in `docs/design/lift-eraser.md`.

## How

- **A stamp map.** Every commit, live or replayed, runs one quad pass that writes the step's number (index + 1, two bytes, an RG8 target of 2 MB) into every texel whose bytes the step changed. "Changed" is the bytes: the pass compares `live` and `paint` as sampled, and equal bytes decode to equal values. A dry brush whose mask was 0 somewhere, or a stroke that laid the same colour at full opacity over itself, leaves those stamps alone. The keyframes now hold the paint and its stamp map.
- **Finding the step.** At a lift stroke's first hit the view reads the stamp under it: one texel drawn into a 1 × 1 target and read back synchronously, one GPU sync per lift stroke. 0 means nothing painted since `open` (bare, or the paint the view was opened with).
- **The paint beneath, pinned.** `PaintHistory.pin(i)` makes sure a keyframe of the paint before step `i` exists: if none, it keeps the paint aside, restores the nearest keyframe, replays the steps up to `i`, takes the keyframe and puts the paint back (at most nine replays). The keyframe is kept, off the schedule, while a lift step in the history points at it, so undo and redo replay the lift exactly. Undo's reach is now `oldest`, the scheduled keyframe the window keeps; a pinned keyframe below it stays while undo can still replay the lift that needs it.
- **Only where the step is on top.** The lift's composite changes a texel only when its stamp is the lifted step's. There, nothing after the step changed the texel, so "the paint without that step" is exactly the keyframe before it: no replay of the later steps without it. Where a later step lies over the lifted one (a wash over the stray stroke), the lift leaves both; the person lifts the wash first. That is a narrowing of the PM's wording, asked on the PR (design note §3).
- **Peeling.** A lift writes no stamp of its own: where it took the step away fully, the texel takes the stamp it had beneath (from the pinned keyframe's stamp map), so the next lift there takes the layer under it; where it took the step away only partly (opacity under 1, a soft edge), the texel keeps the step's stamp and the next lift goes on taking it away.
- **Data.** `lift` is a tool id beside `eraser` (size, hardness, opacity), `PaintStroke.lifts` the step's index in `history()`, `PaintingState.lift` what the last lift found (`{ lifted }` or `{ refused: 'nothing-painted' | 'too-long-ago' }`), `PAINT_COPY.lift` the two sentences, and `recentColours` leaves lift strokes out as it does eraser strokes. The `?dev` Paint tool shows the refusal in its status line.

## Problems and how we solved them

- **Problem.** The lift would need a replay inside a replay. Taken literally, "the paint as replayed without that step" across the whole stroke means replaying every later step without it, and a later lift among them needs its own replay without its own step, inside that one. **Cause:** a lift is not a function of the paint under it, as every other tool is; it depends on a history. **Fix:** the stamp gate (above): where the lifted step is on top, the keyframe before it is the answer; elsewhere the lift does nothing. No lift ever replays another.
- **Problem.** A keyframe a lift needs could be dropped as the undo window moves on, while the lift itself could still be undone and replayed. **Fix:** the window keeps a floor (`oldest`) of its own; pruning drops a keyframe below it only when no lift step from the floor on points at it.
- **Problem.** Sampling the stamp map in the pass that writes it is a WebGL feedback loop, even on a branch that never runs. **Fix:** when there is no paint beneath, the stamp pass's beneath samplers point at the paint, never at the stamp map.
- **Problem.** The first e2e run found 2 texels of 862 that a narrow lift left between the two paints. **Cause:** a dab's hardness is capped at 0.999 so the falloff's two edges never meet, which leaves a band a few thousandths of a mm wide at the dab's edge with partial coverage. **Fix:** the test allows 1 % of the lifted texels to be partial; the wide lift, which covers the stroke it takes away well inside its edge, is asserted byte for byte.
- **Problem.** Tests repeating the same stroke at one spot found an older step under it than expected. **Cause:** a flat stroke of the same colour at full opacity over itself changes no byte, so it stamps nothing (as designed). **Fix:** the test alternates two colours.
- **Problem.** The full container e2e run failed the phone reference screens ("converting", 40 pixels) and timed out a smoke screenshot. **Cause:** load during the 33-minute run; both pass when run on their own, and `main` passes the same filter. Not touched by this change.
- **Problem.** `scripts/measure-painting.mjs` could not run from a worktree. **Cause:** it starts `node_modules/vite/bin/vite.js` relative to the folder, and a worktree shares its parent's `node_modules`. **Fix for the run:** a junction to the parent's `vite` and `corpus` (both git-ignored).

## Numbers

- **Correctness, CI-like (Linux container, software rendering, `npm run docker:e2e`):** a lift 5 mm wide over a 1.5 mm stroke that crossed an earlier 3 mm one gives the paint after the first stroke byte for byte (the test asserts more than 100 texels changed by the second stroke); undo, redo and a replay from keyframe 0 under a later stroke give the same bytes; a narrow lift inside a wide stroke brought 862 texels back to the paint beneath, left 13,783 as they were and 2 between (the dab's edge band). The whole painting spec took 17.4 min in the container.
- **Cost by construction:** a lift stroke's frame is the eraser's (the dab pass and one composite with one more texture read and a compare); the stamp pass is one quad pass at each commit, not each frame; a lift's start adds one synchronous one-texel read back and, when no keyframe is kept before the step, at most `KEYFRAME_EVERY − 1` = 9 replays.
- **Memory:** 2 MB for the stamp map, 2 MB more per keyframe (12 MB at six), 6 MB per step lifted (README's table).
- **Frame counter on the development PC: not measured.** `scripts/measure-painting.mjs` (now with a lift run after the other brushes) did not get past converting the generated figure in 10 minutes, headed or headless, while the PC was busy (two CI runner containers up, the measuring window not in front); the same conversions pass in the container. To be run with the PC free and its numbers added to the PR.

## Still open

- Whether a lift should also reach under a later layer (the PM's call, on the PR; design note §9).
- The frame counter on the reference laptop, as for every brush since #127.
