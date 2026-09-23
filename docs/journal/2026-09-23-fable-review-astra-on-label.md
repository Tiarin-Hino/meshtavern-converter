---
title: Claude reviews every PR, Astra only on request
date: 2026-09-23
phase: 1
issues: []
prs: []
topics: [workflow, tooling]
---

## What we did

The automatic PR review now runs Claude on the Fable 5.1 model on every PR, with the same instructions GPT Astra used. Astra stays, but it runs only while a maintainer puts the `astra-review` label on a PR. `astra-review.yml` became `pr-review.yml`, and the instructions moved to `.github/pr-review.md`. The fix loop is unchanged: blocking findings, then a Claude fix on the branch, then a new review, and `needs-human` after three rounds. Its label is now `changes-requested`.

Models now have fixed roles: Opus 5.5 builds (the fix job, `@claude`, `/implement`), Fable 5.1 reviews. `/implement` checks whether an issue needs strategic thinking first and, if the session is not on Fable, reminds the PM before branching. `/review-pr` gives the same reminder. `/open-pr` adds "Suggest the astra-review label: …" to the description when a PR is complex or risky, and never adds the label itself.

## Why

A paid review on every push to every PR added up quickly. What the PM wanted to keep was the separation: a reviewer that did not write the code. That comes from how the review runs, not from who makes the model. The job runs on GitHub in a fresh context, sees only the repo, the diff and its instructions, and never the session that built the PR. A Claude job set up this way is just as separate and runs on the existing Claude subscription. A different model family still catches things the same family misses, so Astra stays available for the PRs that need it.

## How

Five jobs in `pr-review.yml`:

- **prompt** builds the prompt once. It takes the instructions and schema from the base branch (the merge commit's first parent), so a PR can no longer loosen its own review. On a new push it removes `ready-for-human-review`.
- **claude** runs `claude-code-action` with `--model claude-fable-5-1`, read-only tools and `--json-schema`, so its answer has the same shape as Astra's.
- **astra** runs only with the `astra-review` label. Adding the label starts it. Other labels start nothing.
- **verdict** posts one comment with a section per reviewer. `ready-for-human-review` only when no reviewer has a blocking finding.
- **fix** is unchanged apart from `--model claude-opus-5-5`. It still runs `npm run check` before committing.

Review jobs time out after 20 minutes and cancel the review of an older push of the same PR. The fix job is outside that group, so a push never cancels a running fix. `@claude` runs on Opus 5.5 and the bug-hunting review on Fable 5.1.

## Problems and how we solved them

- **The review cannot test itself on the PR that adds it.** `claude-code-action` skips itself when the workflow file differs from `main` (seen on #60). The verdict job then fails with "The Claude review returned nothing" rather than posting a pass. The first real run is the next PR after the merge.
- **Open PRs.** They keep `astra-changes-requested` until their next verdict removes it, and their round count starts again at 1 because the marker changed.

## Dead ends

- **Claude only.** It drops the second model family completely.
- **A label that runs Astra once and removes itself.** Astra would never see the fixes to its own findings.

## Numbers

- The verdict script was run against a mocked GitHub API in Node, on the development PC, for four cases: pass, a mix of Claude passing and Astra blocking, give-up after three rounds, and an empty Claude answer. All four gave the expected comment and labels.
- Not measured yet: how long a Fable review takes on GitHub Actions.

## Still open

- First real run on the next PR after the merge: check the Claude JSON, the label, and that `astra-review` starts Astra.
- `needs-human` is never cleared, and the fix job's `Bash(git:*)` stays wide. Both are unchanged from #60.

## Story angle

A reviewer is independent when it never sees how the code was built, whoever makes the model. Post title: "What makes an AI reviewer independent: fresh context, not a second vendor".
