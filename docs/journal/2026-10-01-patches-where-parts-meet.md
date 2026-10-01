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
- **The proposal is where the parts touch.** The figure's triangles within 0.5 mm of the base where the automatic placement of #70 sets it, in connected pieces, the four largest, and the base's triangles under each (1 and 2 mm when 0.5 finds nothing). For parts, the same over the parts where their files put them. A proposal is all or nothing: confirmed untouched, the placement is the one it was read from, bit for bit, so every path without marks stays what it was. The first tap starts the person's own marks from nothing; Start over brings the proposal back.
- **The fit changes as little as it can.** The person has just confirmed how the figure stands (#92), so the fit first only moves it (the weighted centres of the patches onto each other), then also turns it about the base's up (two pairs or more), and only tilts it when the marks disagree with how it stands by more than 15°. The free turn is Horn's closed form over the centres and the normals, its eigenvector by Jacobi sweeps, without trigonometry, so it gives the same bits on every machine. The prototype showed why: letting a small sole decide the tilt left a 40 mm figure up to 7 mm off at its far corner.
- **The worker owns the marks.** The page sends what a finger did (a tap as the camera's ray, a drag as brush dabs) and draws what comes back. `applyMeetAction` is a pure function that decides which side a tap goes to without a mode (the base and parts in place are `on`, the figure and parts not yet placed are `of`) and refuses a pair that would give a part a second part to meet. Both meet questions are one loop in `run.ts` with two stages, `pairs` and `fitted`.
- **Taps go through the worker's search tree.** The page's three.js raycast tested every triangle (0.9 s on the 5.6 M-triangle figure); the worker carries the ray into each file's frame and asks the tree. The trees are built while the first question waits and released before the size step, and the memory estimate of a pair or kit counts them (28 bytes per triangle). No new dependency.
- **On the page**, both sides of a pair share one of four colours, drawn once solid and once faint through everything, so a patch under a foot shows from above. Chips select the pair a tap goes to. The brush is a toggle: on, one finger paints and two orbit.

## Problems and how we solved them

- **Steps 5 to 8 could not each compile the page.** The pipeline's types changed under it, and a bridge for the old page would have been thrown away a step later. **Fix:** the pipeline, protocol and wording commits pass their unit tests; the page compiles again from its own commit. Noted on the PR.
- **An eraser dab on nothing counted as a change.** It added an undo step and no note. **Fix:** a dab with no patch under it is a miss; a drag that lands elsewhere is not reported for the dabs that missed.
- **Twelve e2e tests failed in the first full run.** Three came from one helper in `up-question.spec.ts`, `confirmMeet`, which confirmed a pair's meet question once where there are now two stops; the three tests that call it waited at the final view (fixed in ee88a60). The other nine were load: the unit suite and measurements ran beside them, and two workers baking at once ran past the timeouts; alone they pass. (The run's report was not kept; the split is counted from the tests that call the helper.)
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
- **Tests**: unit tests and the e2e suite pass (`meet.spec.ts` 3, `parts.spec.ts` 3, all others unchanged).

## Still open

- The PM's marking session (`npm run feedback -- --mark`): the bat, the pairs placed by hand and a kit for the corpus; it judges criterion 5 and the four tap constants.
- The peak memory of the largest pair with the trees (`scripts/measure-memory.mjs`): not measured in this PR; the estimate counts them (28 bytes per triangle).
- Which kit goes into the corpus: kits in the library have 12–25 part files, `MAX_PARTS` is 6.
- The budgets missed on `swarm-01`, `mounted-01`, `swarm-03` and `large-01` (above); none on the ordinary humanoid the stop rule names.
