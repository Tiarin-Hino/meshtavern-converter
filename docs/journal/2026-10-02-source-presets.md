---
title: Source presets, a known scale and up axis per export convention
date: 2026-10-02
phase: 2
issues: [100]
prs: [105]
topics: [stl-import, orientation, ui]
---

## What we did

A file can now be marked as coming from a known kind of source: "Print file: millimetres, Z up", "Scene units: metres, Z up" or "Scene units: metres, Y up". Picking one sets the up axis and the units together, instead of correcting both by hand for every file. The choice is a select called Source, at the question which way is up and at the top of Adjust. The library takes the same preset as an option, which is what the table application needs.

## Why

An STL file has no units and no up axis, so the converter guesses both: the units from the height, the axis from a base or from the taller of two conventions (#44, #72). Someone who always exports from the same tool corrects the same two things every time, and the table, which converts for many people, had no way to say "this tool writes metres, Z up" except by setting the two options itself. Issue #100 asks for presets that set units, scale and up axis, with a cited source for each and names that follow the repository's rule on third-party names. The work started with a design pass (Fable 5.1, `docs/design/source-presets.md`) and was built on the same PR.

## How

- **A layer under the choices, not a third method.** A preset is five fields of data. At the top of the conversion it is laid under what the person chose, field by field: an axis or units chosen by hand win, the preset fills what is left, and the converter guesses only what neither says. From there the steps see ordinary options. The alternative, a new `method: 'preset'` through the orient and size steps, would have touched every rule that asks "did the person choose an axis?" (the stance candidates, the print cut of a figure, the registration test of a pair) for no change in what they do. The page says "(preset)" instead of "(chosen)" from its own state.
- **The question still comes.** A preset is a claim about the tool, and it can be wrong for one file; nothing is turned without being shown. The file stands the preset's way at the question, and a right preset costs the same one click as a right detection. The PM may still decide that a preset skips the question; that is one line in the page.
- **Every answer is resolved under the preset as it is now.** An answer may set or clear the preset; Reset then means "the preset's axis", and an axis tried by hand wins. For a figure and its base, a preset picked at the figure's question also turns the base, which was already confirmed; so the questions start again with the base, keeping the parts as they were put together.
- **One new option in the size step.** `SizingOptions.scale` multiplies the units, for a tool whose unit is a multiple of one of ours. No shipped preset uses it yet (all have scale 1); it costs one line and the table can pass its own presets.
- **Names.** A label describes the convention, never a product; the test holds every label to "<kind>: <units>, <axis> up". A preset's `source` sentence may name the tool whose default it is, and each tool so named has a line in the README's "Third-party content".

## Problems and how we solved them

- **Two of the five proposed presets had no citation.** The design pass proposed five, two of them from memory. **Cause:** for "Sculpt: millimetres, Y up" no sculpting tool's documentation we found says both Y up and millimetres for STL (one tool lets the person choose millimetres or inches); for "CAD: inches, Z up" the CAD tools found make the STL unit a setting of the export dialog, not something that follows an imperial template. **Fix:** both left out, as the note says to; they are listed for the PM.
- **Vendor documentation pages were blocked from the cloud container.** **Fix:** the facts were read from the tools' own source at a tagged release (PrusaSlicer 2.8.1, Blender 4.2.0) and from the glTF specification's source; the citation names the file.
- **The local end-to-end run could not start Chromium.** The pinned Playwright expects a newer browser build than the container has. **Fix:** a config outside the repository that points at the installed Chromium; nothing in the repository changed.

## Dead ends

None in the code.

## Numbers

Cloud container (no GPU, software rendering): `npm run check` passes with 534 unit tests and `npm run e2e` with 48 of 48 (3.9 min); the regression baseline did not move, as expected, since nothing changes without a preset. The new pipeline tests convert the generated figure written by each preset's convention: it stands on the preset's axis and measures the same height in millimetres as without a preset, to 4 decimals. No timings were measured; the preset adds no work to any step.

## Still open

- The PM decides whether a preset should skip the up question, and confirms the naming rule and the list.
- A file in metres is drawn tiny at the question, preset or not: the camera frames at least 1 unit. A separate task.
- Reading the source from the file (an STL header often names the exporter) is a follow-up of its own.

## Story angle

STL files don't say which way is up or what a unit is: a small feature that turns "fix it every time" into one choice, and why the converter still shows the result before it trusts it. "Your exporter has an accent."
