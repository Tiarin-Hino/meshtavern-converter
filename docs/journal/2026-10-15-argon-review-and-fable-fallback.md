---
title: Gemini 4 Argon becomes the second reviewer, GPT Astra the occasional third, and Opus reviews when Fable is out of usage
date: 2026-10-15
phase: 1
issues: []
prs: [163, 169]
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

## One Claude review per PR (2026-10-16)

From 2026-09-23 to 2026-10-16, two workflows ran Claude Fable 5.1 on every non-draft PR event (opened, each push, ready for review, reopened): `claude-code-review.yml` from #60, and `pr-review.yml`. #66 added `pr-review.yml` and only switched the older workflow's model to Fable.

PR Review (`pr-review.yml`) posts the verdict, sets the labels, drives the fix job, and since #163 falls back to Opus 5.5. The older Claude Code Review ran the code-review plugin, which posts inline comments only when it finds something: none on #161 or #162. Of its last 40 runs (2026-10-14 to 2026-10-16), 27 succeeded, each spending Fable's budget; 9 were skipped, 4 failed. The PM's reading: this is why Fable's weekly budget ran out although Fable was barely used for development.

With no fallback, it failed on every PR once Fable was out of usage, in under a second: #162 (the pipette, #135), #163 and #168, which was green except for that check. The PM chose on 2026-10-16 to delete it rather than give it a fallback. One Claude review now runs per PR event. A PR opened before the merge keeps the failed `claude-review` check on its last commit; it is not required, and the next push or "Update branch" drops it.

## A docs-only PR gets the format check alone (2026-10-16)

That PR's CI then failed on one e2e test (the keyboard test timed out waiting for the file chooser) although it changed only a workflow and this entry; the run took 21 minutes on a GitHub runner. The PM asked that a PR which does not touch the code skip the build and the e2e run.

`ci` is a required check on `main`, and a workflow skipped by path filters never reports, so the PR would wait forever. Instead the job always runs and its first step lists what the PR changes (`git diff` between GitHub's merge commit for the PR and its first parent, the base). When every path is in `DOCS_ONLY` (`docs/`, `.claude/`, `CLAUDE.md`, `CONTRIBUTING.md`, `.mcp.json`, the files directly in `.github/`, the issue forms, `pr-review.yml` and `claude.yml`), it runs `npm run format:check` alone. Anything else runs everything. `README.md` stays code: the unit tests read it. Pushes to `main` always get the whole run, so a path wrongly on the list is caught after the merge.

## Dead ends

None.
