---
title: How often a mini is right without a correction
date: 2026-10-02
phase: 2
issues: [101]
prs: []
topics: [measurement, corpus, orientation, sizing]
---

## What we did

The corpus run now says, for every mini, whether the converter got three things right by itself: which way is up, the scale, and the base size. It adds them up to one rate, lists the minis that fail by kind, and keeps the rate in its results, so the next run says which minis changed. The first measured rate: 21 of 29 corpus minis (72 %) need no correction.

## Why

Issue #101: a person should rarely have to correct a mini after import, and the table application (Phase 2) needs to know how often that holds. The corpus run already checked the up direction (#72) and the size suggestion (#44) against `scripts/corpus-index.json`, each in its own section, but nothing said whether one mini was right in everything, the scale was not checked at all, and no number was kept from run to run.

## How

- **What "right" means.** A mini is right when all three checks hold with every question confirmed as detected:
  - _up_: the up direction in the file is the index's `up` (or the index's `rotation` for a mini the six ways cannot stand up, compared as a quaternion, either sign);
  - _scale_: the units guessed from the height are the file's. The corpus is print files, so the expected units are mm unless an index entry says `units`. No entry does today;
  - _base size_: the creature size suggested (from the measured base, or Medium without one) is the index's `size`.
- **Who is counted.** A mini counts when the index has both its `up` and its `size`. A counted mini that does not convert counts as not right. Minis the index cannot judge are listed as not counted, so the rate does not look better than it is by leaving them out silently.
- **Only a run that confirms the detection measures it.** With `--up index` the minis stand as the index says, so that run reports "not measured" and writes `automatic: null`.
- **Where it lives.** `scripts/lib/automatic.mjs` is pure (figures in, rate and Markdown out) and has unit tests in `src/regression/automatic.test.ts`, which run in `npm run check`; `scripts/corpus.mjs` calls it. `results.json` keeps the rate as `automatic` (the totals, each check, per kind, per mini), and `results.md` opens its "Right without correction" section with the rate, then the comparison with the last run, the kinds, the failures and the table of every mini.
- **No third-party names.** The failures are listed by corpus key, grouped by kind. Keys are the neutral names the index is committed under (`quadruped/quadruped-02`); the notes printed next to them come from the index too.

## Problems and how we solved them

- **Problem.** The last results in `out/corpus/` came from a run with `--up index`, where every mini stands as expected. **Cause:** that run answers the questions from the index. **Fix:** the rate is only computed when the questions are confirmed as detected; the comparison with the last run says "No earlier rate" when the earlier run did not measure it.

## Numbers

Development PC (RTX 3060, i7-11700F, 64 GB, Chrome 154), `npm run corpus`, baked, 2026-10-02, commit b1cfc96 plus this change. 32 corpus entries converted, none failed.

- **Right without correction: 21 of 29 (72 %).**
- Up: 24 of 30 (80 %). Every mini whose up came from a base is right (16 of 16); of those decided by the taller axis, 8 of 14.
- Scale: 32 of 32 (100 %). Every corpus file is in mm and read as mm; the check has nothing hard to work on yet.
- Base size: 24 of 29 (83 %).

| Kind           | Right  |
| -------------- | ------ |
| flying         | 2 of 4 |
| humanoid       | 8 of 8 |
| large-creature | 3 of 4 |
| mounted        | 1 of 2 |
| quadruped      | 2 of 4 |
| swarm          | 2 of 3 |
| terrain        | 3 of 4 |

The eight that fail:

- Up only, all without a flat base in the figure's file, decided by the taller axis: `flying/flying-02`, `mounted/mounted-03` (both figures with a base file), `quadruped/quadruped-02`.
- Up and size: `large-creature/large-01` (up +y for -y, Huge for Gargantuan), `quadruped/quadruped-03` (no base: Medium for Tiny), `swarm/swarm-02` (no base: Medium for Large).
- Size only: `flying/flying-03` (Small for Tiny; Tiny is never suggested, by design), `terrain/terrain-01` (a 107 mm base reads as Gargantuan, expected Huge).

## Still open

- Three entries are not counted: `large-creature/large-04` (a kit, no expected size in the index) and `mounted/mounted-01-mount` and `-rider`, which are in the corpus under names the index does not have; the index still has `mounted/mounted-01`. The index needs the PM's values for them.
- The scale check will stay at 100 % until the corpus has a file in inches or metres.
- The placement of a figure on its base is not part of this rate; it has its own score against the recorded placements (#70).
- Up without a base is the weak spot (8 of 14): #90 (up from print-cut soles for a single file) is the open issue for it.
- The rate is kept in `out/corpus/results.json`, which is local. Over time it is tracked by the journal entries that quote it.

## Story angle

One number for "it just works": what it takes to say honestly how often an automatic import needs no fixing, and what the misses have in common. Possible title: "72 % right, and where the other 28 % go".
