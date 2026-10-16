---
title: The colours used, a swatch each
date: 2026-10-16
phase: 2
issues: [136]
prs: []
topics: [painting, library]
---

## What we did

The library can now list the colours a painting has used, newest first, so a painter can pick a colour from earlier again to carry on or correct an area. The table draws the swatches beside its colour picker; the team's Paint tool under `?dev` shows them under its colour field, and a click paints with that colour again.

## Why

After testing the hobby brushes (#128, PR #132) the PM asked for a history of the colours used. On #136 (2026-10-13) the PM decided it is a plain history, and that eraser strokes do not count: the eraser carries a colour, but it is never shown.

## How

- **A pure helper, no new engine state.** Every step of the painting's history already records its colour (`PaintStroke.colour`, `PaintFill.colour`), so `recentColours(steps, max = RECENT_COLOURS_MAX)` in `brush.ts` walks the steps from the newest back and keeps each colour the first time it meets it, up to 12 (`RECENT_COLOURS_MAX`, a proposal: one row of swatches). It is exported from `index.ts` beside the rest of the painting's data. Because it reads only the steps, a table that keeps them shows the same row after reopening a mini; a history kept across minis and sessions is the table's storage, not the engine's.
- **What counts.** The steps the view's `history()` gives: undone steps are not in it, so their colours leave the row on undo and come back on redo. The limit counts colours, not steps: 30 strokes in one colour still leave room for the eleven before them. Colours are compared and given in lower case, so `#B03030` from a consumer and `#b03030` from a colour input are one swatch.
- **The `?dev` tool.** `#paint-recent`, a group of `btn-icon` buttons, each with its colour as its background (set from the data, so no colour literal in the source) and an accessible name from `PAINT_COPY.recent` ("Paint with #2050a0"). The row is rebuilt only when the applied or undone count moves, since `history()` deep-copies every step and the view emits its state on every frame of a stroke. The comparison is with the last state seen, so undo followed by a new stroke (the same counts as two states earlier) still rebuilds.

## Problems and how we solved them

- **Problem.** `tsc` failed on `@axe-core/playwright` missing. **Cause:** the worktree's `node_modules` predated #146's new dev dependency. **Fix:** `npm ci`.

## Numbers

None: the helper is a loop over the steps; the row is built from at most 12 buttons.

## Still open

- The table's panel and where it keeps the steps between sessions (Phase 2, the table's repository).
