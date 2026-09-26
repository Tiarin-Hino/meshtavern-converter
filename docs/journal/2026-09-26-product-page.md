---
title: A product page instead of a spike page
date: 2026-09-26
phase: 1
issues: [41]
prs: [80]
topics: [ui, testing, workflow]
---

## What we did

The converter's page no longer looks like a test bench. Someone who opens it sees one card: "Drop an STL here", a button and the sentence "Your file never leaves your computer." While a file converts, the card names the step in words ("Unwrapping the surface · 40 %") above a progress bar and a Cancel button. When the mini is ready, a panel on the right says how tall it is, what size of creature it is and what base it stands on. It offers two downloads, the table level and the far level, and keeps the controls for turning, sizing and painting under one "Adjust" heading. When a file does not work, the card says why in one sentence and offers another file. On a phone the panel becomes a sheet at the bottom of the screen. The figures, the stress scene, the device benchmark and the other tools from the spike are still there for the team, with `?dev` in the address.

## Why

Story 6 of the Phase 1 spec (#41): one obvious thing to do, clear feedback while it works, and a mini at the end, without reading instructions. The page had grown one control at a time since Phase 0: a header of fieldsets, a table of figures and a benchmark panel, all visible at once. The work started with a design pass on Fable 5.1 (`docs/design/product-page.md` and six wireframes, the start of PR #80), and Opus 5.5 built it in the same PR.

## How

- **Four states, derived.** The page is in one of four states (empty, converting, done, error), and the state follows from the app state (`pageStateOf` in `src/page-state.ts`); nothing sets it by hand. One `render()` in `main.ts` writes it to `body[data-state]`, and every element names the states it shows in (`data-in="empty error"`). This replaced about twenty lines that flipped `hidden` panel by panel, which is where the old page's odd combinations came from.
- **Wording in one tested module.** Every sentence the page shows is a constant or a pure function in `page-state.ts`, with unit tests: the step labels, the size line ("38 mm tall · Medium, 1 square · 25 mm round base") and the ready line. Changing a word is a one-line change the PM can ask for on the PR.
- **Tools removed, not hidden.** Every tool of the spike carries `data-dev` in the markup and is removed from the document at start-up unless the address has `?dev`, so a product page has no benchmark button to find. The hooks in `window.__mt` keep working in both modes, and the tests that look at the tools open the page with `?dev`.
- **Downloads by level, not by view.** "Download table level" and "Download far level" always write their own level, whatever level is on screen. Looking at the close level cannot change what a download contains. The close level is never exported (PM decision, 2026-09-20). The compressed variant went behind `?dev`: a person downloading here wants a file Blender opens.
- **The promise has a test.** `e2e/promise.spec.ts` records every request while a file with a marker in its header is picked, converted on the normal path (baked and compressed) and downloaded twice. It asserts that every request goes to the page's own origin, as a `GET` without a body, with a short address that does not contain the marker. After the pick, only the page's own files under `/assets/` and `/basis/` may be fetched. A deliberate POST of the marker, added to a throwaway copy of the test, fails it.

## Problems and how we solved them

- **A panel beside the viewport broke the stress test.** The first build put the done panel in a grid column next to the canvas. The 100-mini stress scene then drew 99: its camera is fixed, and in a narrower canvas one mini fell out of view. **Cause:** a departure from the design note, which puts the panel _over_ the viewport. **Fix:** the panel overlays the canvas on a desktop, as designed, so the stress scene and the benchmark keep the view they had. On a phone the sheet takes its own row, because a sheet over the canvas would cover the mini.
- **The promise test found a `blob:` script.** After the pick, three.js starts its KTX2 transcoder worker from a `blob:` URL that it builds in memory from `/basis/basis_transcoder.js`. **Cause:** a `blob:` URL is an object inside the tab, not a network request, and the note's rule ("paths under `/assets/` or `/basis/`") did not foresee it. **Fix:** the test accepts `blob:` URLs of the page's own origin and says why. Everything else stays under the rule.
- **The promise test passed alone and failed in the suite.** It waited until the page was "not converting", which was already true in the moment between picking the file and the page starting to read it. **Fix:** it waits for the done or the error state.
- **Old tests ran against an old page.** The e2e tests reuse a server on port 4173 outside CI. An `npm run lan` left running since 2026-09-23 served the old build, so the first run of the new test failed with `state.page` undefined. **Fix:** build before running e2e locally; the old server serves the new `dist/`.
- **"Keeps the page responsive" timed out twice locally.** It converts 500k triangles and took over 30 s instead of 3 s when the Playwright workers ran the new page tests (which bake) at the same time. **Cause:** CPU contention between parallel workers on the development PC. Run alone six times in a row it took 3.0 to 3.4 s. CI runs one worker. Not changed; noted here in case it shows up again.
- **The team's pictures showed the panel over the mini** (review). `corpus.mjs`, `compare-look.mjs`, `compare-bake.mjs`, `measure-baked.mjs` and `measure-stress.mjs` screenshot `#viewport`, and the done panel and the level chips now lie over it. **Fix:** each script hides `#panel` and `#levels` with a style tag after loading the page. Not run here (no Chrome in the review environment).
- **The wording lived in two places** (review). `index.html` carried the same sentences as `COPY`, so changing `COPY` changed only the tests. **Fix:** elements name their string with `data-copy` and start-up writes `COPY[key]` into them; the HTML has no product wording left.
- **A dropped `.obj` did not show the error card** (review): it wrote the refusal into the status line and left the state as it was. It now goes to the error state like the other refusals.

## Dead ends

- Showing the step as "unwrap… 60 % (40 % of this step)", as the spike did: two percentages for one bar. The bar now shows the share of steps done, and the line names only the step and its own progress.

## Numbers

- The promise test: 7 requests after the pick on the normal path (three scripts and the Basis encoder under `/assets/`, the transcoder's script and WebAssembly under `/basis/`, one `blob:` worker). None of them carried the file. Development PC, Playwright's Chromium.
- Phone layout at 390 × 844: the canvas keeps 450 px of 844 (53 %), the sheet 338 px (40vh). The size line and both downloads fit in the sheet's first screen, and every button in the panel is at least 44 px high.
- e2e suite: 23 tests. It takes about 5 min on the development PC with parallel workers.
- Screenshots in the PR and in `docs/design/product-page/built-*.png`: Playwright's Chromium on the development PC, software rendering (SwiftShader), 1280 × 720 and 390 × 844. They show generated meshes only.

## Still open

- The PM's visual call on the built page, and the wording proposals of the design note (every string of its §4, plain GLB as the download, GLB opening behind `?dev`, Adjust closed on a phone).
- While a new file converts, or when it fails, the previous mini stays in the viewport behind the card; the viewer has no way to clear it yet.
- The rotate gizmo works with a finger, but nobody has tried it on the phone yet.

## Story angle

The page's promise has a test: every request after picking a file must be one of the page's own files. "How we test that a privacy promise on a web page stays true."
