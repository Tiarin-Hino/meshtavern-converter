---
title: Five starting points for the look
date: 2026-10-02
phase: 1
issues: [45]
prs: []
topics: [look, export, ui]
---

## What we did

The Look section of Adjust now starts with five buttons: Grey primer, Bone, Black drybrushed, Steel and Bronze. One click sets the base coat and the three sliders (shadows, wash, edges) to values that go together, and the mini on screen changes at once. The sliders are still there for anyone who wants to go on from a starting point. A downloaded GLB file now says which look the mini has: the values, and the name of the preset when they are one.

## Why

Story 7 of the Phase 1 spec (#45): a few good-looking starting points instead of five controls, with the choice stored with the mini. Until now the page had one look, grey primer, and anything else meant picking a colour and moving three sliders by feel. The export carried the colours themselves but not the settings they came from, so the table could not show or offer the same choice again.

## How

- **A preset is a name and a value for each existing control, nothing more.** The issue says "on top of the existing look controls", and the library's design note had already settled that a preset is a named `Look`. So `LOOK_PRESETS` in `src/lib/pipeline/look.ts` is a list of five such values, and the first one is the default the page always had. Nothing in the shader, the bake or the conversion changed, and the regression baseline did not move.
- **The preset is read from the values, not stored next to them.** `presetOf(look)` compares a look with the five presets and returns the one it equals, or null. The page keeps no second piece of state that could disagree with the sliders: move a slider and no button is pressed; move it back and the button is pressed again. The alternative, a stored "current preset" cleared on every slider event, is the kind of state that goes stale.
- **The export records both.** A GLB written with a sizing gets `extras.meshtavern.look`: the preset's id or null, and the five values. The colours themselves stay in the vertex colours as before. A look of the user's own is recorded with `preset: null` and its values, so nothing is lost when no preset fits.
- **The buttons are built from the list.** `main.ts` makes one button per preset with a stripe in its base coat; the unit test holds the list between four and six, on the sliders' 0.05 steps and in the colour input's lower-case hex, so every preset is a state the controls can show. `scripts/compare-look.mjs` now reads the presets from the page and renders them side by side for corpus minis (`--baked` for the look the table shows).

## Problems and how we solved them

- **Steel looked like grey primer.** The first steel was a slightly cooler grey with stronger edges; on the sheet of a humanoid mini it could not be told from the primer. **Cause:** the look has no metallic surface, only a coat, shadows and edge highlights, so "steel" can only differ by colour and contrast. **Fix:** steel became a dark gunmetal (`#565e68`) with edges at 0.9, and bronze a darker brown (`#7a4f24`) with edges at 0.7. They read as painted metal colours, not as metal.
- **The full end-to-end run failed on timeouts, a different set each time.** With eight parallel workers, started from an unattended session at night, 7 and then 9 of 46 tests timed out inside conversions this change does not touch. **Cause:** eight Chrome instances converting at once starve each other on this PC. **Fix:** the run with one worker, as the earlier full runs here were made: 45 of 46 passed, the one failure was the browser failing to open a context, and that test passed when run again.

## Dead ends

None in the code. The export first seemed to need its own block for the look, written even without a sizing; it stayed inside `extras.meshtavern`, which exists only with a sizing, like the rotation, because that block is what the table reads and a converted mini always has a sizing.

## Numbers

Development PC, Chromium via Playwright: all 46 end-to-end tests have passed on this branch, 45 in the one-worker run (6.1 min) and the last on its own. `npm run check`: 503 unit tests pass. No pipeline times changed; none were measured.

## Still open

- The PM chooses the presets' values and the default (the issue's third criterion). Sheets: `docs/design/look-presets/generated-figure.png` for the stand-in figure, and `out/look/` on the development PC for three corpus minis.
- A real metallic surface (reflections, a tinted highlight) would need new look controls and a change to the shader and the GLB material. Not in this story.
- The look is not kept between visits to the page; the page stores nothing.

## Story angle

A paint rack with five pots: how little a "preset" needs to be when the look is already computed at draw time. Possible title: "Five buttons, zero new shader code".
