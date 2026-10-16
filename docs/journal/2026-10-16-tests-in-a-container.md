---
title: The checks and the e2e tests run in a throwaway container
date: 2026-10-16
phase: 2
issues: []
prs: [174]
topics: [testing, tooling, workflow]
---

## What we did

`npm run docker:check` and `npm run docker:e2e` run the same checks as `npm run check` and `npm run e2e`, but in a Linux container with a fixed share of the development PC (4 cores and 8 GB by default). Each run starts from a clean copy of the working tree and leaves nothing behind except its reports in `out/docker-test/`. `/implement` and `verify-3d` now use them, and fall back to the old commands only when Docker is not running.

## Why

The PM asked for it: the agents' local runs during `/implement` made the PC hard to use. Three things hurt:

- **Load.** Vitest and Playwright size themselves to the whole PC, and parallel sessions each started their own runs.
- **Leftovers.** Every worktree under `.claude/worktrees/` had its own `node_modules` and browser installs (seven of them while this was written), and `out/` had grown to 11 GB.
- **Setup time.** A fresh worktree needed `npm ci` and `playwright install` before its first test. The main checkout's Playwright was 1.63 against 1.64 in the lockfile.

## How

- **The image** (`docker/test.Dockerfile`) is Microsoft's Playwright image at the lockfile's version (v1.64.0, Ubuntu 24.04, Chromium included). The dependencies are installed into it with `npm ci`. It is tagged with a hash of the lockfile, the Dockerfile and the entrypoint, so it is built once and rebuilt only when one of them changes. Older tags are removed.
- **A run** (`scripts/docker-test.mjs`) lists the working tree with `git ls-files -co --exclude-standard`, which takes new files and leaves out what `.gitignore` excludes (`node_modules`, `dist`, the corpus, worktrees). It streams that list into a fresh container. The repo is mounted read-only, the files are copied next to the image's `node_modules`, and the command runs. The reports are copied out and the container is removed. Copying beats running on the mounted folder: the tracked files are only 21 MB, and a Windows folder seen from Linux is slow for many small files.
- **The share.** `--cpus` alone caps the time, but Node still sees all 12 of the Docker VM's cores, so Vitest starts eleven workers that fight over four. `--cpuset-cpus` pins the container to its cores, and `os.availableParallelism()` then reports 4. Playwright counts cores with `os.cpus()`, which still sees 12, so `playwright.config.ts` takes its workers from `MT_TEST_CPUS` (half the cores, as Playwright does by default).
- **Linux like CI.** The reference screens (`e2e/reference-screens.spec.ts`) are compared with the committed Linux set, so a local run no longer writes a Windows set. Each container also has its own network, so two worktrees no longer share port 4173. Before, `reuseExistingServer` let a second session test another worktree's server without saying so.

## Problems and how we solved them

- **The first full run timed out.** 15 unit tests hit their limits, and the unit suite took 860 s against 190 s on CI. **Cause:** another session's `/implement` was running e2e on Windows at the same time, plus four Playwright MCP browsers, with the PC at 92–95 % CPU before the container started. One test file alone ran at the same speed in the container (3.2 s) as on Windows (3.9 s). **Fix:** none needed. Rerun on a quiet PC, everything passed. This is the problem the container is for.
- **The check failed on its own new file.** The first run stopped at `prettier --check` on `scripts/docker-test.mjs`. The format hook had not run, because the file was written before the session moved into the repo. Formatted and rerun.

## Numbers

All on the development PC, Docker Desktop's VM with 12 cores and 16 GB, 4 cores and 8 GB for the container:

| Run                     | Result                            | Time                                            |
| ----------------------- | --------------------------------- | ----------------------------------------------- |
| `npm run docker:check`  | 58/58 test files                  | 3 min 10 s in all; unit tests 164 s (CI: 190 s) |
| `npm run docker:e2e`    | 100/101, 2 workers, 1.3 GB in use | 24.4 min (CI: 11–20 min on its 4 cores)         |
| Image build, first time | 3.9 GB image                      | about 1 min after the base image's download     |

The one e2e failure was `phone-390 › the five states`: 40 pixels at the edges of the masked status line in the converting state, whose width depends on which step the screenshot catches. Alone it passed 3 times out of 3.

## Still open

- The `phone-390` converting screenshot can catch a different step under load: a flaky test, not fixed here.
- `/implement-quiet` still forbids Docker. With `MT_TEST_CPUS=2` it could run e2e itself instead of waiting for CI; that is the PM's call.
- The image runs Node 24 (the Playwright image's), CI runs Node 22. Both meet `engines` (20.19+).

## Story angle

"Our agents were eating the PC": how a lockfile-tagged container and two Docker flags gave parallel coding sessions a fixed slice of the machine and cleaned up after them.
