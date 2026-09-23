---
title: Two automatic reviewers, and what the second one caught in itself
date: 2026-09-23
phase: 1
issues: []

prs: [60, 64]
topics: [workflow, tooling, testing]
---

## What we did

PRs in this repo now get two automatic reviews. Claude reviews the diff for bugs and comments inline. GPT Astra, a model from another vendor, checks that the solution is as simple as the problem and fits the rest of the codebase. If Astra finds nothing blocking, the PR gets the label `ready-for-human-review`. If it does, the PR gets `astra-changes-requested`, a Claude job fixes the findings on the branch, and the next push is reviewed again. After three failed rounds the PR gets `needs-human`. `@claude` mentions in issues and PRs work too.

## Why

Most code here is written by an AI agent, and the PM does not read code. A reviewer that is a different model catches different mistakes, and letting the agent fix blocking findings before a human looks saves a round trip. The labels are advice: a human still reviews and merges.

## How

- `.github/workflows/astra-review.yml` has three jobs. **review** runs `openai/codex-action@v1` read-only and must answer in a fixed JSON schema (`.github/astra-review.schema.json`). **verdict** posts the comment, sets the labels and counts earlier rounds from its own comments. **fix** runs `anthropics/claude-code-action@v1` without the workflow's own token, so that its push comes from the Claude GitHub App and starts the next review (a push made with the workflow token starts no new runs).
- Astra's instructions are plain text in `.github/astra-review.md`, pointed at this repo: `CLAUDE.md`, `docs/specs/`, the rule that a user's STL is never uploaded, and `src/regression/baseline.json`.
- Because the repo is public, `@claude` answers only the owner, members and collaborators, and neither review runs on PRs from forks (which get no secrets) or on drafts.
- The PR was opened as a draft because the secrets did not exist yet; marking it ready was the first real run.

## Problems and how we solved them

- **Anyone could end the loop.** Astra's first round on this PR found that the round counter trusted the review marker in comments from anyone. On a public repo, three copied comments would stop the loop. **Fix:** count only markers posted by `github-actions[bot]`.
- **A stale review could act on newer code.** Round 2 found that a review of an older commit could still label or "fix" the PR after a new push. **Fix:** the verdict and fix jobs skip when the PR's head has moved since the review started. Round 3 passed.
- **The fix loop cannot fix the PR that adds it.** `claude-code-action` refuses to run when the workflow file differs from the one on the default branch, so the fixes above were made by hand in the local session.

## Numbers

- Three Astra rounds on this PR: changes, changes, pass. Successful Astra runs took about 50 s to 75 s on GitHub Actions.
- Every push to an open PR is one paid review, and every failed review adds one Claude run.

## Still open

- The fix job does not run `npm run check` before it commits. The plan was that CI on its push would catch a broken fix; see the next point for why that does not happen yet.
- **The loop does not close yet.** Its first real run was on #63, the PR that added this journal: Astra asked for two changes and the Claude fix job committed them on the branch (da7fa14), but that push started no workflow at all, neither the next Astra round nor CI. So the claim that a push from the Claude GitHub App starts new runs does not hold as set up; a human push restarts the checks. **Cause, found 2026-09-23:** the fix job's `actions/checkout` stored the workflow token in git's config (its default, `persist-credentials`). When Claude pushed, git sent that stored token instead of the Claude App token the action had put in the remote URL, so the push counted as a workflow-token push, and GitHub starts no workflows for those. Claude's own review on #12 had pointed at exactly this line. **Fix:** `persist-credentials: false` on that checkout, in both repos (#64 here). It can only be proven after merge, because the Claude action refuses to run a workflow that differs from the one on `main`.

## Story angle

A reviewer that found two bugs in its own plumbing on its first day. Title idea: "Letting one model review another".
