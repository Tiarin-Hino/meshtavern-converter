---
title: The largest corpus mini on the reference laptop
date: 2026-10-02
phase: 2
issues: [103]
prs: [107]
topics: [devices, performance]
---

## What we did

We converted the largest file of the test corpus, a 281 MB sculpt of a large creature with 5.6 million triangles, on the reference laptop. It becomes a mini with a baked 2048 px texture, compressed, in 104 s. The laptop does not refuse it and nothing crashes. No code changed; the figures are now in the Phase 1 spec (story 8).

## Why

Phase 1 proposed that the largest corpus mini converts on the weak device in 3 minutes or less, but the file was only ever run on the development PC (114 s). The PM moved the run out of the phase's exit criteria on 2026-10-02 and made it a release blocker, #103 (see `2026-10-02-phase-1-exit.md`). Two things were unknown: how long the laptop takes, and whether the file fits its memory at all. The converter estimates a conversion's peak memory before it starts and refuses a file that would need more than half of what the browser reports for the device (#43, `2026-09-23-files-that-are-not-clean.md`); that estimate had never been compared with a measurement on the laptop.

## How

The build of `main` (c282d0f) was served on the laptop itself with `vite preview`, which is what `npm run lan` serves to other devices, and opened in real Chrome 149 with the window in front, a fresh browser profile per conversion, on the power cord. A one-off script in the git-ignored `out/` folder, made from `scripts/measure-memory.mjs`, picked the file, confirmed the question "which way is up" as detected, and read the page's own figures (`window.__mt.state`: step times, time to the question, longest stall) and the operating system's peak of resident memory per Chrome process (`VmHWM` in `/proc`). Three conversions: the file alone twice, and once with its base file as a pair.

## Problems and how we solved them

- **The build did not run on the laptop.** `vite build` stopped with a missing export of `node:util`. **Cause:** the laptop had Node 20.5.1; the repo needs 20.19 or newer. **Fix:** Node 22.23.3 from nodejs.org, checksum verified, unpacked in a user folder and put first on the `PATH`; the system Node is untouched.
- **The expected refusal did not come.** From the estimate we expected a laptop to be allowed 4 GB (half of the 8 GB Chrome used to report at most). **Cause:** Chrome 149 reports `navigator.deviceMemory` = 32 on this 32 GB laptop. **Fix:** none needed; the budget is 16 GB and the file fits by a wide margin. The refusal itself therefore remains unseen on the laptop.

## Numbers

Reference laptop: i7-1265U, Intel Iris Xe, 32 GB, Ubuntu 24.04, Chrome 149, on the power cord (CPU governor `powersave`, power profile `balanced`, the system's defaults), window in front. Times are the sum of the pipeline's steps as the page reports them.

|                                   |  File alone, run 1 |  File alone, run 2 | With its base file |
| --------------------------------- | -----------------: | -----------------: | -----------------: |
| Triangles                         |          5,625,026 |          5,625,026 |          6,065,066 |
| Whole conversion                  |            104.1 s |            105.1 s |            112.5 s |
| read / weld / orient              |  0.2 / 2.9 / 0.9 s |  0.2 / 2.9 / 0.9 s |  0.2 / 3.1 / 2.8 s |
| place                             |                  – |                  – |              5.4 s |
| simplify                          |             56.0 s |             56.6 s |             59.4 s |
| shade / levels                    |        0.6 / 0.4 s |        0.6 / 0.4 s |        0.6 / 0.4 s |
| unwrap / bake / encode            | 5.6 / 32.0 / 5.5 s | 5.6 / 32.4 / 5.5 s | 5.4 / 29.7 / 5.4 s |
| File picked to question on screen |              4.4 s |              4.4 s |              5.6 s |
| Longest stall                     |             203 ms |             168 ms |             189 ms |
| Peak memory, page process         |           2,117 MB |           2,117 MB |           2,442 MB |
| Peak memory, GPU process          |             211 MB |             208 MB |             209 MB |
| Estimate (`memory.ts`)            |           2,774 MB |           2,774 MB |           3,229 MB |

- The conversion takes 58 % of the 3 minutes proposed. More than half of it is the simplify step (reducing the sculpt to the levels), a third the bake.
- The estimate is 31 % (alone) and 32 % (pair) above the measured peak: on the safe side, slightly outside the 5–30 % it was fitted to on the development PC.
- The time to the question is within the 15 s proposed for the largest file.
- The laptop is a little faster than the development PC's 114 s. That figure is from 2026-09-23 and an older Chrome, so the two are not a like-for-like comparison.

## Still open

- **The stall is over the limit.** 168–203 ms against the 100 ms limit the corpus run reports against; the two smaller minis measured on the laptop earlier stalled 17 and 33 ms. Which moment stalls (showing 5.6 million triangles at the question is the first suspect) was not located: #108.
- The "too large for this device" refusal was not seen on the laptop, because no corpus file comes near 16 GB. It is covered by unit and e2e tests only.
- A laptop with 8 GB would be allowed 4 GB and would also convert this file (2.1 GB measured); a 4 GB device would refuse it (2,774 MB needed, 2,048 MB allowed). Neither was measured.
- The 3-minute limit is still marked as a proposal in the spec.

## Story angle

A 281 MB sculpt becomes a game-ready mini on integrated graphics in under two minutes, inside a browser tab that never uses more than 2.2 GB. Possible title: "Five million triangles on a laptop without a graphics card".
