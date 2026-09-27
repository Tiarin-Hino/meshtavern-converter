# Design: a base file next to the figure (#70)

Status: design pass by Fable 5.1, 2026-09-27, for Opus 5.5 to build · Spec: Phase 1, story 10 · Issue: #70

This note fixes the decisions the build should not have to make: how a second file reaches the pipeline, which file is taken as the base, how the base's top is read and where the figure is set down, what the result carries, how the user corrects the placement, the corpus pairs and their report, the regression shape, and the build order with the test that proves each step. Product behaviour comes from the issue and the spec; where this note picks a number, it is a named constant marked _(proposal)_ and the PM can change it. Every heuristic here is a convenience: the manual placement is the guaranteed path (issue), and the corpus pairs decide whether the convenience is good enough. Whoever builds this changes the code, not this note, unless a decision here turns out wrong on a real pair; then stop and ask (§10).

Corpus minis are named by their generic index names (`humanoid/humanoid-09`), never by their product names, here and in everything the build writes.

## 1. What the problem looks like

Most sculpted minis ship as two STLs. The figure file has feet, often on a thin integral "puddle", or a peg or a tab sticking down. The base file has a flat underside and, on top, a dedicated spot for the figure: a shallow recess the puddle fits into, a hole for the peg, a slot for the tab, or nothing but a flat patch on a sculpted top. Today the converter takes one file, so a person joins the two in another program first: the step this story removes.

Three facts shape the design:

- **Everything needed already exists for one file.** `resolveOrientation` finds a flat underside (a base file always has one, it was printed on it), `orientAndPlace` stands a mesh on y = 0 with the origin at the centre of its base, `measureBase` measures that base, and `restingPoints` (stance.ts) finds the lowest points of a figure. The pair path runs the single-file path twice, then adds one step.
- **The spot on a base is a basin.** A recess, a hole and a slot are all regions of the top surface that would hold water if the base were rained on. That turns "find the recess, slot or hole" into one algorithm over a height map of the top, and "which basin" into a size match against the figure's feet.
- **Setting down is dropping.** The figure is lowered straight down until it first touches the base, wherever that happens: the puddle on the recess floor, the peg tip on the hole's floor, the feet on the rim when the peg is longer than the hole. One rule covers every kind of spot, and a misfit shows as a figure that floats instead of a wrong mini.

