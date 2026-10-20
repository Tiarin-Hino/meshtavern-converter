---
title: The converting pictures hold their step, and the look-presets test gets its time
date: 2026-10-20
phase: 2
issues: [183]
prs: []
topics: [testing, e2e, reference-screens]
---

## What we did

Two end-to-end tests that failed on `main` in the test container, every time, now pass there. The reference pictures of the converting state hold the step line at one step while they are taken, and the test that clicks through the look presets has two minutes instead of thirty seconds. Nothing on the page changed, and no reference picture was rewritten.

## Why

While finishing #181, a full `npm run docker:e2e` passed 116 of 119 tests, and the three failures were the same on `main` in the same container. A container run is only useful to a PR when it is green on `main`; CI showed the same tests flaking under load.

## How

- **The converting pictures.** `reference-screens.spec.ts` covers the step line (`#status`) and the bar with Playwright's magenta mask, because they move while the picture is taken. The mask is drawn over the element's box, and the step line is as wide as its words. `holdStatus` in `e2e/states.ts` now writes the line and puts it back from a `MutationObserver` whenever the page's progress writes into it; the observer runs before the page is drawn again, so every picture has the same words under the mask. `releaseStatus` lets go before the conversion is cancelled. This holds the line as `freezeFrames` holds the scenes' frames. The words held are the ones the committed set was taken with, `describeProgress` of the `simplify` step, "Reducing the detail…".
- **The look-presets test.** `smoke.spec.ts` › "offers look presets, and the export says which one the mini has" takes a picture of the viewport after each of the five presets, for the PR's sheets. With the scene drawn in software, each costs about 4.5 s. The test now sets `test.setTimeout(120_000)`, as the file's other tests on a generated mesh do.

## Problems and how we solved them

- **40 pixels differ on the converting pictures.** Two 20 px columns of red at the left and right edges of the mask over the step line, on the desktop and both phones, in both themes. **Cause:** the picture caught the conversion at another step than the committed set did. On phone-390 the line is 137 px wide with "Joining the surface…" (x 126.5) and 139 px with "Reducing the detail…" (x 125.5): the mask covers pixels 127–263 or 126–264. Which one a picture got depended on how far the 720,000-triangle conversion had come in the container. **Fix:** hold the line at the committed set's words.
- **The presets test timed out with its work done.** The page snapshot at the timeout showed the Wash slider at 0.2, the test's last action: slow, not hung. **Cause:** five viewport pictures at about 4.5 s each, against the default 30 s. **Fix:** the time it needs.

## Dead ends

- **Holding the line at "Joining the surface…".** `converting()` returns once the progress log has the read and weld steps, so the weld step looked like the one the set was taken at. The first run with that hold failed all six converting pictures with the same 40 pixels: the committed set has "Reducing the detail…". Reading the mask's columns in the expected and actual pictures (126–264 against 127–263) settled it.
- **Rewriting the converting pictures.** Not done: a new set would have recorded whichever step the run happened to catch, and the next run would differ again.

## Numbers

All in the test container (`npm run docker:e2e`, 4 of 12 cores, 8 GB, SwiftShader), on the development PC:

|                                                  | before                                                                                                                                                                        | after                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `reference-screens` + `smoke`, `--repeat-each=2` | on `main`: the converting pictures of one to three frames a run and the presets test (the #181 session's runs; once without repeats: phone-390 only, the presets test passed) | 38 of 38 passed                                                       |
| The presets test                                 | 35.4 s, timed out at 30 s                                                                                                                                                     | 24–26 s of 120 s (1.4–1.8 s to convert, about 4.5 s a preset picture) |

## Still open

- The presets test's pictures are for people reading a PR, not assertions: they could be taken once for the sheet instead of per preset, if the test's time matters later.
