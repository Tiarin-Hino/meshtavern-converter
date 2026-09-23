---
title: Orientation becomes its own story
date: 2026-09-23
phase: 1
issues: [44, 70, 72]
prs: [73]
topics: [planning, orientation]
---

## What we did

A new story in the Phase 1 plan, "Figure stands upright" (#72, story 11 in the spec). It owns one thing: a figure file without a base comes out standing, without the user working out axes. Story 4 (#44, scale and base) and story 10 (#70, a base file next to the figure) now name it as a dependency, and the epic's order lists it between the two.

## Why

The first `npm run corpus` over the 30-mini corpus (2026-09-21) found seven minis not upright: two quadrupeds, a mounted figure, the largest dragon, a swarm standing on its edge and two flyers. All are figure files without a base, stored in print orientation. The base detector from Phase 0 finds nothing on them and falls back to "the taller of Y-up and Z-up", which is right for a standing humanoid and wrong for anything long and low. Some of the seven look tilted rather than turned by a quarter, so the six-way "up" selector on the page cannot fix them by hand either.

The Phase 1 exit criterion asks for an upright mini without manual help, but no story owned orientation. The question on #44 was whether it should join that story or become its own. The PM asked whether #70 could take it, since setting a figure down on a base file needs to find its feet anyway. The answer was no, for three reasons: five of the seven fallen minis were dropped without a base file and never enter #70; #70 depends on #44, and #44 already generates a plain base under a baseless mini, which requires knowing which way is down first; and both stories get simpler when neither half-solves the problem. The PM agreed on 2026-09-23.

## How

- **Detection when there is no base** _(proposal)_: score the candidate directions by the signs a resting creature shows. The lowest points form a wide, level cluster (feet, paws, a swarm's underside) rather than a line or a point; more of the volume sits above the middle than below it, because bodies and heads sit over legs; the printing conventions (Z-up, then Y-up) only break ties. This replaces "tallest axis", not the base detector, which keeps priority.
- **Tilt, not only quarter turns** _(proposal)_: after the direction is chosen, the mini is set down on its lowest points so that the resting plane is level within 2°. A mini already resting flat is not moved.
- **Manual correction stays the guaranteed path**: free turning on the page, then "set down" again; the six-way select remains as the coarse step. Nothing is turned silently, the project's convention for every guess.
- **The result carries the orientation as a rotation**, so #44 places the plain base under the upright figure, #70 matches feet to a recess, and the table can reproduce it.
- **Pass mark**: all 30 corpus minis upright by detection alone. A corpus index records the expected up direction per mini and `npm run corpus` reports every mismatch. That index does not exist yet: today the script only walks the git-ignored corpus folders. The spec now names it once, in story 4: a committed `scripts/corpus-index.json`, keyed by the file's path under `corpus/`, holding the expected creature size for #44 and the expected up direction for #72; whichever story is built first creates it; the generated shapes of the CI baseline get the same check.
- **Order**: #44 is built first on today's fallback with the interface left open; #72 follows; #70 after both. The page control lands in the plain form and is restyled with #41.

## Still open

- Whether the three signs are enough for all seven fallen minis is exactly what the story has to find out; a learned model is the fallback only if they fail, as a follow-up.
- Minis lying down on purpose (a corpse marker, a fallen tree) will be "corrected" wrongly; the manual path covers them, and the corpus has none yet.
- Three numbers in the story are guesses, not measurements: the 2° levelling tolerance, the 15° manual step, and the 200 ms detection budget for the largest file. The base detector took 35–115 ms on five small minis (2026-09-20 entry); nobody has timed anything on the 281 MB dragon.

## Story angle

Seven of thirty minis fell over, and the wolf explains why "tallest is up" was never going to work.
