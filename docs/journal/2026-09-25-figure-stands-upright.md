---
title: A mini you can turn by hand, and a detection that did not stand the minis up
date: 2026-09-25
phase: 1
issues: [72]
prs: [79]
topics: [orientation, regression, performance, ui]
---

## What we did

The page now lets you turn a mini freely, in 15° steps or with a rotate gizmo, and apply the turn or set the mini down on its lowest points. Nothing converts until you press Apply or Set down. The converter records how it turned a mini as a rotation, and the exported file carries it for the table. Finding which way is up got faster. The story's main aim, standing up minis without a base by themselves, was built as designed and did not work on the corpus. It was taken out again, and those minis keep the old guess until the PM decides what next.

## Why

Story 11 of the Phase 1 spec (#72): the first corpus run found 7 of 30 minis not upright, all without a base (`2026-09-23-orientation-as-its-own-story.md`). A design pass on Fable 5.1 (`docs/design/figure-stands-upright.md`) planned the work. Opus 5.5 built it in PR #79, where the design's own stop rules ended the detection part.

## How

- **One pass over the triangles** collects the flat resting area on all six axes, the volume and its centroid. The base measurement takes its coverage instead of repeating the loop. An open shell is caught because its face area vectors do not cancel out (`OPEN_SHELL_SHARE`).
- **A rotation, not only an axis.** `Orientation` holds the axis, how it was decided, a quaternion and the tilt. A quarter turn still swaps coordinates, so the regression baseline did not move.
- **Set down** finds the convex-hull facet the mini lands on when dropped and levels it, snapping to the axis within 2°.
- **Ground truth.** Every baseless corpus mini was rendered on all six axes (renders stay local). The expected up direction went into `scripts/corpus-index.json`, and `npm run corpus` checks it.

## Problems and how we solved them

- **The detection stays over its 200 ms budget on the largest file.** **Cause:** its 2.8 M vertices do not fit the processor's cache, and its triangles point all over them. Fetching every triangle's corners alone takes about 260 ms. **Not solved:** sampling triangles would make the base coverage an estimate, which the design leaves to the PM.
- **Set down does nothing on rounded feet.** **Cause:** next to the lowest point of a rounded paw, the flattest hull facet is a tiny patch of the same paw. A table on flat pads levels exactly; a generated quadruped with round paws, tilted 30°, stays tilted. **Not solved:** that needs real rolling on a convex hull, part of the PM's decision.
- **A shell command ran by accident.** Backticks inside an inline script started a second corpus run, which overwrote the local comparison sheets of 2026-09-24. **Fix:** the results file was restored from a copy; the sheets come back with the next full run.

## Dead ends

- **The design's stance score** (216 drop directions, the facet each lands on, and the signs of a resting creature, weighted) stood 1 of 17 baseless minis upright and level. Two of its signs point the wrong way on real sculpts. Raised weapons, wings and capes put the height up and the mass down, so "more volume above the middle" often prefers upside down. And most standing figures cannot stand on their own feet: they were sculpted for a base they do not include. Scoring only the six axes with the same signs got 7 of 15 right; the old "taller of Y-up and Z-up" gets 10 of 17.
- **Setting down on the lowest points** tilts minis that stood right. On their correct axis, 6 of 15 stayed, 6 tilted by 3–12° and 3 tipped 59–82° onto another side. Falling towards the weight instead moved the failures around and was reverted.
- **Tuning the loop for V8.** A branch-free loop and smaller functions gained nothing; the corner fetches dominate.
- **The pass in file order** takes about 155 ms once warm, but about 540 ms on the first call, the one a conversion makes.

## Numbers

Plain Node 20.19.2 on the development PC, median of 7 calls:

| Mini                    | Triangles | Detection before → after | Orient step before → after |
| ----------------------- | --------- | ------------------------ | -------------------------- |
| large-creature/large-01 | 5.6 M     | 896 → 538 ms             | 1830 → 569 ms              |
| humanoid/M-001a         | 1.25 M    | 68 → 20 ms               | 188 → 82 ms                |
| quadruped/quadruped-02  | 0.5 M     | 46 → 12 ms               | 83 → 18 ms                 |

`npm run corpus -- --no-bake`, Chrome 153 on the development PC, started unattended. Untouched steps ran 10–50 % slower than on 2026-09-24, so these times are upper bounds:

- **Orient step:** largest file 1953 → 760 ms; ordinary minis 95–183 → 62–114 ms.
- **Up direction:** 24 of 30 minis match the index (the PM confirmed the last two flyers). The 6 misses are fallen baseless minis; one of them, the largest file, is also tilted 45° in the file.

The design's stance score, not shipped: 200–300 ms per ordinary baseless mini, 832 ms on the largest file (Node).

Unit tests 225 → 280; e2e 17 → 18.

## Decisions

The PM decided on the PR (2026-09-25): detection is a help and leaves Phase 1's acceptance, and the user's placement is final. The detection budget scales with the mesh: 150 ms per million triangles, at least 200 ms _(proposal)_; the largest file's 538 ms is inside its 840 ms. Setting down happens only on request: the six-way select and a new Apply button keep exactly what the user chose, and Set down levels.

## Still open

- Better detection of minis without a base, and levelling rounded feet: after Phase 1, if wanted.
- A clean timed corpus run from the PM's session.

## Story angle

Seven minis fell over, and "stand it on its feet" cannot fix them: a mini made for a base cannot stand on its own feet. Possible title: "Your mini can't stand on its own two feet".
