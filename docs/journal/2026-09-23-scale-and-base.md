---
title: Units, bases and creature sizes on a 32 mm grid
date: 2026-09-23
phase: 1
issues: [44]
prs: [74]
topics: [stl-import, orientation, ui, testing, regression]
---

## What we did

The converter now tells you how big your mini is in table terms. It guesses the file's units, measures the base the mini stands on, and suggests a creature size (Small, Medium, Large and so on) with the number of grid squares it takes. You can pick another size, scale the mini so its base has a diameter you enter, or give a mini without a base a plain round one. The grid in the viewer is now the 32 mm square the PM decided on, and the exported file carries the size for the table.

## Why

Story 4 of the Phase 1 spec (#44): a mini has to take the right number of squares next to everyone else's. The PM fixed the grid at 32 mm on 2026-09-23 (`2026-09-23-grid-and-base-decisions.md`). The work started with a design pass on Fable 5.1 (`docs/design/scale-and-base.md`), which fixed the data shape, the modules and every threshold as a proposal. This entry covers the build on Opus 5.5 in PR #74.

## How

- **A new pipeline step, `size`,** runs between orienting and reducing. It has to come before the reduction because the detail levels' error budgets are in millimetres, and before the bake so that a plain base is part of the baked mini.
- **Units from the height** (`units.ts`): at least 8 units tall is millimetres, 0.3 to 8 is inches, less is metres. It is shown on the page and can be corrected there.
- **The base** (`base.ts`): the up detection already looked for a flat underside. `measureBase` repeats that test on the placed mini, takes the outline of the vertices on the floor and calls it round when width and depth agree within 10 % and the outline's area is 85–118 % of the circle's. `orientAndPlace` now puts the origin at the centre of the base instead of the centre of the bounding box, so the table can centre the mini in its squares.
- **The suggestion** (`size.ts`): the smallest footprint the base fits into, with 5 % tolerance; within one square, under 26 mm is Small. Without a base, the figure's wider side stands in. The size names are the SRD 5.1's (CC-BY-4.0, attribution in `README.md`); the squares are ours.
- **Scaling is always a choice.** A base larger than the chosen footprint gets a warning and a "Scale to fit" button, never a silent rescale. Every choice converts the file again with fixed options, as the up selector already did.
- **What the table gets:** `sizing` on the result and in the figures, and `extras.meshtavern` in the GLB (grid square, size, squares, base diameter, units, scale).
- **A corpus index** (`scripts/corpus-index.json`) records the expected size per corpus mini, and `npm run corpus` now reports where the suggestion agrees.

## Problems and how we solved them

- **The note's round-base test called a square round.** "The outline covers 85 % of the circle" is true of a square too, which covers all of it. **Fix:** compare areas both ways (a square has 127 % of the circle's area); the square-plinth test the note asked for now passes.
- **Two answers in the note for a mini without a base:** the origin at the centre of the contact patch (§1) or of the bounding box (§3). We took §3: a figure on one foot forward would otherwise sit off its base.
- **The e2e tests read stale figures.** The page's live figures refresh twice a second, and a conversion counts as busy until the mini's first frames are drawn. **Fix:** the tests poll, and wait for the page to settle after each control.

## Dead ends

- Comparing the corpus run with the last saved one could not show what this change moved: that run predates #68, which drops repeated triangles, and every exported file grew by the new `meshtavern` block. The levels were compared with `main` directly in Node instead (below).

## Numbers

Development PC, `npm run corpus` with a headed Chrome started from the agent session. Its times are not usable: weld, a step this change does not touch, ran 1.4–1.8 times slower than in the PM's run of the same night.

- **All 30 corpus minis converted** and all were read as millimetres. A base was measured on the 13 minis the up detection finds one on: 15, 20, 20, 24 (not round), 25, 26.5, 32, 49, 50, 50, 97, 99 mm and a 107 mm wall piece (not round).
- **Suggestions against the proposed index: 16 of 30 agree.** Of the 14 that do not: two Tiny creatures (never suggested, by design), three humanoids on 20–24 mm bases called Small, five minis without a base sized by the figure's own width, four too large (a spread weapon, wings, a hound lying on its side) and one too small, a mount file of only the mount, a swarm, and two terrain pieces.
- **The origin shift moves the far level** of three minis on a base by +2.5 %, +1.3 % and −1.2 % triangles, with the error still at the level's target. Measured in Node on the same machine, `main` against this branch, nothing else different. The generated shapes of the regression baseline did not move, because their bases are centred already.
- **The base measurement costs** 0.8 s on the largest file (5.6 million triangles), 60–120 ms on ordinary minis (Node, development PC).
- Unit tests 175 → 220; e2e 14 → 17 tests.

## Still open

- The PM's answers on PR #74: whether the far level may move by up to 2.5 % from the origin shift, the Small threshold for 20 mm bases, how to size a mini without a base, and whether the corpus index may name the corpus files in this public repo.
- The mismatches from wrong orientations wait for #72; a base shipped as its own file is #70.
- A choice converts the whole file again; restarting from the size step is a follow-up.

## Story angle

What a mini's size means at the table, and why the converter measures the base rather than the figure. Possible title: "How many squares is your dragon?"
