---
title: The paint file before the first stroke
date: 2026-10-25
phase: 2
issues: []
prs: []
topics: [ui, painting, testing]
---

## What we did

Two small changes to the page around the paint file, from the PM's pre-release ideas (decided in a session on 2026-10-25, not on an issue):

- **The empty state says a paint file is welcome.** A line under the pair hint ("Have a paint file? Drop it with the STL files, or open it first.") and an **Open paint file** button that opens the same picker as the painter's footer. The three ways in of #167 existed, but nothing on the page told anyone: the card said "Drop an STL here" and the picker quietly accepted `.mtpaint`.
- **Save paint file before the first stroke.** Save was disabled at zero steps. Now it is always enabled, and the done panel has its own Save paint file under Paint this mini, with a line saying what the file keeps. A paint file with no steps holds the conversion's choices and the look: a figure in parts with its base, every question answered once, converts the same way next time without a question, and lands in the done panel rather than the painter.

## Why

The PM's second idea was to import the paint file at the first step so a multipart mini is not put together by hand again. The code already did that since #167, so the gap was discoverability, and one real hole: a conversion nobody had painted yet could not be saved at all, because Save needed a stroke and the unsaved record is only written when a step moves. The page's own words were the fix for the first, and lifting a guard for the second.

The PM's first idea, painting on the original sculpt rather than the table level, was turned down in the same session: the painter already shows the sculpt's detail through the baked normal and cavity maps, the sculpt has no texture coordinates and xatlas's time grows with the square of the triangle count (the table level is already unwrapped in eight slabs), and nothing reads a painted GLB of millions of triangles. A reference sheet for painting in real life (a turnaround and the colours used) is the output that would serve the tagline; it is a product decision still to be made.

## How

- `index.html`: `#paint-file-hint` and `#paint-file-open-empty` in the empty card, `#paint-file-save-done` and `#paint-file-keeps` in the paint section. Two new sentences in `COPY` (`paintFileHint`, `paintFileKeeps`).
- `main.ts`: `paintFileNow` reads the view's history and engines only while the painter is open on the mini, else `steps: []`; `savePaintFile` serves both buttons and writes the status line itself when the painter is not on screen; `replayOnMini` returns after setting the look when the file has no steps, and such a file for this very conversion is opened without the replace dialog, since it replaces nothing (the automatic review caught the first version, which opened the painter on an empty painting over a saved one); the `disabled` line of Save is gone; the empty state's hint hides while a paint file waits, since the status line speaks then.
- `e2e/paint-file.spec.ts`: a new test saves from the done panel before any stroke, reads the file back with no steps, opens it through the empty state's button, drops the STL with the questions on, and lands in the done panel with no question asked and Save enabled in the painter.
- Design note `painter-on-the-page.md` §4, §7.1, §7.2 and §9.1 carry "Changed (2026-10-25)" lines; README and CLAUDE.md say the same in a sentence.

## Problems and dead ends

- The empty-state button could have been left out, since the file button's picker accepts `.mtpaint` already. It stays because the hint says "open it first" and a reader looks for the button that does it.
- A zero-step file could have opened the painter on an empty painting, as any file does. It would have failed on a mini without a detail texture (the view refuses one) and would have landed the person in a painter with nothing to continue, so the done panel it is.

## Numbers

None: no pipeline or engine change. The reference screens of the empty state and of the painter change on purpose (the empty card for its new line and button, the painter because Save paint file is drawn enabled before the first stroke) and were rewritten from the first CI run's artifact with `npm run shots:take` (`docs/guides/reference-screenshots.md`); the done state's picture is unchanged, its new button lies below the panel's fold.
