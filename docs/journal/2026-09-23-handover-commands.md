---
title: Fable designs, Opus builds, in this repo too
date: 2026-09-23
phase: 1
issues: [44]
prs: [75]
topics: [workflow, tooling]
---

## What we did

The converter's copy of `/implement` now hands over instead of building when it runs on Fable 5.1 and the issue needs a design pass: it writes `docs/design/<name>.md` with the decisions the build should not have to make, commits it and opens a draft PR whose body is the brief for the build. A new command, `/continue-pr <PR>`, picks that PR up on Opus 5.5 and builds to the note. `CLAUDE.md` names both. The first hand-over is #44 (scale and base): `docs/design/scale-and-base.md` and draft PR #74.

## Why

The PM's Fable budget is small. Until now an issue that needed strategic thinking ran its whole build on Fable, most of it work Opus does as well. The split keeps Fable for the four kinds of decision only it should make (data shapes, module boundaries, heuristics, the order of the build) and gives Opus a command that starts exactly where Fable stopped, so a session that hits the limit mid-way loses nothing. The reasoning and the shape of the two commands are in the private repo's journal entry of the same day; this entry records the converter's part, as the guide's rule "a command changed there is changed here" asks.

## How

- `/implement` step 3 has three outcomes instead of two: clear building work goes on with any model; design needed on Opus stops and asks for Fable, as before; design needed on Fable does the design pass and stops after the draft PR.
- `/continue-pr` holds only what a hand-over adds (read the brief, check the draft state, check the model, build in the note's order and stop where it says, never change the note silently, keep the PR body ticked with evidence, mark the PR ready) and points at `/implement` steps 6 to 10 for the building rules, so those live in one file per repo. The first review of PR #75 asked for that instead of a copy.
- `/open-pr` learned the two hand-over cases both commands rely on: a design-pass draft (`gh pr create --draft`, the brief as the body, no journal entry yet) and an existing PR (`gh pr edit --body-file`, the brief kept, the criteria ticked). Before this it only created finished PRs; the same review caught that.
- `docs/design/` now holds design notes as well as wireframes; `CLAUDE.md` says so.

## Still open

- #74 is the first run. Whatever the brief leaves unclear there belongs in the command afterwards.

## Story angle

The public half of a two-model workflow: the note that a planner leaves for a builder, and why it lives in the repo rather than in a chat.
