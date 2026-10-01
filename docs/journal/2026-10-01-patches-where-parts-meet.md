---
title: Patches where the parts meet
date: 2026-10-01
phase: 1
issues: [93]
prs: [95]
topics: [placement, ui, worker, tooling]
---

## What we did

Where a figure meets its base, or a wing meets its body, is now marked by painting, not by pins. A tap colours the patch of surface around the finger; a brush adds more, an eraser takes some away. A patch on each part makes a pair, drawn in one colour on both, and a connection can have up to four pairs (two feet, a peg and a tail). The converter first shows the parts apart with the pairs it proposes; you confirm them or paint your own. Only then does it put the parts together and show the result, which you can raise, lower, turn or let tilt, and confirm before anything is reduced.

## Why

The PM tried the first build of #93 (`2026-09-30-marks-where-parts-meet.md`) and asked for the marking to be rethought on 2026-10-01 ([PR #95 comment](https://github.com/Tiarin-Hino/meshtavern-converter/pull/95#issuecomment-5922310339)). One pin per side, shown on a figure that was already placed, was hard to read and hard to reset: the person had to judge a placement before saying where the parts touch. The PM asked for painted areas in pairs, a proposal shown without placing anything, and a final view after the pairs are confirmed. A design pass on Fable 5.1 planned the rework the same day (`docs/design/patches-where-parts-meet.md`, with a prototype run on the corpus); Opus 5.5 built it on 2026-10-01, in the note's order.

## How

