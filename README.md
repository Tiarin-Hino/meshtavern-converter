# MeshTavern Converter

Turn a 3D-print STL of a miniature into a lightweight, game-ready 3D mini — entirely in your browser. Your STL file is never uploaded.

**Status:** early, but usable end to end. Drop an STL and it is reduced to three detail levels, stood upright, measured (units, base, creature size and its footprint on a 32 mm grid), given a primed-and-washed look, and can be downloaded as a GLB file (the table and far levels). Everything runs in your browser. There is no hosted version yet: run it locally as shown below. See [the Phase 0 spec](docs/specs/phase-0-spike.md) for measurements, and [the Phase 1 spec](docs/specs/phase-1-converter.md) for the converter at product quality and how its exit criteria ended: Phase 1 is finished, and what follows is what the table needs from the library and the release blockers. [The journal](docs/journal/) tells how it was built: what we tried, what failed and why.

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

The page is one consumer of the converter; the MeshTavern table application is another. `package.json` exports five entries, as TypeScript sources for a Vite project: `meshtavern-converter` (convert, refuse, size, orient, export, the painting's data and fill; no three.js), `meshtavern-converter/three` (draw a baked mini), `meshtavern-converter/questions` (the view that asks a conversion's questions, with its stylesheet `meshtavern-converter/questions.css`), `meshtavern-converter/painting` (the view in which a person paints a baked mini, with its stylesheet `meshtavern-converter/painting.css`) and `meshtavern-converter/dev` (generated meshes and STL writers, for tests and tooling). The package is not published to npm; install it from git (`"meshtavern-converter": "github:Tiarin-Hino/meshtavern-converter#<commit>"`).

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
  findSourcePreset,
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
      // sizing: or leave it out, suggested from the base; preset: the files' known export
      // convention, or leave it out, guessed; the other files are transferred too.
      {
        sizing: { size: 'medium' },
        preset: findSourcePreset('scene-m-y'),
        ...(secondStl && { secondStl, moreStl }),
      },
      // Optional: stop and ask on the full-detail meshes. askPerson and markPerson are your own
      // dialogs; answer with confirm: false to show a change first.
      async (question) =>
        question.kind === 'up'
          ? { kind: 'up', orientation: await askPerson(question), confirm: true }
          : { kind: 'meet', ...(await markPerson(question)), confirm: true },
    );
    // The level the table shows. When it was baked, result.baked has its unwrapped mesh, whose
    // texture coordinates go into the GLB as TEXCOORD_0, and the detail texture (ktx2) they are for.
    const table = result.baked?.mesh ?? result.lods[BAKED_LEVEL]!.mesh;
    const glb = encodeGlb(table, {
      name: file!.name,
      look: DEFAULT_LOOK,
      compact: false,
      sizing: result.sizing,
      orientation: result.orientation,
    });
    // Character or prop, guessed from the base; the `kind` option sets it.
    return { glb, ktx2: result.baked?.ktx2 ?? null, kind: result.kind.kind, stats: result.stats };
  } catch (error) {
    if (error instanceof ConversionProblem) console.warn(PROBLEM_MESSAGES[error.code]);
    throw error;
  }
}
// converter.cancel() stops the running conversion; its promise rejects with ConversionCancelled.
```

- The fourth argument of `convert` is optional. With it, the worker stops on the full-detail meshes and asks. Every `Question` carries the welded meshes the callback has not had yet (`meshes`, each file once, in file coordinates) and where to draw each file (`shown`: a rotation and a translation per file, and the `box` of it all). An `UpQuestion` (`kind: 'up'`) asks which way is up: the `role` (`mini`, or `base` then `figure` for several files), the proposed `orientation` and why (`reason`). The answer is an `UpAnswer`: `orientation` as in the options (`{}` is the proposal), `confirm`, and `swap` or `baseFile` (another file as the base, or `null`: no base, the files are parts of one figure). A `MeetQuestion` (`kind: 'meet'`) asks how a figure's parts go together (`about: 'parts'`, first) or where the figure meets its base (`about: 'base'`, last, for every pair), in two stages: `pairs` (the parts apart, with the pairs of patches where they meet: the converter's proposal, `proposed`, or the person's) and `fitted` (put together, `placement`). A patch is an area of a part's surface made by strokes (`Stroke`: a tap, a brush or an eraser dab at a point in its file's coordinates); a pair is a patch on the part in place (`on`) and one on the part that goes there (`of`). The answer is a `MeetAnswer` with one `action`: `tap` and `brush` (at a `Target`: a ray in the coordinates `shown` is drawn in, or a point on a file), `clear`, `undo`, `set` (a whole `Meeting` or the parts' joints at once), `fit` (put them together), `back`, `nudge` (`liftMm`, `turnDeg`, `turn: 'keep' | 'free'`), `pick` (what is there) and `confirm`. The question that comes back holds the marks (`marks`) and what to draw (`pairs`, each side's `triangles`). Without the callback nothing is asked, and the options say how the files stand and meet (`orientation`, `baseOrientation`, `pairing`, `parts`, `placement.marks`). `result.choices` holds what was confirmed: converting the same files with those options gives the same mini without asking.

- The questions can be asked by the view this page uses, instead of dialogs of your own: `mountQuestions` from `meshtavern-converter/questions` puts its own canvas into one element and its controls into another, draws every `Question` and sends every answer, so the consumer never looks inside one:

  ```ts
  import { mountQuestions } from 'meshtavern-converter/questions';
  // After the theme's stylesheets, linked in the page's <head> (see below).
  import 'meshtavern-converter/questions.css';

  // A dialog: a box for the meshes (give it a size), a box for the controls, your own Cancel.
  const view = mountQuestions({
    scene: dialog.querySelector<HTMLElement>('.scene')!,
    controls: dialog.querySelector<HTMLElement>('.controls')!,
    onChange: ({ question }) => dialog.classList.toggle('asking', question !== null),
  });
  cancelButton.onclick = () => converter.cancel();

  const ask = { up: true, baseUp: true, parts: true, meet: true };
  const askUp = view.start({ names: files.map((f) => f.name), ask });
  try {
    const result = await converter.convert(stl, onProgress, { secondStl, moreStl, ask }, askUp);
    // result.choices reproduces the mini without questions, as before.
  } finally {
    view.end();
  }
  ```

  `start` takes the files' names, what is asked, and the `orientation`, `baseOrientation` and `preset` id the conversion starts with, if any; it returns the callback for `convert`'s fourth argument. Left without `controls`, the view lays a panel of its own over the scene's right edge. Given a `footer` (a panel's footer that holds your Cancel), the view puts its Confirm there after what it holds, shown while its question is (#144); left out, Confirm ends the controls. The words are `QUESTION_COPY` and the sentence functions (`describeUp`, `describePairs`, …), replaced field by field: `mountQuestions({ copy: { askUp: 'Which way is up?' } })`. The controls are MeshTavern's components (#143): the page links the theme's `tokens.css` and `components.css` before the view's stylesheet, the table application's own (`web/public/theme/`) or the copy in this repo's `public/theme/` served with its `fonts/` folder, as this page does (`<link rel="stylesheet" href="/theme/tokens.css" />`, then `components.css`). Then `questions.css` is imported once, as above; it holds the view's layout and the few parts of its own the components do not have, every rule under `.mt-questions`, every colour a role of `tokens.css`, so the view follows the page's light or dark theme. Without the theme the controls work but have the browser's look. The chips' colours are `--pair-1` to `--pair-4`, which the view writes on its elements from `PAIR_COLOURS`. The view's elements keep this page's ids, so there is one view per document. `view.state` and the view's methods (`answerUp`, `confirmUp`, `tap`, `brush`, `confirmMeet`, …) are what this page's `window.__mt` hooks forward to, so `scripts/lib/answer-up.mjs` drives a consumer the same way.

- A source preset (`SOURCE_PRESETS`, `findSourcePreset(id)`, or a `SourcePreset` of your own) says what a tool's files are: `units`, an extra `scale` and the `up` axis. It lies under the options field by field: an `orientation`, `baseOrientation` or `sizing` given wins over it, and the converter guesses only what neither says. Its axis counts as chosen, so the up question still comes, standing the file the preset's way; an `UpAnswer` may set (`preset`) or clear (`preset: null`) it. `result.choices.preset` is the preset the conversion ended with.
- `result.kind` is a first guess whether the mini is a `character` or a `prop`, made from its base: a separate base file, no flat underside, or a bare flat top within `DISC_HEIGHT_MAX_MM` of the floor covering `TOP_SHARE` of the base make a character; anything else that stands on a flat underside is its own base, a prop (`reason` says which, `topShare` what was measured). The `kind` option sets it (`method: 'manual'`), and `result.choices.kind` keeps it. A tree on a disc reads as a character: the guess cannot tell it from a figure.
- The look is chosen when a mini is drawn and exported (`look` above, `vertexColours`, the `three` entry), not when it is converted: changing the colour does not need a new conversion. `LOOK_PRESETS` are named starting points (grey primer, bone, black drybrushed, steel, bronze), `presetOf(look)` says which one a look is, and a GLB written with a `sizing` records both in `extras.meshtavern.look`.
- `createBakedMaterial` and `transcodeDetail` from `meshtavern-converter/three` draw the baked table level with its KTX2 texture. `transcodeDetail` needs three.js's `basis_transcoder.js` and `.wasm` served; pass their folder as its third argument (this page serves them under `basis/`, see `vite.config.ts`).
- The look is per material: `createBakedMaterial(texture, uniforms)` reads the look from the `LookUniforms` it is given. Give each mini its own (`createLookUniforms(look)`, changed later with `updateLookUniforms`) when minis look different; pass one set to every material when they all look alike, as this page does, and one `updateLookUniforms` changes them all.
- A paint goes under the look (#125): `createBakedMaterial(texture, uniforms, { map })` takes a colour texture on the table level's texture coordinates (`result.baked.mesh`). It is laid out like the detail texture (row 0 at v = 0: `flipY` false) with its colour in sRGB (`colorSpace = SRGBColorSpace`) and straight alpha: where alpha is 1 the paint replaces the base coat, where it is 0 the base coat shows, in between the two mix; the wash still pools in the creases and the edges still catch the light. The far and close levels have no texture coordinates, so they take the paint per vertex, once: `paintAtVertices(level, result.baked.mesh, { width, height, data })` gives RGBA bytes per vertex (a vertex more than `PAINT_REACH_MM` from the table level stays bare), and `vertexColours(level, look, paint)` draws it under the same look. The texture stays the consumer's (not disposed with the material); spread a painted island's colour a few texels past its edge, as the bake does, or the smaller mipmaps mix the neighbouring islands of the atlas in at the seams.
- `renderThumbnail(mesh, { renderer, texture, albedo, look, size })` from `meshtavern-converter/three` makes the picture for a list of minis: the table level from the viewer's angle and light, a PNG `Blob` of at most `THUMBNAIL_SIZE` (512) px on a transparent background. It is made by the consumer after the conversion, not by the worker: pass the renderer that already draws the mini (it draws into a render target and leaves the screen alone; without one a private renderer is made and released), and, for a baked mini, `result.baked.mesh` with its transcoded texture (`transcodeDetail`) and its paint, if it has one (`albedo`, as `map` above), else `result.lods[BAKED_LEVEL].mesh`.
- A baked mini can be painted in a view of its own (#127, design note `docs/design/painting-engine.md`): `mountPainting` from `meshtavern-converter/painting` puts a canvas and a brush ring into one element; every panel (tools, sliders, palette, Undo, Redo, regions, Save) is yours, wired to the view's methods. The strokes are written into a `PAINT_SIZE` (1,024) px colour texture over the table level's unwrap, drawn through `createBakedMaterial`'s `map`, so the paint comes back as an `Albedo` that `paintAtVertices` and `renderThumbnail` take:

  ```ts
  import { mountPainting } from 'meshtavern-converter/painting';
  // After the theme's tokens.css, as for the questions above.
  import 'meshtavern-converter/painting.css';
  import { regionsOf } from 'meshtavern-converter';

  const view = mountPainting({
    scene: dialog.querySelector<HTMLElement>('.scene')!,
    onChange: (state) => panel.render(state), // your tools, sliders, palette, Undo, Redo
  });
  await view.open({
    mesh: result.baked!.mesh,
    texture, // transcodeDetail(result.baked.ktx2, renderer)
    look,
    paint: storedPaint ?? null, // the Albedo you kept, or none
    regions: regionsOf(result.baked!.mesh, {
      source: result.mesh,
      figureTriangles: result.pair?.figureTriangles,
      sizing: result.sizing,
      kind: result.kind,
    }),
  });
  view.setTool('flat');
  view.setBrush({ sizeMm: 2 });
  view.setColour('#b03030');
  // ... the person paints ...
  const albedo = await view.paint(); // 1,024² RGBA bytes: store them; paintAtVertices and renderThumbnail take them
  view.close();
  ```

  `open` refuses a mesh without texture coordinates (a mini whose bake was skipped) with a `RangeError` whose message is `PAINT_COPY.cannotPaint`. The left button, a pen's tip and one finger paint; the right button and two fingers turn the mini, the middle button pans, the wheel zooms; a second finger during a stroke cancels it; `setNavigating(true)` lets one finger turn the mini instead. A stroke reaches only what was in sight of the camera it was painted from and faces it, within a sphere of the brush's size in mm, and the gutter around every island of the atlas is filled two texels deep as it is painted, so no seam shows at full size; for mipmaps spread it further, as the paint bullet above says. The tools of this build are `flat`, `fill` (a tap fills the surface up to a fold or a crease, `brush.tolerance` loosening both; `fillRegion('base' | 'figure')` fills the ready regions `regionsOf` found) and `eraser`, and the hobby brushes (#128), which read the mini's surface from the detail texture: `wash` pools in the creases and buried places, tints flat surface faintly and nearly leaves a raised edge (`opacity` is its strength); `ink` stains everything it covers, the creases most (`opacity` is its flow); `dry` paints only where the surface is raised, `opacity` its pressure, which reaches further down an edge; `airbrush` is soft and builds up over passes (`opacity` is its flow), and `brush.direction`, a vector in the mini's coordinates (scaled to unit length) (`[0, 1, 0]` is above), sprays only the surface that faces it: a zenithal highlight in one pass. `toolMask` gives each brush's share of a texel from the surface, and the constants it reads (`WASH_FLAT` … `AIR_DIR_SOFTNESS`) are exported beside it. Every stroke and fill is one step as plain JSON (`history()`), `undo` and `redo` go at least `UNDO_STEPS` (50) back by replaying from keyframes. The words are `PAINT_COPY`, replaced field by field, with a sentence or two on what each tool does (`toolHints`) for your panel; the view shows only `cannotPaint`. Every rule of the stylesheet is under `.mt-painting`; the ring takes the `--accent` role of the theme's `tokens.css`. Several views may share a document, one per element.

  What the view holds while a mini is open, over your own renderer's (a second WebGL context, like the question view's):

  | Target or texture                                    | Format                                       |                                              Size |
  | ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------------: |
  | `atlas` (islands, borders, occlusion)                | RGBA8                                        |                                            4.0 MB |
  | `owner` (where each gutter texel's paint comes from) | RGBA8                                        |                                            4.0 MB |
  | `paint` (committed), `live` (on screen)              | RGBA8 sRGB, two                              |                                            8.0 MB |
  | `stroke` (the stroke's coverage)                     | R8, with a depth and stencil buffer          |                                            5.0 MB |
  | `depth` (the stroke's camera)                        | 24-bit depth + R8, the drawing buffer's size |                           8.3 MB at 1,920 × 1,080 |
  | keyframes for undo, at most six                      | RGBA8 sRGB                                   |                                     up to 24.0 MB |
  | the view's copy of the detail texture                | yours (compressed or raw)                    | 1.3 MB (1,024 px) to 5.3 MB (2,048 px) compressed |
  | the table level's geometry                           | 36 B a vertex, 12 B a triangle               |                                            1–3 MB |

  About 36 MB, 60 MB with every keyframe, plus the context's own canvas buffers (the drawing buffer is capped at 2 device pixels per CSS pixel). Measured on the development PC with the view open on large-01: the GPU process grew by 130 MB. `state.perf` is the view's frame counter for the last stroke (`performance.now()` around each frame, `slow` over `FRAME_BUDGET_MS`); it measures the CPU's part and what the GPU makes the CPU wait for, not GPU time, which needs `EXT_disjoint_timer_query_webgl2`. `scripts/measure-painting.mjs` also measures the time between frames.

- Linked with `file:../meshtavern-converter` instead, Vite's dev server refuses to serve the worker from outside the project until the folder is allowed: `server: { fs: { allow: ['.', '../meshtavern-converter'] } }`.

## Licence

[MIT](LICENSE).

## Third-party content

The unwrap runs [xatlas](https://github.com/jpcy/xatlas) (MIT, Copyright 2018-2020 Jonathan Young), compiled by this project to WebAssembly from upstream commit `f700c779` (`wasm/xatlas/`, licence in [`wasm/xatlas/LICENSE`](wasm/xatlas/LICENSE)).

The detail texture is encoded with [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Apache-2.0, Copyright 2016–2026 Binomial LLC; "Basis Universal" is a trademark of Binomial LLC), compiled by this project to WebAssembly from upstream commit `1b33fd50` (`wasm/basis-encoder/`, licence and notice in [`wasm/basis-encoder/LICENSE`](wasm/basis-encoder/LICENSE) and [`wasm/basis-encoder/NOTICE`](wasm/basis-encoder/NOTICE)). The build includes [Zstandard](https://github.com/facebook/zstd) (BSD-3-Clause, Copyright Meta Platforms, Inc., [`wasm/basis-encoder/LICENSE-zstd`](wasm/basis-encoder/LICENSE-zstd)) and the QOI and DDS readers upstream bundles (MIT, [`wasm/basis-encoder/LICENSE-mit`](wasm/basis-encoder/LICENSE-mit)).

The source presets (`src/lib/pipeline/source-preset.ts`) cite where each convention is documented: PrusaSlicer's [source](https://github.com/prusa3d/PrusaSlicer/tree/version_2.8.1) for millimetres and Z (PrusaSlicer is a trademark of Prusa Research a.s.), Blender's [source](https://github.com/blender/blender/tree/v4.2.0) for its STL export defaults and scene units (Blender is a trademark of the Blender Foundation), and the [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units) for metres and +Y up (glTF is a trademark of The Khronos Group Inc.). The presets' labels name the convention, not the tool; no tool endorses this project.

The creature size names (Tiny, Small, Medium, Large, Huge, Gargantuan, in `src/lib/pipeline/size.ts`) come from the SRD 5.1. The footprint in squares, the 32 mm grid and the plain-base diameters are this project's own.

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at <https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at <https://creativecommons.org/licenses/by/4.0/legalcode>.
