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

## Use it as a library

The page is one consumer of the converter; the MeshTavern table application is another. `package.json` exports three entries, as TypeScript sources for a Vite project: `meshtavern-converter` (convert, refuse, size, orient, export; no three.js), `meshtavern-converter/three` (draw a baked mini) and `meshtavern-converter/dev` (generated meshes and STL writers, for tests and tooling). The package is not published to npm; install it from git (`"meshtavern-converter": "github:Tiarin-Hino/meshtavern-converter#<commit>"`).

```ts
import {
  Converter,
  ConversionProblem,
  PROBLEM_MESSAGES,
  readStlFile,
  memoryBudgetBytes,
  encodeGlb,
  DEFAULT_LOOK,
  BAKED_LEVEL,
} from 'meshtavern-converter';

const converter = new Converter();
// deviceMemory is Chromium-only; without it the budget assumes a 4 GB device.
const budget = memoryBudgetBytes((navigator as { deviceMemory?: number }).deviceMemory);

export async function addMini(file: File) {
  try {
    const stl = await readStlFile(file, budget); // refuses empty, not-STL and too-large files early
    const result = await converter.convert(stl, (p) => console.log(p.step, p.percent), {
      orientation: { up: '+z' }, // or leave it out: detected from the base
      sizing: { size: 'medium' }, // or leave it out: suggested from the base
    });
    const table = result.lods[BAKED_LEVEL]!; // the level the table shows; result.baked has its texture
    const glb = encodeGlb(table.mesh, {
      name: file.name,
      look: DEFAULT_LOOK,
      compact: false,
      sizing: result.sizing,
      orientation: result.orientation,
    });
    return { glb, ktx2: result.baked?.ktx2 ?? null, stats: result.stats };
  } catch (error) {
    if (error instanceof ConversionProblem) console.warn(PROBLEM_MESSAGES[error.code]);
    throw error;
  }
}
// converter.cancel() stops the running conversion; its promise rejects with ConversionCancelled.
```

- The look is chosen when a mini is drawn and exported (`look` above, `vertexColours`, the `three` entry), not when it is converted: changing the colour does not need a new conversion.
- `createBakedMaterial` and `transcodeDetail` from `meshtavern-converter/three` draw the baked table level with its KTX2 texture. `transcodeDetail` needs three.js's `basis_transcoder.js` and `.wasm` served; pass their folder as its third argument (this page serves them under `basis/`, see `vite.config.ts`).
- Linked with `file:../meshtavern-converter` instead, Vite's dev server refuses to serve the worker from outside the project until the folder is allowed: `server: { fs: { allow: ['.', '../meshtavern-converter'] } }`.

## Licence

[MIT](LICENSE).

## Third-party content

The creature size names (Tiny, Small, Medium, Large, Huge, Gargantuan, in `src/lib/pipeline/size.ts`) come from the SRD 5.1. The footprint in squares, the 32 mm grid and the plain-base diameters are this project's own.

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at <https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at <https://creativecommons.org/licenses/by/4.0/legalcode>.
