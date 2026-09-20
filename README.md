# MeshTavern Converter

Turn a 3D-print STL of a miniature into a lightweight, game-ready 3D mini — entirely in your browser. Your STL file is never uploaded.

**Status:** early, but usable end to end. Drop an STL and it is reduced to three detail levels, stood upright, given a primed-and-washed look, and can be downloaded as a GLB file. Everything runs in your browser. See [the Phase 0 spec](docs/specs/phase-0-spike.md) for measurements and what is still open.

## Run it

```bash
npm install
npm run dev
```

## Develop

```bash
npm run check   # format, lint, typecheck, unit tests, build
npm run e2e     # Playwright smoke test (first time: npx playwright install chromium)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [CLAUDE.md](CLAUDE.md) for conventions (also used by the Claude Code agent).

## Licence

[MIT](LICENSE).
