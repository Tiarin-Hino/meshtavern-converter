---
name: verify-3d
description: Verify a visual or 3D change in the converter by driving the real app and looking at screenshots. Use after changing anything in the viewer, shaders, mesh output or layout, and before opening a PR for such a change.
---

# Verify a 3D change

The canvas has no accessibility tree, so text-based page inspection tells you nothing about the scene. Verify in two layers:

1. **Numbers first.** Drive the app through `window.__mt` (state, `loadDemo()`, and any hooks added for the feature) and assert on values: triangle counts, bounds in mm, LOD chosen, frame time. Add or extend a Playwright test in `e2e/` so the check stays in CI.
2. **Then pixels.** Run `npm run e2e` and open the screenshot written under `test-results/` with the Read tool. Check: is the mini lit (not black), upright (Y-up), standing on the grid, centred, fully in frame? Compare with the previous screenshot when changing looks.

Rules:

- Take screenshots from fixed camera positions so runs are comparable; add a hook to set the camera rather than dragging the mouse.
- If a judgement is aesthetic ("does the wash look good?"), do not decide it yourself: attach before/after screenshots to the PR and label the issue `needs-human`.
- For performance claims, record numbers from the app's own measurements, state the hardware, and never extrapolate from the headless software renderer used in CI.
- Test with real minis from the local `corpus/` folder when available, but never commit them or their converted output; commit only renders in `docs/design/`.
