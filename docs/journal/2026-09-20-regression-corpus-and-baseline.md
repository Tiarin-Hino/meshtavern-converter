---
title: A regression net - the corpus script and a CI baseline
date: 2026-09-20
phase: 1
issues: [46]
prs: [52]
topics: [regression, testing, tooling]
---

## What we did

Every change to the pipeline can quietly change how a mini looks, how large its files are or how long it takes. Now one command, `npm run corpus`, converts every mini in the local test collection in real Chrome and writes the figures and a comparison sheet per mini. In CI, six generated stand-in minis are converted on every check, and any unexplained change in their figures fails the build.

## Why

Phase 0 compared results by hand, on five clean minis. Phase 1 story 1 (#46, [spec](../specs/phase-1-converter.md)) asks for a net before the bigger changes start: baking by default, messy files, a faster unwrap. The real minis are licensed and never enter the repository, so CI needs something else to watch.

## How

- **Local corpus run.** `scripts/corpus.mjs` replaces the older `compare-lods.mjs` and `export-sizes.mjs`. It writes `results.json`, readable tables in `results.md` and one comparison sheet per mini to `out/corpus/`, baked by default. The report lists which figures moved since the previous run and how far the corpus is from the 20 to 30 minis of different kinds the spec asks for. Folders under `corpus/` name the kind (`humanoid`, `large-creature`, `quadruped`, `flying`, `mounted`, `swarm`, `terrain`); the report counts kinds still missing, Y-up and Z-up files, and flat bases found. A conversion taking more than 10 minutes is recorded as failed and the run goes on.
- **CI baseline.** `src/regression/` holds generated shapes: a bumpy sheet, a figure on a base (baked at 512 px), the same figure Y-up, a figure without base, a swarm on a 50 mm base and a smooth boulder. Between them every rule that decides a level's triangle count occurs (source, error, floor, cap), and both up-detection methods. `baseline.test.ts` runs inside `npm run check` and compares against a committed `baseline.json`.
- **What "unexplained" means.** Counts, names and decisions must match exactly. Error, size in mm, compressed file size and texture coverage may drift by 0.1 to 1 % (`compare.ts`). An intended change is recorded with `npm run baseline:update`, so the changed `baseline.json` shows up in the PR for review.
- **No times in the baseline.** CI runners share cores and say nothing about speed.

## Problems and how we solved them

- **Problem.** An exact comparison of triangle counts needs the same bits on every machine. **Cause:** `sin`, `cos` and `pow` may differ in the last digit between JavaScript engines, which can move a simplifier decision. **Fix:** the shapes use only `+ − × ÷` and `sqrt`, which give the same bits on every machine. The baseline recorded on Windows with Node 20 then passed unchanged in CI on Linux with Node 22.
- **Problem.** A net nobody has seen fail proves little. **Fix:** the table level's error limit was changed from 0.05 to 0.06 mm on purpose; the test failed with 40+ lines such as `figure.levels[1].triangles: 35012 → 25324 (-27.7 %)`. Reverted.

## Numbers

All on the **development PC** (Chrome 153), five minis of the local corpus at the time:

- Whole corpus run: 5 min 18 s baked, 1 min 22 s unbaked. 5 converted, 0 failed.
- Whole conversion, baked: 16 to 20 s for the three ordinary minis; 61 s and 152 s for the two large ones, of which the unwrap was 32 s and 109 s.
- A second unbaked run reported "Changes since the last run: None", so real minis give stable figures too.
- **CI:** the baseline test adds about 15 s to `npm run check`. 12 new tests for the regression code.

The corpus then grew: the first run over 30 minis (2026-09-21, recorded on #42) converted and baked all 30, 5.9 to 130 s each, with 17 of 30 above 15 s. That run fed the next two entries.

## Still open

- Growing the corpus to 20 to 30 minis was the PM's part; #52 only added the bookkeeping, so it said "Part of #46", not "Closes".
- The baseline records what the pipeline does today, right or wrong: the generated boulder, long and low with no base, is stood on its end by the "tallest" guess. When #44 fixes up-detection the baseline changes on purpose.
- Four older measuring scripts were only switched to the shared file lister, not re-run.
- The baseline does not record the compressed texture size.

## Story angle

How to regression-test a mesh pipeline when you may not commit a single real test file. Title idea: "Six fake minis and a sqrt".

Later: see 2026-09-23-orientation-as-its-own-story.md. Up-detection moved from #44 to its own story (#72, story 11); the boulder in the baseline changes on purpose when that story is built.