The PM's collection is the motivation and the test material: the figures come with a separate base file and are often in print orientation, so the figure's own up detection (#72) and the six-way select run before the feet can be matched.

## 2. What the result carries

```ts
// src/lib/pipeline/pair.ts
export type PairWarning =
  /** Both files have a flat underside and are low and wide; the lower one was taken as the base. */
  | 'both-look-like-bases'
  /** The figure has a flat underside of its own (an integral base); it was set on the base anyway. */
  | 'figure-has-its-own-base';

export interface FileShape {
  /** Width, height and depth in file units after the file's own orientation. */
  sizeMm: [number, number, number];
  up: UpAxis;
  upMethod: Orientation['method'];
  /** Height over the longer side of the footprint: low and wide is small. */
  aspect: number;
  /** A flat underside covering `MIN_BASE_COVERAGE` of the footprint: what a base has. */
  flatUnderside: boolean;
}

export interface Pairing {
  /** Which of the two files is the base: 0 the first given, 1 the second. */
  baseFile: 0 | 1;
  method: 'guessed' | 'manual';
  warnings: PairWarning[];
  files: [FileShape, FileShape];
}

// src/lib/pipeline/place.ts
export type SpotKind = 'hole' | 'recess' | 'flat';

export interface Spot {
  kind: SpotKind;
  /** Centre of the spot on the base, scene x and z, base file units. */
  centre: [number, number];
  /** Extent of the spot: the basin's bounding box, or the window of the flattest patch. */
  sizeMm: [number, number];
  /** Rim height minus floor height of the basin; 0 for a flat patch. */
  depthMm: number;
  /** How well the figure's contact footprint fits the spot, 0–1 (§4.4); 0 for a flat patch. */
  fit: number;
}

export interface Placement {
  spot: Spot;
  /** The figure's contact footprint that was matched: its extent in x and z. */
  contactMm: [number, number];
  /** Where the figure ended up: its contact centre relative to the base's origin (x, z), and its lift above y = 0. */
  offsetMm: [number, number, number];
  /** The turn about the vertical applied to the figure, degrees. */
  yawDeg: number;
  /** `detected`: the heuristic alone. `manual`: the user moved, turned, raised or lowered it. */
  method: 'detected' | 'manual';
  /** Every basin that was considered, best first, for the corpus report and tuning. */
  candidates: Spot[];
}

export interface PairResult {
  pairing: Pairing;
  placement: Placement;
  /** The merged full-detail mesh lists the figure's vertices and triangles first: the page splits it there for the preview (§6). */
  figureVertices: number;
  figureTriangles: number;
}
```

- `ConversionResult.pair: PairResult | null` and `ConversionStats.pair: PairResult | null`. Null for a single file: nothing else in the result changes shape.
- `ConversionResult.orientation` and `stats.up` / `upMethod` are the **figure's**. The base's orientation is in `pair.pairing.files[baseFile]`.
- `Sizing.base` is measured from the base file (issue), so `describeMini` says "25 mm round base from its own file" _(proposal)_ for a pair.
- `Placement.offsetMm` and everything else in file units of the oriented base, before the size step; the page divides viewer distances by `sizing.scale` (§6). GLB `extras.meshtavern` does not change: the table needs the merged mini and its base diameter, which it already gets.
- A new problem code `not-a-pair` in `problems.ts`: "Neither of these files has a flat underside, so neither can be the base of the other. Drop the figure on its own, or drop it together with its base file." _(proposal)_

## 3. Options and the protocol

```ts
// PipelineOptions (run.ts) and ConvertOptions (protocol.ts) gain:
/** The second STL of a figure-plus-base pair. Which one is the base is guessed (§4.1) unless `pairing.swap`. */
secondStl?: ArrayBuffer;
pairing?: PairingOptions;
placement?: PlacementOptions;

export interface PairingOptions {
  /** The other file is the base: the user swapped the guess. */
  swap?: boolean;
}

export interface PlacementOptions {
  /** Moves the figure from the detected spot, scene x and z, base file units. */
  moveMm?: [number, number];
  /** Raises (positive) or sinks the figure from the drop height. */
  liftMm?: number;
  /** Turns the figure about the vertical, on top of any alignment the detection applied (§4.5). */
  turnDeg?: number;
}
```

- The manual values are **relative to the detection**, like a turn on top of the detected up. The detection is deterministic for the same two files, so the offsets stay meaningful across re-conversions; after a swap the page resets them, and resets `orientation` too, because the up axis was chosen for what is now the base (§6).
- `WorkerRequest` carries `secondStl` next to `stl`, transferred like it. `Converter.convert(stl, onProgress, options)` keeps its signature: the second buffer travels in the options and `client.ts` adds it to the transfer list. `handleRequest` and `runPipeline` read it from the options. The `secondStl` buffer is unusable on the page after the call, like `stl`; the page re-reads both files for a re-conversion, as `lastSource.read()` does today.
- `OrientationOptions` and `SizingOptions` apply to the figure and the merged mini as before. The base is always oriented by its own detection.
- Memory: `checkFits` for a pair uses the sum of the two files' estimates minus one `FIXED_BYTES` (`estimatePairBytes(a, aFormat, b, bFormat)` in memory.ts); the refusal is the existing `too-large`.

## 4. The place step

New step `place` in `STEPS` between `orient` and `size`, run only when `secondStl` is given (`stepCount` counts it then). It lives in two modules that stay free of DOM and three.js and get unit tests: `pair.ts` (roles) and `place.ts` (height map, basins, contact, drop, merge).

With a second file, `read`, `weld` and `orient` each run once over both files inside their step (both soups, both welds, both orientations), so the timings keep one entry per step and the progress bar keeps its steps. Memory accounting sums the two files' buffers. Orient calls `resolveOrientation(mesh, {})` on both first, because the roles are guessed from the detection (§4.1); when the figure has `OrientationOptions`, it is resolved again with them. Give `resolveOrientation` an optional precomputed pass (the `Omit<UpDetection, 'orientation'>` that `scanMesh` returns) so the largest figure is not scanned twice (0.6 s on the development PC for 5.6 M triangles).

### 4.1 Which file is the base (`guessRoles` in pair.ts)

For each file after its own detection: `flatUnderside = coverageFor(pass, up) >= MIN_BASE_COVERAGE` on the detected axis (that is `method === 'base'`), and `aspect = height / max(width, depth)` after `orientAndPlace`.

| Files with a flat underside | Decision                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none                        | `ConversionProblem('not-a-pair')`. Two figures cannot be set on each other, and a base without a flat underside is not a base.                                                                                  |
| one                         | That file is the base, whatever its aspect. A flyer's tall scenic pillar is a base; a low creature without a base is a figure.                                                                                  |
| both                        | The lower aspect is the base. Warning `both-look-like-bases` when the other file's aspect is also ≤ `BASE_MAX_ASPECT` (two bases, or a very low creature on its own base); otherwise `figure-has-its-own-base`. |

`BASE_MAX_ASPECT = 0.5` _(proposal)_: a 25 mm base 4 mm tall is 0.16, a 32 mm scenic base with a 15 mm rock is 0.47, a hound on an integral oval base about 0.6, a standing figure on its base about 1.5. `pairing.swap` exchanges the roles after the guess and sets `method: 'manual'`; the warnings stay as computed, so the page can still say what it saw.

A pair with a warning converts and is shown; only the case with no possible base is refused (issue: "a message that says what to do, not a wrong mini"). The refusal ends in the page's error state, like every other `ConversionProblem`; §10 flags this for the PM, because it drops a figure that was already on screen when a wrong base is added to it.

### 4.2 The height map of the base's top (`topHeightMap` in place.ts)

The base stands Y-up on y = 0 with the origin at its centre (its own `orientAndPlace`). Its top is read into a grid over the footprint: cell size `HEIGHTMAP_CELL_MM = 0.5` _(proposal)_, or larger so that no side exceeds `HEIGHTMAP_MAX_CELLS = 512` _(proposal)_; a 50 mm base is 100 × 100 cells, a 100 mm one 200 × 200.

- **Top height per cell** is the highest surface seen from above: for every triangle, the cell centres inside its x/z projection get the interpolated y, keeping the maximum per cell (barycentric test on the cell centres in the triangle's bounding cells). Vertical walls project to no area and define nothing, which is right. Every vertex is also stamped into its cell, so a finely sculpted top whose triangles are smaller than a cell leaves no gaps.
- **Inside the outline:** a cell is covered when any triangle or vertex touched it. Uncovered cells connected to the map's border (flood fill over uncovered cells from the border) are outside the base. Uncovered cells not connected to the border are **through holes**: their height is set to 0, the floor the base stands on.
- Cost: one pass over the base's triangles (a base file is 100k–1M triangles) and a fill over at most 512² cells: tens of milliseconds.

```ts
export interface HeightMap {
  cellMm: number;
  /** x and z of the centre of cell (0, 0). */
  origin: [number, number];
  columns: number;
  rows: number;
  /** Top height per cell, row-major; NaN outside the base. Through holes are 0. */
  top: Float64Array;
}
```

### 4.3 Basins (`findBasins`)

Rain on the height map: the classic "trapping rain water" flood. Cells on the outline's edge start at their own height in a priority queue keyed by height (ties broken by cell index, so every machine gets the same order); popping the lowest cell and pushing its uncovered neighbours at `max(neighbour height, popped level)` gives every cell the level water would stand at. `water = level − top`. Cells with `water ≥ RECESS_MIN_DEPTH_MM` form basins by 4-connectivity.

`RECESS_MIN_DEPTH_MM = 0.4` _(proposal)_: a printable recess is 0.5–2 mm deep and a layer is 0.2 mm, so 0.4 keeps layer texture and sculpted scratches out. A basin's `depthMm` is its water level minus its lowest cell; its `centre` and `sizeMm` are its cells' bounding box; basins smaller than `RECESS_MIN_AREA_MM2 = 2` _(proposal; a 1.6 mm peg hole)_ are dropped. `kind` is `hole` when the basin is a through hole or deeper than `HOLE_MIN_DEPTH_MM = 2` _(proposal)_, else `recess`; the name is for the user and the report, not for the matching.

### 4.4 The figure's contact footprint and the choice of spot (`contactFootprint`, `chooseSpot`)

The figure stands Y-up on y = 0 after its own `orientAndPlace`. Its **contact footprint** is the x/z bounding box and centre of the vertices within `CONTACT_BAND` of its lowest point, `CONTACT_BAND = max(CONTACT_BAND_MIN_MM, CONTACT_BAND_SHARE × height)` with `CONTACT_BAND_MIN_MM = 0.5` and `CONTACT_BAND_SHARE = 0.03` _(both proposals)_: 0.9 mm on a 30 mm figure, 3 mm on a 100 mm dragon. On feet or a puddle it is the soles; on a peg or tab it is the peg's or tab's end, because they reach lower than the feet. `restingPoints(positions, [0, 1, 0], band)` in stance.ts does this pass once its `band` is taken in mm rather than as a share (add a parameter; the #72 caller keeps its share).

**Fit of a basin** to the contact footprint: with both extents sorted (longer, shorter) and `r_i = contact_i / basin_i`, `fit = Π_i min(r_i, 1 / r_i)`, in (0, 1]. A 3 mm peg over a 3.2 mm hole: 0.88. Feet 12 × 8 mm over a 16 × 12 mm recess: 0.5. The same feet over a 2 × 3 mm crevice of a sculpted top: 0.06. A 3 mm peg over a 20 mm decorative puddle: 0.02. The basin with the highest fit is the spot when `fit ≥ RECESS_MIN_FIT = 0.25` _(proposal; half the size in each direction)_; among basins within `FIT_TIE = 0.05` _(proposal)_ of the best, the deeper one wins. All basins considered go into `candidates`, best first.

**No basin fits: the flattest patch.** A window the size of the contact footprint (at least 3 × 3 cells, clamped to the map when the figure is wider than the base) slides over the top one cell at a time; windows containing a cell outside the outline are skipped. The window with the smallest height range (max − min) wins; among windows within `FLAT_PATCH_TIE_MM = 0.2` _(proposal)_ of the smallest range, the one nearest the base's centre. A naive loop is enough: 200 × 200 cells × a 24 × 16 window is under 10 M comparisons. The spot's `kind` is `flat`, `depthMm` 0, `fit` 0, `sizeMm` the window.

### 4.5 Turn, move, drop, merge (`placeFigure`, `mergeMeshes`)

In this order, all about the figure's contact centre, all with + − × ÷ and sqrt only (the regression pair of §8 depends on the same bits on every machine):

1. **Alignment.** When the spot is a basin and both the basin's cells and the contact vertices are elongated, `longer / shorter ≥ ELONGATED_ASPECT = 1.3` _(proposal)_, the figure is turned about the vertical so the long axes coincide, by the smaller of the two turns (never more than 90°). The long axis of a point set is the major eigenvector of its 2 × 2 covariance, closed form with one sqrt; cos and sin of the turn come from the normalised eigenvector components, not from `atan2`. This is what lets a tab enter a slot; on round holes and puddles nothing is elongated and nothing turns. The user's `turnDeg` is added after it.
2. **Move.** The contact centre is translated onto the spot's centre, plus `moveMm`.
3. **Drop.** `lift = max over figure vertices inside the map of (lowestTopAround(x, z) − y)`, where `lowestTopAround` is the minimum `top` in the 3 × 3 cells around the vertex's cell (`DROP_NEIGHBOURHOOD = 1` cell _(proposal)_). Vertices over cells outside the base do not constrain; when no vertex is over the base the lift is 0 and the figure stands on the floor beside it. The neighbourhood is the fit tolerance: without it a peg the size of its hole would sit on the rim, because its rim vertices fall into rim cells. Then `liftMm` is added. Cost: one pass over the figure's vertices, about 20 ms for 2.8 M.
4. **Merge.** The figure's positions (turned, moved, lifted) first, then the base's, indices offset, in the manner of `standOnBase`; `figureVertices` and `figureTriangles` record the split. Normals, if any, are recomputed later by the simplify step as today.

The step returns a `PlacedMesh` for the size step: the merged mesh, its bounding box as `sizeMm`, and `base` from `measureBase` on the **base file's** oriented mesh with the base's own coverage (issue: the base is measured from the base file). The merged mesh keeps the base's origin, so it stands on y = 0 centred on its base like a single-file mini and `sizeMini` runs unchanged. A `plainBase` option does nothing for a pair, because there is a base.

### 4.6 Budget

The whole step on the largest realistic pair (a 5.6 M-triangle figure on a 1 M-triangle base) is expected under `PLACE_BUDGET_MS = 300` _(proposal)_ on the development PC: the height map is one pass over the base, the flood and the window search are bounded by 512² cells, the drop is one pass over the figure. Measure it in build step 4 with `performance.now()` in a Node script over the corpus pair with the most triangles; report the number with the device. Over budget: report, do not sample (§10).

## 5. Where the code goes

- **`src/lib/pipeline/pair.ts`** — `FileShape`, `Pairing`, `PairingOptions`, `PairWarning`, `BASE_MAX_ASPECT`, `guessRoles(shapes, options)`.
- **`src/lib/pipeline/place.ts`** — the constants of §4, `HeightMap`, `topHeightMap`, `findBasins`, `contactFootprint`, `chooseSpot`, `placeFigure`, `mergeMeshes`, `Spot`, `Placement`, `PlacementOptions`, `PairResult`.
- **`src/lib/pipeline/stance.ts`** — `restingPoints` takes the band in mm when asked (§4.4).
- **`src/lib/pipeline/memory.ts`** — `estimatePairBytes`.
- **`src/lib/pipeline/problems.ts`** — `not-a-pair`.
- **`src/lib/pipeline/run.ts`** — `secondStl`, `pairing`, `placement` in `PipelineOptions`; the two-file read, weld and orient; the `place` step; `pair` in result and stats.
- **`src/lib/pipeline/orient.ts`** — `resolveOrientation` accepts a precomputed pass.
- **`src/lib/worker/protocol.ts`, `handle.ts`, `client.ts`** — the second buffer and the two option objects.
- **`src/lib/index.ts`** — exports `Pairing`, `PairingOptions`, `PairWarning`, `Placement`, `PlacementOptions`, `Spot`, `SpotKind`, `PairResult` (types) and nothing else new; `index.test.ts` pins them. `dev.ts` exports the generated recess base of §8 for tests and the page's hook.
- **`src/page/page-state.ts`** — the wording of §6; **`src/page/main.ts`, `index.html`, `src/page/style.css`, `src/page/viewer.ts`** — the second file, the Base section, the split preview and the move gizmo.
- **`scripts/lib/corpus-files.mjs`, `scripts/corpus.mjs`, `scripts/corpus-index.json`** — pairs (§7).
- **`src/regression/shapes.ts`, `measure.ts`, `baseline.json`** — the pair case (§8).

## 6. The page

The panel gains a fourth Adjust section, **Base** (`<fieldset id="pair">`), after Look, as the product-page note (#41, §12) reserved. The wording below is a proposal like every string in `COPY`.

**Getting two files in.** `#file` gets `multiple`. `loadFile(file)` becomes `loadFiles(files)`: one file converts it alone, as today, and replaces whatever is on screen; two files convert as a pair; more than two give the error line "Drop one figure file, or a figure and its base." (`describeTooManyFiles`, next to `describeWrongFile`). Both files pass `readStlFile` with the budget before anything is read fully; the pair's joint estimate is checked in the pipeline (§3). A dropped or picked single file never joins the mini on screen by itself: adding a base is explicit, through the section's button, so that converting the next mini stays one drop (§10 flags this choice). `lastSource` becomes a list of one or two sources; `choices` gains `pairing` and `placement`; the heading of a pair reads `figure + base` (names without `.stl`); `state.fileName` joins them with " + ".

**The Base section**, top to bottom:

- With a single-file mini: the button **Add a base file** (`#add-base`, opens a second hidden input `#base-file`). The file picked becomes the second file of the pair; the guess decides which is the base.
- With a pair: the line `Base: <name> · Figure: <name>` and the button **Swap figure and base** (`#swap-pair`); a warning line (`#pair-warning`) for `both-look-like-bases` ("Both files look like bases. If one is a low creature, swap them.") and `figure-has-its-own-base` ("The figure has a flat underside of its own; it was set on the base anyway.").
- The placement line (`#placement`, `describePlacement(placement)`): "Set in the 3.2 mm hole" / "Set in the 14 × 10 mm recess" / "Set on the flattest patch of the top", with " · moved by hand" appended when `method` is `manual`.
- The controls: a checkbox **Move by hand** (`#move-by-hand`: a translate gizmo on the figure part, vertical arrow hidden), buttons **Raise 0.5 mm**, **Lower 0.5 mm** (`LIFT_STEP_MM = 0.5` _(proposal)_), **Turn −15°**, **Turn +15°** (the existing `TURN_STEP_DEG`, about the vertical), the pending line `#placement-pending` ("Moved 2.3 mm, turned 15°, raised 0.5 mm — not applied yet"), **Apply** (`#placement-apply`), **Reset** (`#placement-reset`), and **Remove the base** (`#remove-base`: converts the figure alone).

**The preview.** The merged full-detail mesh (`levels[0]`, on the page already) lists the figure's vertices and triangles first (`pair.figureTriangles`, `pair.figureVertices`), so the page can show it as two objects without any extra data: `viewer.showPair(mesh, figureTriangles, sizeMm)` builds two geometries that share the position attribute and split the index. While any placement control is used, the page shows level 0 split this way (the level chips follow); `viewer.setFigureOffset(moveMm, liftMm, turnDeg)` moves the figure part in the viewer, scaled by `stats.sizing.scale` from file units to scene mm. `viewer.setMoveGizmo(onMove)` is `setTurnGizmo`'s twin: `TransformControls` in translate mode with `showY = false`, attached to the figure part, OrbitControls disabled while it drags. Nothing converts until Apply, which sends `placement` relative to the detected spot; Reset drops the preview; the turn preview of #72 (pitch and roll of the whole mini) and the placement preview are exclusive, and starting one resets the other. After Apply, the table level shows again, as after every conversion.

**Hooks** (`window.__mt`): `loadGeneratedPair()` (converts the generated figure without base on the generated recess base of §8: the e2e fixture), `addBase(stl: ArrayBuffer, name)`, `swapPair()`, `movePlacement(dxMm, dzMm)`, `liftPlacement(dyMm)`, `turnPlacement(deg)`, `applyPlacement()`, `resetPlacement()`, `removeBase()`; `state.pair` holds the pending preview (`{ moveMm, liftMm, turnDeg }` or null) and the last result's `PairResult` is in `state.stats.pair`. Figures rows under `?dev`: `Pair` ("base: file 2 (guessed), figure 12 × 30 × 8 mm, base 32 × 4 × 32 mm") and `Placement` ("hole 3.2 mm, fit 0.88, lift 0.0 mm, turn 0°").

**Wording** in `COPY` and functions in `page-state.ts` (unit-tested): `addBase`, `removeBase`, `swapPair`, `moveByHand`, `pairHint` ("Two files? Drop the figure and its base together.", shown under the drop hint), `describePlacement`, `describePairWarning`, `describeTooManyFiles`, and `describeMini`'s "from its own file". `STEP_LABELS.place = 'Setting the figure on its base'`.

## 7. Corpus pairs and the report

- **Convention** _(proposal)_: a base file sits next to its figure as `<name>-base.stl` (`humanoid/humanoid-09.stl` and `humanoid/humanoid-09-base.stl`). `corpusFiles()` keeps returning figure paths (it leaves `-base.stl` files out, so every script that walks the corpus still converts figures alone) and gains `baseFileFor(path)`; `corpus.mjs` picks both files with `setInputFiles('#file', [figure, base])`. The results key stays the figure's.
- **Three pairs** from the PM's licensed library (the private repo's notes say where it is; never commit or attach a file, name a shop or a creator), one each: peg and hole, flat recess, sculpted top without a recess. Named generically under their kind, mapped in the local `corpus/NAMES.md`. If the library has no pair of one kind, stop and ask (§10).
- **`scripts/corpus-index.json`** gains `"spot": "hole" | "recess" | "flat"` per pair, the PM's expectation, and an optional `"placementNote"`. Unknown fields stay untouched.
- **`results.json`** gets `pair` per pair (base file, method, warnings, spot kind, size, depth, fit, offset, lift, yaw, the candidates) and `results.md` a section **Base files**: one row per pair with the spot found against the index, the lift, the yaw, the warnings, and the runner-up basins; the comparison sheet's heading adds "on <base name>, set in the hole". Whether the figure sits right is the PM's judgement on the sheets (issue); the PR lists every pair under "Needs a human look".
- Run `npm run corpus -- --no-bake` while tuning, one full run at the end; put the Base files table in the PR and the journal.

## 8. Regression shape

`src/regression/shapes.ts` gains `generateRecessBase()`: a 32 mm round base 4 mm tall with a 14 mm round recess 1 mm deep, Z-up, built on `addRoundBase`'s disc grid (`onDisc`): rings inside the recess radius are lowered by the depth and a ring of wall quads joins the two heights; only + − × ÷ and sqrt, so its bits are the same on every machine. `dev.ts` exports it for the page's `loadGeneratedPair`. `REGRESSION_CASES` gains `figure-on-base`: `generateFigure(false)` as the figure, the recess base as the second file, `bake: 0`, expected `up: '+z'` and `spot: 'recess'`; `CaseFigures` gains `spot` and `liftMm` (`RELATIVE_TOLERANCE` applies to the lift, exact to the spot), and `baseline.test.ts` checks them. `npm run baseline:update` adds the case; **no existing case may change a single figure** (§10).

Unit fixtures, not in the baseline: a peg-and-hole pair (a figure with a 3 mm cylinder under it, a base with a 3.2 mm through hole) and a tab-and-slot pair (a 1.5 × 8 mm tab, a 2 × 9 mm slot turned by 90° in the file) as small generated meshes in `place.test.ts`.

## 9. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green at steps 6 and 7.

1. **`pair.ts`.** `guessRoles` with the table of §4.1, `not-a-pair`. Tests: figure without base + flat base → base is file 1 (or file 0 when given first); tall figure with integral base + base → warning `figure-has-its-own-base`, the base is the low one; two low bases → `both-look-like-bases`, the lower aspect wins; two figures without a flat underside → `not-a-pair`; `swap` exchanges the roles and sets `manual`.
2. **`topHeightMap`.** Tests on generated Y-up meshes: a flat disc gives one height everywhere inside and NaN outside; a disc with a through hole gives 0 in the hole; the recess base of §8 gives the two heights; a tilted plate gives interpolated heights within a cell's error; a mesh of tiny triangles has no gaps.
3. **`findBasins`, `contactFootprint`, `chooseSpot`.** Tests: the recess base has one basin of the recess's size and depth, kind `recess`; the hole base has one basin of kind `hole` with the base's height as depth; a bumpy sheet (`generateBumpySheet`) yields only basins under `RECESS_MIN_AREA_MM2` or none; the contact footprint of `generateFigure(false)` is its two lowest blobs' soles, of a figure with a peg the peg's end; `chooseSpot` picks the recess for the figure, the hole for the peg, and `flat` for the figure over the bumpy sheet, with the window nearest the centre among equal ranges.
4. **`placeFigure`, `mergeMeshes`, the `place` step.** The two-file read, weld and orient in `run.ts`; `PairResult` in result and stats; `estimatePairBytes`. Tests (`place.test.ts`, `run.test.ts`): the figure's contact centre lands on the recess centre and its lowest point on the recess floor; the peg's tip on the hole's floor when the hole is deeper than the peg, and the feet on the rim when it is shallower; the tab turns into the slot within 1° and a round peg does not turn; the merged mesh stands on y = 0 with `sizing.base` measured from the base file (32 mm round); `figureVertices` and `figureTriangles` match; the single-file path is bit-identical (the baseline does not move at all at this step); `not-a-pair` and `too-large` for a pair surface as `ConversionProblem`s. Measure the step on the largest corpus pair in Node (§4.6) and record the number with the device.
5. **Options.** `PairingOptions` and `PlacementOptions` through `run.ts`, `protocol.ts`, `handle.ts`, `client.ts`. Tests: `swap` puts the figure on the other file; `moveMm`, `liftMm`, `turnDeg` shift the figure's contact centre, lift and yaw by exactly what was given and set `method: 'manual'`; `handle.test.ts` transfers both buffers and passes the options through.
6. **Regression** (§8): the generator, the case, the figures, the baseline update, `dev.ts`.
7. **Page** (§6): the input, `loadFiles`, the Base section, `page-state.ts` wording with unit tests, the split preview and the move gizmo, the hooks. e2e in a new `e2e/pair.spec.ts`: `loadGeneratedPair()` converts and the placement line reads "Set in the 14 × 10 mm recess" (or the measured size), `state.stats.pair.placement.spot.kind` is `recess`, `sizing.base.diameterMm` is 32; `movePlacement(2, 0)` shows the pending line and converts nothing (`progressLog` unchanged); `applyPlacement()` converts, `method` is `manual` and `offsetMm[0]` moved by 2; `swapPair()` converts with `baseFile` exchanged and a warning; `removeBase()` converts the figure alone and `stats.pair` is null; two files picked at once through `#file` (`setInputFiles` with two generated STLs written to the test's output folder) convert as a pair, three files give the error line. The heading, the section and the pending line as text assertions; `body[data-state]` stays `done` throughout. Screenshots with `verify-3d`: the pair from the side at grid level (the figure seated in the recess), and the section with a pending move.
8. **Corpus** (§7): the convention, the three pairs, the index field, the report. Run, read the sheets, tune the constants of §4 only if a pair misses in a way one threshold fixes (each change a commit with the table that motivated it); a miss that needs a design change stops (§10). Put the Base files table in the PR.
9. **Docs**: `CLAUDE.md` (layout: `pair.ts`, `place.ts`, the `place` step, the second file in the protocol, the hook list, the corpus convention; conventions: pairs), the spec's story 10 status line, `CONTRIBUTING.md` (the `-base.stl` convention), the journal entry `docs/journal/2026-09-<dd>-base-file.md` (topics `placement` (new: add it to the README's list), `ui`, `regression`, `testing`): the algorithm in words, the three pairs and what the PM saw, every threshold moved and why, the step's time with the device, what did not work.

## 10. When to stop and ask

- **A corpus pair misses in a way no single threshold fixes**: the recess is found but the wrong basin wins, the peg sits on the rim, the sculpted top gets a spot the PM would not choose. Stop with the height map's figures for that pair (basins with size, depth and fit) on the PR; the PM decides between accepting it as a manual case and a design change.
- **The library has no pair of one of the three kinds.** Ask the PM for one; build and test the kind on the generated fixture meanwhile.
- **The baseline moves** on any existing case, at any step. The single-file path must be bit-identical.
- **The place step is over `PLACE_BUDGET_MS`** on the largest pair. Report the numbers; a coarser cell or a vertex stride needs the PM's say.
- **Decisions here the PM may want to change**, flagged in the PR's "Needs a human look" with screenshots, built as proposed meanwhile:
  - The pair converts fully, bake included, before the placement is shown, and every correction converts again, as the up axis and the size do (§6). The alternative is a separate `place` job that returns the two oriented meshes for a preview before merging: faster feedback, one more click on every pair, a fifth page state.
  - A single dropped file starts a new conversion; a base is added through the section's button (§6).
  - `not-a-pair` ends in the error state and drops the mini that was on screen (§4.1). The alternative keeps the figure's mini and shows the refusal as a warning line.
  - Every constant of §4, `BASE_MAX_ASPECT` and `RECESS_MIN_FIT` first.
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 11. Out of this note

More than two files, cutting a figure off a printed base, and scaling figure and base separately are out by the issue. A restart of the pipeline from the place step after a correction, instead of a full conversion, stays the follow-up the size and orientation notes named. The table (Phase 2) receives the merged mini and its base diameter as today; whether it wants the split for its own effects is a question for the table's spec. Facing direction (which way the figure looks on its base) is the table's job, as #72 decided for the whole mini; the yaw here only fits a tab into a slot.
