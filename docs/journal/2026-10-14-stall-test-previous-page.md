---
title: The stall test waits for Chromium to let go of the page before
date: 2026-10-14
phase: 2
issues: [156]
prs: [157]
topics: [testing, tooling, performance]
---

## What we did

The end-to-end test "the page does not freeze while a mini is converted, baked and shown" now starts its conversion two seconds after the page opened rather than right away. In the first second after a navigation, Chromium is still tearing down the page that was there before, and on a CI runner without a GPU that teardown held the new page up for 100–650 ms. The page itself did not change. The frame watch now also says in which step its longest gap fell (`state.longestFrameGapDuring`), and the test's failure message prints it. The CI job may now run 35 minutes instead of 25.

## Why

From 2026-10-13 the test failed now and then on CI with a longest gap above the 400 ms CI limit: 450 ms on the hobby-brushes PR (run 38448393224), 433 ms on #144's branch, 400 ms on main after #144, and 650 and 450 ms on PR #155, which changed only words. It looked as if the theme (#143) and the components (#144) had made the page slower. They had not caused it: the first failure came a day before them.

## How

We measured on CI, because the PC did not reproduce it. On the reference Windows PC with SwiftShader the worst gap was 33–83 ms, with all cores or pinned to two.

1. The frame watch records where the longest gap falls. On CI it fell in the worker's `simplify` or `shade` step every time (or across it, `simplify → unwrap`). The page's main thread does nothing in those steps: progress comes once per step, and a long-task observer saw no task over 100 ms there.
2. How much ran before the test in the same browser seemed to matter: 17–67 ms alone, 117–183 ms after the bake test, 133 ms after the whole smoke file, 250–283 ms in the full suite. That turned out to be mostly different runners: the same job got an AMD EPYC 9V74 one time and a 7763 another, with step times up to three times apart.
3. The test that settled it, on one runner, interleaved, six times each: converting right after `ready` gave 133–200 ms; converting after waiting 2 s gave 17–33 ms. And in every immediate run the gap started at the same page time, 1,010–1,026 ms after navigation, whatever the conversion was doing.
4. A Chrome trace of that gap (`browser.startTracing`, written into the report folder) named it. The page's main thread ran one task for the whole gap: `LayerTreeHost::~LayerTreeHost` → `ProxyMain::Stop`, posted by Blink's `widget_base.cc` `Shutdown` with a task delay of exactly 1,000,000 µs. It waited on `RasterImplementation::Finish` on the compositor thread, which waited for the GPU process (`GpuChannel::ExecuteDeferredRequest`, the renderer compositor's command buffer) to run everything queued. One second before the teardown, the trace has `navigationStart` for `http://localhost:4173/` in the same renderer process: the test's `page.goto('/')` replacing the page from `beforeEach`.

So Chromium shuts the old document's widget down when the new one commits, and destroys its compositor a second later. Destroying it means a GPU finish, which in software lasts until SwiftShader has drawn whatever our page queued in the meantime. The test started converting about 0.4 s after navigation, so that wait landed about 0.6 s into the conversion: in `simplify` or `shade`. How long it lasted depended on how fast the runner was.

The fix is in the test, not the page: it waits until `performance.now()` is past 2 s (the second plus a margin for a busy runner) before the conversion. Everything the test is about stays cold: the shaders, the transcoder, the unwrapper and the encoder still load and compile during the conversion. A person on a GPU pays a few milliseconds for that finish, and only when a file is dropped within a second of a reload.

## Problems and how we solved them

- **Trace attachments were missing from the report.** `testInfo.attach` with a 50 MB JSON body did not reach the HTML report. **Fix:** the diagnosis spec wrote the trace into `playwright-report/diag/`, which the CI job uploads anyway.
- **Tracing made its own gap.** Started right before the conversion, tracing put an 850–1,100 ms gap in every run, all at about 1 s after navigation. That was the same teardown, made longer by tracing. **Fix:** tracing started before `page.goto`.
- **Two test workers at once doubled the numbers.** The first diagnosis ran the traced spec next to the real test, and the real test failed 12 times out of 12 (517–900 ms). **Fix:** every later measurement ran with `--workers 1`. CI's e2e run does not: `playwright.config.ts` sets no `workers`, so on the 4-vCPU runner Playwright runs two, and the figures below are single-worker ones. This PR's CI runs are the two-worker evidence.

## Dead ends

- **The viewer drawing every frame.** The viewer draws its scene every animation frame, also while a conversion runs and nothing on it changes, and in software that takes CPU the worker needs. Holding the drawing during a conversion (drawing only when the camera moves or the canvas changes) brought the gap after the bake test from 150–183 ms to 117–133 ms, and the full suite stayed at 250–283 ms. It was not the cause, so it is not in this PR.
- **The theme's fonts and the components' animations.** No long task, timer or font event lined up with the gap; the trace showed none of them in it.

## Numbers

All on GitHub's `ubuntu-latest` (4 vCPU, AMD EPYC 7763 or 9V74, SwiftShader), the generated 180,000-triangle sheet (`loadGenerated(300)`), baked, `--workers 1`:

| When the conversion starts   | Longest gap, 6 runs on one runner |
| ---------------------------- | --------------------------------- |
| Right after `ready` (before) | 133, 167, 150, 200, 167, 133 ms   |
| 2 s after navigation         | 17, 17, 17, 33, 17, 17 ms         |

Failures before the fix: 450, 433, 400, 650 and 450 ms against the 400 ms CI limit. On the reference Windows PC (SwiftShader) 33–83 ms either way.

## Still open

- The CI limit stays at 400 ms. With the teardown out of the measurement, the gaps on CI were 17–33 ms, but those were single-worker runs and CI runs two workers, so whether the CI limit could go down to the spec's 100 ms is the PM's call once a few more CI runs show where the numbers settle.
- "runs the device benchmark and offers the result as text" also ran past its 180 s on one slow runner (and on 2026-10-13): software drawing of the stress scenes, a separate flake.

## Story angle

A flake blamed on the new theme turned out to be the browser tidying up the page before, one second late. Possible title: "The stall that was not ours".
