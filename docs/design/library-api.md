# Design: a converter other code can call (#50)

Status: design pass by Fable 5.1, 2026-09-26, for Opus 5.5 to build · Spec: Phase 1, story 5 · Issue: #50

This note fixes the decisions the build should not have to make: where the library ends and the page begins, what the library exports and through which entries, how the page and the table application import it, how the boundary is enforced, the build order with the test that proves each step, and where the builder must stop and ask. The issue is a refactor with one hard rule, **no behaviour change**: every unit and end-to-end test passes unchanged or with import paths updated only, and the regression baseline does not move. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§9).

## 1. What exists and what the table needs

Today `src/` is one folder with two kinds of code in it. The pipeline (`src/pipeline/`, pure functions on typed arrays, no DOM, no three.js) and the worker around it (`src/worker/`: `Converter` on the page side, the message protocol, the worker glue) are the converter. Everything else is the page: `main.ts` (980 lines of UI wiring), `viewer.ts` (the three.js scene, orbit and rotate controls, the stress table), `baked-material.ts` and `compressed-texture.ts` (drawing a baked mini with three.js), `benchmark.ts`, `options.ts` (the `?bake=`, `?ktx=`, `?dev` address options), `page-state.ts` (wording and the four states), `style.css`. The page reaches into the pipeline wherever it likes: `main.ts` imports from eleven pipeline modules.

The table application (private repo, Phase 2) will do what the page does when a file is picked: refuse a file that is not an STL or too large before reading all of it, hand the buffer to a worker, show progress, allow cancel, take the result (the levels, the KTX2 detail texture, the sizing and orientation, the figures), let the user correct up axis, turn, units and size and convert again, draw the baked table level with the shader that matches `look.ts`, and write a GLB for the server. Nothing of that is page-specific. What is page-specific: the DOM, the wording, the address options, the viewer's scene, the stress table, the benchmark.

So the boundary is: **the library is everything the table's "add a mini" flow needs; the page is everything only this page needs.** The viewer is page code (the issue: "the viewer stays a separate, optional part"); the two three.js modules that draw a baked mini are library code, because their GLSL must stay in step with `look.ts` and every consumer that draws a baked mini needs them.

## 2. Layout

```
src/
  lib/                       the library: what a consumer may import
    index.ts                 the public API, three.js-free (§3)
    three.ts                 the three.js helpers for drawing a baked mini (§4)
    dev.ts                   generated meshes, STL writers, step lists: tests, tooling, the benchmark (§5)
    pipeline/                moved from src/pipeline/, unchanged inside
    worker/                  moved from src/worker/, unchanged inside
    three/
      baked-material.ts      moved from src/baked-material.ts
      compressed-texture.ts  moved from src/compressed-texture.ts
  page/                      the page: imports the library through src/lib/index.ts, three.ts and dev.ts only
    main.ts, viewer.ts, benchmark.ts, options.ts, page-state.ts, style.css
    options.test.ts, page-state.test.ts
  regression/                the regression net, unchanged in place; imports through the entries like the page
  types/                     unchanged
```

Why move the folders instead of adding an entry file next to them: the split has to be visible in the tree, one lint pattern has to name the library's inside (§6), and the PM asked for `src/` to be split, not annotated. `git mv` keeps the history readable. Tests stay next to their modules, so the pipeline's tests and `src/lib/worker/*.test.ts` need no import change at all; `src/regression/`, `src/page/*.test.ts`, `e2e/*.spec.ts` and `index.html` (`/src/page/main.ts`) change paths only. `docs/journal/` keeps its old paths: history is not rewritten.

Nothing moves inside `pipeline/` and `worker/`. `Converter` stays in `src/lib/worker/client.ts` and is re-exported; `ConvertOptions` stays in `protocol.ts`. Renaming or merging modules is not part of this story.

## 3. The public API: `src/lib/index.ts`

One file of re-exports, nothing else: the API is the list, and §7 turns the list into a test so it grows on purpose. Keep the signatures exactly as they are. In particular `Converter.convert(stl, onProgress, options)` stays as it is, callback second: changing it would change `client.test.ts` beyond an import path, which the issue rules out. An `AbortSignal` or an options-only signature is a follow-up issue, not this one.

