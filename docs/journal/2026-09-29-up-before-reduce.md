---
title: Asking which way is up before anything is reduced
date: 2026-09-29
phase: 1
issues: [92]
prs: [94]
topics: [orientation, worker, ui, tooling]
---

## What we did

A dropped STL now stops right after the converter has read it and guessed which way is up. The page shows the sculpt at full detail, flat-shaded in primer grey, and asks "Is this the right way up?". Nothing is reduced or baked until you press Yes. A figure with a base file asks about the base first, then the figure, with Swap at either. Two files without a flat underside are no longer refused: the page proposes one as the base and you say which.

## Why

Detection gets 3 of 15 corpus pairs and 6 of 30 single files wrong (#72, #70), and each correction used to convert again, a minute per try on a large mini. Issue #92 asks for the question first. A design pass on Fable 5.1 planned it (`docs/design/up-before-reduce.md`); the PM decided its eight questions the same day. Opus 5.5 built it on 2026-09-29 while the PC was in use (`/continue-pr-quiet`), and measured it the next day (`/continue-pr`).

## How

- **One job that waits.** Two jobs (orient, then convert) would read and weld the largest file twice. So the pipeline takes a callback, `askUp`, after the orient step; `runPipeline` is async, so the worker still receives the answer while it waits. Each answer is worked out over the pass the orient step kept, inside the orient step's time; a person's thinking time is in no step. Without the callback the old path runs, and the regression baseline did not move.
- **The worker decides, the page shows.** The welded mesh goes to the page once per file, as a copy; later answers come back as an orientation, and the viewer turns the mesh it has.
- **A pair's decision moved in front of the question.** Registration and the better of two candidate axes are decided by `decideFigure` in the orient step, so the figure's question shows what will be placed.
- **`result.choices`** convert the same mini again without asking; a proposal confirmed as it is stays `{}`, or a registered pair would skip its registration test next time.
- **Unattended runs** answer through the page's hooks (`scripts/lib/answer-up.mjs`).

## Problems and how we solved them

- **Two test expectations were wrong**, not the code: a base confirmed before a swap stays in `stats.asked`, and a round base's wall counts as a flat side in the 2 mm band of #70.
- **A pipeline test timed out under `npm run check`.** **Cause:** a helper placed every pair twice to prove the split decision; on every core a test passed its 5 s. **Fix:** one test of its own.
- **The corpus report gave the 15 s budget to the wrong file.** It took the largest _single_ file, an ordinary humanoid held to 3 s; the largest corpus file is a pair. **Fix:** fixed before the measured run.
- **The first full corpus run was taken at night** and its untouched steps ran 1.5× slower than the day before; a watcher missed its end because PowerShell appended UTF-8 to a UTF-16 log. **Fix:** repeated with the PM at the PC, from a launcher that writes one encoding.
- **The registered figure's box.** The note's box for it would stand the mesh off the grid. **Fix:** every box is the file's mesh turned as shown (§3.1); reported on the PR.

## Numbers

Development PC (i7-11700F, RTX 3060, Chrome 153), 2026-09-30, `npm run corpus -- --no-bake`, window in front; steps this work did not touch ran at 0.99× the run of 2026-09-29 (median of 75), so the machine held still.

- **Time to the question** (from picking the files to two frames after the mesh reached the viewer): the 15 single files 93–716 ms, median 354 ms; the slowest is the 1.25 M-triangle humanoid. Pairs 377 ms – 1.6 s, and the largest corpus file (5.6 M triangles with its base, 6.1 M together) 7.1 s. The issue's budgets are 3 s and 15 s on the reference laptop; the laptop's run is the PM's.
- **The orient step grew** by the copy and, for a pair, by the decision moved into it: 97 → 116 ms on the humanoid, 3.0 → 3.4 s on the largest pair.
- **Longest stall** during a conversion: 103 ms on the largest pair (the 5.6 M-triangle mesh going to the GPU at the question), under 50 ms on every other mini.
- **With `--up index`** all 30 minis stand on the index's axis (24 before); the six that changed each converted once, with no try at the question. Nothing else changed.
- **Peak memory** of the page (`scripts/measure-memory.mjs`, converting as detected): the largest file 2,637 MB (2,630 before, estimate 2,774), the humanoid 796 MB (695 before, estimate 898). The GPU process: 402 and 198 MB (177–191 before).
- `npm run score-placements`: the same table as on `main`.

## Still open

- The reference laptop's time to the question (criterion 4) is the PM's run.
- The humanoid's peak memory rose 101 MB, more than its 23 MB copy; still under the estimate, with 11 % left.
- "25 mm across" in the question is in the file's units: a file in inches would read "1 mm across".
- Base and figure together at the question: #93. Opening the question again from Adjust: the note's §12.

## Story angle

"Show me before you crunch it": moving the one human decision to the front of a two-minute pipeline, and why the pipeline waits instead of running twice.
