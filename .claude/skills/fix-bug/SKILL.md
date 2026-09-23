---
name: fix-bug
description: Reproduce, diagnose and fix a bug with a regression test, then open a PR. Use when asked to fix a bug, given a bug issue number, or given a description of something that does not work as specified.
argument-hint: <issue number or description>
---

# Fix bug: $ARGUMENTS

1. **Get the report.** With an issue number: `gh issue view <n> --comments`. With only a description: search for an existing issue first (`gh issue list --search`), and if there is none, create one with steps, expected, actual and browser/OS/GPU so the fix has something to close.
2. **Is it a bug?** Compare "expected" with the spec and the issue's acceptance criteria. If the behaviour was never specified, it is a product question: label `needs-human` and ask instead of choosing.
3. **Reproduce before touching code.** Write a failing test (unit if possible, e2e if it needs the browser) that shows the bug. Build the input as a generated mesh (see `src/regression/shapes.ts`) or a minimal synthetic file, never a real mini. If it cannot be reproduced, say exactly what was tried and ask for the missing detail; do not ship a speculative fix.
4. **Find the cause, not the symptom.** Use `git log` / `git blame` and the journal entry of that area to see when it broke and why the code looks the way it does. State the root cause in one or two sentences.
5. **Branch** `fix/<n>-short-name` and make the smallest change that fixes the cause. No drive-by refactors. Check nearby code for the same mistake and mention what was found.
6. **Prove it.** The new test passes; `npm run check` and `npm run e2e` pass. For a visual bug, take before and after screenshots with `verify-3d`.
7. **Journal.** Add an entry in `docs/journal/` (format: `docs/journal/README.md`): the symptom, how it was found, the root cause, the fix, and how the bug got in. For a bug in work that already has an entry, extend that entry instead. Skip only for a typo or formatting fix.
8. **Open the PR** with `/open-pr`. The description states: root cause, the fix, the regression test, and anything that could not be verified on this machine (other browsers, GPUs).
