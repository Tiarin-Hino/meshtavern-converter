---
name: continue-pr-quiet
description: Continue a hand-over PR like /continue-pr, but without anything that loads the PC - no e2e, browser, corpus or measurement runs. Use when asked to continue or build a PR quietly, in the background, or while the PM is using the PC.
argument-hint: <PR number>
---

# Continue PR $ARGUMENTS, quietly

The PM is using this PC while you build. Do exactly what `/continue-pr` does (read `.claude/skills/continue-pr/SKILL.md` and follow its steps in order), under the quiet rules of `/implement-quiet` (read `.claude/skills/implement-quiet/SKILL.md`: what not to run, what to run instead, what changes at the end). Only what a hand-over adds to those rules is written here.

- **Build order.** The design note's steps are built in its order. A step that is itself a heavy run (a corpus run, measurements, screenshots with `verify-3d`) is not done: it goes on the PR's "Deferred to a full run" list with the note's section, and the steps after it that do not need its result go ahead.
- **Stop rules that need a heavy run** (a time over budget, a corpus mini that fails, a placement score that moves) cannot fire in a quiet build. Say so in the PR body next to the deferred run, so the full run knows it still has to check them.
- **The end.** The PR stays a draft: step 7 of `/continue-pr` rewrites the body with the evidence there is, and does not mark the PR ready. `/continue-pr <PR>` on a free PC finishes it.
