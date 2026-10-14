---
title: The stress test lets go of its 100 minis
date: 2026-10-14
phase: 2
issues: [151]
prs: []
topics: [testing, tooling]
---

## What we did

The end-to-end test that fills the table with 100 minis now waits until the browser has drawn the scene without them, opens the page again, and only then ends. The test after it no longer starts in a browser that is still busy with 100 minis. Nothing changes for someone using the converter: this is a fix in the test suite.

## Why

The painting engine (PR #131) added `e2e/painting.spec.ts`, which keeps the other test worker busy with software rendering: 5 minutes at first, about 10 since the hobby brushes (PR #132). Since then, the test right after the 100-mini test, "draws the 32 mm grid and stands stress minis one footprint apart", has failed before its body ran:

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

That happened in runs 290 and 313 (dependabot PRs), 297 and 308 (main), 300 (the first attempt) and 315 (PR #150, twice). It held up PRs that had nothing to do with it. The second error in the log varied:

- runs 290, 300, 313 and 315's second attempt: `browser.newContext: Protocol error (Browser.setDownloadBehavior): Failed to find browser context for id …`;
- run 297: `browser.newContext: Test ended.`;
- run 308 and 315's first attempt: none.

## How

The test now does three things after "Single mini" is clicked, all within its own time (raised from 180 s to 300 s):

1. It still waits until `state.perf` says the stress scene is gone.
2. It takes a screenshot. Playwright adds no wait of its own; Chromium's capture copies a newly drawn frame, and in software rendering that frame comes only after every frame queued before it. CI's renderer sometimes refuses a capture ("Unable to capture screenshot", which `scripts/lib/feedback-session.mjs` already meets). The test then goes on without it.
3. It opens the page again and waits until it is ready, so the browser tears the stress page down inside this test rather than after it.

It prints how long steps 2 and 3 took on every run. If the grid test still fails while those times are short, this was not the cause.

Two other fixes were dropped:

- Giving the next test's hook more time would blame the wrong test and hide the cost.
- Closing the page by hand can return before the GPU work has caught up, which would move the stall into the next test.

## Problems and how we solved them

- **The old guard did not wait for a frame.** The test's comment, and this journal's scale-and-base entry of 2026-09-23, said the test "ends on a drawn frame". **Cause:** `state.perf.minis` is the length of the stress list, which is emptied as soon as "Single mini" is clicked and copied into the state on a 500 ms timer. Waiting for 0 proves no frame was drawn. **Fix:** the screenshot in step 2.
- **The failure was reported in the wrong place.** Playwright says "while running beforeEach hook" also when the time runs out in a fixture the hook needs. Where the log names the pending call (runs 290, 297, 300, 313, 315's second attempt), it was the next test's `browser.newContext`, before the hook's own `page.goto` started. So a first proposed patch, more time inside the hook, would not have helped.
- **Playwright's own end-of-test screenshot hides the backlog.** With `screenshot: 'on'` it gives up after 5 s and swallows the error, so the context can close with frames still queued. The 5.7 s measured below is past that limit.

## Numbers

Measured in the Claude Code cloud container (4 cores), Playwright 1.63, Chromium in software GL. The screenshot time is counted from when `state.perf` showed 0:

| Run                                                                | 100-minis test | grid test | screenshot | page open again |
| ------------------------------------------------------------------ | -------------- | --------- | ---------- | --------------- |
| The two tests alone, pinned to 2 cores, before the fix             | 22.0 s         | 6.9 s     | —          | —               |
| With `painting.spec.ts` in the other worker, pinned to 2, with fix | 33.7 s         | 16.1 s    | 5,703 ms   | 1,606 ms        |
| The whole suite on 4 cores, with the fix (72 passed)               | 22.4 s         | 4.8 s     | 1,422 ms   | 791 ms          |

The original failure did not reproduce in the container, so CI's runner is probably slower. The new log line will give its own figures.

CI before the fix: this test failed in 5 of the 16 completed e2e attempts after PR #131 was merged (runs 289 to 313), and in 2 of 2 on PR #150.

## Still open

- The fix rests on the measured backlog, not on a reproduced failure.
- Runs 297, 300 and 309 (the last two on their first attempt) also failed "runs the device benchmark and offers the result as text" at its 180 s, and run 297 the 400 ms stall limit (450 ms). The benchmark draws 100- and 400-mini scenes too; not addressed here.
- The CI job's limit is 25 minutes and recent jobs took up to 23.7. The new steps add seconds to a normal run.

## Story angle

A test that passes and breaks the next one: how a software renderer's queue of unfinished frames outlived the page that made them. "The frames that weren't drawn yet."
