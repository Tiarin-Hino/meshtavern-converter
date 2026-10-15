---
title: The quality bar: accessibility scan, keyboard pass, reference screenshots
date: 2026-10-15
phase: 1
issues: [146]
prs: [159]
topics: [ui, testing]
---

## What we did

Three new e2e tests keep the page's look and its use without a mouse from slipping before it is published. An accessibility scan checks every state of the page in both themes; a keyboard pass checks that Tab reaches every control with the theme's focus ring and that every kind of control works with keys; and 30 reference pictures (five states, a desktop and two phones, light and dark) fail the run when a pixel of the page moves. The scan and the keyboard pass each found a real defect, both fixed here.

## Why

The table application keeps its look with the same three tests (its spec 07 U7), and the page must hold the same bar before it is published (spec `docs/specs/look-and-feel.md` L4, K5 of the epic #148, design note `docs/design/look-and-feel.md` §11). It runs after K3 (#144, the page on the components) and K4 (#145, the words), so the pictures show the finished page.

## How

- **The scan** is axe-core through Playwright (`@axe-core/playwright` 4.13.0, pinned like the application's), with the WCAG 2.2 A and AA rules. It runs over empty, the drag overlay, the credits dialog, converting, error, the up question, done with every section of Adjust open, the pairs stop and the final view of a figure on its base, the phone's More menu and sheet, and the `?dev` Paint tool, each in light and dark. A serious or critical violation fails; every result, the rest included, is attached to the report as text.
- **The keyboard pass** has two halves. The sweep lists every visible, enabled control not taken out of the order (`tabindex="-1"`: the hidden file inputs and the menu's items, which the arrows move between), presses Tab until the focus has come round, and asserts each was reached with a 2 px solid outline in the colour `--focus-ring` resolves to. It runs in seven states and on a phone. The flows then drive each kind of control with keys only: both file buttons (the `filechooser` event), the theme switch, the credits dialog (Tab stays inside, Escape gives the focus back), a disclosure, a level chip, a look preset chip, a slider, the six-way axis in the panel and at the question, Confirm, the More menu and the sheet's handle.
- **The reference pictures** are Playwright's `toHaveScreenshot`, one set per platform (Playwright puts the platform in the file name). The canvases are hidden by `e2e/reference-screens.css`, the converting step and its bar are masked, motion is reduced. The Linux set, the one CI compares, is committed; a platform's first run writes its own. `docs/guides/reference-screenshots.md` says how to read a failure and how to rewrite the pictures.
- `e2e/states.ts` holds the ways into each state the three specs share. The done state of the pictures comes from the generated figure with `?bake=off`: the canvas is not on them, so the texture is not needed.
- "The two phone frames" of the issue are read as the two phone sizes the page's tests already hold the sheet to, 375 × 812 and 390 × 844.

## Problems and how we solved them

- **Two empty yellow buttons while converting.** The scan's first run failed on `button-name` for `#ask-confirm` and `#meet-confirm`. **Cause:** since #144 the question view moves its two Confirm buttons into the page's footer, and only hides them when a question is shown; before the first question both stood visible and empty under Cancel on the converting card (`page.spec.ts` took a picture of it, nobody saw it). **Fix:** the view hides them when it moves them; `page.spec.ts` asserts the footer holds Cancel alone while converting.
- **The chosen pair's chip hid the focus ring.** **Cause:** `questions.css` draws a pressed pair chip's outline in its pair's colour, which is more specific than the theme's one focus rule. **Fix:** the pair's outline yields while the chip has the keyboard's focus.
- **The credits dialog failed the contrast rule, once.** **Cause:** the scan ran while the dialog was still fading in. **Fix:** the scan runs with reduced motion, under which the theme turns off the dialog's and the menu's animations.
- **A picture at the question waited more than a minute.** With 2 workers on 4 cores, each test's question scene drew in software continuously; the first picture after a theme change took 9 s in a probe and never came in the full run, at 5, 30 and 60 s timeouts. Taking the stylesheet out of each picture (`stylePath`) and injecting it once changed nothing. **Fix:** `freezeFrames` holds every `requestAnimationFrame` callback while the pictures are taken and hands them back afterwards, so the scenes stop drawing and go on afterwards. The run went from 9 min (3 failed) to 29 s (all passed).

## Dead ends

- A longer screenshot timeout: 60 s was not enough, and it only hid the cost.

## Numbers

All on the cloud container (4 cores, Chromium 141 headless shell, SwiftShader).

- The scan: 24 scans, no violation of any impact.
- The reference run: 3 tests, 30 pictures, 25–29 s with 2 workers; two runs in a row compared clean; the same set compared clean in the full Chromium 141 build too; a picture deleted and written again came back byte-identical. 972 KB for the Linux set.
- `npm run check`: 681 unit tests pass.

## Still open

- **CI's Chromium is a newer build than the container's.** The Linux set was written with Chromium 141; if CI's draws text differently, the first CI run fails and the set is rewritten from its report (the guide says how).
- **The Windows set** is written on the development PC's first run and committed from there.
- The scan reads axe's rules for contrast with the theme's real colours; the contrast of every pair of roles stays the application's check.

## Story angle

Two tiny tests that each found a real defect nobody saw in the pictures, and a screenshot that hung because the 3D scene behind a hidden canvas never stopped drawing.
