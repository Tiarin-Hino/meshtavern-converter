---
title: Detect the up axis from the base, with a fallback guess and a manual override
date: 2026-09-20
phase: 0
issues: [21]
prs: [22]
topics: [orientation, stl-import, testing]
---

## What we did

The converter now works out which way is up in the file instead of assuming it. It looks for the flat base a mini stands on; if there is none, it makes an educated guess; and a selector on the page lets the user say "up is this axis" and convert again. The figures row says which of the three decided: `base`, `tallest` or `manual`.

## Why

The first orientation step (`2026-09-19-weld-orient-place.md`) assumed every STL is Z-up, the slicer convention, and always rotated by 90°. When the PM added two detailed commercial 32 mm minis to the local test set to judge the detail levels, both came out lying on their backs. Their files were Y-up, the convention of sculpting tools, and they had no base: bare feet. The size read-out gave it away: 32 × 29 × 48 mm, with the 48 mm height ending up as depth. Issue #21 recorded the bug; the Phase 0 spec already required a manual fallback for orientation.

## How

- **`detectUpAxis` looks for the base.** For each of the six directions (±x, ±y, ±z) it adds up the area of faces that point straight down (within 10° of it) and lie on the lowest plane (within 2 % of the mesh's extent), and divides by the footprint seen from that direction. That share, called `coverage`, is the confidence figure. A mini on a base has a large flat underside, so the direction with the most coverage is "down". Coverage must reach 15 % to count, because feet and cloak hems touch the ground with far less.
- **Without a base, pick the taller convention.** When nothing reaches 15 %, the code compares the two conventions that actually occur, Y-up and Z-up, and picks the one that makes the mini taller. Standing figures are taller than they are wide. On a tie it stays with Z-up.
- **Manual override.** An "Up axis in file" selector converts the file again with a fixed axis; hook `window.__mt.setUp(axis)`.
- **Always rotate, never mirror.** `orientAndPlace` now handles all six directions, each as a proper rotation, so a mini is never flipped into its mirror image and its triangles keep facing outwards. A unit test checks the signed volume after each of the six rotations: a mirrored mesh would turn it negative.

14 new unit tests, 47 in total.

## Problems and how we solved them

- **The bug itself.** Minis stored Y-up lay on their backs. **Cause:** a hard-coded Z-up assumption, which held for the PM's own minis and was never tested with a Y-up file. **Fix:** detection as above. It only surfaced because the test set gained minis from a different source, which is an argument for a varied regression corpus (a Phase 1 story).
- **Minis without a base defeat the base detector.** **Cause:** bare feet give almost no flat resting area. **Fix:** the `tallest` fallback plus the override, with the method shown so the user knows when the converter was guessing.

## Numbers

Development PC, Chrome 153, the five minis of the local test set:

- All five come out upright: three by `base` (coverage 36 to 73 %), two by `tallest`.
- Detection costs 35 to 115 ms per mini.

## Still open

- The `tallest` guess is wrong for long, low creatures without a base: a wolf on all fours is longer than it is tall. The override is the answer for now; a small learned model is a candidate for later.
- Files in other units or needing scale to a base size are a Phase 1 topic.

## Story angle

A bug found only because a different kind of file showed up, and the one-line clue in the size read-out that explained it. Possible title: "Which way is up? Ask the base".
