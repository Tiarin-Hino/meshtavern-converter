---
title: The questions as a view other code mounts
date: 2026-10-07
phase: 2
issues: [119]
prs: [120]
topics: [ui, worker, tooling, workflow]
---

## What we did

The questions a conversion asks are now a part of the library, not of the page: which way is up, how a figure's parts go together and where the figure meets its base, with the brush, the pair chips, Look at and the final view. A program that converts minis, such as the table application's "add a mini" dialog, mounts the same view into two boxes of its own and gets the same questions with the same controls. Nothing changed for someone using the page: it mounts that view where the questions were, and every test of the questions passes unchanged.

## Why

Issue #119, needed by the table application (Phase 2). Since #92 and #93 the worker stops on the full-detail meshes and asks, and the page drew the questions and sent the answers: about 1,100 lines spread over `main.ts`, `viewer.ts`, `page-state.ts`, `index.html` and `style.css`. The table has to answer the same `Question`s. A second copy there would drift from the worker's protocol the first time a `MeetAction` changed. The work started with a design pass on Fable 5.1 (`docs/design/questions-view.md`, the first commit of PR #120) and was built by Opus 5.5 in the same PR, in the note's seven steps.

## How

- **A fourth entry, `meshtavern-converter/questions`.** `mountQuestions({ scene, controls, copy, onChange })` puts the view's own canvas into `scene` and its controls into `controls`. Without `controls` it lays a panel of its own over the scene. `start(conversion)` takes the files' names, what is asked and the options the conversion started with, and returns the callback `convert` takes as its fourth argument. `end()` is called when the conversion ends, however it ends. Every question hook of the page has a method of the same name on the view (`answerUp`, `confirmUp`, `tap`, `brush`, `confirmMeet`, `pickAt`, `screenOf`, …).
- **Moved, not rewritten.** `src/lib/questions/scene.ts` is the question half of the page's viewer: `showShown` and the chunks of #108, `rayAt`, `screenOf`, `setPatches`, `focusOn`, `focusFile`, the brush, the question material and its warm-up, `QuestionFile`. It adds what the viewer's constructor made: a renderer, a camera, OrbitControls, the grid and the table light. `src/lib/questions/mount.ts` is `main.ts`'s question code: the `asking` state, `askUp` (now `asked`), `showQuestion`, the chips, `answerQuestion`, `sendMeet`, the brush queue, the controls' wiring and the pointer handlers. The markup that was in `index.html` is now a template in the same file, with the same ids. `src/lib/questions/copy.ts` holds the words (`QUESTION_COPY`) and the sentences (`describeUp`, `describePairs`, `describePlacement`, …), with their unit tests; `mesh-chunks.ts` moved with its test.
- **The page as a consumer.** `main.ts` mounts the view into `#question-view` (absolutely over `#viewport`, the same box, so the tests' taps at canvas coordinates land on the view's canvas) and `#questions` (in the panel, where the sections were). `showAsked` mirrors `view.state` into `state.question`, `state.meet`, `state.orientation` and `state.preset`, so the e2e specs read what they read before. At the first question it takes the mini off the viewer, as drawing the question there used to, and starts the clock of `questionMs`. The page's `COPY` spreads `QUESTION_COPY`, so the specs still import every string from `page-state.ts`.
- **Why the view owns its canvas** (note §2). The issue asks for a view mounted into an element. Drawing into the consumer's three.js scene instead would hand the consumer the renderer, the camera, the controls and the pointer handling: the copy the issue wants to avoid. The cost is a second WebGL context on the page, measured below. Its render loop runs only while a question's meshes are held.
- **Two copies of the camera code** (note §7.2). `setCamera`, `setTurn`, `setTurnGizmo`, the pivot, the grid and the lights are now both in the page's viewer (for the converted mini, Adjust's turn) and in the scene (for the question). Each copy carries a comment pointing at the other. A shared helper waits for a third copy.
- **Scoped styles.** Every rule of `src/lib/questions.css` is under `.mt-questions`. The page's control rules (buttons, selects, focus, the phone's touch targets) are copied at the same values, so a consumer without rules of its own gets the page's look. Colours come from the page's custom properties with the page's values as fallbacks. The pairs' colours are written onto the hosts as `--pair-1` … `--pair-4` from `PAIR_COLOURS`, the one list the scene also draws the patches with. The `:root` block in `style.css` is gone.

## Problems and how we solved them

