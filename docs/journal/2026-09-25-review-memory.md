---
title: The reviewer remembers its earlier rounds
date: 2026-09-25
phase: 1
issues: []
prs: [78]
topics: [workflow, tooling, review]
---

## What we did

The automatic PR review now sees what it said before and what the author answered. The prompt job puts every comment on the PR into the prompt, names the commit the last round judged, and states the date with the author's time zone; the verdict job stamps each review comment with the commit it reviewed. The rules gained a "Later rounds" section: an answered, deferred or declined note is closed; non-blocking notes come only from the commits since the last round; at most three of them per review; dates are judged against the prompt's date; and the repo's skills count as rules next to `CLAUDE.md`. Companion PR in the private repo: Tiarin-Hino/meshtavern#21.

## Why

The PM counted the review rounds on #74 (scale and base): 11 rounds over 2026-09-23 and 24, 36 notes, 2 of them blocking. The biggest source of noise was one note re-raised in 7 of 11 rounds: `measureBase` repeating the per-face loop of `detectUpAxis`, about a second on the largest file. It stayed after the PR body listed it as a limit, after it became an acceptance criterion in #72, and after a code comment at the loop said so. Round 11 still wrote "it is a small change and would remove the duplicate now". Two false positives came from the runner's clock: the design note was dated 2026-09-25, which it already was in Central Europe while the runner, on UTC, was a day behind; three rounds called it a future date. One came from reading half the rules: screenshots in `docs/design/` were flagged as against `CLAUDE.md` when `verify-3d` says renders go there. And later rounds kept finding two to five fresh notes on code that had not changed for several rounds, so the loop never reached zero.

None of this was the reviewer disobeying its rules. Every round was a fresh review that saw only the rules, the PR title and body, and a diff range: no earlier comments, no replies, no date. The rule "do not raise new non-essential points on code you could have flagged before" was there, but the reviewer had no way of knowing what "before" was.

What was worth keeping came from the same reviews: the leftovers after an idea changed (a stale `CLAUDE.md` rule, the one blocking finding; the spec with the old number; a stale viewer comment) and real slips introduced by the fixes themselves (a benchmark converting twice, a scale button turning a suggested size into a chosen one, a warning firing from a measure the PM had dropped). Those came from reviewing the new commits, which is exactly what the later rounds should be limited to.

## How

- **Memory through the PR itself.** The prompt job (`.github/workflows/pr-review.yml`) fetches the PR's comments with `gh api` and appends them to the prompt under "Earlier rounds and replies", each cut at 6,000 characters and the whole at 80,000, newest kept. No store, no artefact: the PR thread is the memory, and it is what a human reviewer would read too. The reviewer's own tools stay read-only on the repo.
- **The stamp.** The verdict job writes `<!-- pr-review:reviewed <sha> -->` into every review comment. The next prompt job finds the last stamp and gives the reviewer a second diff range, "what changed since the last round", next to the whole PR's range. On the first round the prompt says so.
- **The date.** One line, "Today is <date> (UTC). The author works in Central European time; a date within one day of today is not a future date", and a rule to judge dates against that line only.
- **The rules** (`.github/pr-review.md`): a "Later rounds" section with the closed-note rule, the new-commits-only rule for non-blocking notes, the "nothing to say" outcome after a ready verdict; a cap of three non-blocking notes; the skills as rules, with `verify-3d` and `open-pr` named. The existing sentence about not raising new non-essential points on old code moved into that section.
- **`CLAUDE.md`** now says `docs/design/` holds renders and screenshots too, which `verify-3d` always said; the disagreement the round-10 note found is closed at the source.
- The rules and the workflow are read from `main`, so the first PR to get the remembering reviewer is the one after this merges.

## Problems and how we solved them

- **Comment bodies can be null** (a comment with only an attachment): the `jq` filter uses `(.body // "")` so one such comment does not empty the whole list.
- **`pipefail` is on in GitHub's shell**, so the `grep | tail | cut` that finds the stamp ends the step when there is no stamp yet. The pipeline carries `|| true` and the first round takes the "nothing reviewed before" branch.
- **The stamp could name a commit the checkout does not have** (a force-push, a rebase). `git cat-file -e` checks before the range is offered; otherwise the prompt falls back to the first-round wording.

## Still open

- Whether 6,000 characters per comment keeps enough of a long review: the reviews on #74 were 3,000–5,000. Raise it if a stamp or an answer gets cut.
- The cap of three notes and the "new commits only" rule are a judgement the reviewer makes; the next long PR shows whether it holds. Count the rounds again.
- The fix job's own comments are by `claude[bot]`; they are in the list like every other reply, but nothing marks them as the fix job's. Fine while it is one voice.

## Story angle

A reviewer with no memory is not stubborn, it is amnesiac: eleven rounds on one PR, the same note seven times, and the one-line fix was to let it read the thread.
