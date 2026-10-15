---
title: Gemini 4 Argon becomes the second reviewer, GPT Astra the occasional third, and Opus reviews when Fable is out of usage
date: 2026-10-15
phase: 1
issues: []
prs: []
topics: [ci, review]
---

## What we did

Two changes to the automatic review (`.github/workflows/pr-review.yml`), the same as in the table's repo.

The label `argon-review` runs Gemini 4 Argon as a second opinion, on the `GEMINI_API_KEY` secret. GPT Astra keeps its job and its `astra-review` label as a third opinion a maintainer adds now and then. The verdict waits for every review that runs, and all of them must pass.

The Claude review now has a fallback. The Fable 5.1 step may fail. When it failed or returned nothing, a step searches its log for the words of a usage limit, and only then does Opus 5.5 review the same prompt. The review comment then reads "Claude (Opus 5.5, Fable out of usage)". Any other failure fails the job as before.

## Why

The PM asked for both. Argon's list price is a fifth of Astra's until 2026-11-30 and two fifths after. Fable's budget is small, and a PR waited when it ran out; Opus on the same subscription is a better reviewer than none.

## How

Argon runs in the Gemini CLI, pinned at 0.64.0, in its plan mode, which allows only reading tools. The web tools are taken out in a fresh settings file per run. Plan mode has no shell, so the job writes the PR's diff, and on later rounds the diff since the last reviewed commit, into files in `$RUNNER_TEMP/review/` and tells the model where they are. The CLI cannot enforce an output schema, so the prompt ends with the schema and the job checks the answer with `jq`, dropping a Markdown fence if the model adds one.

The Opus step installs Claude Code 2.1.280 first, as the fix job does, since the action's bundled version cannot run Opus 5.5.

## Problems and open points

- The usage-limit words are a pattern (`usage limit`, `limit reached`, `hit your limit`, `rate_limit_error` and the like), not a documented error code. If the first real limit does not match, the job fails as it did before this change.
- A PR that changes `pr-review.yml` is not reviewed by Claude (the action skips a workflow that differs from `main`). The first PR after the merge proves the fallback, and the first PR with `argon-review` proves Argon.

## Dead ends

None.