- **A patch is strokes, not triangles.** A tap, a brush dab or an eraser dab is recorded as a point in its file's coordinates, so a record survives a re-weld or a repaired copy of the file, as the pins did. The worker resolves the strokes in order with the file's search tree. A tap takes the triangles within 3 mm of the finger that face the way the surface does there (within 30°, across creases under 40°). The prototype had grown patches without a limit, and their centres ended up to 5 mm from the real contact; a bounded tap keeps the centre where the finger was.
- **The proposal is where the parts touch.** The figure's triangles within 0.5 mm of the base where the automatic placement of #70 sets it, in connected pieces, the four largest, and the base's triangles under each (1 and 2 mm when 0.5 finds nothing). For parts, the same over the parts where their files put them. Confirmed untouched, the placement is the one it was read from, bit for bit, so every path without marks stays what it was. The first build of the rework made a proposal all or nothing (a first tap started from nothing); after trying it the PM asked to edit it instead (below).
- **The fit changes as little as it can.** The person has just confirmed how the figure stands (#92), so the fit first only moves it (the weighted centres of the patches onto each other), then also turns it about the base's up (two pairs or more), and only tilts it when the marks disagree with how it stands by more than 15°. The free turn is Horn's closed form over the centres and the normals, its eigenvector by Jacobi sweeps, without trigonometry, so it gives the same bits on every machine. The prototype showed why: letting a small sole decide the tilt left a 40 mm figure up to 7 mm off at its far corner.
- **The worker owns the marks.** The page sends what a finger did (a tap as the camera's ray, a drag as brush dabs) and draws what comes back. `applyMeetAction` is a pure function that decides which side a tap goes to without a mode (the base and parts in place are `on`, the figure and parts not yet placed are `of`) and refuses a pair that would give a part a second part to meet. Both meet questions are one loop in `run.ts` with two stages, `pairs` and `fitted`.
- **Taps go through the worker's search tree.** The page's three.js raycast tested every triangle (0.9 s on the 5.6 M-triangle figure); the worker carries the ray into each file's frame and asks the tree. The trees are built while the first question waits and released before the size step, and the memory estimate of a pair or kit counts them (28 bytes per triangle). No new dependency.
- **After the PM tried it (same day): editing the proposal, and the camera.** The PM found three things: marking on a very large model was slow, a proposed pair could only be replaced, and orbiting the middle of two models side by side is no way to look at one of them. A proposal is now made editable by the first tap, dab or × on it: each proposed patch becomes brush dabs that cover it (`strokesCovering`: greedy over its triangles, the dab's radius grown with the area so a large contact stays under 400 strokes), so it is recorded as strokes like any patch; the action then applies, and Undo goes straight back to the proposal. Recording the proposal's triangles instead would have tied a record to the heuristic's version, which the design note avoided on purpose. For the camera: a right-click, or a finger held still for half a second, turns the view about the spot under it (the worker says what is there, as for a tap); Look at buttons frame one file or all; the wheel zooms to the pointer at a question; with the brush on, the middle button pans.
- **On the page**, both sides of a pair share one of four colours, drawn once solid and once faint through everything, so a patch under a foot shows from above. Chips select the pair a tap goes to. The brush is a toggle: on, one finger paints and two orbit.

## Problems and how we solved them

- **Steps 5 to 8 could not each compile the page.** The pipeline's types changed under it, and a bridge for the old page would have been thrown away a step later. **Fix:** the pipeline, protocol and wording commits pass their unit tests; the page compiles again from its own commit. Noted on the PR.
- **An eraser dab on nothing counted as a change.** It added an undo step and no note. **Fix:** a dab with no patch under it is a miss; a drag that lands elsewhere is not reported for the dabs that missed.
- **Twelve e2e tests failed in the first full run.** Seven were load: the unit suite and measurements ran beside them, and two workers baking at once ran past the timeouts; alone they pass. The rest were one helper that confirmed a pair's meet question once, where there are now two stops.
- **Every tap on the 6 M-triangle figure took about 0.7 s.** The PM noticed it marking; in Chrome every answer at the pairs stop took 780 ms, picks that missed included, while the page drew at 155 fps. A profile of the worker put nearly all of it in `rayTriangle`. **Cause:** in `TriangleBvh.raycast` a box the ray misses enters at Infinity, and before the first hit `Infinity <= Infinity` let every such box through: a ray tested all 6 M triangles until it hit one. The brute-force test had passed, because it checks answers, not work. **Fix:** a missed box is never visited; a counter of the triangles a ray tested (`lastRayTests`) pins it in a test. An answer now takes 1–2 ms in Chrome on that pair, 0–4 ms in Node.
- **The pair limit counted all joints together.** At the parts question the pairs are one list over every joint, and the cap of four pairs held for the list, so a kit of five parts could not give each part a pair. **Fix:** `pairsAllowed`: four per part there.
- **A test read a point's place on the screen before the camera's matrices caught up.** Moving the camera and reading `screenOf` in the same frame used the old camera; the tap then missed. **Fix:** `screenOf` updates the camera's matrices first.
- **A bash quirk ate several file edits.** Heredocs with certain contents ended early on this machine's Git Bash. Edits went through scripts written to the scratchpad instead. Not the project's problem, but it cost time.

## Dead ends

The first build of this PR, pins and two taps (`2026-09-30-marks-where-parts-meet.md`), is replaced: `resolveMark`, `meetingRotation`, the pin proposal, the page's raycast and its pins went; several files, the roles, the `assemble` step and the questions' plumbing stayed. From the design pass's prototype: unbounded growth from a tap, an ICP between the patches (worse than moving alone on 7 of 12 pairs), and letting the normals decide the tilt.

## Numbers

Development PC (i7-11700F, 64 GB, Windows 11, Node 20.19), 2026-10-01.

- **The fit from the proposal** (`scripts/measure-fit.mjs`): the contact patches of every corpus pair's automatic placement, the figure moved 20 mm across, 5 up and 10 back, put back by the fit. 14 of 15 pairs have contact; all 14 fitted `standing`, the box corners back within 0.15–1.00 mm (worst `flying-01`, 1.00 mm; the stop rule is more than two pairs over 1 mm, or one over 2.5). `large-01` has none: its automatic placement (centred, lift 0) leaves no figure vertex within 5 mm of the base's surface, so the pairs stop says "Nothing found" and the person marks it.
- **Times**: proposal 40–445 ms per pair, 1,907 ms on `swarm-01` (889 mm² of contact; budget 1,500 ms on the largest pair, which takes 356 ms). Trees 173–328 ms per million triangles, 415 on the 6 M-triangle `large-01` (budget 400). A tap after the tree 1.2–14 ms, 25 and 33 ms on `mounted-01` and `swarm-03` (budget 20; the humanoid of the stop rule 11 ms). The fit under 1 ms (budget 50).
- **Taps at a contact piece's centre** mark 0.2–31 mm², their centre 0.07–1.6 mm from the piece's (2.9 mm on `swarm-01`'s 889 mm² piece, which a 3 mm tap cannot cover).
- **Corpus** (`npm run corpus -- --no-bake --up index`, Chrome, window visible): 30 of 30 converted, none failed. Every corpus pair's automatic placement is the same bits as on `main` (15 of 15, `placePairOnly` of both trees side by side): nothing is marked yet, and the path without marks did not move.
- **Regression baseline**: only `peg-marked-in-hole` moved (now two tapped patches whose centres meet; table level 35,174 → 35,132 triangles).
- **A tap on the largest pair** (`large-01`, 6 M triangles, Chrome): 780 ms per answer before the raycast fix, 1–2 ms after. The first answer still waits for the two files' trees (about 2 s) if it comes before they are built.
- **Tests**: unit tests and the e2e suite pass (`meet.spec.ts` 4, `parts.spec.ts` 3, all others unchanged).

## Still open

- The PM's marking session (`npm run feedback -- --mark`): the bat, the pairs placed by hand and a kit for the corpus; it judges criterion 5 and the four tap constants.
- The peak memory of the largest pair with the trees (`scripts/measure-memory.mjs`): not measured in this PR; the estimate counts them (28 bytes per triangle).
- Which kit goes into the corpus: kits in the library have 12–25 part files, `MAX_PARTS` is 6.
- The budgets missed on `swarm-01`, `mounted-01`, `swarm-03` and `large-01` (above); none on the ordinary humanoid the stop rule names.
