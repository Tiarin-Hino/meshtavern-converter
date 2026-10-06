# Design: a thumbnail and a character-or-prop guess per mini (#99)

Status: design pass by Fable 5.1, 2026-10-06, for Opus 5.5 to build · Not part of the Phase 1 epic: what the table application (Phase 2, its spec 04, item C4) needs from the library · Issue: #99 · Builds on #44 (`docs/design/scale-and-base.md`), #50 (`docs/design/library-api.md`), #70 (`docs/design/base-file.md`) and #101 (the corpus rate, `docs/journal/2026-10-02-right-without-correction.md`)

This note fixes the decisions the build should not have to make: where each of the two new outputs is made and why, the rule behind the guess with its thresholds as named constants, the thumbnail's camera, light, background and file, how both reach the consumer, the page and the corpus run, the build order with the test that proves each step, and where the builder must stop and ask. Product behaviour comes from the issue; where this note picks a name, a number or a wording, it is marked _(proposal)_ and the PM can change it. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§9).

## 1. The problem

The table application lists a person's minis (spec 04, L3) and lets them switch a new mini between "character" and "prop" before saving it (L1). For the list it needs a small picture of each mini without loading a mesh, and for the switch a first guess that is right often enough that most people never touch it; spec 04 asks for the rate on the corpus with no target yet. The library returns neither today (spec 04, "Risks"). Both are needed by the import of the table (spec 04, M2), so they go into the library, not the page.

The two outputs are different in kind, and that decides where each lives (§2): the guess is arithmetic on the mesh and belongs in the pipeline like the size suggestion; the thumbnail is a rendering and needs a GPU, which the pipeline must never need (`CLAUDE.md`: pure functions, Node and a worker).

## 2. Where each output is made

**The guess runs in the pipeline, inside the `size` step.** It reads what the step already has: the mesh standing Y-up on y = 0 in millimetres, the measured base (`Sizing.base`) and, for a pair, the pair's roles. It adds no step to `STEPS`, so the progress labels and `stats.timings` keep their shape; its time is part of the size step's, which today is under a millisecond and stays under 50 ms for the largest corpus file (§3.4). It travels in `ConversionResult` and `ConversionStats` like `sizing` does, and the worker passes it through structured clone (a few bytes).

**The thumbnail is rendered by the consumer, through the `three` entry.** Three reasons, in order of weight:

- The consumer already has a WebGL renderer with the mini on screen: the table shows the mini before saving (spec 04, L1), the page shows it in the viewer. A second WebGL context on a weak device competes with the first for memory and is counted against the browser's limit (Chrome drops the oldest context past 16). So `renderThumbnail` takes the consumer's renderer and draws into a render target, leaving the screen untouched (§4.3); without one it makes a private renderer and disposes it, for a consumer that only wants the picture.
- Rendering in the worker would mean three.js in the worker bundle (about 600 KB more to load before the first conversion) and WebGL on an `OffscreenCanvas`, which Safari gained only in 17 (2023) and which no part of the converter uses today.
- The thumbnail is a view of the result, like the look (`docs/design/library-api.md`, §3.2): it depends on the look the consumer chose and on the detail texture it transcoded. It is not an input of the conversion and must not force one.

So `ConversionResult` does not carry the thumbnail. "The library result includes a thumbnail" (the issue) is met by the library: `renderThumbnail(result's table level)` is one call away, documented next to the GLB export in the README (§7), and the page and the corpus run do exactly that.

## 3. The guess: `src/lib/pipeline/kind.ts` (new)

### 3.1 Data shape

```ts
export type MiniKind = 'character' | 'prop';

export interface KindGuess {
  kind: MiniKind;
  method: 'guessed' | 'manual';
  /**
   * base-file: the mini came with a separate base file, so it is a figure made for a base.
   * no-base: no flat underside, so a figure made for a base it did not come with, or one that leans.
   * base-top: a flat top within DISC_HEIGHT_MAX_MM of the floor covers at least TOP_SHARE of the base's outline: a disc with something standing on it.
   * solid: a flat underside without such a top: the thing is its own base.
   * manual: the option said so.
   */
  reason: 'base-file' | 'no-base' | 'base-top' | 'solid' | 'manual';
  /** The share the base-top rule measured (§3.2), null when the rule did not run. Kept so the corpus report can show how close a miss was. */
  topShare: number | null;
}
```

