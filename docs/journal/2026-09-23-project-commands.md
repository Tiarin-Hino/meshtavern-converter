---
title: The build commands move into the converter repo
date: 2026-09-23
phase: 1
issues: []
prs: []
topics: [workflow, tooling]
---

## What we did

The converter repo now has its own agent commands for the build part of the work loop: `/implement`, `/fix-bug`, `/test`, `/open-pr` and `/review-pr`, next to the existing `verify-3d`. They live in `.claude/skills/` and are listed in `CLAUDE.md`.

## Why

The commands were first written for the project's other repo, where planning and specs happen. Claude Code loads commands only from the repo a session runs in, so a session opened here, or `@claude` on a converter issue, had none of them. Converter work was therefore started from a session in the other repo, pointed at this one. When the PR that introduced the commands was merged, copying the build commands here was promised as a separate step; this is that step.

## How

The five commands are adapted copies, not links, because this repo is public and must stand on its own:

- References to documents outside this repo are gone. Where the originals point at product decisions, these point at `CLAUDE.md` and `docs/specs/`.
- The rules checked are this repo's: the user's STL never reaches a network call, pipeline code stays free of the DOM and three.js scene objects, no STL files or renders of real minis, no names of third-party minis, creators or shops, and a moved regression baseline needs a reason.
- The tools named are this repo's: `npm run check`, `npm run e2e`, `npm run corpus`, `npm run baseline:update`, generated test shapes in `src/regression/shapes.ts`, and `verify-3d` for anything visual.
- Each command carries the journal rule: `/implement` and `/fix-bug` write the entry, `/open-pr` checks it exists, `/review-pr` checks it matches the PR.

Planning commands (specs, decisions, research, status) were not copied. Planning stays with the product repo.

## Problems and how we solved them

- **A command pointed at an issue form that does not exist.** The original `/fix-bug` says to create a bug issue "following the bug form"; this repo has no issue forms yet (the folder is empty, although `CONTRIBUTING.md` asks people to use them). **Fix:** the command lists the fields to fill instead. The missing forms are left as a separate gap.

## Still open

- `CONTRIBUTING.md` asks contributors to use issue forms that this repo does not have.
- The copies can drift from the originals. When one changes, the other should follow in a companion PR.

## Story angle

Small, but telling: an AI agent's instructions are files in a repo, and they only work in the repo they sit in.
