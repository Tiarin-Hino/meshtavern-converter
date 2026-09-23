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
- **The suggestion** (`size.ts`): the smallest footprint the base fits into, with 5 % tolerance; within one square, under 18 mm is Small. A Medium mini on a base under 25 mm is offered a one-click scale up to 25 mm. A mini without a base is suggested Medium (see below). The size names are the SRD 5.1's (CC-BY-4.0, attribution in `README.md`); the squares are ours.
- **Scaling is always a choice.** A base larger than the chosen footprint gets a warning and a "Scale to fit" button, never a silent rescale. Every choice converts the file again with fixed options, as the up selector already did.
- **What the table gets:** `sizing` on the result and in the figures, and `extras.meshtavern` in the GLB (grid square, size, squares, base diameter, units, scale).
- **A corpus index** (`scripts/corpus-index.json`) records the expected size per corpus mini, and `npm run corpus` now reports where the suggestion agrees.

## Problems and how we solved them

- **The note's round-base test called a square round.** "The outline covers 85 % of the circle" is true of a square too, which covers all of it. **Fix:** compare areas both ways (a square has 127 % of the circle's area); the square-plinth test the note asked for now passes.
- **Two answers in the note for a mini without a base:** the origin at the centre of the contact patch (§1) or of the bounding box (§3). We took §3: a figure on one foot forward would otherwise sit off its base.
- **The e2e tests read stale figures.** The page's live figures refresh twice a second, and a conversion counts as busy until the mini's first frames are drawn. **Fix:** the tests poll, and wait for the page to settle after each control.
- **The figure's width is a poor guide without a base.** The design pass let the figure's wider side stand in for a missing base. On the corpus it missed five of 17 such minis: a spread weapon or wings made them too large (a bat came out Gargantuan), a hound lying on its side (#72) too. **Fix:** the PM decided on the PR to suggest Medium without a base and let the user pick, to revisit after #72.
- **20 mm bases came out Small.** The proposal called a base under 26 mm Small, and three of the PM's humanoids on 20–24 mm bases got it. They are Medium creatures printed small: 29–32 mm tall where bought humanoids of the same nominal scale are 36–48 mm. **Fix (PM):** Small only under 18 mm, and a Medium mini on a base under 25 mm gets a "Scale up to a 25 mm base" button. Not 32 mm: scaled that far, two of them stand taller than any bought humanoid.
- **The index named bought minis.** The spec keyed the committed corpus index by the corpus file path, which is the file name of a bought mini, and this repo names none. **Fix (PM):** the bought minis in the local corpus are renamed to `<kind>-NN`; a local, git-ignored map keeps the original names.

## Dead ends

- Comparing the corpus run with the last saved one could not show what this change moved: that run predates #68, which drops repeated triangles, and every exported file grew by the new `meshtavern` block. The levels were compared with `main` directly in Node instead (below).

## Numbers

Development PC, `npm run corpus` with a headed Chrome started from the agent session. Its times are not usable: weld, a step this change does not touch, ran 1.4–1.8 times slower than in the PM's run of the same night.

- **All 30 corpus minis converted** and all were read as millimetres. A base was measured on the 13 minis the up detection finds one on: 15, 20, 20, 24 (not round), 25, 26.5, 32, 49, 50, 50, 97, 99 mm and a 107 mm wall piece (not round).
- **Suggestions against the index the PM confirmed: 16 of 30 agreed** while the figure's width sized minis without a base, **13 of 30 with Medium for them.** Medium fixes five (humanoids, a ghost, a hound, a swarm of bats) and misses eight large creatures without a base (a dragon, two giants, two riders, a boar, a wyvern, a swarm). The rest: two Tiny creatures (never suggested, by design), three of the PM's humanoids on 20–24 mm bases called Small, and two terrain pieces.
- **The PM's humanoids on small bases are small for their scale:** 29–32 mm tall on 20–24 mm bases, against 36–48 mm for bought humanoids of the same nominal scale. Scaled to a 25 mm base they would be 32–41 mm, to a 32 mm base 41–52 mm.
- **After the 18 mm line and the scale-up offer: 17 of 30 match** (quick run without baking); the three humanoids now come out Medium with the offer to scale up. The 13 misses: eight large creatures without a base (Medium by default), two Tiny creatures, a pixie and a cat, a mount, a swarm and a wall piece.
- **A second full run after the renames** changed no level, triangle or bake figure; only the file sizes by a few bytes (the shorter names are written into the GLB).
- **The origin shift moves the far level** of three minis on a base by +2.5 %, +1.3 % and −1.2 % triangles, with the error still at the level's target. Measured in Node on the same machine, `main` against this branch, nothing else different. The generated shapes of the regression baseline did not move, because their bases are centred already.
- **The base measurement costs** 0.8 s on the largest file (5.6 million triangles), 60–120 ms on ordinary minis (Node, development PC).
- Unit tests 175 → 225; e2e 14 → 17 tests.

## Still open

- Decided on the PR: the far-level shift, Medium without a base, Small under 18 mm with the scale-up offer, generic corpus names, the index.
- Minis without a base: Medium misses the large ones; to revisit after #72.
- Older docs on `main` still name bought minis; a separate change swaps them for the generic names.
- The mismatches from wrong orientations wait for #72; a base shipped as its own file is #70.
- A choice converts the whole file again; restarting from the size step is a follow-up.

## Story angle

What a mini's size means at the table, and why the converter measures the base rather than the figure. Possible title: "How many squares is your dragon?"
