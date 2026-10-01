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

// A figure, and optionally its base and its other parts: up to MAX_PARTS files.
export async function addMini(files: File[]) {
  const [file, ...others] = files;
  try {
    // readStlFile refuses empty, not-STL and too-large files early.
    const [stl, secondStl, ...moreStl] = await Promise.all(
      files.map((f) => readStlFile(f, budget)),
    );
    const result = await converter.convert(
      stl!,
      (p) => console.log(p.step, p.percent),
      // sizing: or leave it out, suggested from the base; the other files are transferred too.
      { sizing: { size: 'medium' }, ...(secondStl && { secondStl, moreStl }) },
      // Optional: stop and ask on the full-detail meshes. askPerson and markPerson are your own
      // dialogs; answer with confirm: false to show a change first.
      async (question) =>
        question.kind === 'up'
          ? { kind: 'up', orientation: await askPerson(question), confirm: true }
          : { kind: 'meet', ...(await markPerson(question)), confirm: true },
    );
    const table = result.lods[BAKED_LEVEL]!; // the level the table shows; result.baked has its texture
    const glb = encodeGlb(table.mesh, {
      name: file!.name,
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

- The fourth argument of `convert` is optional. With it, the worker stops on the full-detail meshes and asks. Every `Question` carries the welded meshes the callback has not had yet (`meshes`, each file once, in file coordinates) and where to draw each file (`shown`: a rotation and a translation per file, and the `box` of it all). An `UpQuestion` (`kind: 'up'`) asks which way is up: the `role` (`mini`, or `base` then `figure` for several files), the proposed `orientation` and why (`reason`). The answer is an `UpAnswer`: `orientation` as in the options (`{}` is the proposal), `confirm`, and `swap` or `baseFile` (another file as the base, or `null`: no base, the files are parts of one figure). A `MeetQuestion` (`kind: 'meet'`) asks how a figure's parts go together (`about: 'parts'`, first) or where the figure meets its base (`about: 'base'`, last, for every pair), in two stages: `pairs` (the parts apart, with the pairs of patches where they meet: the converter's proposal, `proposed`, or the person's) and `fitted` (put together, `placement`). A patch is an area of a part's surface made by strokes (`Stroke`: a tap, a brush or an eraser dab at a point in its file's coordinates); a pair is a patch on the part in place (`on`) and one on the part that goes there (`of`). The answer is a `MeetAnswer` with one `action`: `tap` and `brush` (at a `Target`: a ray in the coordinates `shown` is drawn in, or a point on a file), `clear`, `undo`, `set` (a whole `Meeting` or the parts' joints at once), `fit` (put them together), `back`, `nudge` (`liftMm`, `turnDeg`, `turn: 'keep' | 'free'`), `pick` (what is there) and `confirm`. The question that comes back holds the marks (`marks`) and what to draw (`pairs`, each side's `triangles`). Without the callback nothing is asked, and the options say how the files stand and meet (`orientation`, `baseOrientation`, `pairing`, `parts`, `placement.marks`). `result.choices` holds what was confirmed: converting the same files with those options gives the same mini without asking.

- The look is chosen when a mini is drawn and exported (`look` above, `vertexColours`, the `three` entry), not when it is converted: changing the colour does not need a new conversion.
- `createBakedMaterial` and `transcodeDetail` from `meshtavern-converter/three` draw the baked table level with its KTX2 texture. `transcodeDetail` needs three.js's `basis_transcoder.js` and `.wasm` served; pass their folder as its third argument (this page serves them under `basis/`, see `vite.config.ts`).
- Linked with `file:../meshtavern-converter` instead, Vite's dev server refuses to serve the worker from outside the project until the folder is allowed: `server: { fs: { allow: ['.', '../meshtavern-converter'] } }`.

## Licence

[MIT](LICENSE).

## Third-party content

The unwrap runs [xatlas](https://github.com/jpcy/xatlas) (MIT, Copyright 2018-2020 Jonathan Young), compiled by this project to WebAssembly from upstream commit `f700c779` (`wasm/xatlas/`, licence in [`wasm/xatlas/LICENSE`](wasm/xatlas/LICENSE)).

The detail texture is encoded with [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Apache-2.0, Copyright 2016–2026 Binomial LLC; "Basis Universal" is a trademark of Binomial LLC), compiled by this project to WebAssembly from upstream commit `1b33fd50` (`wasm/basis-encoder/`, licence and notice in [`wasm/basis-encoder/LICENSE`](wasm/basis-encoder/LICENSE) and [`wasm/basis-encoder/NOTICE`](wasm/basis-encoder/NOTICE)). The build includes [Zstandard](https://github.com/facebook/zstd) (BSD-3-Clause, Copyright Meta Platforms, Inc., [`wasm/basis-encoder/LICENSE-zstd`](wasm/basis-encoder/LICENSE-zstd)) and the QOI and DDS readers upstream bundles (MIT, [`wasm/basis-encoder/LICENSE-mit`](wasm/basis-encoder/LICENSE-mit)).

The creature size names (Tiny, Small, Medium, Large, Huge, Gargantuan, in `src/lib/pipeline/size.ts`) come from the SRD 5.1. The footprint in squares, the 32 mm grid and the plain-base diameters are this project's own.

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at <https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at <https://creativecommons.org/licenses/by/4.0/legalcode>.
