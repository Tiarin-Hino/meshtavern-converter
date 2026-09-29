---
name: implement-quiet
description: Build a GitHub issue like /implement, but without anything that loads the PC - no e2e, browser, corpus or measurement runs. Use when asked to implement or build quietly, in the background, or while the PM is using the PC.
argument-hint: <issue number>
---

# Implement issue $ARGUMENTS, quietly

The PM is using this PC while you build. Do exactly what `/implement` does (read `.claude/skills/implement/SKILL.md` and follow its steps in order, the gate, the model check and the design pass included), with the changes below. The result is a draft PR that is built and unit-tested but not yet fully verified; the PM tests by hand or runs `/continue-pr <PR>` when the PC is free, and that run does what this one left out.

This file holds the quiet rules for both quiet commands; `/continue-pr-quiet` points here.

## What not to run

Nothing that opens a browser, takes the screen or the keyboard focus, or uses more than one core for longer than a few seconds:

- `npm run e2e`, `npm run corpus`, `npm run feedback`, `npm run bench`, `npm run score-placements`, `npm run lan`
- `scripts/measure-*.mjs`, `scripts/compare-*.mjs`
- a dev or preview server, the browser pane, Playwright in any form, and with them the local part of `verify-3d`
- `npm run xatlas:build`, `npm run basis:build` (Docker)
- `npm run check` as a whole: it runs the unit tests on every core. Run its parts as below
- several things at once: no background jobs, no subagents that run tests or builds

## What to run instead

- While building: the tests of the modules you touch, one worker: `npx vitest run <files> --maxWorkers=1`.
- Before every push: `npm run format:check`, `npm run lint`, `npm run typecheck`, then the whole unit suite once with one worker: `npx vitest run --maxWorkers=1` (103 s on one core of the development PC, 2026-09-29).
- `npm run baseline:update` only when the regression baseline moves on purpose; it is one process.
- **CI is the machine for the rest.** Every push to the PR runs `npm run check` and `npm run e2e` on GitHub. Open the draft PR early (after the first step that passes the checks above), push after each step, and read the result of the last push before going on: `gh pr checks <n>`, once, not in a loop. When the e2e tests fail there, work from the log and the report (`gh run download <run id> -n playwright-report`): it holds the screenshots. Do not run them locally to find out. An e2e failure you cannot explain from CI after two attempts goes on the deferred list with what you saw.

Everything else stays as `/implement` says: tests are written alongside the code, e2e tests included (CI runs them); small commits; the rules; docs; the journal entry.

## What changes at the end

- **The PR stays a draft.** Do not mark it ready.
- **Tick only what is proven.** A criterion whose proof is a run you did not do (a measurement, the corpus, a screenshot for the PM's judgement) stays unticked, with "deferred" and the command next to it. CI's screenshots come from a software renderer: they prove that something is drawn, not how it looks or how fast it is. Never write a skipped check as passed.
- **The PR body gets a section "Deferred to a full run"**, above "Limits": one line per run left out, as the command to type and what it is to prove. `/continue-pr` starts from that list.
- **The journal entry** is written as far as the work went; under "Numbers" and "Still open" it says which figures wait for the full run.
- **Tell the PM** in a few lines: what is built, what CI says, how to look at it by hand (`npm run dev`, which file to drop, what to look for), and that `/continue-pr <PR>` finishes the PR when the PC is free.
