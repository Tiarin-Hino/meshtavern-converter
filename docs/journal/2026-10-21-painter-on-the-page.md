---
title: The painter on the page
date: 2026-10-21
phase: 2
issues: [167]
prs: [188]
topics: [ui, look, performance, testing, privacy]
---

## What we did

The page now paints. After a conversion, **Paint this mini** in the done panel turns the viewport into the painter and the panel into the painter's panel, with **Open paint file**, **Save paint file** and **Done** at its foot. Done brings the mini back with its paint on it, and both downloads carry the paint. A paint file dropped together with its STL files (or on its own, then the files) converts the mini without a question and opens the painter where it was left. A painting not saved yet is kept in this browser and offered back the next time the same files are dropped; the colours painted with become swatches on the next mini. The status line says what is kept and that nothing is sent.

## Why

The PM decided on 2026-10-13 to publish the page with its painter before the table exists (`2026-10-13-published-before-the-table.md`). The library had the painting engine (#127 onwards), the paint file (#165) and the painter's panel (#166); this was the page's part, designed in a pass on Fable 5.1 (`docs/design/painter-on-the-page.md`, PR #188's first commit) and built on Opus 5.5 in the same PR.

## How

- **A sixth page state.** `painting` follows from the app state like the other five (`pageStateOf` takes `painter`, after the question, busy and the error), so `render()`, `data-in` and the CSS needed no new mechanism. The panel frame is the done state's, with the library's panel in `#paint-panel` and three buttons in the footer; on a phone the sheet keeps the footer in view.
- **The view stays open behind the done panel.** Done hides the view instead of closing it, so Paint again is instant and undo still reaches the first stroke. For that the view gained one additive method, `setShown`: hidden, its frame loop is stopped (the scene's `setPaused`) and the canvas takes no pointer. Nothing the page reads back needs a frame: `paint()`, `surface()` and `history()` worked hidden at once, which a test pins (the stop rule of the note's §15 was not hit).
- **The GLB's texture is the painted look, not the paint.** glTF multiplies a vertex colour into the base colour texture, and the look is not a multiplication (the edges add light), so the paint cannot sit in a texture with the look in the vertex colours. `paintedTexture` (pure, in `paint.ts`) computes `pointColour` per texel from the view's `surface()` (the baked cavity and occlusion the person saw) and the paint; the page encodes it as a PNG with a canvas, and `encodeGlb` stores it as the material's base colour with COLOR_0 left out. The far level takes the paint per vertex. An unpainted mini's files are byte for byte the old ones: four SHA-256 values recorded before the change are pinned in `glb.test.ts`, and the regression baseline did not move.
- **The look is one value.** A chip in the panel's Look section and Adjust's controls change the same look; the page listens to the view (`subscribe`) and the view hears the page's `setLook`.
- **Three ways in for a paint file, one path.** `convertWithPaintFile` takes the files in the paint file's order (`matchFingerprints`, over hashes taken in `digest.worker.ts`), its choices into the page's (`choicesOf`, so Adjust shows and keeps them) and its look, converts without a question and replays. A paint file alone waits in the empty state for its files; a wrong drop is refused and it keeps waiting. Opened on the mini on screen, it replays there when the mini was converted with the file's choices, and otherwise converts again with them first (the note said "replays"; replaying steps onto a surface converted differently would paint the wrong places).
- **What stays on the device.** `storage.ts` is the one place the page touches storage besides the theme: one IndexedDB record (the paint file's contents and the files' names, no pixels), written a second after the last change and forgotten at Save, at "Convert afresh" and when Open replaces a painting; the palette in `localStorage`. Every call is guarded; a test blocks both stores and paints anyway. `confirm.ts` is the application's dialog with a yes and a no, for the offer and for losing unsaved steps.

## Problems and how we solved them

- **The page stalled 280 ms at the start of the largest conversion.** large-01 with its base (281 MB) stalled 273–328 ms "during start → read", against 55 ms on `main` in the same probe (three runs each, real Chrome, the development PC). **Cause:** the source files' SHA-256 for the paint file was started on the dropped buffers just before they went to the worker, and `crypto.subtle.digest` copies its input on the calling thread. **Fix:** the fingerprint is taken when the painter first opens, from a fresh read of the file, in a small worker (`digest.worker.ts`) the buffer is transferred to; the offer compares file sizes before it hashes anything. Back to 54–55 ms, and the whole corpus's longest stall is 48 ms.
- **The fingerprint said 0 bytes.** **Cause:** `fingerprintOf` reads the buffer's length after its `await`, by when `convert` had transferred the buffer. **Fix:** the size was taken first; with the worker it no longer arises.
- **The corpus run's GLB sizes moved by two thirds.** **Cause:** the `--paint` pass left the mini painted, so the exports that follow it carried the texture. **Fix:** the pass times one painted download and then drops the paint.
- **Two older painting tests failed in the full run.** The page now takes the view's look as its own, and the device palette (filled by every earlier test on the shared page) shows after the mini's colours. Both are the new behaviour; the tests read the page's look before the change and empty the palette first.
- **A stroke in the last second before Close or a new drop was lost from the kept painting** (found in review round 1). **Cause:** the record is written a second after the last change, but a conversion and Close closed the view first, and the delayed write then found nothing open. **Fix:** `flushUnsaved` writes a waiting record before anything closes the view and before a drop reads it; the file's contents are taken before its first `await`. Test: `promise.spec.ts` "a stroke followed at once by Close is kept on this device".
- **Opening a paint file on the mini, and the offer, still hashed on the page's thread** (review round 1): they matched through `matchSources`, which hashes the bytes it is given. **Fix:** `matchFingerprints` in `paint-file.ts` (`matchSources` now uses it) matches against the worker's hashes; nothing hashes on the page's thread any more.
- **A `waitForFunction` with an async predicate passed at once.** Its promise is truthy. **Fix:** `expect.poll` and a plain `state.painted` flag.
- **A shared `node_modules` lost 47 packages.** A throwaway worktree for the stall comparison got a junction to this worktree's `node_modules`, itself a link to the main checkout's; `git worktree remove --force` followed the junction and deleted from the shared install. **Fix:** `npm install --no-save` from the unchanged lockfile restored every non-optional package (checked against `package-lock.json`); an `npm install` without `--no-save` had rewritten the lockfile's `libc` fields and was reverted. Lesson: remove a junction with `rmdir` before removing the worktree it sits in.

## Dead ends

- **Hashing the dropped buffers before the conversion** (the note's §7.4): it is what stalled the page; see above.

## Numbers

On the development PC (i7-11700F, RTX 3060, 64 GB, Windows 11, Chrome 155), `npm run corpus -- --paint`, 32 minis, all baked, the questions confirmed as detected, 19 min 22 s:

| What                                                       | Result                                                                                     | Budget                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| Paint to the painter's first frame                         | 118–2,260 ms, median 254 ms; 30 of 32 within budget (large-04 2,260 ms, swarm-03 2,040 ms) | 2,000 ms (the reference laptop's) |
| A stroke of the flat brush, 48 samples: the engine's frame | median 0.2–0.3 ms, worst 1.3 ms, no slow frame                                             | 33 ms                             |
| Between frames during the stroke                           | 6.1 ms median, 6.4 ms worst (the 165 Hz screen)                                            | 33 ms                             |
| The painted texture and its PNG, one table-level download  | 230–359 ms, median 296 ms; large-01 305 ms                                                 | under a second (note §15)         |
| Longest page stall per conversion                          | median 12 ms, worst 48 ms                                                                  | 100 ms                            |

In Playwright's software rendering the painted texture and its PNG took 2.7–2.9 s, most of it the surface's read-back. `npm run docker:check`: 3 min 21 s. `npm run docker:e2e` (4 cores): 39 min 53 s, 144 tests, before the last fixes; the eleven failures were the reference pictures (taken from CI's run 39532047007) and the two older tests above. The page's CSS stays within `theme-files.test.ts`'s budget.

## Still open

- **[human]** The PM paints two of their minis on the page, on the development PC (`npm run dev`) and on the laptop (`npm run lan`), and judges the panel, the brushes and the result.
- The painter's open time on the reference laptop, and why the two slowest minis take over 2 s on the PC (the view's open: the regions and the groups are computed on the page's thread, then the texture and the geometry go to the GPU).
- Keyboard shortcuts for Undo and Redo, a worker for the painted texture, a record per mini in the storage: the note's §16.
