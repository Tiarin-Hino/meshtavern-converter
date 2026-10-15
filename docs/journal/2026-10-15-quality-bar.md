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

- **The scan** is axe-core through Playwright (`@axe-core/playwright` 4.13.0, pinned like the application's), with the WCAG 2.2 A and AA rules, in every state the page, its questions and the `?dev` Paint tool can be in, both themes. Serious and critical fail; every result is attached to the report as text. The full list is in `e2e/accessibility.spec.ts`.
- **The keyboard pass** sweeps with Tab: it lists every visible, enabled control not taken out of the order (`tabindex="-1"`: the hidden file inputs, the menu's items), presses Tab until the focus comes round, and asserts each was reached with a 2 px solid outline in the colour `--focus-ring` resolves to. Flows then drive each kind of control with keys only (`e2e/keyboard.spec.ts`).
- **The reference pictures** are Playwright's `toHaveScreenshot`, one set per platform (the platform is in the file name), canvases hidden, the converting step masked, motion reduced; the Linux set is committed. `docs/guides/reference-screenshots.md` says how to read a failure and rewrite them.
- **Held frames.** While a picture is taken, `freezeFrames` keeps the page's animation-frame callbacks and hands them back after (see Problems).
- `e2e/states.ts` holds the ways into each state the three specs share. "The two phone frames" of the issue are read as the two phone sizes the page's tests already hold the sheet to, 375 × 812 and 390 × 844.

## Problems and how we solved them

- **Two empty yellow buttons while converting.** The scan's first run failed on `button-name` for `#ask-confirm` and `#meet-confirm`. **Cause:** since #144 the question view moves its two Confirm buttons into the page's footer, and only hides them when a question is shown; before the first question both stood visible and empty under Cancel on the converting card (`page.spec.ts` took a picture of it, nobody saw it). **Fix:** the view hides them when it moves them; `page.spec.ts` asserts the footer holds Cancel alone while converting.
- **The chosen pair's chip hid the focus ring.** **Cause:** `questions.css` draws a pressed pair chip's outline in its pair's colour, which is more specific than the theme's one focus rule. **Fix:** the pair's outline yields while the chip has the keyboard's focus.
- **The credits dialog failed the contrast rule, once.** **Cause:** the scan ran while the dialog was still fading in. **Fix:** the scan runs with reduced motion, under which the theme turns off the dialog's and the menu's animations.
- **A picture at the question waited more than a minute.** **Cause:** with 2 workers on 4 cores, each test's question scene drew continuously in software, and a picture waits for a frame. **Fix:** `freezeFrames` holds the animation-frame callbacks while the pictures are taken and hands them back after. The run went from 9 min with 3 failures to 29 s.

## Dead ends

- A longer screenshot timeout: 5, 30 and 60 s all ran out, and it would only have hidden the cost.
- The stylesheet injected once instead of with each picture (`stylePath`): no change.

## Numbers

All on the cloud container (4 cores, Chromium 141 headless shell, SwiftShader).

- The scan: 24 scans, no violation of any impact.
- The reference run: 3 tests, 30 pictures, 25–29 s with 2 workers; two runs in a row compared clean; the same set compared clean in the full Chromium 141 build too; a picture deleted and written again came back byte-identical. 972 KB for the Linux set.
- `npm run check`: 681 unit tests pass.

## Still open

- **The Linux set must come from CI.** The first CI run differed by 1–2 % of the pixels in every picture (text drawn by CI's newer Chromium); this session can reach neither CI's artifacts nor that browser build. The comparisons are now soft, so one run writes every actual picture; CI uploads them as `reference-screens-actual`, and `npm run shots:take` puts them in place. Until then the reference test is red on CI.
- **The Windows set** is written on the development PC's first run and committed from there.
- The scan reads axe's rules for contrast with the theme's real colours; the contrast of every pair of roles stays the application's check.

## Story angle

Two tiny tests that each found a real defect nobody saw in the pictures, and a screenshot that hung because the 3D scene behind a hidden canvas never stopped drawing.