- **The entry could not import its stylesheet.** The note had `questions.ts` import `./questions/questions.css`. **Cause:** the e2e specs import `COPY` from the page, which now spreads `QUESTION_COPY` from the entry, and Playwright's test runner cannot load a `.css` import. A throwaway spec failed with `SyntaxError: …x.css: Missing semicolon`. Node scripts that import the words would fail the same way. **Fix:** the stylesheet is its own export, `meshtavern-converter/questions.css` (`src/lib/questions.css`). The consumer imports it once, next to the entry, as `main.ts` does. Asked on the PR. Injecting the CSS at mount from a string was not taken: it needs `style-src 'unsafe-inline'` or a nonce in the table's content security policy.
- **The live figures said 0 triangles at a question.** `e2e/up-question.spec.ts` waits for `state.perf.triangles ≥ 720,000` while a large mesh is drawn in chunks. **Cause:** the meshes are drawn by the view's renderer now, and the page's figures come from the viewer's. **Fix:** a method the note did not have, `view.rendered()`, gives the view's triangles and draw calls; while a question is on screen the page takes those two figures from it. The spec is unchanged.
- **The view's text vanished in a light dialog.** The consumer check put the controls into a white box: the page's light text on white. **Cause:** on the page the panel behind the controls is dark; the view gave its controls no background. **Fix:** `:where(.mt-questions-controls) { background: var(--q-panel) }`. It has no specificity, so a consumer's own background wins. On the page it is the panel's colour, and the screenshots stayed the same pixels.
- **The README's example did not type-check.** `dialog.querySelector('.scene')!` is an `Element`, and `scene` takes an `HTMLElement`. Found by compiling the snippet in a scratch file. **Fix:** `querySelector<HTMLElement>(…)` in the README. The design note has the same line; it is a plan, so it was left as written.
- **The full e2e run timed out in a dozen unrelated tests.** On step 1, which changed only where strings live, 12 of 52 tests timed out, among them `loadDemo()` after 30 s. **Cause:** Playwright's default worker count oversubscribed the development PC: each worker converts and draws in software. All 12 passed when run again with 2 workers. The final runs use `--workers=3`; the three tests that timed out at that count (`page.spec` phone, `smoke.spec` detail levels, `source-preset.spec` Adjust) had also timed out before the view existed, and pass alone.
- **The lint rule had to refuse a deep import once.** A scratch file in `src/page/` importing `../lib/questions/scene` failed `no-restricted-imports` as intended; `**/lib/questions/*` joined the restricted patterns.

## Dead ends

- None in the build. The one approach not taken, a stylesheet injected at mount, is under "Problems".

## Numbers

Development PC: i7-11700F, RTX 3060, 64 GB, Windows 11, Chrome 154, window in front.

**Screenshots** (`verify-3d`; seven views from the same hooks and camera, `main` at dfbdeb1 against this branch, software GL as in CI): the up question of a lying figure, the base's question of a pair, the pairs stop with the proposal, two pairs of one's own, the final view, the parts question with a wing apart: **identical pixels** (0 of 921,600 differ). The question on a 390 × 844 phone: 51 pixels differ, by at most 32 of 255 levels, all in the anti-aliasing of the bottom sheet's two rounded top corners over the canvas. The sheet: `docs/design/questions-view-after.png`.

**The corpus** (`npm run corpus -- --no-bake`, the questions confirmed as detected, 32 conversions each, none failed; `main` first, this branch right after):

|                                               |           `main` |                   this branch |
| --------------------------------------------- | ---------------: | ----------------------------: |
| Longest stall, worst mini                     | 55 ms (swarm-03) |              55 ms (swarm-01) |
| Longest stall, per mini, branch − main        |                  |        −12 … +19 ms, median 0 |
| Time to the question, large-01                |            8.1 s |                         6.8 s |
| Time to the question, per mini, branch − main |                  | −1.5 … +0.03 s, median −74 ms |

The stall moves within the run-to-run noise #108 measured (7–79 ms). The time to the question is shorter on the branch for almost every mini. That is most likely the order of the runs (the corpus files were read cold by the first run), not the change, so it is not claimed as a gain.

**Peak memory** (`scripts/measure-memory.mjs`, baked, the question confirmed as detected, a fresh browser per conversion):

|                                            | Page process, `main` | Page process, branch | GPU process, `main` | GPU process, branch | Estimate (`memory.ts`) |
| ------------------------------------------ | -------------------: | -------------------: | ------------------: | ------------------: | ---------------------: |
| large-01 (268 MB, 5.6 M triangles), 3 runs |       2,633–2,636 MB |       2,736–2,740 MB |          274–291 MB |          319–323 MB |               2,774 MB |
| M-001a (60 MB, 1.25 M triangles)           |               795 MB |               791 MB |              187 MB |              230 MB |                 898 MB |

The second context costs the GPU process about 40 MB for either file. On the largest file it also costs the page's process about 100 MB, in every run. That is still under the estimate, but the margin falls from about 140 MB to about 35 MB. A guess, not confirmed: each context keeps its own transfer buffer to the GPU process, sized by the largest upload it made, so the question's 100 MB of geometry leaves a large one behind in the view's context and the mini's upload grows another in the viewer's. On the humanoid, whose question fits one chunk, the page's process did not grow.

**The consumer check** (a throwaway Vite 8.3 project outside the repo, the library linked by `file:`, as #50 did): a dialog with a scene box and a controls box, `mountQuestions` with one word replaced (`askUp`), the generated puddle figure and recess base. All four questions (base, figure, pairs, final view) were answered by clicks on the view's own buttons; the conversion ended `asked: base, figure, meet`, placement `detected`, no console errors. Without `controls` the view's own panel works the same. The same check passed from the dev server and from a production build. It needed nothing in the library beyond the entry. The consumer needs the `server.fs.allow` line #50 found, and the stylesheet import.

## Still open

- **The memory margin on the largest file**, above. If the table must hold more beside a conversion, the view could release its renderer after the last Confirm and make a new one at the next conversion, or draw into the page's viewer (note §2's alternative, §13). Neither was built here.
- One view per document: the twenty question tests address the elements by id (note §6.1, §13).
- The Base select is as wide as its longest entry ("No base: these are the parts of one figure") and overflows a narrow controls box. That is the page's behaviour too, so it was left alone.
- At the final view the placement is said in the base file's units, because the sizing is not known while a conversion runs. That is also the behaviour before the move (`state.stats` is null during a conversion), now said in a comment.

## Story angle

Moving a thousand lines of user interface behind a library call, and proving nobody can tell: the same tests, the same element ids, and seven screenshots that match to the pixel.
