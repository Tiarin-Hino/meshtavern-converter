---
title: A 32 mm grid, creature sizes and a separate base file
date: 2026-09-23
phase: 1
issues: [44, 70]
prs: [71]
topics: [planning]
---

## What we did

Two changes to the plan before the scale work starts. Story 4 (#44) no longer asks the user to pick a base size from a list. Instead the converter measures the base, suggests a creature size (Tiny to Gargantuan) with its footprint on the grid, and the user accepts or changes it. A new story (#70) lets a person drop the base file next to the figure file, because most sculpted minis ship as two files with a dedicated spot on the base for the figure.

## Why

The PM decided on 2026-09-23 that **one grid square is 32 mm in mini space**. Tiny, Small and Medium creatures take one square, Medium filling it and Small and Tiny standing centred in it; Large 2×2, Huge 3×3, Gargantuan 4×4. A base may be smaller than its footprint: a 50 mm base is a normal Large mini and sits centred in its 2×2 squares. This ties the size of a mini to what matters at the table, the number of squares it takes, rather than to a list of base diameters. The old list (25, 32, 40, 50, 75, 100 mm) had no clear meaning at the table, and 40 mm matched no creature size at all.

The separate base came from the PM's own collection: professional minis are rarely printed on a plain base. The figure has feet, a peg or a tab, the base has a recess or a hole, and joining them in another program is exactly the kind of step the converter exists to remove.

## How

The spec's story 4 is rewritten and story 10 added; the issues #44 and #70 carry the acceptance criteria, all product behaviour marked as proposals except the grid decision. Design choices in the proposals:

- **Suggestion from the measurement.** The smallest footprint the base fits into, with a 5 % tolerance so a 33 mm base still counts as one square. Size names come from the SRD 5.1 (CC-BY-4.0); the footprint in squares is shown beside the name so other game systems fit.
- **Keep the size, record the meaning.** By default the mini keeps its measured millimetres; the result records the size, the footprint and the base diameter, and its origin sits at the centre of its base so the table can centre it. Scaling is an explicit user action, never a side effect.
- **Base file merged before reduction.** The figure is set down on the base's contact points and the two become one mesh before the pipeline reduces, unwraps and bakes it, so levels, textures and the regression numbers keep working unchanged. Recess detection is a heuristic; the user always sees the placement and can adjust it.

## Still open

- Which of Tiny, Small and Medium a small base suggests is a proposal (under 26 mm Small, otherwise Medium, Tiny only by choice); the review of PR 71 first read Tiny as undecided, and the PM confirmed all three on 2026-09-23.
- The exact heuristic for recesses, slots and pegs is for the implementation of #70 to find; the corpus pairs will show how often it is right.
- The 32 mm grid is a decision the table (Phase 2) inherits; it belongs in an ADR or the vision when the table is specced.

## Story angle

Why a mini's size should be measured in squares, not millimetres, and why your dragon's base can be smaller than the dragon.
