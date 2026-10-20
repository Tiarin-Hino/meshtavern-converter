---
title: Groups pulled apart, each painted on its own
date: 2026-10-19
phase: 2
issues: [180, 139]
prs: [181]
topics: [painting, ui, textures, testing, performance]
---

## What we did

The painter can pull a mini's groups apart: the arm, the head, the shield or the base is drawn beside the body with a gap, every side of it in reach, and a stroke on it paints it alone, where the same stroke with the groups together would also catch the shoulder behind it. Put together brings everything back. Like hiding (#139), pulling apart is not a step: Undo never moves a group. In the team's Paint tool a Pull apart button lays every group out at once, Put together gathers them, and a box beside each group pulls that one apart on its own.

Built quietly (`/implement-quiet`, Fable 5.1) while the PM used the PC; the full run (`/continue-pr`, Opus 5.5, 2026-10-20) ran the deferred list on the development PC, fixed the `?dev` tool's box a group, and ends the work in PR #181.

## Why

The PM's decision on #139 (2026-10-13, corrected): pull groups apart while painting, each moved by its own offset, some apart and others together. #139 built hiding and fixed the data so this changes no shape: every vertex shader already read each group's offset from `uGroups`, every step already recorded `groups.apart` (always empty), and the fill already honoured an `apart` class per triangle. The design note's §9 is the brief; this entry is the build.

## How

- **The rule is the parts question's.** At the pairs stop of #93 a figure's parts are laid apart by `pulledApart`: each part whose box comes within a gap of the body's moves along the line from the body's middle to its own, just far enough to clear the body and the parts moved before it, by `APART_SHARE` (15 %) of the body's largest side, at least `APART_MIN_GAP_MM` (10 mm). The rule is now `apartTranslations`, over boxes, and `groupsApart` runs it over the boxes of a mini's groups; on the winged figure's three files as one mesh it gives `pulledApart`'s translations bit for bit, and the pairs stop is unchanged (its tests pass as before).
- **Everything happens in the coordinates the mini is drawn in.** The display, the stroke's depth map and the dab pass draw each vertex at its position plus its group's offset, as #139 already had them. A pointer's hit is found by one ray cast per distinct offset, the ray moved by the opposite offset and the cast kept to that offset's groups, the nearest hit winning; its point is recorded as drawn, so the dab pass, which compares drawn positions with the dab, paints the group the dab is on and nothing of a neighbour that lies far away as drawn. Only `texelAt`, the tests' tap, gives its point back in the mini's own coordinates, and a lift stroke looks under its start there, where the paint's stamp is.
- **The record makes the replay the same.** A stroke or a fill made with groups apart records every offset in `groups.apart`; its replay writes them into the uniform, renders the same depth map, draws the same distances and floods within the same classes, then puts the view's own offsets back. So Undo and Redo give the same bytes with the groups together, as the e2e test proves. A step made with nothing apart and nothing hidden has no `groups` field, so every record before this change reads the same.
- **The brush lifts between offsets, not between groups.** The note said a hit on another group than the last hit's lifts the brush. By group, a stroke running from the body onto the head, both at zero, would lift and leave a spacing gap between two groups that touch, and strokes with nothing apart would change. The view lifts when the hit's group is drawn at another offset than the last one's: with nothing apart every hit is in one class.
- **The camera frames what is drawn.** `PaintScene.reframe` frames the box of the groups as drawn with the camera's current angles and zoom; the sphere the camera orbits moves by the change from the mini's own box to the drawn one, so with nothing apart the camera is bit for bit where it was.

## Problems and how we solved them

- **A hidden group could still be hit after the first cast was cached.** The casts a hit takes (one per offset) are built once and kept; hiding a group changed what they should skip but not the cached cast with no filter. **Cause:** the cache was dropped on an offset change only. **Fix:** hide, show, a group edit and a keyframe restore drop it too. Caught reading the diff, before any test ran.
- **The scene already had a `frame`.** The loop's method; the new one is `reframe`.
- **The #139 Paint tool test counted eleven boxes where it expected six.** CI's first run. **Cause:** the new "Apart" box beside every group but the body matched its `input[type="checkbox"]` locator. **Fix:** it counts the shown boxes, `input[data-group]`. The same run had two timeouts outside this change (the smoke test's look presets at 30 s, the phone's meet test at 240 s), and the second run two more (the phone's meet test again, the smoke benchmark at 180 s), 117 passed. The Playwright reports of main's run and this branch's, side by side, say why: every spec ran 30–40 % slower on this branch's runner, the ones this change does not touch included (the feedback spec 115 → 155 s, the up question's large mesh 25 → 51 s, the thumbnail 25 → 44 s), and the painting spec 965 → 1,412 s, of which the three new tests are 109 s. The phone test's tap on the sole from below never brought the next question (56 ms for the tap, then 227 s waiting); a touch whose release lands between `TAP_MAX_MS` (400 ms) and `FOCUS_HOLD_MS` (500 ms) is neither a tap nor a hold, which a starved page can do to a Playwright tap. Filed as its own issue; the tests run none of this change's code.
- **Shell heredocs in the Git Bash tool** failed on quotes again, as #139's entry warned; the edits went through the editor and small Python scripts instead.

