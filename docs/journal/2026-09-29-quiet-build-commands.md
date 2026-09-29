---
title: Building while the PC is in use
date: 2026-09-29
phase: 1
issues: []
prs: [94]
topics: [workflow, tooling]
---

## What we did

Two new commands, `/implement-quiet <issue>` and `/continue-pr-quiet <PR>`, build exactly as `/implement` and `/continue-pr` do, but leave out everything that loads the PC or takes its screen. The PR they leave is a draft that is built and unit-tested; a list in its body says which runs are still owed, and `/continue-pr <PR>` does them when the PC is free.

## Why

The PM asked for it on 2026-09-29: a build should be able to start while the PM works on the same PC, without disturbing that work. The end-to-end tests start a browser and bake minis, the corpus run opens Chrome in front of everything and needs the window to stay there to give usable times, and the unit tests use every core. Until now a build meant leaving the PC alone.

## How

- **One file holds the quiet rules** (`.claude/skills/implement-quiet/SKILL.md`): what not to run, what to run instead, what changes at the end. `/continue-pr-quiet` points at it and adds only what a hand-over changes, the way `/continue-pr` points at `/implement`. Both quiet commands read the normal command's file and follow it, so the building rules still live in one place.
- **Not run:** the end-to-end tests, the corpus and feedback runs, the benchmark, the placement score, the measuring and comparing scripts, any dev server or browser, the WebAssembly builds in Docker, `npm run check` as a whole, and anything in parallel.
- **Run instead:** format check, lint, typecheck, and the unit tests with one worker.
- **CI does the heavy part.** Every push to a PR runs the full check and the end-to-end tests on GitHub, so a quiet build opens its draft PR early, pushes after each step and reads the result. End-to-end tests are still written with the code; they are just not run on the PC. A failure there is worked from CI's log and its report with the screenshots.
- **Nothing skipped counts as proven.** A criterion whose proof is a run that was left out stays unticked, the PR stays a draft, and its body lists every run owed as the command to type. `/continue-pr` recognises such a draft and starts with that list.

## Numbers

The whole unit suite with one worker (`npx vitest run --maxWorkers=1`): 383 tests in 103 s on one of 16 logical cores, development PC, Node 20, 2026-09-29.

## Still open

- Not used yet. The first quiet build will show whether pushing per step and waiting for CI (up to 15 minutes a run) is a workable rhythm, and whether end-to-end failures can be solved from CI's report alone.
- CI draws in software: its screenshots prove that something is drawn, not how it looks on a real GPU or how fast it is. Visual judgement and every measurement stay with the full run.
- The private product repo has its own copies of the commands (a companion change there).

## Story angle

A build that stays out of your way: what an agent can prove on one core, and what it has to leave on a list. Possible title: "Quiet hours for the build".