```ts
// The converter: a worker that converts one STL at a time.
export { Converter, ConversionCancelled, type WorkerLike } from './worker/client';
export type { ConvertOptions } from './worker/protocol';
export {
  BAKED_LEVEL,
  STEPS,
  BAKE_STEPS,
  type ConversionResult,
  type ConversionStats,
  type Baked,
  type BakeFigures,
  type BakeSkipped,
  type Progress,
  type StepName,
  type StepTiming,
  type LodStats,
} from './pipeline/run';
// Why a file did not become a mini, with the sentence the user reads.
export {
  ConversionProblem,
  PROBLEM_MESSAGES,
  toProblem,
  type ProblemCode,
} from './pipeline/problems';
// Refusing a file before all of it is read: what the page does in its drop handler.
export { readStlFile } from './read-file'; // §3.1 (proposal)
export { SNIFF_BYTES, sniffStl, type StlFormat } from './pipeline/stl';
export { checkFits, memoryBudgetBytes, estimateConversionBytes } from './pipeline/memory';
// The mesh the levels are made of.
export type { IndexedMesh } from './pipeline/mesh';
export type { Lod, LodSpec } from './pipeline/simplify';
export { LOD_SPECS } from './pipeline/simplify';
// Orientation: the detection's result and the user's correction (issue #72).
export { UP_AXES, type UpAxis, type Orientation, type OrientationOptions } from './pipeline/orient';
export {
  fromAxisAngle,
  IDENTITY,
  multiply,
  turnAngleDeg,
  type Rotation,
} from './pipeline/rotation';
// Size: units, creature size, base, footprint (issue #44).
export {
  CREATURE_SIZES,
  GRID_SQUARE_MM,
  SIZES,
  sizeLabel,
  footprintMm,
  type CreatureSize,
  type FootprintSquares,
  type Sizing,
  type SizingOptions,
  type SizingWarning,
  type Units,
  type BaseMeasurement,
} from './pipeline/size';
export { UNIT_FACTORS } from './pipeline/units';
// The look: applied when drawing and exporting, never inside the conversion (§3.2).
export { DEFAULT_LOOK, vertexColours, type Look } from './pipeline/look';
// The detail texture.
export type { BakedMaps } from './pipeline/bake';
export { readKtx2Header, type Ktx2Header } from './pipeline/compress';
// Export.
export { encodeGlb, glbEncoderReady, type GlbOptions } from './pipeline/glb';
```

The rule for what is in and what is out: **in, when the table's "add a mini" flow would import it; out, when only this page, a test or a script does.** The list above is what `main.ts` and `viewer.ts` import today, sorted by that rule, plus `readKtx2Header` and `estimateConversionBytes` (a consumer will want to say how large the texture is and whether a file fits). If the build finds the page needs something not listed, decide by the rule: a consumer would need it too → add it to `index.ts`; only the page → `dev.ts` (§5), or keep it in the page. Both are a one-line change; note them in the PR.

### 3.1 `readStlFile` _(proposal)_

The page's drop handler does three things before it converts: it sniffs the first `SNIFF_BYTES` to tell binary from ASCII, checks that the file fits the memory budget, and only then reads the whole file. The table will do exactly that, so it belongs in the library:

```ts
// src/lib/read-file.ts
/**
 * Reads an STL into memory the way the page does: the first SNIFF_BYTES and the size decide
 * whether the file is refused (empty, not an STL, too large for the budget) before all of it
 * is read. Throws a ConversionProblem. Blob is available in browsers, workers and Node.
 */
export async function readStlFile(file: Blob, memoryBudgetBytes?: number): Promise<ArrayBuffer>;
```

`main.ts` calls it and keeps its own extension check and `describeWrongFile` (page wording). Unit test in Node with a `Blob`: an empty blob, a blob of zeros (not an STL), a valid small STL with a budget too small, a valid one with enough budget. The e2e refusals in `messy-files.spec.ts` keep proving the page's side. If the extraction changes what any messy-file test sees, stop (§9): the point is to move the lines, not to change the order of the checks.

### 3.2 Where the look is

