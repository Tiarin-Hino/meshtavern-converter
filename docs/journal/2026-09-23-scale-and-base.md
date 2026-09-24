---
title: Units, bases and creature sizes on a 32 mm grid
date: 2026-09-23
phase: 1
issues: [44]
prs: [74]
topics: [stl-import, orientation, ui, testing, regression]
---

## What we did

The converter now tells you how big your mini is at the table: it guesses the file's units, measures the base, and suggests a creature size (Small, Medium, Large…) with the grid squares it takes. You can pick another size, scale the mini to a base diameter, or add a plain round base. The viewer's grid is the 32 mm square, and the exported file carries the size.

## Why

Story 4 of the Phase 1 spec (#44): a mini must take the right number of squares. The PM fixed the grid at 32 mm (`2026-09-23-grid-and-base-decisions.md`). A design pass on Fable 5.1 (`docs/design/scale-and-base.md`) set the data shape and every threshold as a proposal; Opus 5.5 built it in PR #74, where the PM decided the open questions.

## How

- **A new pipeline step, `size`,** before the reduction, whose error budgets are in mm, and before the bake, so a plain base gets baked too.
- **Units from the height:** 8 or more is mm, 0.3 to 8 inches, less metres; shown and correctable.
- **The base:** the outline of the vertices on the floor, round when width and depth agree within 10 % and its area is 85–118 % of the circle's. The origin moves to the base's centre, so the table can centre the mini in its squares.
- **The suggestion:** the smallest footprint the base fits into, with 5 % tolerance; within one square, a base under 18 mm is Small. A Medium mini on a base under 25 mm is offered a one-click scale up to 25 mm. A mini without a base is suggested Medium. Size names are the SRD 5.1's (CC-BY-4.0, credited in `README.md`).
- **Scaling is always a choice:** a base larger than its footprint gets a warning and a "Scale to fit" button, never a silent rescale.
- **For the table:** `sizing` on the result and `extras.meshtavern` in the GLB. A committed corpus index holds the expected size per corpus mini, and `npm run corpus` checks the suggestion against it.

## Problems and how we solved them

- **The note's round test called a square round.** "The outline covers 85 % of the circle" is true of a square too. **Fix:** compare areas both ways; a square has 127 % of the circle's area.
- **Without a base, the figure's width misled** 5 of 17 minis (a bat came out Gargantuan). **Fix (PM):** suggest Medium; revisit after #72.
- **20 mm bases came out Small** under the proposed 26 mm line. Three of the PM's humanoids on 20–24 mm bases are Medium creatures printed small: 29–32 mm tall against 36–48 mm for bought ones. **Fix (PM):** Small only under 18 mm, plus the offer to scale up to 25 mm (at 32 mm two of them would outgrow every bought humanoid).
- **The index named bought minis.** The spec keyed it by corpus file path, and this public repo names no bought mini. **Fix (PM):** those files were renamed to `<kind>-NN` locally; a git-ignored map keeps the originals.
- **CI broke the browser after the stress test.** As Medium, the 50 mm test sheet's 100 copies stood 32 mm apart and overlapped; CI's software renderer choked. **Fix:** the test makes the sheet Large (64 mm apart) and ends on a drawn frame.

## Numbers

Development PC, `npm run corpus`. Times from the run of 2026-09-24 with the PC free; two unattended runs ran at half speed and are not quoted.

- **All 30 corpus minis** read as mm. Bases measured on the 13 that have one: 15 to 107 mm.
- **17 of 30 suggestions match the confirmed index.** The misses: eight large creatures without a base (Medium by default), two Tiny creatures (never suggested), a mount, a swarm and a wall piece.
- **The origin shift moves the far level** of three minis by +2.5, +1.3 and −1.2 % triangles at the same error (Node, against `main`); accepted by the PM.
- **Times:** the largest file 112.6 s whole (114 s before), other minis with a 2048 px texture 21–34 s, longest page stall 49 ms. Measuring the base adds about 1 s to the largest file and 30–160 ms to ordinary ones.
- Unit tests 175 → 225; e2e 14 → 17.

## Still open

- Minis without a base: Medium misses the large ones; revisit with #72, which also takes over merging the base measurement into the up detection's pass.
- Older docs on `main` still name bought minis; a separate change swaps them.
- A choice converts the whole file again; restarting from the size step is a follow-up.

## Story angle

What a mini's size means at the table, and why the converter measures the base rather than the figure. Possible title: "How many squares is your dragon?"
