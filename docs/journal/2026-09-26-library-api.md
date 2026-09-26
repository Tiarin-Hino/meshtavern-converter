---
title: A converter other code can call
date: 2026-09-26
phase: 1
issues: [50]
prs: [83]
topics: [worker, tooling, workflow]
---

## What we did

Nothing changes for someone using the page. Underneath, the converter is now a library that the page uses like any other program would. The MeshTavern table application (a separate, private repo) will import the same library when someone adds a mini at the table, instead of copying the page's code. The README shows how that call looks.

## Why

Story 5 of the Phase 1 spec (#50). The page reached into the conversion code wherever it liked: `main.ts` imported from eleven pipeline modules. A second consumer would have had to guess which of those were meant to be used. The work started with a design pass on Fable 5.1 (`docs/design/library-api.md`, the first commit of PR #83), and Opus 5.5 built it in the same PR, in the note's five steps.

## How

- **Two folders.** `src/lib/` holds the pipeline, the worker around it, and the two three.js modules that draw a baked mini: their shader must stay in step with the look, so every consumer needs them. `src/page/` holds the page: UI wiring, the 3D viewer, the benchmark, the wording. The viewer stays page code: the table has its own scene.
- **Three doors in.** `src/lib/index.ts` is the public API: convert, cancel, progress, refuse a bad file early, orientation and size types, the look, GLB export. It loads no three.js, so a Node script or a server can use it. `three.ts` draws a baked mini. `dev.ts` is for tests and tooling (generated meshes, STL writers, the pipeline without a worker).
- **The door is enforced.** An ESLint rule (`no-restricted-imports`, part of ESLint itself) refuses imports into `lib/pipeline`, `lib/worker` or `lib/three` from the page, the regression net and the end-to-end tests. A unit test (`src/lib/index.test.ts`) lists every export of the three entries, so the API only grows in a visible diff. It also checks that nothing behind `index.ts` imports three.js.
- **One piece moved into the library.** The page's drop handler read the first 8 KB, checked format and memory budget, and only then read the whole file. That is now `readStlFile(file, budget)`, because the table needs the same early refusal. The messy-file tests passed unchanged.
- **`package.json` exports the entries as TypeScript sources.** The table is a Vite project and compiles them like its own code, worker included. Nothing is published to npm.
- **The look is not a conversion option,** although the issue lists "look preset" among them. Colours are computed when drawing and exporting (see `2026-09-20-primed-and-washed-look.md`), so changing them needs no new conversion. Presets arrive with #45.

## Problems and how we solved them

- **The regression net needed five helpers the note did not list.** `shapes.ts` and its test use `addRoundBase`, `pushOutward`, `Vec3`, `weldVertices` and `detectUpAxis` to build stand-in minis. **Cause:** the note sorted what the page imports, not the regression net. **Fix:** by the note's own rule (the table would not need them), they went into `dev.ts`. The page needed nothing beyond the list.
- **A linked library's worker was refused by the consumer's dev server.** In a throwaway Vite project with the library linked by `file:`, the page loaded but the worker got a 404: "outside of Vite serving allow list". **Cause:** a `file:` link is a symlink, and Vite's dev server serves nothing outside the project folder. **Fix:** on the consumer's side, `server.fs.allow: ['.', '../meshtavern-converter']`; the README says so. Installed as a copy (as `github:` will), it works without it. The note expected a different problem, Vite's dependency pre-bundling losing the worker. It does not happen: Vite 8 rewrites the worker's address when it pre-bundles the package.
- **The transcoder path assumed Vite.** `compressed-texture.ts` built the Basis transcoder's address from `import.meta.env.BASE_URL` when the module loaded. **Fix:** `transcodeDetail` takes the path as an optional third argument, computed only when it is not given. A new path replaces the cached loader.
- **Local e2e runs needed another Chromium.** The container's preinstalled Chromium is older than the one this Playwright version expects. A config file outside git pointed Playwright at it. The repo's config is unchanged.

## Numbers

All in a cloud container (Linux, no GPU, software rendering like CI).

- ESLint rule before the page's imports changed: 42 errors in 12 files. After: none.
- Unit tests: 292 before, 300 after (4 for the export lists, 4 for `readStlFile`). The regression baseline did not move. All 23 end-to-end tests passed after each of the four code steps.
- `dist/` after moving the page: the same 13 files as a build from `main`, hashes included. After step 3, only the page's main script got a new hash (the transcoder parameter, the import order).
- Consumer check (Vite 8.3, a 7,200-triangle generated sheet): all ten steps ran in the worker, baked, KTX2 texture 857 KB, table-level GLB 164 KB. The same result from the dev server with a `file:` link, the dev server with a packed copy, and a production build.

## Still open

- `convert(stl, onProgress, options)` keeps its callback-second signature, because the issue allows only import changes in the tests. An options-only form with an `AbortSignal` waits for the table's first use.
- The consumer check did not draw a baked mini with the `three` entry. The page's e2e tests cover that code.
- Look presets: #45.

## Story angle

Turning a web page into a library without changing a pixel: an ESLint rule and a list of exports as the contract. "The page is just another customer."
