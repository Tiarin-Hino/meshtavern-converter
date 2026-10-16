---
title: The keyboard test catches the file picker before its keys press it
date: 2026-10-16
phase: 2
issues: [170]
prs: [172]
topics: [testing, tooling]
---

## What we did

Now and then on CI, the keyboard test "the file button, the dialog and the theme switch with keys alone" waited 30 seconds for a file picker that never came. The page was not at fault. The test asked Playwright to watch for the picker in the same instant it pressed Enter, and under load the key could get into the page before the request to watch did. The test now starts watching for pickers before it opens the page and counts the pickers it caught. Nothing changes for someone using the converter.

## Why

The keyboard pass is part of the quality bar of #146 (spec `look-and-feel.md` L4), and CI's `ci` job, which runs it, is required on main. A test that fails one run in seven blocks code PRs for nothing and teaches everyone to press "re-run". It failed on #146's own branch and again on PR #169, which changed only the CI configuration.

## How

1. **Counting.** Of the 15 CI runs that included the keyboard spec (from #146's branch on 2026-10-15 to #169 on 2026-10-16, all first attempts), 2 failed this test, both at the same line: `page.waitForEvent('filechooser')` after Tab had reached the bar's file button and Enter was pressed. No other test failed with it on #169. The other 13 runs passed it.
2. **The page.** The bar's button calls `fileInput.click()` in its click handler, and Enter on a focused button clicks it. Nothing on the page moves the focus or listens to keys in the empty state, and `tabTo` checks the focus right before the key. A trusted key press counts as a user gesture, which Chromium needs before it opens a picker.
3. **Playwright (1.63.0).** Adding the first `filechooser` listener sends `updateSubscription` to Playwright's server without waiting for the answer. The server then sends Chromium `Page.setInterceptFileChooserDialog`. Chromium reports a picker (`Page.fileChooserOpened`, which becomes Playwright's event) only if interception was on when the file input opened it; otherwise headless Chromium closes the picker and nothing is reported.
4. **The race.** `keyboard.press` sends `Input.dispatchKeyEvent` straight away. The key reaches the page's renderer through the input channel, and the interception request through the DevTools session: two channels with no order between them, and Blink's scheduler may run input ahead of other waiting tasks. On CI the page's main thread is busy: the viewer draws every animation frame in software (SwiftShader), and a second test worker runs alongside. So the key could open the picker before the flag was set. A click does not race the same way: Playwright makes several round trips through the same DevTools session first (scrolling, visibility and hit checks), and those queue behind the interception request.

The fix is in the test: `catchPickers(page)` adds one listener before `open(page)` and collects every picker. The navigation and every evaluation after it travel the same session as the interception request, behind it. The listener also stays on for both pickers, so interception is never turned off and on again between them, as it was with two separate `waitForEvent`s. `expect.poll` waits for each picker to arrive.

## Dead ends

- **A longer timeout.** The picker did not come late. Without interception it never comes, so no wait would have helped.

## Numbers

CI (GitHub Actions, `ubuntu-latest`, 4 vCPU, SwiftShader):

|                                                                | Runs | This test failed |
| -------------------------------------------------------------- | ---- | ---------------- |
| Before, the whole suite with two workers (2026-10-15 to 10-16) | 15   | 2                |
| Diagnosis run, the old step, four workers                      | 60   | 28               |
| Diagnosis run, the new step, four workers                      | 60   | 0                |

The diagnosis run (run 38878614589) was a temporary draft PR, #171, closed without merging. Its CI ran only the file-button step, the old way and the new way, 60 times each, with four workers drawing in software at once. All 28 failures were the old way timing out while it waited for the picker. The new way also opened the card's picker with Space after each bar picker, 120 pickers in all, and caught every one. Four workers load the runner more than the suite's two, so the old way failed there more than three times as often as in the suite (47% against 13%).

## Still open

- The whole suite runs this test once per CI run, so this PR's own run proves little at a one-in-seven rate. The diagnosis run is the evidence, and the next weeks of CI will confirm it.

## Story angle

"The key that beat the debugger": a flaky test where the page was right and the test's own wait raced Chromium's two channels into the page.
