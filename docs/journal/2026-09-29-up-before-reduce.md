---
title: Asking which way is up before anything is reduced
date: 2026-09-29
phase: 1
issues: [92]
prs: [94]
topics: [orientation, worker, ui, tooling]
---

## What we did

A dropped STL now stops right after the converter has read it and guessed which way is up. The page shows the sculpt at full detail, flat-shaded in primer grey, and asks "Is this the right way up?". You can pick another axis, turn it, set it down or reset it; nothing is reduced or baked until you press Yes. A figure with a base file asks about the base first, then the figure, with Swap at either. Two files without a flat underside are no longer refused: the page proposes one as the base and you say which.

## Why

Detection gets 3 of 15 corpus pairs and 6 of 30 single files wrong (#72, #70), and each correction used to convert again, a minute per try on a large mini. Issue #92 asks for the question first. A design pass on Fable 5.1 planned it (`docs/design/up-before-reduce.md`); the PM decided its eight questions the same day (Confirm is a click, grey flat shading, Swap at the question, a warning instead of a refusal, …). Opus 5.5 built it while the PC was in use, without browser or corpus runs (`/continue-pr-quiet`).

## How

- **One job that waits.** Two jobs (orient, then convert) would read and weld the largest file twice, 3.5 s more. So the pipeline takes a callback, `askUp`, between the orient step and the rest. `runPipeline` is async, so the worker still receives messages while it waits. Each answer is worked out from scratch over the pass the orient step kept, and its time goes to the orient step (`resume`); a person's thinking time is in no step. Without the callback the path is the old one, and the regression baseline did not move.
- **The worker decides, the page shows.** The welded mesh goes to the page once per file, as a copy; later answers come back as an orientation and a box, and the viewer turns the mesh it has. Turning is a preview; Confirm sends the rotation on screen.
- **A pair's decision moved in front of the question.** Whether the files were exported together, and which of two candidate axes touches the base better, was decided in the place step. Now `decideFigure` does it in the orient step when asked, so the figure's question shows what will be placed, and `placeOnBase` calls the same function otherwise.
- **`result.choices`** are the options that give the same mini again without asking. A proposal confirmed as it is stays `{}`, not its rotation, or a registered pair would skip its registration test next time.
- **Unattended runs** answer through the page's hooks (`scripts/lib/answer-up.mjs`): the corpus run as detected or, with `--up index`, from the index; the feedback mode leaves it to the PM.

## Problems and how we solved them

- **An e2e expectation was wrong.** After a swap at the figure's question, the base confirmed before it stays in `stats.asked` ("in the order confirmed"). CI found three entries where the test expected two. **Fix:** the test expects three.
- **A test assumed a disc's edge has no flat underside.** **Cause:** the 2 mm band of #70 counts a round wall's faces near the extreme, and on the 32 mm base they reach the 15 % a base needs. **Fix:** the test uses a figure without flat faces.
- **The registered figure's box.** The note gives the box of the figure where the files put it, but the page stands the file's mesh with that box, and a shifted box puts it off the grid. **Fix:** every box is the file's mesh turned as shown, the note's own definition in §3.1. Reported on the PR.

## Numbers

- Unit tests on one worker, development PC, in use: 412 tests in about 140 s (383 in 103 s before). The new pipeline tests take about 35 s, each converting a 115,000-triangle generated figure.
- CI (software rendering): the e2e suite, 37 tests, 3.8 minutes.
- **Waiting for the full run:** the time to the question (3 s and 15 s budgets on the reference laptop), the peak memory of the largest file, and the corpus with `--up index`. Nothing of that was measured in this quiet build.

## Still open

- The deferred runs, with `/continue-pr 94` on a free PC; the laptop's figures are the PM's.
- "25 mm across" in the question is in the file's units: a file in inches would read "1 mm across".
- Base and figure together at the question: #93. Opening the question again from Adjust: the note's §12.

## Story angle

"Show me before you crunch it": moving the one human decision to the front of a two-minute pipeline, and why the pipeline waits instead of running twice.