`ConversionResult.kind: KindGuess` and `ConversionStats.kind: KindGuess` are the same object, as `sizing` is. `PipelineOptions.kind?: MiniKind` and `ConvertOptions.kind?: MiniKind` set it by hand (`method: 'manual'`, `reason: 'manual'`, `topShare` still measured when a base is there). `UpChoices.kind?: MiniKind` is set only when it was manual, so converting again with `result.choices` gives the same mini without asking, as for every other choice. A consumer that lets a person flip the label without converting again (the table's switch) keeps its own copy; the option is for the path that converts the same files again.

### 3.2 The rule

"Derived from the detected base" (the issue). A character is something standing on a base; a prop is something that is its own base. In order:

1. **A separate base file** (`pair !== null && pair.pairing.baseFile !== null`) → `character`, `base-file`. Nobody prints a base file for a barrel. The rule also covers a figure in parts with its base.
2. **No base** (`sizing.base === null`: no flat underside covering `MIN_BASE_COVERAGE`) → `character`, `no-base`. A prop is printed as it stands and so has a flat bottom; a mini without one is a figure made for a base it did not come with (#70, #90), or one that leans or flies. The plain base the size step may add is not looked at: the guess reads the mesh before it.
3. **A base.** One pass over the triangles of the sized mesh: every triangle whose face normal is within `TOP_CONE_DEG` of straight up and whose centroid lies within `DISC_HEIGHT_MAX_MM` above the floor adds its _projected_ area (true area × the normal's y) to `topArea`. `topShare = topArea / outlineArea`, where `outlineArea` is the base's outline as `measureBase` saw it: `π · (diameterMm / 2)²` for a `round` base, `footprintMm[0] · footprintMm[1]` for `other` (the box; an L-shaped or oval outline is over-estimated, which only makes the test stricter). `topShare ≥ TOP_SHARE` → `character`, `base-top`; else `prop`, `solid`.

Why the top and not the cross-section: a gaming base is a thin disc whose top is flat and mostly bare, with the figure's feet on a small part of it. That holds whether the base is solid or hollow underneath (resin bases usually are, #70), whether it has a bevel, and whether the mesh is dense or a twelve-triangle box, which rules out measuring the material in horizontal slices (a hollow base has almost none near the floor) or the extent of the vertices in a band (a sprawling dragon's tail, feet and wing tips span the whole base, and a plain box has no vertices between its rims). A prop has no such top near the floor: a wall's top is at its full height, a rock's surface faces every way, barrels cover the plate they stand on.

Constants, all _(proposal)_, in `kind.ts`:

| Constant             | Value | Why                                                                                                                                                                                                                  |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISC_HEIGHT_MAX_MM` | 10    | Gaming bases are 3 to 5 mm thick; a scenic topper (rubble, a flagstone) raises the top to about 10. Above that, a flat surface is the top of a prop (barrels are about 20 mm, a wall 36 in the corpus).              |
| `TOP_CONE_DEG`       | 30    | A textured base top (grass, cobbles) still faces mostly up; a wall or a barrel side does not. Wider than `FLAT_ANGLE_COS` (10°) on purpose: the underside test wants a plane, this test wants a surface to stand on. |
| `TOP_SHARE`          | 0.5   | Half the base must be bare top. A humanoid's feet cover a tenth; a swarm on a base, or barrels on a plate, cover more than half.                                                                                     |

What the corpus figures of 2026-10-02 (`out/corpus/results.json`) say the rule will do, read from the desk, before the build measures it (§6): the 7 corpus figures that come with a base file and the 5 without a flat underside are characters by rules 1 and 2 (12 right); the 15 single-file figures on a disc should pass rule 3, the two with the sprawling contact (a huge creature on a 100 mm base, a figure on a small irregular base of 24 × 18 mm with coverage 0.36) being the ones to watch; of the 4 terrain pieces, the long wall (107 × 34 mm, coverage 0.85) and the cluster of barrels on a 25 mm plate should read `solid`, the 100 mm scenic piece depends on how much plate shows, and the tree on a 50 mm base will read `base-top` and be wrong: geometrically a tree on a disc is a figure on a base, and no rule from the base can tell them apart. That miss is accepted; the switch exists for it.

### 3.3 Where it runs

`sizeMini` is unchanged. `run.ts`, in the size step after `sizeMini` returns: `guessKind(sized.mesh, sized.sizing.base, pair, options.kind)`. The sized mesh is in millimetres, so `DISC_HEIGHT_MAX_MM` means what it says, and it stands on y = 0 after `orientAndPlace`, so "the floor" is y = 0 (take the lowest y of the positions anyway, for a mesh scaled about the origin, and assert in the test that it is 0 within 1e-3). For a mini without a base `sizeMini` may have added a plain base to `sized.mesh`; rule 2 returns before the pass, so the plain base is never scanned.

### 3.4 Cost

One pass over the triangles with a cross product for the low ones: the same shape as `detectUpAxis`'s pass. Only the triangles whose three corners lie within `DISC_HEIGHT_MAX_MM` of the floor need the normal and the area, so for most of the mesh the pass is three loads and a compare. The size step takes under a millisecond today (it rounds to 0 in every corpus row); the issue sets no budget, so the build measures the step on the largest corpus file (6.1 M triangles) on the development PC and writes the number into the journal. Expect tens to a few hundred milliseconds; more than a second is a reason to look again, not to stop.

### 3.5 Not changed

- **The GLB.** `extras.meshtavern` keeps `sizing`, `orientation` and `look` only. Writing `kind` there would change the bytes of every GLB exported with a sizing, which the regression baseline tracks, and the table takes `kind` from the result. A follow-up issue when the table wants it in the file.
- **The baseline.** `src/regression/baseline.json` does not move: nothing the baseline measures (triangles, error, file sizes) is touched. If it moves, stop (§9).
- **The questions** (#92, #93) ask nothing about the kind.

## 4. The thumbnail: `src/lib/three/thumbnail.ts` (new), exported from `three.ts`

### 4.1 API

```ts
/** The default and the largest size: the table's list and an agent's token view show at most 512 px (table ADR-0006, decision 8). */
export const THUMBNAIL_SIZE = 512;
/** The viewer's framing of a freshly loaded mini (Viewer.setCamera(34, 22, 1)), so the picture shows what the person saw. */
export const THUMBNAIL_AZIMUTH_DEG = 34;
export const THUMBNAIL_ELEVATION_DEG = 22;
export const THUMBNAIL_FOV_DEG = 40;
/** Share of the frame left free on each side. _(proposal)_ */
export const THUMBNAIL_MARGIN = 0.06;

export interface ThumbnailOptions {
  /** Width and height in pixels, square. THUMBNAIL_SIZE by default; more is a RangeError, never a larger picture. */
  size?: number;
  /** The look to draw with. DEFAULT_LOOK. */
  look?: Look;
  /**
   * The detail texture of `result.baked`, transcoded (transcodeDetail) or uncompressed
   * (createDetailTexture), when the consumer has one: the mesh is then `result.baked.mesh`, the
   * table level with texture coordinates, and the picture shows the baked mini as the table
   * does. Without it the per-vertex look is drawn, which is what the table shows when the bake
   * was skipped. The texture is not disposed.
   */
  texture?: THREE.Texture | null;
  /** Draw with this renderer, into a render target: the screen is not touched. Without one a private renderer is made and disposed. */
  renderer?: THREE.WebGLRenderer;
}

/** A PNG with a transparent background, `size` × `size`, of the mesh framed from the viewer's angle. */
export async function renderThumbnail(mesh: IndexedMesh, options?: ThumbnailOptions): Promise<Blob>;

/** Pure, for the test: where a camera with THUMBNAIL_FOV_DEG stands to frame the box at the thumbnail's angle. */
export function frameBox(
  min: Vec3,
  max: Vec3,
  margin?: number,
): { position: Vec3; target: Vec3; near: number; far: number };
```

`mesh` is the table level: `result.baked?.mesh ?? result.lods[BAKED_LEVEL].mesh`, the same expression the README's example uses for the GLB. The box is measured from its positions inside (one pass over at most 60 000 triangles' vertices), so the consumer passes nothing it does not have. A `Blob` of `image/png` is what the table uploads and what the page shows through `URL.createObjectURL`; the e2e test reads it with `arrayBuffer()`.

### 4.2 The scene

The same as the viewer's, without the grid: a `HemisphereLight(0xffffff, 0x30343c, 1.2)` and a `DirectionalLight(0xffffff, 2.2)` from direction (60, 120, 80), both world-fixed (only the direction of a directional light matters, so the mini's size does not). With `texture`: `createBakedGeometry(mesh)` and `createBakedMaterial(texture, createLookUniforms(look))`. Without: a geometry from positions, indices and normals (computed when absent) with a `color` attribute from `vertexColours(mesh, look)`, and the viewer's per-vertex material (`MeshStandardMaterial`, white, `vertexColors`, roughness 0.75, metalness 0). The viewer's two copies of those four values move to constants in `thumbnail.ts` that the viewer imports, so the picture cannot drift from the screen.

Camera: `PerspectiveCamera(THUMBNAIL_FOV_DEG, 1, near, far)` placed by `frameBox`: the target is the box's centre; the camera sits on the ray from the centre at the thumbnail's azimuth and elevation (the viewer's convention: azimuth about the vertical axis, 0 in front of the mini on +z); the distance is the smallest at which all eight corners of the box project inside the frame less the margin. In closed form: with `t = tan(fov / 2) · (1 − 2 · margin)`, for each corner with lateral offset `u` (along the camera's right or up axis, from the centre) and depth offset `w` (toward the camera), the distance must be at least `|u| / t + w`; take the largest over the corners and both axes. `near = distance / 100`, `far = distance · 100`, as the viewer. A mini twice as large gets a camera twice as far: the test.

### 4.3 Drawing and reading back

One code path for both renderers: a `WebGLRenderTarget(size, size, { samples: 4, depthBuffer: true })` (`samples` is ignored on WebGL1, which gives an aliased edge, not an error). Before drawing, save the renderer's render target, clear colour and clear alpha; set clear colour black with alpha 0; `setRenderTarget(target)`; render; `readRenderTargetPixelsAsync` into a `Uint8Array(size · size · 4)`; restore everything saved. Then, on the CPU, three corrections, each a pure function with a unit test:

- **Colour space.** three.js 0.186 draws into a render target that is not an XR target in its working colour space, linear, whatever the target texture's `colorSpace` says (`WebGLPrograms.getParameters`, `outputColorSpace: … ColorManagement.workingColorSpace`); only the canvas gets `renderer.outputColorSpace`. So the bytes read back are linear and the picture would come out dark. `linearToSrgb(bytes)` converts the three colour channels of every pixel (`c ≤ 0.0031308 ? 12.92 · c : 1.055 · c^(1/2.4) − 0.055`, through a 256-entry table), alpha untouched.
- **Row order.** The rows come bottom-up: `flipRows(bytes, size)`.
- **Edges.** A partly covered edge pixel was blended against the transparent black clear, so `unpremultiply(bytes)` divides its colour by its alpha (`rgb · 255 / a` where `0 < a < 255`), or every edge gets a dark fringe on a light page. Order: un-premultiply first (the blend happened in linear), then convert.

Then wrap the bytes in an `ImageData`, `putImageData` on an `OffscreenCanvas` 2D context when `OffscreenCanvas` exists, else a detached `document.createElement('canvas')`, and `convertToBlob({ type: 'image/png' })` or `toBlob`. Dispose the target, geometry and material (not the consumer's texture). A private renderer is made on an `OffscreenCanvas` (or a detached canvas) with `alpha: true`, and after the read gets `dispose()` and `forceContextLoss()`.

`linearToSrgb`, `flipRows` and `unpremultiply` are exported for their unit tests and otherwise private. The `verify-3d` screenshot of step 2 (§8) is what proves the three corrections together: the `?dev` thumbnail next to the viewer, the same mini, the same colours.

### 4.4 What is not in it

No ground shadow, no grid, no base ring: the table draws those around the picture if it wants them. No tone mapping of its own: the consumer's renderer settings apply, and the private renderer uses three.js's defaults, which is what the viewer uses. No caching: the consumer keeps the Blob.

## 5. The page

The product page changes nothing a person sees: the kind switch and the thumbnail are the table's import step (spec 04, M2), and the page's Adjust panel is not the place to design it. For the team's tools, the tests and the corpus run:

- `window.__mt.thumbnail(size?)` → `Promise<ArrayBuffer>` (the PNG's bytes): `renderThumbnail` of the shown mini's table level with the viewer's renderer (`viewer.webglRenderer`), the page's current look, and the transcoded detail texture when the mini was baked (the viewer already holds it for the baked material; expose it to `main.ts` through a small getter rather than reaching into the material). A mini opened from a GLB (`loadGlb`) has no result: the hook rejects with a plain `Error`.
- `state.kind` exposes `result.kind`.
- Under `?dev` only (`data-dev`): an `<img id="dev-thumbnail" width="128" height="128">` filled from the hook after a conversion ends, with the line "Kind: character (guessed, base-top, 0.91)" next to it from `state.kind`, so `verify-3d` can screenshot both. Nothing without `?dev`.

## 6. The corpus run and the rate

- `scripts/corpus-index.json`: the four terrain entries get `"kind": "prop"`; every other entry's expected kind is `character` by default, the way the expected units default to mm. Corpus keys stay the neutral names.
- `scripts/corpus.mjs` keeps, per mini, `guess: { kind, reason, topShare }` from `stats.kind` (results.json already uses `kind` for the corpus folder, so the figure is named `guess`), saves the thumbnail of every converted mini as `out/corpus/thumbs/<key>.png` through the hook, and puts it as the first figure of the mini's comparison sheet, captioned with the size.
- `scripts/lib/automatic.mjs`: a fourth check, `kind`, after `size` in `CHECKS`: `mini.guess.kind` against `entry.kind ?? EXPECTED_KIND` (`'character'`). It counts in `right`, so "right without correction" now means the four things a person can correct at the table's import step (spec 04, L1: up, scale, base size, kind). The headline sentence of the report names the four, the table gets a Kind column, and a failure prints the measured share, "kind character (0.62), expected prop", so a near miss can be read without opening a sheet. `automatic.d.mts` and `src/regression/automatic.test.ts` follow. The comparison with the last run will list minis as "now fails: kind" where the earlier run had no guess; that is the honest reading.
- One corpus run on the development PC (`npm run corpus`, baked, the default `--up detected`) records the rate. The journal entry quotes it the way the #101 entry does: the four checks, the kinds, every miss by corpus key with its share. No target (spec 04); what the PM does with a miss is a later decision.

The worktree the build runs in has no `corpus/`: `corpusFiles()` returns nothing there. Run the corpus from a checkout that has the folder (the main checkout, on this branch, when no other session uses it), or copy the corpus into the worktree; never link it (a junction in a worktree deleted the corpus once, see `corpus/NAMES.md`).

## 7. Docs

`README.md`, "Use it as a library": `result.kind` with one sentence on the rule and the `kind` option, and `renderThumbnail` in the bullet list next to `createBakedMaterial`, with the renderer and texture arguments and the sentence that the picture is made by the consumer, after the conversion, from the table level. `CLAUDE.md` layout: one line each for `pipeline/kind.ts` and `three/thumbnail.ts`, the `?dev` additions on the `main.ts` hook list, the corpus run's `guess` and `thumbs/`, and the fourth check of the rate. The table's spec 04 ("Risks": "Thumbnails, the character-or-prop guess … are not in it yet") is updated in the table's repo when it pins the new commit (M2), not here.

## 8. Build order, one commit each, and the test that proves each step

Each step ends with `npm run check` green; the baseline test in it is the no-change proof for the pipeline.

1. `feat: guess whether a mini is a character or a prop` — `kind.ts` with `guessKind`, the constants and `KindGuess`; the size step in `run.ts`; `kind` on `ConversionResult`, `ConversionStats`, `PipelineOptions`, `ConvertOptions`, `UpChoices`; `index.ts` exports (`MiniKind`, `KindGuess`, the three constants) and their lines in `index.test.ts`. Tests: `kind.test.ts` on generated meshes built with `addRoundBase` and boxes (no sin or cos, same bits everywhere): a 32 mm disc 3 mm high with a 6 mm column on it → `character`, `base-top`, share about 0.96; the disc with a box covering 70 % of it → `prop`, `solid`; a 100 × 30 × 36 box → `prop`, `solid`, share 0; a disc 3 mm high alone → `character` (bare top); a column without a base (`base: null`) → `no-base` with no pass; a pair with a base file → `base-file`; a `kind: 'prop'` option on the first → `manual` with `topShare` still measured. `run.test.ts`: the generated figure converts with `kind.kind === 'character'` and `choices.kind` undefined; with `kind: 'prop'` it is manual and `choices.kind === 'prop'`. `client.test.ts`: the option reaches the worker. The baseline does not move.
2. `feat: render a thumbnail of the table level` — `thumbnail.ts`, its exports in `three.ts` and `index.test.ts`'s three list; the viewer imports the shared material constants; `main.ts` hook and `?dev` image. Tests in Node: `frameBox` (the target is the centre; a box twice as large gives twice the distance; every corner projects inside the frame less the margin, checked by projecting them back; a flat 100 × 1 × 100 plate is framed by its width), `linearToSrgb` (0 → 0, 255 → 255, mid grey 0.5 linear → 188), `flipRows`, `unpremultiply`. `e2e/thumbnail.spec.ts`: on the demo mini, `__mt.thumbnail()` decoded in the page (`createImageBitmap` → canvas → `getImageData`) is 512 × 512, its four corner pixels have alpha 0, the pixel at the centre column and 60 % height is opaque, the opaque pixels' box spans at least 85 % of the frame in width or height; `thumbnail(128)` is 128 × 128; `thumbnail(1024)` rejects; the same on `?bake=0` (the per-vertex path) and on the default page (the baked path, when the bake ran: `state.stats.bakeSkipped === null`). A `verify-3d` screenshot of the `?dev` image next to the viewer: the same mini, the same angle, the same colours.
3. `feat: the corpus run checks the kind guess and saves the thumbnails` — the index entries, `corpus.mjs`, `automatic.mjs` with its types and tests (a `kind` check right and wrong, the default expected kind, the share in the failure line, `right` false on a wrong kind alone). Then the corpus run on the development PC and the numbers into the journal.
4. `docs: the guess and the thumbnail in the README, CLAUDE.md and the journal` — §7 and the journal entry `docs/journal/2026-10-<dd>-thumbnail-and-kind.md` (topics `sizing`, `measurement`, `corpus`, `export`): what a person gets, why the guess reads the base's top and not its material or its outline (the hollow bases and the sprawling dragon, §3.2), why the thumbnail is the consumer's (§2), the colour-space and premultiplication pitfalls if they bit, the rate with every miss, and what stays open.

## 9. Stop and ask

On the PR, and label the issue `needs-human` when the answer is the PM's:

- The regression baseline moves, a GLB's bytes change, or a unit or e2e test outside the new ones needs a change.
- The corpus rate for the kind is below 3 of the 4 props or below 24 of the 27 characters. Report the per-mini shares; do not tune the three constants to the corpus, which is too small to tune against. The PM decides whether the rule, the threshold or the corpus changes.
  - **PM decision, 2026-10-06** (PR #117, comment 6007985746): the build measured 4 of 4 props and 24 of 28 characters. The rule and its constants stay as they are for now; the guess is measured on a much bigger corpus, the PM's own library, before release, and the numbers are adjusted there if needed (#118).
- The thumbnail's colours still differ from the viewer's after the three corrections of §4.3, or the edge fringe remains after un-premultiplying.
- The page would need a second WebGL context, or the viewer's detail texture cannot be reached without changing the `three` entry's API.
- A decision in this note turns out wrong. Record the PM's answer in this note with the date, nothing else.

Not a reason to stop: the exact `?dev` wording, the thumbnail's place on the comparison sheet, the names of private helpers.

## 10. Out of scope, filed or left

- `kind` in the GLB's `extras.meshtavern` (§3.5): a follow-up issue when the table wants it in the file.
- A kind switch or a thumbnail on the product page: the table's import step (spec 04, M2) is where a person meets both.
- Thumbnails at a question (#92) or of a single part (#93): the picture is of the finished mini.
- A guess for minis the rule cannot separate from a figure on a base (a tree on a disc): the switch.
- The table's side: pinning the new commit, the upload of the thumbnail, the switch in the import step, spec 04's "Risks" line.
