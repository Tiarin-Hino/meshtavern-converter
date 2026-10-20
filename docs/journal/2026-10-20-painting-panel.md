---
title: The painter's panel, a library entry on MeshTavern's components
date: 2026-10-20
phase: 2
issues: [166]
prs: [187]
topics: [painting, library, ui]
---

## What we did

The panel a painter works with, the tools, the brush's sliders, the colour with its pipette and swatches, the regions, the mask, the groups and the look, is now part of the library, drawn on MeshTavern's own components, in light and dark. Once the page's painter (#167) mounts it, a person who opens Paint sees the panel of the approved mockup beside the mini, with Undo and Redo at the top; the table application's paint dialog will show the same panel. Today it shows in the team's `?dev` Paint tool, which now mounts it in place of its own plain controls.

## Why

Decision 9 of the application's spec 10 (item C6): the panel belongs on this side of the line, so a tool or a slider is built once and the page and the table look the same. Until now the engine's design note (`painting-engine.md` §10.1) left the panel to each consumer, and the only panel was the `?dev` tool's hand-made row of controls. The design pass on Fable 5.1 (`docs/design/painting-panel.md`, draft PR #187) decided the entry's shape, the sections and their order, the words, the icons and the phone; this build follows it.

## How

- **A sixth entry, a consumer of the view's public interface.** `meshtavern-converter/painting-panel` (`src/lib/painting-panel.ts`, stylesheet `painting-panel.css`) imports the view only through `../painting` and the data through `../index`. If the panel can be built from there, so can the application's own controls; the ESLint deep-import rule now refuses `lib/painting-panel/*` from the page and the tests too.
- **No state of its own.** `mountPaintingPanel({ view, controls, copy?, palette?, names?, pickMode? })` writes its template once and from then on only reflects `view.state` (the swatches are `panelSwatches(recentColours(view.history()), palette)`, read when the history or the palette move). The two lists that change shape, the swatches and the groups' rows, are rebuilt only when their key moves; everything else is attribute writes.
- **Three additions to the view, each additive.** `subscribe(listener)` so the panel hears every state after the consumer's own `onChange` without the consumer forwarding it by hand; `state.look` so the Look section reads the look like every other section reads its state; and the one-shot pipette `pickColour(mode?)` with `cancelPick()` and `state.picking`. The `?dev` tool had put a capture listener on the view's host to steal the next tap before the view's brush saw it; a consumer could only copy that. Now the view owns the wait: its own capture listener on the canvas takes the tap (`stopImmediatePropagation`, so neither the brush nor the orbit controls see it), and the host carries `mt-painting-picking` with a crosshair. None of the three changes a byte a stroke writes: every pixel test and the recorded painting pass unchanged.
- **The order** _(proposal)_: History, Tool, the tool's settings, Colour, Regions, Mask, Groups, Look. The mockup draws the history row last; with eight sections the panel scrolls, so Undo moved to the top where it is never under the fold.
- **The groups as rows.** The `?dev` tool's row of checkboxes and a target select became the components' `.rows`: a row a group, its name and triangle count on the button that makes it the target of the group tools, Hide (eye) and Pull apart (move-3d) beside it as `.tool`s, and a row for a new group. The two tools are children of the row, not of `.row-actions`, which the components show on hover only.
- **Icons** _(proposal)_: a third generated module from the pinned `lucide-static` 1.55.0: `layers` for the lift, the `shield` family for the four mask tools, `group` and `lasso-select` for the group brush and fill, plus the mockup's.
- **The `?dev` tool on the panel.** `#paint-controls` is the panel's element; the team section `#paint-team` keeps what the product panel does not show (Open, the pipette's mode, Save as PNG, Close, the frame counter). Every pixel test and the PM's brush sessions now go through the panel's wiring, so a slip there shows before #167.

## Problems and how we solved them