- **The `?dev` box a group pulled it on top of a group already apart, and stayed ticked when the rule left it in place.** Found reading the diff in the full run. **Cause:** `groupsApart(…, [k])` laid the one group out against the body alone; and with nothing changed in the state, the panel's key did not change, so the box was not rebuilt. **Fix:** `groupsApart` takes the groups already apart (`apart`, only read with `only`) and keeps the one it moves clear of them as of groups moved before it (`apartTranslations(boxes, fixed)`; `pulledApart` passes none and gives the same bits); the box unticks itself when the rule gives no offset. After the review, the view owns that rule: `pullApart(k)` without an offset applies it and says whether the group is apart, so the page (and the table) call one method. Node-tested (`pulls one more group apart clear of those already apart, which stay`).
- **The full e2e run in the container had three failures, none of this change.** The reference screens' "converting" pictures on the phones (40 pixels, 1 %) and the smoke test "offers look presets" at its 30 s timeout failed in both of two repeats on this branch and in both of two on `main` (8ef2748) in the same container, so they are main's; the stall test "does not freeze" failed once of two on the branch and passed on main, the load-dependent limit of a software renderer on 4 cores (it runs none of the painting code). Left for their own issue.

## Dead ends

None. The note's two alternatives (a fifth number a dab for the dab's group, so the record stays in the mini's own coordinates; lifting the brush by group) were weighed, not built: the first changes the record and `spaceDabs` for the same bytes, the second changes strokes made with nothing apart.

## Numbers

- **`groupsApart` on the generated figure (five groups), Node:** well under a millisecond; it is one pass over the triangles for the boxes and the rule over five boxes.
- **The frame counter with every group apart**, development PC (RTX 3060, Chrome, D3D11), `node scripts/measure-painting.mjs`, the flat brush at 16 mm after `pullAllApart()`: the generated figure (35,012 triangles, 8 groups apart: its 5 and the three the group-brush runs before it made) median 0.2 ms, worst 0.3–0.6 ms; large-01 with its base (59,954 triangles, 4 apart) median 0.2 ms, worst 0.4–0.8 ms; 0 slow frames, between frames 6.1 ms (the display's), every stroke with its commit 724–732 ms, the same as the runs with nothing apart. #127's criterion holds; #139's figures (median 0.2–0.3 ms, worst ≤ 1.0 ms) unchanged. GPU process with the view open: 239 MB and 236 MB more than closed, as before. Fewer dabs than the other runs: the stroke's path crosses the canvas and the groups as drawn are smaller once framed apart, so more samples miss.
- **The pixel tests in real Chromium** (`npm run docker:e2e -- e2e/painting.spec.ts`, 4 cores of the PC, software rendering in the container): 42 passed in 21.5 min, the three new ones 29.0 s, 49.2 s and 10.1 s; the whole bar `npm run docker:e2e` 116 passed of 119 in 36.8 min (the three failures above, main's). `npm run docker:check`: 60 files, 726 tests.
- **Screenshots** in real Chrome on the PC (`docs/design/paint-groups/apart*.png`): the generated figure pulled apart; a stroke down the pulled-apart arm, yellow on the arm alone; put together after Undo and Redo, the same paint on the arm alone; the same dabs with the groups together, which paint the shoulder as well.
- **The pixel tests** (`e2e/painting.spec.ts`, three new tests: a stroke down the pulled-apart arm paints the arm's texels and none of the body's where the same dabs with the groups together paint the shoulder, undo and redo to the same bytes with the groups together, and no dab across the gap; a band of mask at the wrist and one group-fill tap make the arm above the wrist a group, the hand staying with the arm; the Paint tool's buttons and boxes) passed in CI's first run of the PR (software rendering) and in the PC's container (above).

## Still open

- The frame figures with groups apart on the reference laptop (the development PC's are above).
- The PM's call on this PR: the dabs stay four numbers in the drawn coordinates with the recorded offsets (the note's §9 proposal), the brush lifting between offsets rather than groups, and the words.
- A group the rule leaves in place (already clear of the body) is not moved by Pull apart, nor by its box in the Paint tool; an offset by hand (`pullApart(k, offset)`) moves it. Whether the tool should offer a hand offset is a product call.

## Story angle

Pulling a mini apart to paint it, without taking it apart: every group moves on screen and in the brush's depth map, but the paint lands in one texture over the unwrapped mini, and the record of where things were makes the stroke replay the same once they are back together. Title: "Painting the arm without the shoulder".
