---
title: A project journal, backfilled for every PR so far
date: 2026-09-23
phase: 1
issues: []
prs: [63]
topics: [workflow, tooling, planning]
---

## What we did

We added a project journal in `docs/journal/`: one entry per piece of work, written from PRs, issues, review threads and specs that already existed. Twenty entries cover everything from the repo scaffold through #62. Writing a journal entry is now part of the definition of done for every PR that changes behaviour, the pipeline, measurements or tooling, checked by the `astra-review.md` automatic review.

## Why

The PM asked for this directly, without an issue: PRs, issue threads and specs hold the story of how the converter was built, but nobody who was not there can follow it, and it is meant to be the source for release documentation and a blog series later. A companion PR in the private MeshTavern repo adds the journal's index and story arcs and the same workflow rule for that repo; this PR only concerns the public converter's own history.

## How

- `docs/journal/README.md` sets the format: a dated `YYYY-MM-DD-short-slug.md` file per entry, a fixed section order (What we did, Why, How, Problems and how we solved them, Dead ends, Numbers, Still open, Story angle), and rules for a public repo: no third-party mini, creator or shop names, no business topics.
- `CLAUDE.md`, `CONTRIBUTING.md`, the PR template and `.github/astra-review.md` all point to the journal so the requirement is checked by both a human and the automatic review, not just remembered.
- `docs/specs/phase-0-spike.md` got a "Journal" section: the fourteen Phase 0 entries in reading order, the table of contents for a post series about that phase.
- The twenty entries were written after the fact, since the journal did not exist while Phase 0 and the early Phase 1 work happened. Each one only holds what a PR, issue, review thread or spec already recorded; nothing was guessed to fill a gap.

## Problems and how we solved them

- **Problem.** `CLAUDE.md` still said print STLs are always Z-up. **Cause:** the wording predates #22, which detects the up axis from the base instead of assuming it. **Fix:** this PR.
- **Problem.** The Phase 1 spec's risk list read "Base and support detection are heuristics" again, even though #55 had narrowed it to "Base detection" alone (support detection was dropped, see [messy-files-scope](2026-09-21-messy-files-scope.md)). **Cause:** merging `main` into #56's branch brought the old wording back. **Fix:** this PR restores the narrowed line.

## Dead ends

None: this PR only adds documentation and a workflow rule, no code path was tried and dropped.

## Numbers

None; docs only.

## Still open

- Whether the backfilled entries read as the people who lived through them remember it, especially the LOD verdict ([lods-with-meshoptimizer](2026-09-20-lods-with-meshoptimizer.md)), the overruled unwrap-and-bake no-go ([unwrap-and-bake-spike](2026-09-20-unwrap-and-bake-spike.md)), and the missing reason for dropping support detection ([messy-files-scope](2026-09-21-messy-files-scope.md)).
- Three mismatches the backfill found but did not touch, because they need a PM call: the Phase 0 spec's "development PC 144 Hz" against results that all show a 165 fps cap; the Phase 1 exit criterion "ordinary mini" still marked a proposal though #56 said merging confirms it; epic #40 still listing the closed #35 as an open blocker.
- Several entries run a little over the 800-word guide in the README.

## Story angle

Writing history after the fact, from the paper trail a team already left in PRs and issues, and being honest in the same entry about what that paper trail did not record. Title idea: "The journal we should have started on day one".
