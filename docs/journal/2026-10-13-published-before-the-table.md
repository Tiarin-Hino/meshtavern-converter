---
title: The page is published before the table, with the painter on it
date: 2026-10-13
phase: 1
issues: [47]
prs: [140]
topics: [planning, ui]
---

## What we did

Recorded a reversed decision in `docs/specs/phase-1-converter.md`: the page is published on GitHub Pages before the table application exists, with the mini painter on it. The painter is the engine of #126 to #128 behind a panel that becomes a library entry of its own, so the page and the table application mount the same tools. A painting is saved as a **paint file**: the converter's version, a fingerprint of each source file, the conversion's choices, the look and the steps the engine records (`history()`), no pixels and no geometry; it reopens an unfinished painting on the page, is refused for files whose fingerprints differ, and replays the same painting in the table application later. #47 is the publishing task again. The three decisions beside the reversed one stand: GitHub Pages, downloads of the table and far levels only, nothing collected.

## Why

The PM decided on 2026-10-13 to give the converter to the community as a free tool before the table is finished, so the converter gets real use and polish while the table is built, and so the people who try it can bring their painting to the table once it exists. The engine already replays strokes as data for undo, deterministically on one GPU (design note `docs/design/painting-engine.md`, section 8), which is what makes a file of strokes the painting's source rather than a picture of it.

## How

The product spec with the stories lives in the private repo (spec 10, amended the same day); this repo gets the technical items once that amendment is merged: the paint file and the replay in the engine, the panel as a library entry, the painter on the page with Save and Open of the file, the downloads carrying the paint, the promise test extended, and the publication.

## Dead ends

None.

## Still open

Which of the `release-blocker` issues (#87, #98, #118) must close before the page is published is the PM's call per issue.
