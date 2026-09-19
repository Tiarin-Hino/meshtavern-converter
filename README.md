# MeshTavern Converter

Turn a 3D-print STL of a miniature into a lightweight, game-ready 3D mini — entirely in your browser. Your STL file is never uploaded.

**Status:** early spike. It currently opens an STL, shows it and reports its size and triangle count. Reduction, auto-scaling, the "primed" look and GLB export are in progress — see [the Phase 0 spec](docs/specs/phase-0-spike.md).

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