- **Problem.** The panel kept a flag to tell its own cancelled pick from a tap off the mini, and still could not tell a consumer's `cancelPick()` from a miss. **Cause:** the view resolved both with null, though it knew which had happened. **Fix** (the automatic review's note on the build): a pick ended without a tap (cancelled, closed, replaced) resolves with undefined and a tap that hit nothing with null; the flag went. The same review found four words of `PAINT_COPY` that nothing showed once the `?dev` tool's own controls went (`groups.show`, `groups.into`, `groups.apart`, `recent.label`); they were dropped, and the pipette's `pick.hint` became its tooltip.
- **Problem.** On the phone frame, Show mask's switch was a squashed circle over its own label. **Cause:** the page's phone rule `#panel input[type='checkbox']:not(.mt-questions *)` sizes every checkbox in the panel to 20 px, the switch's input included, and an id selector beats the component's class. **Fix:** the rule leaves `.mt-painting-panel *` alone too; the panel sizes its own checkboxes on a phone.
- **Problem.** Hiding a group with Space lost the keyboard focus. **Cause:** the state change rebuilds the groups' rows, and the focused button was replaced. **Fix:** the rebuild remembers which control had the focus (`data-target`, `data-shown` or `data-apart` and its group) and focuses its successor; the keyboard test asserts it.
- **Problem.** A pressed swatch that got the focus showed the accent outline of "pressed", not the focus ring, which the keyboard sweep checks on every control. **Fix:** `.swatch:focus-visible` takes the focus ring after the pressed rule.
- **Problem.** A picture of `#paint-controls` was cut off. **Cause:** the panel sits in the page's scrolling panel (on a phone, in the sheet), and a picture of an element ends where its scrolling frame does. **Fix:** the panel's reference pictures use the three widths at a height tall enough for the whole panel (2600 px on a desktop, 3400 px on a phone), and take the panel alone, so the page's `?dev` figures with times in them are not on the picture.
- **Problem.** In the container the panel's light picture timed out "waiting for element to be stable", and once that was fixed the phone-390 picture came out 20 px too low. **Cause:** a picture of an element waits for two animation frames to see it still, and `freezeFrames` holds every frame; then `scrollIntoView` scrolled the window as well as the panel, and on the phone the sheet was still rising when the box was measured. **Fix:** the page clipped to the panel's box, the box read again until it stays put, only `#panel-body` scrolled, and 30 s for a 3,400 px frame in software rendering.
- **Problem.** ESLint refused the percentage's thin space (`no-irregular-whitespace` checks template literals). **Fix:** a named constant `THIN_SPACE` written as its escape.

- **Problem.** On CI the panel's pictures differed from the container's set by 189–222 pixels, 1 %. **Cause:** the base coat's hex was in `--font-code`, and the theme ships no monospace, so each machine drew it in its own (the container and the CI runner have different ones); every other line is Inter or Fraunces from the theme and matched. A group's row also stood in its hover colour on CI, under Playwright's tolerance: the pointer left over the panel after its scroll, and moving it to the corner did not clear the hover there. **Fix:** the hex is in the theme's text face with tabular figures; the panel takes no pointer events while its pictures are taken.

- **Problem.** CI's run was cancelled at its 45 minutes, and a phone's panel test spent its 240 s waiting for a browser context. **Cause:** the panel's tests converted and painted at 2,600 and 3,400 px tall, so the viewer and the paint scene drew canvases that size in software rendering throughout, and the next test waited for their teardown; main's own runs already take 37–42 of the 45 minutes. **Fix:** the page works at the frame's size, the scenes' frames are held, and only then is the window made tall for the picture; the frames are not handed back. The panel tests went from 25–40 s to 16–19 s in the container.

## Dead ends

- **Leaving `aria-label` flipping between Hide and Show** as the note's §5.7 has it. A toggle button whose name changes with its pressed state reads twice inverted ("Show, pressed" for a hidden group). The build keeps one name, "Hide: The base", with `aria-pressed` while hidden, and only the icon changes; noted on the PR for the PM.

## Numbers

- **Frame rate, development PC (RTX 3060, Chrome through Playwright, `scripts/measure-painting.mjs`), before (main at `b97f735`) and after (the `?dev` tool on the panel).** Every brush on the generated figure and on large-01: the engine's counter median 0.1–0.3 ms a frame before and after, the time between frames a median of 6.1 ms (the display's 165 Hz) in both, 0 slow frames in both. The panel does nothing per frame: the view emits at a stroke's start and at its commit, and the panel's `show` is attribute writes. Single long intervals between frames (42 ms and 97 ms once each on large-01 after, 24 ms before) came in different runs in different places and are the machine's.
- **Undo through a paint file's 111 steps on large-01**: the first after-run had a median of 16 ms and 3 undos over 100 ms against 8 ms and 1 before, which looked like the swatches' `view.history()` copy on every undo; run again, after and before were 7 ms and 8 ms, one undo over 100 ms each. Noise; the swatches' rebuild costs nothing measurable.
- **Open**: 542 ms after, 583 ms before (generated figure); 903 and 1,060 ms after, 781 and 1,166 ms before (large-01, two runs each): within the spread.
- **CSS budget** (`src/theme-files.test.ts`, gzip level 9): `painting-panel.css` 1,577 B; the six stylesheets 18,971 B of the 40 KB budget (17.3 KB before, `style.css` +15 B).
- **e2e times**: the full `docker:e2e` run 37.7 min for 129 tests (4 cores, 8 GB, software rendering); each panel picture test 18–25 s, the keyboard pass over the panel and the two scans about 1.8 min together on the PC's Chrome.

## Still open

- The page's Paint beside Adjust, the paint file's Save and Open, the device palette: #167, which mounts this panel (`painting-panel.md` §11.1).
- Keyboard shortcuts for Undo and Redo (Ctrl+Z, Ctrl+Shift+Z): once both consumers say where the focus lives while painting.
- The pipette's mode as a product control: `'shown'` always on the page; `'painted'` stays in the `?dev` team section.
