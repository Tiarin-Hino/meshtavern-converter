---
title: Set up the converter repo, its toolchain and its reference hardware
date: 2026-09-19
phase: 0
issues: []
prs: [15, 16]
topics: [tooling, workflow, devices]
---

## What we did

We created the public converter repository with a working skeleton: a web page that opens an STL file, shows it in 3D and reports its size and triangle count. Around it we set up tests, continuous integration, templates for issues and pull requests, and the instructions an AI coding agent follows in this repo. Two small follow-ups the same evening pinned the toolchain to what the development machine can run, added the MIT licence and wrote down which computer the first numbers would come from.

## Why

The Phase 0 spike (`docs/specs/phase-0-spike.md`) had to answer three questions: can a browser process a real 100 MB sculpt, does a reduced mini look good enough, and can a reference laptop show 100 minis. Answering them needs code that produces numbers, and code needs a place with tests and review. The repo is public because the converter is the part of MeshTavern people can inspect: it promises that a user's STL is processed in the browser and never uploaded, and anyone can check that.

## How

- **Scaffold (commit 3c5caa4, 35 files).** Vite 8, TypeScript 6, three.js 0.186 for the viewer, Vitest 4 for unit tests, Playwright for end-to-end tests in a real browser, ESLint and Prettier. The first pipeline function, `src/pipeline/stl.ts`, reads an STL; it came with unit tests and one Playwright smoke test.
- **One rule shaped everything after it:** mesh processing lives in `src/pipeline/` as pure functions on typed arrays, with no page or three.js objects, so the same code runs in a Web Worker, in Node for benchmarks and in unit tests.
- **Testing a 3D canvas.** A canvas has no accessibility tree, so tests cannot "read" the scene. The page exposes its state on `window.__mt` and tests assert on numbers (triangle counts, sizes in mm); screenshots are only for "does it look right". A project skill, `verify-3d`, spells out this two-layer check for the agent, including "never report speed from the CI software renderer" and "aesthetic calls go to a human".
- **CI** runs format check, lint, typecheck, unit tests, build and the Playwright tests on every pull request, and uploads the Playwright report so a reviewer can see screenshots. Branch protection requires it.
- **Workflow files:** issue templates (epic, user story, task, bug), a PR template, CODEOWNERS, Dependabot for npm and GitHub Actions, and `CLAUDE.md` with conventions: Y-up scene, 1 unit = 1 mm, budgets and thresholds as named constants, never commit real minis.
- **PR #16** added the MIT licence (the PM's choice) and filled in the "Reference hardware" section of the spec from the PM's desktop.

## Problems and how we solved them

- **Dependabot's first grouped update failed.** It bumped TypeScript to 7, Vitest to 5 and `@types/node` to 22+. **Cause:** `typescript-eslint` only supports TypeScript below 6.1, and Vitest 5 needs Node 22.12 or newer while local development ran Node 20.19. **Fix (PR #15):** Dependabot now skips those major versions, with a note to lift the Vitest and Node entries after a Node upgrade. CI itself already ran on Node 22. The three GitHub Actions bumps Dependabot opened at the same time (#1 to #3) merged without trouble.
- **The only measuring machine was the wrong kind.** The PM's desktop has an RTX 3060, 64 GB and a CPU without integrated graphics. **Cause:** the spike's exit criteria are about ordinary laptops. **Fix:** PR #16 records the desktop as an upper bound only ("can prove something is too slow, not that it is fast enough") and asks the PM for a second, weaker device. The Ubuntu laptop with Iris Xe graphics was named later and became the reference for "a weak device".

## Numbers

None yet. This entry sets up where numbers come from: the development PC (i7-11700F, RTX 3060, 64 GB, Chrome 153, Windows 11) as the upper bound, and CI for correctness only.

## Still open

- Node 20 is past end of life; the held-back majors wait for the upgrade.
- The weak reference device was not yet named at this point.

## Story angle

Setting up a repo where an AI agent writes the code and a PM who does not read code reviews it: tests that read numbers instead of pixels, and a rule that aesthetic calls go to a human. Possible title: "Testing a 3D app you cannot look inside".
