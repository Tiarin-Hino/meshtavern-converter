# MeshTavern Converter

Turn a 3D-print STL of a miniature into a lightweight, game-ready 3D mini — entirely in your browser. Your STL file is never uploaded.

**Status:** early, but usable end to end. Drop an STL and it is reduced to three detail levels, stood upright, measured (units, base, creature size and its footprint on a 32 mm grid), given a primed-and-washed look, and can be downloaded as a GLB file (the table and far levels). Everything runs in your browser. There is no hosted version yet: run it locally as shown below. See [the Phase 0 spec](docs/specs/phase-0-spike.md) for measurements, and [the Phase 1 spec](docs/specs/phase-1-converter.md) for what is being built now. [The journal](docs/journal/) tells how it was built: what we tried, what failed and why.

## Run it

```bash
npm install
npm run dev
```

Open the page, drop an STL (or choose one), and download the table or far level as a GLB. The team's tools from the spike (figures, stress scene, device benchmark, opening a GLB, the compressed download) appear with `?dev` in the address, for example `http://localhost:5173/?dev`.

## Develop

```bash
npm run check   # format, lint, typecheck, unit tests, build
npm run e2e     # Playwright smoke test (first time: npx playwright install chromium)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [CLAUDE.md](CLAUDE.md) for conventions (also used by the Claude Code agent).

## Licence

[MIT](LICENSE).

## Third-party content

The creature size names (Tiny, Small, Medium, Large, Huge, Gargantuan, in `src/pipeline/size.ts`) come from the SRD 5.1. The footprint in squares, the 32 mm grid and the plain-base diameters are this project's own.

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at <https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at <https://creativecommons.org/licenses/by/4.0/legalcode>.
