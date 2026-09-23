---
name: test
description: Write or extend tests for an area, or check an issue's acceptance criteria one by one and report what is proven. Use when asked to test something, add coverage, verify acceptance criteria or find out why tests are flaky.
argument-hint: <area, file, or issue number>
---

# Test: $ARGUMENTS

Pick the mode from the argument.

## An issue number: verify acceptance criteria

1. `gh issue view <n>`; list every acceptance criterion.
2. For each one, find or write the check that proves it and run it. Produce a table: criterion, how it was checked, result, evidence (test name, number with its device, screenshot path).
3. Mark criteria that only a human can judge (looks, feel) as **needs a human look** and prepare the screenshots for them with `verify-3d`. Never tick those yourself.
4. Report failures plainly with the output. Do not fix them here unless asked; suggest `/fix-bug`.

## An area or file: extend coverage

1. Read the code and its existing tests; follow the test style and commands in `CLAUDE.md`.
2. List the behaviours that matter and are untested: edge cases, error paths, limits (huge meshes, empty files, malformed or non-manifold input, odd up axes).
3. Write tests for behaviour, not implementation details. Pipeline functions get fast unit tests in Node; use e2e only for what needs a browser. Canvas content is asserted through numbers exposed by `window.__mt`, with screenshots only for "does it look right".
4. If a test exposes a real bug, keep the failing test, report it, and file a bug issue rather than weakening the test.

## Always

- Fixtures are generated (see `src/regression/shapes.ts`) or self-made. No STL files of real minis and no third-party IP, even in a test name.
- The regression baseline (`src/regression/baseline.json`) is changed only on purpose, with `npm run baseline:update` and a reason in the PR.
- A flaky test is a bug: find the cause (timing, shared state, GPU differences, software rendering in CI) instead of adding retries or sleeps.
- Test-only work goes on a `test/<n>-short-name` branch and through `/open-pr` like any other change.