The issue lists "look preset" among the options to convert with. The look is not an input of the conversion, on purpose (Phase 0, `2026-09-20-primed-and-washed-look.md`): the pipeline stores per-vertex occlusion and cavity, and the colours are computed when a mini is drawn (`vertexColours`, the shader in `baked-material.ts`) and when it is exported (`encodeGlb({ look })`). Converting again to change the colour would be wrong. So the API covers the look through `Look`, `DEFAULT_LOOK`, `vertexColours`, `GlbOptions.look` and the `three` entry, and a preset (#45, not built) will be a `Look` value with a name, exported from `index.ts` when #45 adds it. Say so in the README example and in the PR, so the criterion reads right.

## 4. The three.js entry: `src/lib/three.ts`

```ts
export {
  createBakedMaterial,
  createBakedGeometry,
  createDetailTexture,
  createLookUniforms,
  updateLookUniforms,
  disposeBakedMaterial,
  bakedTextureBytes,
  type LookUniforms,
} from './three/baked-material';
export { transcodeDetail, ownCopy, compressedTextureBytes } from './three/compressed-texture';
```

Separate from `index.ts` so a consumer without three.js (a Node script, a test, a server that only wants the GLB) never loads it, and so the test of §7 can prove `index.ts` is three.js-free. `three` stays in `dependencies`: the page needs it, and the table has it anyway.

One change inside: `TRANSCODER_PATH` in `compressed-texture.ts` reads `import.meta.env.BASE_URL`, which only exists under Vite. Give `transcodeDetail` an optional third parameter `transcoderPath` with today's value as the default, so a consumer that serves the Basis transcoder elsewhere can say where; the page passes nothing. No other signature changes. The README says that the consumer must serve three.js's `basis_transcoder.{js,wasm}` under that path (the page does it in `vite.config.ts`).

## 5. The development entry: `src/lib/dev.ts`

What tests, the benchmark, the regression net and scripts need, and a table would not:

```ts
export { generateBumpySheet } from './pipeline/generate';
export { encodeBinaryStl, encodeAsciiStl } from './pipeline/stl';
export { runPipeline, type PipelineOptions } from './pipeline/run'; // the pipeline without a worker: Node and tests
export { DETAIL_EFFORT, DETAIL_EFFORTS } from './pipeline/compress';
export { meshBuffers, computeVertexNormals } from './pipeline/mesh';
```

`src/regression/measure.ts` and `shapes.ts` import through `index.ts` and `dev.ts` like the page does. The regression net stays where it is: it is tooling on the library, not part of it.

## 6. The boundary, enforced

Two rules, both in `npm run check`:

- **ESLint** (`eslint.config.js`, a block for `files: ['src/page/**', 'src/regression/**', 'e2e/**']`): `no-restricted-imports` with the patterns `**/lib/pipeline/*`, `**/lib/worker/*`, `**/lib/three/*` and the message "import from src/lib/index.ts, three.ts or dev.ts: the page uses the library like any other consumer". Type-only imports count too (a consumer cannot deep-import types either). No plugin is needed; the rule is in ESLint's core.
- **Vitest** (`src/lib/index.test.ts`): imports `index.ts` and `dev.ts` in Node (Vitest's default environment, no DOM) and asserts that `Object.keys(module).sort()` equals a list written in the test. The list is the API; adding an export means adding a line to the test, so the API grows in a visible diff. A second test does the same for `three.ts` and additionally asserts that `index.ts`'s source, read from disk, contains no `from 'three` and no `/three/`: cheap, and it says why in one comment.

## 7. How the page imports the library

`src/page/main.ts` imports from `../lib`, `../lib/three` and `../lib/dev` only. `viewer.ts` from `../lib` and `../lib/three`. `benchmark.ts` and `options.ts` from `../lib/dev` where they need `DETAIL_EFFORT(S)`. `page-state.ts` from `../lib` (types and the step lists). `index.html` points at `/src/page/main.ts`; `vite.config.ts` needs no change (root stays the repo, the worker is found through `new URL('./convert.worker.ts', import.meta.url)` as before). Check that `dist/` after `npm run build` has the same files as before, give or take hashes: the promise test (`e2e/promise.spec.ts`) depends on the page still fetching only `/assets/` and `/basis/`.

For a consumer outside the repo, `package.json` gets an `exports` map that points at the TypeScript sources; the repo stays `private` and unpublished (out of scope):

```json
"exports": {
  ".": "./src/lib/index.ts",
  "./three": "./src/lib/three.ts",
  "./dev": "./src/lib/dev.ts"
}
```

The table (a Vite project) installs it as `"meshtavern-converter": "github:Tiarin-Hino/meshtavern-converter#<commit>"` or `file:../meshtavern-converter` while both repos sit side by side, and Vite compiles the TypeScript sources and the worker like its own. **Verify this once** in a throwaway Vite project in a temporary folder outside the repo (not committed): `npm create vite@latest` with the vanilla TypeScript template, install the library by `file:` link, call `new Converter().convert()` on a generated STL and log `result.stats.triangles`. Two things may bite: Vite's dependency pre-bundling (`optimizeDeps`) tries to bundle a linked package and then cannot find the worker; the fix on the consumer's side is `optimizeDeps: { exclude: ['meshtavern-converter'] }`, and if it is needed, the README says so. And the worker's WebAssembly dependencies (`meshoptimizer`, `xatlas-wasm`, `ktx2-encoder`) must resolve from the consumer's `node_modules`; with a `file:` link npm installs the library's dependencies inside the link, so they do. Record what was needed in the README and the journal; if the smoke check needs a change inside the library beyond `exports`, stop and ask (§9).

## 8. The README example

Under a heading "Use it as a library", one snippet of about twenty lines, type-checked once by pasting it into a scratch file under `src/` and running `npm run typecheck` (then deleted):

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
const budget = memoryBudgetBytes(navigator.deviceMemory);

async function addMini(file: File) {
  try {
    const stl = await readStlFile(file, budget); // refuses empty, not-STL and too-large files early
    const result = await converter.convert(stl, (p) => console.log(p.step, p.percent), {
      orientation: { up: '+z' }, // or leave it out: detected from the base
      sizing: { size: 'medium' }, // or leave it out: suggested from the base
    });
    const table = result.lods[BAKED_LEVEL]; // the level the table shows; result.baked has its texture
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

Plus three lines: the `three` entry draws a baked mini (`createBakedMaterial`, `transcodeDetail`) and needs the Basis transcoder served; the look is chosen when drawing and exporting, not when converting; the `dev` entry is for tests and tooling. The `CLAUDE.md` "Layout" section is rewritten for the new paths (`src/lib/pipeline/…`, `src/page/…`) and gets one line each for `index.ts`, `three.ts`, `dev.ts` and the lint rule.

## 9. Build order, one commit each, and where to stop

Each step ends with `npm run check` green; the baseline test in it is the no-behaviour-change proof for the pipeline.

1. `refactor: move the pipeline and the worker under src/lib` — `git mv src/pipeline src/lib/pipeline`, `git mv src/worker src/lib/worker`; fix the imports in `src/regression/`, `src/*.ts`, `e2e/`; `npm run check` and `npm run e2e` green with no test changed beyond paths.
2. `refactor: the page under src/page` — `git mv` of the page files and their two tests, `baked-material.ts` and `compressed-texture.ts` into `src/lib/three/`; `index.html` script path; e2e imports; `npm run check` and `npm run e2e` green. Compare `dist/` file names with a build from `main`: the same set.
3. `feat: the library's entries and the boundary` — `index.ts`, `three.ts`, `dev.ts`, the `transcoderPath` parameter, the ESLint block, `index.test.ts`; the page, the regression net and e2e import through the entries. The lint rule must fail before the imports are changed and pass after: run it once in between and note it in the journal.
4. `feat: read an STL file with the early refusals in the library` — `readStlFile` with its unit test, `main.ts` calling it; `messy-files.spec.ts` unchanged and green.
5. `docs: the library in package.json, the README and CLAUDE.md` — `exports`, the README section (§8), `CLAUDE.md` layout, the smoke check of §7 done and its findings written down, the journal entry.

**Stop and ask** on the PR, and label the issue `needs-human` when the answer is the PM's:

- The regression baseline moves, or any unit or e2e test needs a change that is not an import path (except the lint rule and `index.test.ts`, which are new).
- The page needs an export that fails the rule of §3 both ways (a consumer would not need it, but it is not development-only either).
- The consumer smoke check (§7) needs a change inside the library beyond the `exports` map and the `transcoderPath` parameter, for example bundling the worker differently.
- `dist/` after step 2 differs from `main` in more than hashes.
- A decision in this note turns out wrong. Record the PM's answer in this note with the date, nothing else.

## 10. Out of scope, filed or left

- Publishing to npm, a built `dist/lib`, declaration files: out of scope by the issue. The `exports` map points at sources, which is enough for the table under Vite.
- An options-only `convert(stl, { onProgress, signal, ... })` signature: a follow-up issue once the table's first use says what it needs.
- Look presets (#45) go into `index.ts` when they exist.
- Splitting `main.ts` (980 lines) into smaller page modules: not this story; the page changes only its imports and the drop handler's read.
- How the table stores or shares what it gets back: the table's own design (private repo).
