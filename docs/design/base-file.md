# Design: a base file next to the figure (#70)

Status: design pass by Fable 5.1, 2026-09-27; built to it by Opus 5.5 the same day (steps 1–7 and the corpus tooling, PR #89, stopped with three questions for the PM); revised by Fable 5.1 after the overnight research of 2026-09-28 (§12, which also lists what this revision asks the built code to change) · Spec: Phase 1, story 10 · Issue: #70

This note fixes the decisions the build should not have to make: how a second file reaches the pipeline, which file is taken as the base, how the base's top is read and where the figure is set down, what the result carries, how the user corrects the placement, the corpus pairs and their report, the regression shape, and the build order with the test that proves each step. Product behaviour comes from the issue and the spec; where this note picks a number, it is a named constant marked _(proposal)_ and the PM can change it. Every heuristic here is a convenience: the manual placement is the guaranteed path (issue), and the corpus pairs decide whether the convenience is good enough. Whoever builds this changes the code, not this note, unless a decision here turns out wrong on a real pair; then stop and ask (§10).

Corpus minis are named by their generic index names (`humanoid/humanoid-09`), never by their product names, here and in everything the build writes.

## 1. What the problem looks like

Most sculpted minis ship as two STLs. The figure file has feet, often on a thin integral "puddle", or a peg or a tab sticking down. The base file has a flat underside and, on top, a dedicated spot for the figure: a shallow recess the puddle fits into, a hole for the peg, a slot for the tab, or nothing but a flat patch on a sculpted top. Today the converter takes one file, so a person joins the two in another program first: the step this story removes.

Three facts shape the design:

- **Everything needed already exists for one file.** `resolveOrientation` finds a flat underside (a base file always has one, it was printed on it), `orientAndPlace` stands a mesh on y = 0 with the origin at the centre of its base, `measureBase` measures that base, and `restingPoints` (stance.ts) finds the lowest points of a figure. The pair path runs the single-file path twice, then adds one step.
- **The spot on a base is a basin.** A recess, a hole and a slot are all regions of the top surface that would hold water if the base were rained on. That turns "find the recess, slot or hole" into one algorithm over a height map of the top, and "which basin" into a size match against the figure's feet.
- **Setting down is dropping.** The figure is lowered straight down until it first touches the base, wherever that happens: the puddle on the recess floor, the peg tip on the hole's floor, the feet on the rim when the peg is longer than the hole. One rule covers every kind of spot, and a misfit shows as a figure that floats instead of a wrong mini.

The PM's collection is the motivation and the test material: the figures come with a separate base file and are often in print orientation, so the figure's own up detection (#72) and the six-way select run before the feet can be matched.

**What the library actually looks like** (the research of §12, 1,328 pairs inventoried, 14 corpus pairs and 48 sampled pairs analysed in detail, more in the library-wide table of §12):

- **Base undersides are hollow.** A rim touches the floor and the inner face sits 1–1.5 mm higher, or something pokes 0.2 mm below the underside. The up detector's `RESTING_BAND` (2 % of the height, 0.1–0.3 mm on a thin base) then sees only the rim and misses the base, so it stands the base on its edge. An absolute band of 2 mm finds the underside on every corpus base and on 47 of 48 sampled bases; the last one is exported at a 26° tilt and has no axis-aligned face at all.
- **Most tops are terrain, not seats.** The median base is 25 mm wide and 9 mm tall with a sculpted top (cobbles, rock, roots); two thirds have no basin deeper than 0.4 mm. Seats exist and are unmistakable when they do: a footprint-shaped recess in the ground for one foot, per-foot recesses on a plain disc, a disc recess for a figure that carries its own puddle, a nub on the base that enters a socket in the figure. Crevices between cobbles also read as basins, small and sloped.
- **The figure keys into the terrain.** A figure sculpted on its base has its soles cut flat at the base's surface where it stood: one foot on the ground, the other on a stone, each sole a negative of the top there. The same flat cuts reveal the figure's up axis without any base (issue #90). Matching the whole underside as a template against the top was tried on this insight and dropped after the visual test (§12): a seat that fits, or the flattest patch near the middle, places better than the most contact.
- **Pegs are rare here.** No through hole in 62 bases; deep round holes on one scenic base. A peg-and-hole pair for the corpus may have to come from elsewhere or from a generated fixture (§7).

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
/** hole and recess: a seat won (§4.3). flat: the flattest patch. registered: the files' own placement (§4.4). */
export type SpotKind = 'hole' | 'recess' | 'flat' | 'registered';

export interface Spot {
  kind: SpotKind;
  /** Centre of the spot on the base, scene x and z, base file units: where the figure's contact centre went. */
  centre: [number, number];
  /** Extent of the seat's bounding box, or of the flattest window. */
  sizeMm: [number, number];
  /** Rim height minus floor height of the seat; 0 otherwise. */
  depthMm: number;
  /** How well the contact footprint fits the seat, 0–1 (§4.4); 0 otherwise. */
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

For each file, `baseOrientation(mesh)` in pair.ts finds the underside the way a base needs it (§1: hollow undersides, tilted exports), and the roles follow from what it finds:

1. **Flat underside within an absolute band.** Per axis and sign, the area of faces within 10° of the axis whose centroid lies within `UNDERSIDE_BAND_MM = 2` _(proposal)_ of the extreme along that axis, over the footprint seen from that axis: `sumTriangles` in orient.ts computes the same thing with `RESTING_BAND` and only needs a second, absolute band next to it. The best axis with coverage ≥ `MIN_BASE_COVERAGE` (0.15, as today) is the base's up; `flatUnderside` is true.
2. **Tilted export.** When no axis reaches it, the dominant plane: face normals binned on a cube-sphere (12 × 12 cells a face, area-weighted), the best bin's direction refined twice as the area-weighted mean of the normals within 10° of it. When that plane holds ≥ `DOMINANT_PLANE_SHARE = 0.1` _(proposal)_ of the surface area and is more than `LEVEL_TOLERANCE_DEG` off every axis, it is the underside: the rotation `fromTo(normal, −y)` (rotation.ts) orients the file and `flatUnderside` is true, `how: 'dominant-plane'`. Bit-exactness is not needed here (no regression case is tilted).
3. Otherwise `flatUnderside` is false; the file's orientation is the detector's as today.

Then `aspect = height / max(width, depth)` after `orientAndPlace`. The figure keeps the orientation of the `orient` step (detection, the index or the user's choice); its `flatUnderside` comes from the same 2 mm test, so a figure that carries its own puddle or disc says so.

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

`RECESS_MIN_DEPTH_MM = 0.25` (the build's measurement on the first nine corpus pairs, commit d193bcb: their foot recesses are 0.3–0.5 mm deep, the note's first 0.4 missed most of them, 0.15 adds many false ones; the research of §12 counted basins at 0.4 and undercounts seats accordingly). A basin's `depthMm` is its water level minus its lowest cell; its `centre` and `sizeMm` are its cells' bounding box; basins smaller than `RECESS_MIN_AREA_MM2 = 2` _(proposal; a 1.6 mm peg hole)_ are dropped. `kind` is `hole` when the basin is a through hole or deeper than `HOLE_MIN_DEPTH_MM = 2` _(proposal)_, else `recess`; the name is for the user and the report, not for the matching.

**Seats and crevices.** On a sculpted top the flood also finds the gaps between cobbles and the folds of a root: small, shallow (right at `RECESS_MIN_DEPTH_MM`), irregular. A seat made for a figure is the size of what goes into it and reasonably compact. A flat floor is not the sign: a footprint pressed into sculpted mud has a sloped floor (26 % of its cells within 0.2 mm of the lowest) while the crevices between cobbles are flat (§12). So a basin is a **seat** for this figure when its fit to the contact footprint (§4.4) is at least `SEAT_MIN_FIT = 0.5` and `bboxFill ≥ SEAT_BBOX_FILL = 0.4` _(both proposals; on the pairs looked at, the seats score 0.6–0.87 and the crevices at most 0.36)_. Seats become proposals (§4.4); the other basins stay in `candidates` for the report, and every basin, seat or not, takes part in the surface match through its depth. `flatFloorShare` is reported, not used.

### 4.4 The figure's contact footprint and the choice of spot (`contactFootprint`, `chooseSpot`)

The figure stands Y-up on y = 0 after its own `orientAndPlace`. Its **contact footprint** is the x/z bounding box and centre of the vertices within `CONTACT_BAND` of its lowest point, `CONTACT_BAND = max(CONTACT_BAND_MIN_MM, CONTACT_BAND_SHARE × height)` with `CONTACT_BAND_MIN_MM = 0.5` and `CONTACT_BAND_SHARE = 0.03` _(both proposals)_: 0.9 mm on a 30 mm figure, 3 mm on a 100 mm dragon. On feet or a puddle it is the soles; on a peg or tab it is the peg's or tab's end, because they reach lower than the feet. `restingPoints(positions, [0, 1, 0], band)` in stance.ts does this pass once its `band` is taken in mm rather than as a share (add a parameter; the #72 caller keeps its share).

**Fit of a basin** to the contact footprint: with both extents sorted (longer, shorter) and `r_i = contact_i / basin_i`, `fit = Π_i min(r_i, 1 / r_i)`, in (0, 1]. A 3 mm peg over a 3.2 mm hole: 0.88. Feet 12 × 8 mm over a 16 × 12 mm recess: 0.5. The same feet over a 2 × 3 mm crevice of a sculpted top: 0.06. A 3 mm peg over a 20 mm decorative puddle: 0.02. Seats (`fit ≥ SEAT_MIN_FIT`, §4.3) are proposals for the surface match below, best fit first; among seats within `FIT_TIE = 0.05` _(proposal)_ of each other, the deeper one ranks first. All basins considered go into `candidates`, best first, with their fit.

**Before any of this: registered pairs** (the build's proposal on PR #89, 2026-09-27, for the PM to confirm). In 13 of the 40 surveyed pairs whose files stand the same way up, the figure file already stands on the base in the files' own coordinates: turned by the base's up axis and dropped from its own x/z, it lands within `REGISTERED_TOLERANCE_MM = 0.3` _(proposal)_ of the height the file gives it. For those the files' placement is kept (`spot.kind: 'registered'`, the line "Set where the files put it"), the figure's up is the base's, and nothing below runs; the user's move, raise, turn and Apply work as built. The heuristic below is for the pairs exported apart (each file centred on itself). The research of §12 did not test registration in the base's frame and does not contradict it; on the 14 corpus pairs at least `flying/flying-04` is registered.

**Seats first, then the flattest patch: the rule as built (PR #89), and it stays.** The seat with the best fit (`fit ≥ RECESS_MIN_FIT = 0.25`, the build's value, which finds the 0.3–0.5 mm foot recesses of the corpus) is the spot; among seats within `FIT_TIE = 0.05` the deeper one. Without a seat, the flattest patch: a window the size of the contact footprint (at least 3 × 3 cells, clamped to the map when the figure is wider than the base) slides over the top one cell at a time, windows with a cell outside the outline are skipped, the smallest height range wins, and among windows within `FLAT_PATCH_TIE_MM = 0.2` of it the one nearest the base's centre. `kind` is `hole`, `recess` or `flat`.

**The centre guard: a figure belongs near the middle of its base** _(proposal from the two placements the PM made by hand and the sheets, §12)_. On every corpus pair the sheets called right, the built rule leaves the figure's bounding-box centre within 25 % of the base's width of the base's centre (9 mm at most); on every pair called wrong or doubtful it is 42 % to 129 % away, because the contact it centred was an extremity (wing tips 100 mm apart, one hoof of a beast standing on a slope). So, after the seat or the flattest patch is chosen: when the figure's box centre would land more than `CENTRE_MAX_SHARE = 0.3` of the base's footprint from the base's centre, the figure's box is centred on the base instead and dropped (`spot.kind` `flat`, `sizeMm` the base's footprint, the line "Set over the middle of the base"). Measured against the PM's hand placements: the dragon within 5 mm (built rule 40 mm off and 47 mm too high), the beast rider within 11 mm (built rule 29 mm off); the PM then lowers or tilts by a few millimetres and degrees, which the buttons give. A contact wider than `WIDE_CONTACT_SHARE = 0.8` of the base is the same case caught early, before the flattest patch is searched.

**The surface match was tried and dropped** (§12, the visual test of 2026-09-29). The research prototype slid the figure's underside over the base's top and scored the share of soles touching after the drop, with seats as proposals. Rendered side by side with the built rule on all 15 corpus pairs in real Chrome, it was never visibly better and was worse on two: the giant's foot left its footprint recess for the open ground, and the bat left its spire for the ground beside it. A sculpted top offers some patch that touches any small sole, so "most contact" is not "the right spot"; a seat that fits, or the flattest patch near the middle, is a better prior. It also cost 1–60 s where the built rule costs 0.1–0.5 s. Finer height-map cells (0.25 mm) changed nothing where the placement was clear and only reshuffled the ambiguous pairs, so resolution is not the limit either.

### 4.5 Turn, move, drop, merge (`placeFigure`, `mergeMeshes`)

In this order, all about the figure's contact centre, all with + − × ÷ and sqrt only (the regression pair of §8 depends on the same bits on every machine):

1. **Alignment.** When the spot is a seat and both the seat's cells and the contact vertices are elongated (`longer / shorter ≥ ELONGATED_ASPECT = 1.3`), the figure is turned about the vertical so the long axes coincide, by the smaller of the two turns (as built: the major eigenvector of the 2 × 2 covariance, cos and sin from the normalised eigenvector, no `atan2`). A tab enters a slot; round holes and puddles do not turn. The user's `turnDeg` is added after it.
2. **Move.** The contact centre is translated onto the winning position, plus `moveMm`.
3. **Drop.** `lift = max over figure vertices inside the map of (lowestTopAround(x, z) − y)`, where `lowestTopAround` is the minimum `top` in the 3 × 3 cells around the vertex's cell (`DROP_NEIGHBOURHOOD = 1` cell _(proposal)_). Vertices over cells outside the base do not constrain; when no vertex is over the base the lift is 0 and the figure stands on the floor beside it. The neighbourhood is the fit tolerance: without it a peg the size of its hole would sit on the rim, because its rim vertices fall into rim cells. Then `liftMm` is added. Cost: one pass over the figure's vertices, about 20 ms for 2.8 M.
4. **Merge.** The figure's positions (turned, moved, lifted) first, then the base's, indices offset, in the manner of `standOnBase`; `figureVertices` and `figureTriangles` record the split. Normals, if any, are recomputed later by the simplify step as today.

The step returns a `PlacedMesh` for the size step: the merged mesh, its bounding box as `sizeMm`, and `base` from `measureBase` on the **base file's** oriented mesh with the base's own coverage (issue: the base is measured from the base file). The merged mesh keeps the base's origin, so it stands on y = 0 centred on its base like a single-file mini and `sizeMini` runs unchanged. A `plainBase` option does nothing for a pair, because there is a base.

### 4.6 Budget

As built and measured by the build: the place step (height map, flood, basins, fit or flattest patch, drop, merge) takes a median of 236 ms (181–541 ms over 7 runs) on a 5.6 M-triangle figure over a 1 M-triangle base, development PC, Node, `scripts/measure-place.mjs`; the budget stays `PLACE_BUDGET_MS = 300`. The base orientation of §4.1 adds one more accumulator to a pass that already exists and the dominant plane a pass over the normals of the base only; the registration test is one drop. Measure again on the largest corpus pair once the changes are in; over budget: report (§10).

## 5. Where the code goes

- **`src/lib/pipeline/pair.ts`** — `FileShape`, `Pairing`, `PairingOptions`, `PairWarning`, `BASE_MAX_ASPECT`, `UNDERSIDE_BAND_MM`, `DOMINANT_PLANE_SHARE`, `baseOrientation(mesh)` (the 2 mm band and the dominant plane, §4.1), `guessRoles(shapes, options)`.
- **`src/lib/pipeline/place.ts`** — the constants of §4, `HeightMap`, `heightMap` (top and underside), `findBasins` (with the seat filter), `contactFootprint`, `fitOf`, `chooseSpot`, `flattestPatch`, `placeFigure`, `mergeMeshes`, `Spot`, `Placement`, `PlacementOptions`, `PairResult`.
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
- **Fourteen pairs are already in place** (2026-09-28): the base files of every corpus mini that has one in the PM's library were copied to `corpus/<kind>/<name>-base.stl` (`flying-01/02/04`, `humanoid-01/02/03`, `large-01/02/03`, `mounted-02/03`, `quadruped-01`, `swarm-01/03`). They cover the kinds the library has: a footprint recess in sculpted ground (`large-creature/large-02`, one foot in the ground, the other on a stone), sculpted tops without a seat (`humanoid/humanoid-02`, `humanoid-03`, `mounted/mounted-03`), plateaus (`mounted/mounted-02`, `quadruped/quadruped-01`), tall scenic bases where the figure sits on top and overhangs (`flying/flying-01`, `large-creature/large-01`), a figure with its own puddle on a base (`swarm/swarm-01`). The issue's three kinds map onto them as: **flat recess** = `large-02`; **sculpted top** = `humanoid-02` or `mounted-03`; **peg and hole**: none in the library (no through hole in 62 bases scanned, §12), so this kind is proven on the generated fixture of §8, and the PM decides whether a bought pair is still wanted (§10). The library-wide table of §12 lists the few bases with deep round holes, for the PM to pick from if so. Never commit or attach a file, name a shop or a creator; the generic names are mapped in the local `corpus/NAMES.md`.
- **`scripts/corpus-index.json`** gains `"spot": "hole" | "recess" | "flat"` per pair, the PM's expectation, and an optional `"placementNote"`. Unknown fields stay untouched.
- **`results.json`** gets `pair` per pair (base file, method, warnings, spot kind, size, depth, fit, offset, lift, yaw, the candidates) and `results.md` a section **Base files**: one row per pair with the spot found against the index, the lift, the yaw, the warnings, and the runner-up basins; the comparison sheet's heading adds "on <base name>, set in the hole". Whether the figure sits right is the PM's judgement on the sheets (issue); the PR lists every pair under "Needs a human look".
- Run `npm run corpus -- --no-bake` while tuning, one full run at the end; put the Base files table in the PR and the journal.

## 8. Regression shape

`src/regression/shapes.ts` gains `generateRecessBase()`: a 32 mm round base 4 mm tall with a 14 mm round recess 1 mm deep, Z-up, built on `addRoundBase`'s disc grid (`onDisc`): rings inside the recess radius are lowered by the depth and a ring of wall quads joins the two heights; only + − × ÷ and sqrt, so its bits are the same on every machine. `dev.ts` exports it for the page's `loadGeneratedPair`. `REGRESSION_CASES` gains `figure-on-base`: `generateFigure(false)` as the figure, the recess base as the second file, `bake: 0`, expected `up: '+z'` and `spot: 'recess'`; `CaseFigures` gains `spot` and `liftMm` (`RELATIVE_TOLERANCE` applies to the lift, exact to the spot), and `baseline.test.ts` checks them. `npm run baseline:update` adds the case; **no existing case may change a single figure** (§10).

Unit fixtures, not in the baseline: a peg-and-hole pair (a figure with a 3 mm cylinder under it, a base with a 3.2 mm through hole) and a tab-and-slot pair (a 1.5 × 8 mm tab, a 2 × 9 mm slot turned by 90° in the file) as small generated meshes in `place.test.ts`.

## 9. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green at steps 6 and 7.

1. **`pair.ts`.** `baseOrientation` (the 2 mm band, the dominant plane), `guessRoles` with the table of §4.1, `not-a-pair`. Tests: a generated base with a hollow underside (a rim 1 mm high around a recessed inner face, so the 2 % band sees under 15 %) is found by the 2 mm band; the same base rotated by 26° about x (with `Math.cos`/`sin` in the test) is found by the dominant plane within 1°; figure without base + flat base → base is file 1 (or file 0 when given first); tall figure with integral base + base → warning `figure-has-its-own-base`, the base is the low one; two low bases → `both-look-like-bases`, the lower aspect wins; two figures without a flat underside → `not-a-pair`; `swap` exchanges the roles and sets `manual`.
2. **`topHeightMap`.** Tests on generated Y-up meshes: a flat disc gives one height everywhere inside and NaN outside; a disc with a through hole gives 0 in the hole; the recess base of §8 gives the two heights; a tilted plate gives interpolated heights within a cell's error; a mesh of tiny triangles has no gaps.
3. **`findBasins`, the seat filter, `contactFootprint`, `seatFit`.** Tests: the recess base has one basin of the recess's size and depth, kind `recess`, a seat; the hole base has one basin of kind `hole` with the base's height as depth; a bumpy sheet (`generateBumpySheet`) yields only basins under `RECESS_MIN_AREA_MM2` or sloped ones that fail the seat filter; the contact footprint of `generateFigure(false)` is its two lowest blobs' soles, of a figure with a peg the peg's end; `seatFit` scores the recess above `SEAT_MIN_FIT` for the figure and the hole for the peg, and a generated cobble crevice (a 2 × 8 mm groove, 0.5 mm deep) below it.
4. **The figure's up for a pair** (§12, the two-candidate rule): the print-cut axis when confident (`PRINT_CUT_MIN_MM2 = 1`, `PRINT_CUT_MIN_LEAD = 4`, as issue #90); when the cut names an axis with less area (≥ `PRINT_CUT_WEAK_MM2 = 0.3`) that differs from the detector's, place the figure both ways and keep the one whose contact vertices touch the base better after the drop (`contactTouchShare`: the share of the contact footprint's vertices within 0.3 mm of the base). Tests: a generated figure with a 1 mm² flat cut on its −y side and no base is placed −y up; the same figure with a 0.5 mm² cut and a taller z extent is placed by whichever way touches the recess base better; the flying figures of the corpus are the real check (§12: it turns the countess the right way up without turning the bat the wrong way).
5. **`placeFigure`, `mergeMeshes`, the `place` step.** The two-file read, weld and orient in `run.ts`; `PairResult` in result and stats; `estimatePairBytes`. Tests (`place.test.ts`, `run.test.ts`): the figure's contact centre lands on the recess centre and its lowest point on the recess floor; the peg's tip on the hole's floor when the hole is deeper than the peg, and the feet on the rim when it is shallower; a round peg does not turn; the merged mesh stands on y = 0 with `sizing.base` measured from the base file (32 mm round); `figureVertices` and `figureTriangles` match; the single-file path is bit-identical (the baseline does not move at all at this step); `not-a-pair` and `too-large` for a pair surface as `ConversionProblem`s. Measure the step on the largest corpus pair in Node (§4.6) and record the number with the device.
6. **Options.** `PairingOptions` and `PlacementOptions` through `run.ts`, `protocol.ts`, `handle.ts`, `client.ts`. Tests: `swap` puts the figure on the other file; `moveMm`, `liftMm`, `turnDeg` shift the figure's contact centre, lift and yaw by exactly what was given and set `method: 'manual'`; `handle.test.ts` transfers both buffers and passes the options through.
7. **Regression** (§8): the generator, the case, the figures, the baseline update, `dev.ts`.
8. **Page** (§6): the input, `loadFiles`, the Base section, `page-state.ts` wording with unit tests, the split preview and the move gizmo, the hooks. e2e in a new `e2e/pair.spec.ts`: `loadGeneratedPair()` converts and the placement line reads "Set in the 14 × 10 mm recess" (or the measured size), `state.stats.pair.placement.spot.kind` is `recess`, `sizing.base.diameterMm` is 32; `movePlacement(2, 0)` shows the pending line and converts nothing (`progressLog` unchanged); `applyPlacement()` converts, `method` is `manual` and `offsetMm[0]` moved by 2; `swapPair()` converts with `baseFile` exchanged and a warning; `removeBase()` converts the figure alone and `stats.pair` is null; two files picked at once through `#file` (`setInputFiles` with two generated STLs written to the test's output folder) convert as a pair, three files give the error line. The heading, the section and the pending line as text assertions; `body[data-state]` stays `done` throughout. Screenshots with `verify-3d`: the pair from the side at grid level (the figure seated in the recess), and the section with a pending move.
9. **Corpus** (§7): the convention, the fourteen pairs that are in place, the index field, the report. Run, read the sheets, tune the constants of §4 only if a pair misses in a way one threshold fixes (each change a commit with the table that motivated it); a miss that needs a design change stops (§10). Put the Base files table in the PR, next to the research's placements (§12) for the same pairs.
10. **Docs**: `CLAUDE.md` (layout: `pair.ts`, `place.ts`, the `place` step, the second file in the protocol, the hook list, the corpus convention; conventions: pairs), the spec's story 10 status line, `CONTRIBUTING.md` (the `-base.stl` convention), the journal entry `docs/journal/2026-09-<dd>-base-file.md` (topics `placement` (new: add it to the README's list), `ui`, `regression`, `testing`): the algorithm in words, the three pairs and what the PM saw, every threshold moved and why, the step's time with the device, what did not work.

## 10. When to stop and ask

- **A corpus pair misses in a way no single threshold fixes**: the recess is found but the wrong basin wins, the peg sits on the rim, the sculpted top gets a spot the PM would not choose. Stop with the height map's figures for that pair (basins with size, depth and fit) on the PR; the PM decides between accepting it as a manual case and a design change.
- **The library has no peg-and-hole pair** (§7, §12): the kind is proven on the generated fixture; whether a bought pair is still wanted is the PM's call, asked on the PR.
- **The flattest patch or a seat lands a corpus pair somewhere the eye rejects** (§12 has the sheets of 2026-09-29 as the reference: the built rule was right or plausible on 10 of 15 by eye). Report it with the sheet; do not add a new scoring rule without the PM: the surface match was that attempt, and the pictures dropped it.
- **The figure's up is wrong** on a corpus pair with a base (the detector's guess, §12): the placement cannot be right then. Use the index's `up` in the corpus run (the script may pass it), note the pair under "Needs a human look", and point at issue #90.
- **The baseline moves** on any existing case, at any step. The single-file path must be bit-identical.
- **The place step is over `PLACE_BUDGET_MS`** on the largest pair. Report the numbers; a coarser cell or a vertex stride needs the PM's say.
- **Decisions here the PM may want to change**, flagged in the PR's "Needs a human look" with screenshots, built as proposed meanwhile:
  - The pair converts fully, bake included, before the placement is shown, and every correction converts again, as the up axis and the size do (§6). The alternative is a separate `place` job that returns the two oriented meshes for a preview before merging: faster feedback, one more click on every pair, a fifth page state.
  - A single dropped file starts a new conversion; a base is added through the section's button (§6).
  - `not-a-pair` ends in the error state and drops the mini that was on screen (§4.1). The alternative keeps the figure's mini and shows the refusal as a warning line.
  - Every constant of §4, `BASE_MAX_ASPECT`, `SEAT_MIN_FIT` and `BASIN_WEIGHT` first.
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 11. Out of this note (see also §12)

More than two files, cutting a figure off a printed base, and scaling figure and base separately are out by the issue. A restart of the pipeline from the place step after a correction, instead of a full conversion, stays the follow-up the size and orientation notes named. The table (Phase 2) receives the merged mini and its base diameter as today; whether it wants the split for its own effects is a question for the table's spec. Facing direction (which way the figure looks on its base) is the table's job, as #72 decided for the whole mini; the yaw here only fits a tab into a slot.

## 12. Research: what the PM's library taught (2026-09-28)

Run overnight on the development PC (i7-11700F, Node 20, one thread per run) at the PM's request, between the design pass and the build. Everything is local and git-ignored: `out/research70/scripts/` holds the prototype (`analyze.mjs`: base orientation, height map, rain-flood basins, contact footprint, seat fit, surface match, images; `summarize.mjs`; `flatcut.mjs`; `basescan.mjs`; `inventory.mjs`), `out/research70/<run>/` the per-pair figures as JSON and `img/` the height maps: the base's top with the basins in red and the chosen spots boxed, the figure's underside with its soles bright. No image of a bought mini is committed; the PM looks at them on the development PC.

**Material.** The library index lists 5,616 STLs; 1,328 are figure-plus-base pairs by file name (a base next to its figure, or one base shared by variants), 864 of them with a single figure file. Analysed in detail: the 14 corpus pairs (the figure's up from the corpus index) and a stratified sample of 48 single-figure pairs, one per package; the library-wide table below covers the 864.

**Findings**, each with what it changed in this note:

1. **Hollow undersides** (§1, §4.1). Three of the 14 corpus base files and 6 of the 48 sampled ones were missed by `detectUpAxis`, which stood them on their edge: the underside's faces sit 0.16–1.5 mm above the lowest point (an inner face 1–1.5 mm up inside a rim, or a lip 0.2 mm below the face) and the 2 % band of a 5–13 mm base is 0.1–0.27 mm. A 2 mm absolute band finds 14 of 14 and 47 of 48 (coverage 0.63–0.78 of the footprint). The 48th is exported tilted by 26° about a horizontal axis; its dominant plane holds 34 % of its surface area and orients it. Design: `baseOrientation` with `UNDERSIDE_BAND_MM` and the dominant plane. A note for #44/#72: the same misses happen to any thin plain base dropped alone; whether `RESTING_BAND` should get an absolute minimum is the PM's call, filed with the findings on PR #89.
2. **Tops are terrain** (§1, §4.3). Sampled bases: 25 mm wide (p10–p90: 25–50), 9 mm tall (4–21), aspect 0.34 (0.15–0.62), 88 % measured round. The top's most common height holds a median 20 % of the cells (p10 6 %, p90 47 %); 15 of 48 are plateaus by the `PLATEAU_SHARE` rule. 33 of 48 have no basin of 0.4 mm; the 46 basins found are 0.9 mm deep (0.4–1.8), 4 mm long (2.5–10), 5 mm² (2.3–23), and half of them have a flat floor. No through hole in 62 bases; three basins of kind `hole`. Seats seen: a footprint-shaped recess for one foot in sculpted ground (`large-02` and one sampled pair), an octagonal recess with a raised centre for a wide-skirted figure, a disc recess with a nub that enters the figure's own socket, per-foot recesses on a plain disc. Design: the seat filter; seats propose, the surface match decides.
3. **Soles key into terrain** (§1, §4.4). At the 3 % band a sampled figure's contact footprint is 11 mm long (2.5–23) and 34 mm² (3–275); 19 % have a wide sole or puddle (hull ≥ 30 % of the footprint), 10 % a flat underside of their own by the 2 mm band. The soles are flat cuts at different heights (one foot on the ground, the other on a stone). On the height maps a surface match (the underside as a template) and the fit-or-flattest rule agree within 8 mm on 81 % of the sampled pairs and the match looked better on the seat bases in the height-map images; the 3D renders of 2026-09-29 (below) reversed that verdict on the corpus, and the match was dropped. What stays from this finding: the seat filter by fit (a crevice between cobbles of the right size still fools the fit rule, an accepted risk), and the one-cell clearance in the drop (a foot map is a cell wider and a seat a cell narrower than the meshes, so a 4 × 6 mm foot rests on the rim of its own 4 × 6 mm recess without it). Half the sampled pairs have a margin under 0.05: smooth terrain or a plateau where several spots touch equally and the centre tie-break decides, which is what the "other spots fit as well" wording is for.
4. **The print-cut plane** (issue #90). On the 30 corpus minis the axis with the most coplanar flat area at its extreme is the index's up in 25 of 30, in 21 of 21 when confident (≥ 1 mm² and 4× the runner-up), and 27 of 30 combined with the detector (24 of 30 today). In the sample, 37 of 48 figures have a confident cut and 7 of those disagree with the detector's guess: those seven placements in the detector-oriented run are meaningless, and the corpus runs of the build should pass the index's up until #90 is decided.
5. **Times** (§4.6): height map, flood and basins 50–160 ms on 25–50 mm bases, 350 ms on the 94 mm one; the prototype's surface match 1.0 s (p10) / 2.0 s (median) / 16 s (p90) on the sample, 25 s on the dragon pair.

**The library-wide run** (864 single-figure pairs, the figure oriented by the detector, so the placement columns carry the detector's misses; the base columns do not depend on it):

| Measure                                                                            | Value                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Base found by the 2 % band / by the 2 mm band / by the dominant plane / by neither | 92 % / 99.5 % (860) / 2 / 2 (a ruin and an animal)     |
| Base width p10 / p50 / p90, height p10 / p50 / p90                                 | 25 / 25 / 50 mm, 3.8 / 9.5 / 23 mm                     |
| Round by `measureBase`, aspect ≤ 0.5                                               | 94 %, 76 %                                             |
| Plateau top (mode ≥ 30 % of the cells)                                             | 32 %                                                   |
| No basin ≥ 0.4 mm deep                                                             | 59 %                                                   |
| Has a seat for its figure (fit ≥ 0.5, bbox fill ≥ 0.4)                             | 12 % (101); deep and ≥ 15 mm²: 28                      |
| Has a basin of kind `hole` (≥ 2 mm deep or through) / a through hole               | 10 % (88) / 3 % (23), mostly on terrain pieces         |
| Figure with a flat underside of its own (2 mm band)                                | 7 %                                                    |
| Figure with a wide sole (hull ≥ 30 % of its footprint)                             | 13 %                                                   |
| Figure with a confident print-cut axis; of those, disagreeing with the detector    | 68 %; 117 (20 % of the confident ones)                 |
| Roles by the 2 mm rule: base / `not-a-pair` / warning `figure-has-its-own-base`    | 860 / 3 / 63                                           |
| Surface match time p50 / p90 / max (prototype)                                     | 1.9 s / 12 s / 60 s; height map and basins 0.1 / 0.2 s |

The bases with holes are listed in `out/research70/all/` (`top.basins[].kind`); the deep round ones sit on scenic terrain pieces and a few character bases (3–4 mm holes, 2–4 mm deep), none with a matching peg on the figure's underside that the contact footprint could see.

**The visual test (2026-09-29).** Every corpus pair rendered by the page in real Chrome from three angles, three columns: the page as built (both files dropped), the research placement (surface match, the index's up), and the research placement with the automatic flat-cut up. Sheets in `out/research70/sheets3/` (`sheets3b/` for the dragon, re-rendered upright). Verdicts by eye:

| Pair         | As built                                          | Research (surface match)              | Decides                                              |
| ------------ | ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| flying-01    | perches on the spire, plausible                   | on the ground beside the spire, worse | built rule; the peg goes into the spire's side (#91) |
| flying-02    | refused (rim underside)                           | stands on the base, plausible         | base orientation; PM placed it: see below            |
| flying-04    | upside down                                       | right, with the index's up            | the figure's up (two-candidate rule)                 |
| humanoid-01  | on the rock, right                                | lower, beside the rock                | built rule                                           |
| humanoid-02  | right                                             | right                                 | equal                                                |
| humanoid-03  | on the crate, right                               | right                                 | equal                                                |
| large-01     | on its wing tips beside the base                  | wrong too                             | PM placed it by hand: see below; centre-the-box rule |
| large-02     | foot in the footprint recess, right               | off-centre near the rim, wrong        | built rule                                           |
| large-03     | refused (rim underside)                           | on the base, off-centre but plausible | base orientation                                     |
| mounted-01   | the rider beside the spire (its mount is the bat) | same                                  | a three-piece set, out of scope                      |
| mounted-02   | right                                             | right                                 | equal                                                |
| mounted-03   | on its tail (up axis +z)                          | right, with the index's up            | the figure's up is manual; PM placed it: see below   |
| quadruped-01 | right                                             | right                                 | equal                                                |
| swarm-01     | base standing on its edge                         | base upside down (logo side up)       | a plain disc: see below                              |
| swarm-03     | right                                             | right                                 | equal                                                |

Built rule right or plausible 10 of 15, wrong 3 (two by the figure's up, one with no cut), refused 2 (the base's underside). The surface match is never better on placement and worse on three, so it is dropped (§4.4). Finer cells (0.25 mm): identical placement on the clear pairs (four moved under 0.5 mm), reshuffled by 14–38 mm on the ambiguous ones, at 2–5 times the cost. Soles as patches (each local minimum of the underside scored on its own, the refinement once named for the giant): scores 0.0–0.8 with margins near 0, the giant still not seated; dropped in that form.

**The dragon, placed by the PM** (2026-09-29, in the page, read back from the page's state through the browser: figure up `-y` by the six-way select, then in the Base section moved 43 mm and lowered 44.5 mm from the built spot, not applied). In the base's frame that is the figure's bounding-box centre within 5 mm of the base's centre and its lowest point 2 mm above the table: feet on the top of the spire, wings and tail hanging outside the base. The built rule had put the wing tips' centre on the flattest patch at the base's centre, which shoves the body 40 mm aside and lifts it 47 mm. Tested with the prototype in the same orientation: the figure's box centred on the base and dropped touches the spire top with a point 45 mm above its lowest vertex (a foot) at a lift of 14.9 mm, 13 mm higher than the PM's, who let the claws sink into the rock (0.2 % of the vertices inside the base at lift 2.1). A perch on the highest feature's centre (4.8, 32.6) was 28 mm off. Hence the rule in §4.4: a contact wider than the base means extremities, so centre the box. The PM's orientation (`-y`) differs from the index's `-z` with a 45° turn; both are recorded in the index's notes.

**The beast rider, placed by the PM** (`mounted/mounted-03`, 2026-09-29, read back the same way): up `+y` by the select, Set down (a 3.2° tilt the PM calls a couple of degrees too much: the beast was sculpted standing on a slope, front high, so levelling its lowest points is the wrong correction for it), then moved 29 mm from the flattest patch and raised 5 mm. The built rule had centred the one lowest hoof (a 5 × 6 mm contact) on the flattest 5 × 6 mm window, 29 mm from where the PM put it and near the base's rim; the surface match was 14 mm off; the figure's box centred on the base would be 11 mm off. With the dragon (5 mm) that is two of two for centring the box, and the built rule's own results say why it works: on the nine pairs the sheets called right, the figure's centre ends within 25 % of the base's width of the middle (humanoid-02 4 %, large-02 9 %, quadruped-01 10 %, flying-04 13 %, humanoid-03 14 %, mounted-02 18 %, humanoid-01 23 %, swarm-03 25 %, swarm-01 0 %); on the five called wrong or doubtful it ends 42–129 % away (large-03 42 %, flying-01 44 %, flying-02 44 %, mounted-03 73 %, large-01 129 %). Hence the centre guard of §4.4. Set down on a figure sculpted for sloped terrain is a second, smaller lesson: the pair path should not level the figure by default, and the note's registration branch and the six-way select keep the file's axis exactly.

**The wyvern, placed by the PM** (`flying/flying-02`, 2026-09-29, with a repaired copy of its base whose lip was pressed flat so the built detector accepts it; `out/research70/scripts/repair-base.mjs`): up `+y` by the select (the index had `+z` from the 25th; the PM's choice with the base is `+y`, recorded), then a move of 2 mm. With the right axis the built rule was already right: the flattest patch at the middle of the base for a 31 × 24 mm contact, lift 4.3 mm. No automatic rule finds the axis: the figure has no flat cut (4 mm² on `+x` with a lead of 1.5), and the base match scores `+z` above `+y`. So the wyvern, the dragon's cousin the mounted rider and the countess are the three "up axis" cases of the corpus: one solved by the two-candidate rule (the countess), two left to the six-way select.

**The plain disc** (`swarm-01`, a 50 mm disc with a recessed logo on its underside and a lightly textured top): the 2 mm band finds a flat face on both sides and takes the logo side, so the base comes out upside down; the built rule stands it on its edge. This is the build's question 2 in its purest form. The tie-break to build _(proposal)_: when the two opposite faces are within `UNDERSIDE_TIE = 0.1` of each other in coverage, the underside is the side whose basins (the flood of §4.3 run on that face) cover the larger area, because undersides are hollowed and lettered while tops carry relief; if that ties too, the registration test decides, else the "Turn the base over" button. That swarm also carries its own puddle (`figure-has-its-own-base`), so it needs no base at all.

**The figure's up axis for a pair: the two-candidate rule.** With the base upright, the figure was tried in all six axis directions and matched against the top (the PM's idea): 1 of 15 right by the match alone, 11 of 15 by the flat-cut area alone, so the base cannot pick among six (dead end d). Between **two** candidates it can: when the flat cut names an axis with ≥ 0.3 mm² and a 4× lead but under the 1 mm² of a confident cut, and the detector names another, the one whose placement touches the base better wins. That gives 13 of 15 against 12 for either alone: it turns the countess the right way up (her cut is 0.96 mm², just under confident) without turning the bat the wrong way (a 0.5 mm² cut on the wrong side, which the base then rejects). The two left are the dragon and the mounted rider, with no cut at all: the six-way select. §9 step 4 builds it.

**Dead ends.** (a) The figure and base files are not in one coordinate frame: bases are exported lying on their side for printing, so the raw coordinates carry no placement. (b) The library's "one-piece" files join the figure's parts (wings, weapons), not the figure with its base, so there is no file that shows the intended placement; in the only pair that looked like one, the "contact" the excess map found was the body seen from above. Ground truth is the PM's eye on the images, and after the build the comparison sheets. (c) A recess-first rule without a seat filter picks crevices between cobbles when a foot happens to be their size. (d) **The base cannot orient the figure** (the PM's idea of 2026-09-29, tested on the 15 corpus pairs): with the base upright by its flat side, the figure was tried in all six axis directions and matched against the base's top each time, and the best match was taken as the up axis. The raw match picks the right axis 1 time in 15; touch share alone 5; touch weighted by how tall the figure stands 6; the print-cut area of the side alone 11; the match times the print-cut area also 11, so the base adds nothing to the cut. The reason is in the per-axis figures: the match score is not comparable across orientations. A figure on its back or on its nose touches the terrain with whatever is lowest there, a wing tip, a shoulder, a 1 × 1 mm point at 100 % contact, and a sculpted top has a spot for any small patch. The four the cut misses (the bat, the wyvern, the dragon, the mounted rider) have no flat cut at all (0.00–0.01 % of the footprint): they perch on claws or a spire, and they stay the user's six-way select. The base-first order itself is right and is what §4.1 does; the figure's up comes from the print-cut plane when confident (#90), else the detector, never from the base.

**How this relates to the build's own survey** (PR #89, comments of 2026-09-27, 60 pairs). The two agree where they overlap and each found something the other did not. The build found **registered pairs** (13 of 40 same-way-up pairs stand on their base in the files' own frame) and shallow **foot recesses of 0.3–0.5 mm** (hence `RECESS_MIN_DEPTH_MM` 0.25); this research ran at 0.4 mm and in the files' own axes, so its "59 % have no basin" is "at 0.4 mm" and its dead end (a) is superseded by the build's registration test, which turns both files by the base's up first. This research found the **hollow undersides' cause and cure** (the 2 mm band, 860 of 864, rather than lowering the coverage to 8 %, which the build proposed and which still leaves the rim at 1 % on `flying-02`), the **tilted exports**, the **print-cut plane** (which orients `flying-04`'s figure the right way up without the registration test), and that seats are the minority and **soles key into terrain** (the surface match). Build question 2's upside-down bases (a flat top over a hollow underside, about 10 of 60): under the 2 mm band the underside and a plain flat top come out close (0.76 against up to 0.7), so registration decides when it applies, and otherwise the side whose 2 mm coverage is larger; a "Turn the base over" button is the honest fallback and worth its two lines. Build question 3: in this library the "flat recess" kind is the shallow foot recess (`humanoid-01`, `humanoid-02` by the build's reading), the "sculpted top" kind is most of the corpus, and peg-and-hole stays on the fixtures unless the PM brings a pair.

**What this revision asks of the built code** (for `/continue-pr` once the PM has decided; the built code follows the note of 2026-09-27 and the build's own deviations listed on the PR):

1. `baseOrientation` in pair.ts: the 2 mm underside band, the dominant plane, and the plain-disc tie-break (§4.1, §12) in place of `detectPairFile`'s coverage rule; the refusal then only when neither file has an underside by that test.
2. The registration test as the first branch of the placement (§4.4), if the PM says yes.
3. The figure's up for a pair by the two-candidate rule (§9 step 4), until #90 changes the single-file detection.
4. Seats by fit and compactness, no flat-floor test (§4.3); `RECESS_MIN_DEPTH_MM` stays 0.25; the one-cell clearance stays; the centre guard of §4.4 (a figure's box centre more than 30 % of the base's width from the middle is centred instead; a contact wider than 80 % of the base is caught before the search).
5. `SpotKind` gains `registered`; the placement line says "Set where the files put it".
6. The corpus report writes the pairs' sheets the way `out/research70/scripts/sheets.mjs` does (three views, one column per run), because the sheets decided everything above; the fourteen pairs are in `corpus/`, and `mounted-01` is noted as a three-piece set.

**For the PM to look at** (`out/research70/`): `corpus4/img/*--base-top.png` and `*--figure-bottom.png` for the fourteen corpus pairs (green box: seat or flat spot; cyan: the soles at that spot; orange: the surface match's position), `sample48c/img/` for the 48 sampled pairs with the confident print-cut orientation. The decisions this research asks for are in §10 and on the PR.
