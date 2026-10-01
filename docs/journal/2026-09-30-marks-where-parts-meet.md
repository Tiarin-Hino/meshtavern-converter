---
title: Marking where the parts meet
date: 2026-09-30
phase: 1
issues: [93]
prs: [95]
topics: [placement, ui, worker, tooling]
---

## What we did

A figure with its base is now shown on the base before it converts: the automatic placement, with two pins where the figure and the base meet. If the placement is wrong, you tap a spot on the base and a contact on the figure (a recess floor and a sole, a hole in the side of a rock and a peg), and the figure is set there, its contact against the spot. Raise, Lower and Turn then move it along and about the spot. A mini can also come as up to six files: a body, its wings or other parts, and a base. The parts are shown together first, where their files put them, and a part that lies apart is joined by the same two taps.

## Why

The placement of #70 finds seats on a base's top from above. It cannot see a hole in a vertical face, such as the giant bat's peg going into the side of its spire. It guesses on sculpted tops, and it knew nothing about figures shipped in parts. Correcting a placement meant a second conversion. Issue #93 asked for marks on the full-detail models before anything is reduced. A design pass on Fable 5.1 planned it (`docs/design/marks-where-parts-meet.md`). The PM answered its seven questions the same day, and changed three of them: the meeting is shown before the conversion for every pair, not on request. Raise, Lower and Turn exist at the question once something is marked, but not after the conversion. The PM also asked for a session in which they mark the hard corpus minis themselves. Opus 5.5 built it on 2026-09-30.

## How

- **Two marks fix five of six freedoms.** A mark is a tapped point in its file's coordinates. The worker finds the nearest triangle and averages the normals of the surface within 1 mm (within 60° of the nearest triangle's, so a hole's rim stays out). The figure is turned so the contact's normal opposes the spot's, and moved so the points coincide. The only freedom left, the turn about the normal, is the Turn button. A flat sole on a flat floor is the identity turn, bit for bit: the figure keeps its orientation.
- **The worker decides every transform.** Each question now carries each file's mesh once, and where to draw each file. The page draws, taps and pins; it composes no transform. A tap on the base, or on a part in place, is the spot. A tap on the figure, or on a part not yet placed, is the contact. There is no mode button (the PM's choice), and the figure is laid beside its base while one mark is set.
- **A new `assemble` step** puts a figure's parts together in the body's frame before the orient step. A part without a joint keeps its file's coordinates bit for bit, so a kit exported in place converts to exactly the one-file mesh. The design pass's survey found 34 of 50 winged kits in the library exported in place. The roles are guessed over every file, and "no base" makes the files parts of one figure.
- **The proposal is shown as pins.** For the base: the vertex of the figure's contact footprint nearest its centre, and where it was set. For parts in place: where each touches its neighbour, found with a search tree. A part further than 1 mm from every other lies apart and gets no pins: nothing new is detected.
- **The marking session.** `npm run feedback -- --mark` walks the corpus pairs the PM placed by hand, the bat and every kit, baked, every question on the page. It writes the results into `scripts/corpus-placements.json`, and `npm run corpus -- --up index` answers those minis from the recorded choices.

## Problems and how we solved them

- **The camera framed the base, then cut the figure off.** It framed once per conversion, at the base's question. **Fix:** it reframes when other files are shown, the figure is laid apart, or the scene's size changes by half or more.
- **The figure laid beside the base sat behind the panel.** **Fix:** what a question shows is centred across.
- **Three test expectations were wrong**, not the code. The second meet question shows the marked placement; the reset comes one answer later. The scene is recentred, so the wing's move shows between the wing and the body. A parts question confirmed before the roles changed stays in the record, as a confirmed base does since #92.
- **Resolving a mark was over twice the budget on the largest file** (807–1020 ms). **Cause:** the design pass's 40 ms per pass was a guess; a pass over 6 million triangles through their indices costs several hundred. **Fix:** a pass over the vertices first bounds the search by the nearest vertex. The triangle pass tests each box on x before loading the rest, and allocates nothing: 345–446 ms, the same triangle found.
- **Parallel e2e runs time out on this PC**, in different tests each run, as #70 found. With one worker, as CI runs, every test passed.
- **A shell heredoc broke on quotes** three times. **Fix:** the edit scripts went to files.
- **The automatic review found four bugs in replaying choices** after the roles change. A record's joints were answered under the guessed roles. A recorded Swap was never replayed. The placement score dropped a record's roles. The page kept its joints after another base was named, and sent them back. **Fix:** replay the roles first and the swap once, pass the roles through, and drop the joints on both sides. A new e2e test fails without the last fix.
- **The time to the question looked 44 % slower** for single files, whose path did not change. A timing script that forgot to reset `questionMs` first gave stale numbers. Reset before each run, a build of `main` and one of this branch, alternating, gave the same times.

## Numbers

Development PC (i7-11700F, RTX 3060, 64 GB), 2026-09-30.

- **One answer at the meet question** on the largest corpus pair (5.6 M-triangle figure, 1 M-triangle base), in Node (`scripts/measure-place.mjs`): 345–446 ms, the mark on the base 11–38 ms, on the figure 309–367 ms; budget 300 ms. A mark is resolved once per conversion; Raise and Turn only place the figure again.
- **A tap's raycast** in Chrome (`scripts/measure-pick.mjs`), three.js over every triangle: 62–77 ms on the 1.25 M-triangle humanoid (budget 300 ms), 834–898 ms on the largest pair.
- **The corpus** (`npm run corpus -- --no-bake --up index`, Chrome 153, window in front): 30 of 30 converted. Against the run of #92, the only figure that moved is the new `meet` entry in each of the 15 pairs' `asked` list. Triangles, levels, spots, offsets and sizes are identical. Untouched steps ran at 1.03–1.08× (medians).
- **The place step** grew by the meet question's work (the automatic placement's pins, the layout beside the base): 16–95 ms → 60–294 ms on the 14 ordinary pairs, 178 → 736 ms on the largest pair.
- **Time to the question** of single files read 1.44× slower in that run. Timed again against a build of `main`, four runs of three files each, alternating: the same (the humanoid 864–1501 ms against 974–1828 ms on `main`). The evening's machine, not this work.
- **Regression baseline:** two new cases. `peg-marked-in-hole` puts the peg's end on the hole's floor. `figure-in-parts` (the figure's arm in a file of its own) has the same figures as `figure-on-base`, except 4 bytes of GLB name. No other row moved; `npm run score-placements` gives the same table as `main`.
- Unit tests 427 → 451; e2e 37 → 42, all passing with one worker.

## Still open

- The PM's marking session and the corpus kit (criterion 5): the kits come from the PM's library, copied as `<name>-part-<label>.stl`. Some library kits have 12 to 25 parts, more than `MAX_PARTS`.
- The largest file's tap (0.9 s on the page's main thread) and mark (0.4 s in the worker) are over budget. A search tree (three-mesh-bvh on the page) is the PM's call.
- The time to the parts question and the peak memory of a kit are measured once a kit is in the corpus.
- Marking comfort on a real phone is the PM's note; the e2e test taps with a touchscreen at phone size.

## Story angle

"Two taps and a normal": why a point and a surface direction are all it takes to put a peg in a hole, and why most multi-part kits needed no taps at all.

Later: see `2026-10-01-patches-where-parts-meet.md` (the marking reworked into patches in pairs).
