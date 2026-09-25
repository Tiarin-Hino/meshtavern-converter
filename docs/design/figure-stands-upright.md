# Design: figure stands upright (#72)

Status: design pass by Fable 5.1, 2026-09-25, for Opus 5.5 to build · Spec: Phase 1, story 11 · Issue: #72

This note fixes the decisions the build should not have to make: what the result carries, the module boundaries, the one pass over the triangles, the heuristic that finds a baseless creature's stance with its thresholds and weights, the levelling, the manual correction, the corpus index and the build order. Product behaviour comes from the issue and the spec; where this note picks a number, it is a named constant marked _(proposal)_ and the PM can change it. The weights of the score are guesses from paper estimates on typical shapes (§4.5) and are meant to be tuned on the corpus; the tuning method and the stop rule are part of the design. Whoever builds this changes the code, not this note, unless a decision here turns out wrong on a real mini; then stop and ask (§8).

Corpus minis are named by their generic index names (`quadruped/quadruped-02`), never by their product names, here and in everything the build writes.

## 1. What the problem looks like

The base detector (`detectUpAxis`, `src/pipeline/orient.ts`) finds a flat underside on 13 of the 30 corpus minis. The other 17 fall back to "the taller of Y-up and Z-up". That is right for 10 of them (standing humanoids and giants) and wrong for seven: `quadruped/quadruped-02` (a hound, 26 × 72 × 47 mm after conversion: its length was taken as height), `quadruped/quadruped-03` (a cat, 7 × 25 × 16), `mounted/mounted-03` (rider on a horse, 39 × 72 × 60), `large-creature/large-01` (the largest dragon, 5.6 M triangles, 281 MB), `swarm/swarm-02` (a mound of small creatures, 64 × 64 × 63, on its edge), `flying/flying-02` and `flying/flying-04` (two flyers). Some are tilted in the file, not turned by a quarter.

Two facts shape the design:

- **A print file without a base is not in any convention.** It is stored the way it was sculpted or the way it was arranged for printing, and a sculpt made for a separate base file has its feet in a plane but that plane can lie anywhere. So the candidates for "up" are all directions, not six axes, and the answer has two parts: a direction and a levelling.
- **Physics alone picks the wrong stance.** A rigid body rests where its centre of mass is lowest, and that is lying on its side for every creature. The signs in the issue (a wide, level cluster of lowest points; more volume above the middle than below) encode the fact that sculptors pose creatures standing. The heuristic therefore rests on physics for what is possible (a stance must be stable, the resting plane touches the lowest points) and on the pose prior for which possible stance to take.

## 2. What the result carries

```ts
// src/pipeline/rotation.ts
/** A unit quaternion, x y z w, the glTF order. */
export type Rotation = [number, number, number, number];

// src/pipeline/orient.ts
export type UpAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'; // unchanged

export interface Orientation {
  /** The six-way direction taken as up in the file: the coarse step, the nearest axis of `rotation`. */
  up: UpAxis;
  /** `base`: a flat underside decided. `feet`: the stance score decided (§4). `manual`: the user's choice. */
  method: 'base' | 'feet' | 'manual';
  /** base: coverage of the footprint, as today. feet: the score's lead over the runner-up, 0–1 (§4.6). manual: 1. */
  confidence: number;
  /** File coordinates → scene coordinates (Y-up), before the shift to the base centre and before any scale. */
  rotation: Rotation;
  /** Angle between the final up direction and the axis `up`: how far the mini was turned beyond a quarter turn. 0 when it rested flat, or stands on a base. */
  tiltDeg: number;
  /** The angle by which "setting down" turned the mini (§5). 0 when it was not set down, or already rested level. */
  setDownDeg: number;
  /** feet only: the best three stances with their features, for the corpus report and for tuning. */
  candidates?: StanceCandidate[];
}
```

- `ConversionResult.orientation: Orientation` and `ConversionStats.orientation: Orientation`.
- `ConversionStats.up` and `upMethod` stay (the corpus script, the regression figures and the page read them) and mirror `orientation.up` and `orientation.method`. The value `'tallest'` disappears everywhere: `'feet'` replaces it. `UpDetection.method` loses `'tallest'`.
- GLB `extras.meshtavern` gains `rotation` (the four numbers) so the table can reproduce the orientation and the library API (#50) can hand it back as a choice.
- The regression figures (`CaseFigures` in `src/regression/measure.ts`) gain `tiltDeg`, with a `RELATIVE_TOLERANCE` of 0.01 in `compare.ts`.

## 3. Options: how a correction reaches the pipeline

`PipelineOptions.forcedUp` and `ConvertOptions.up` are replaced by one object, like `sizing`:

```ts
export interface OrientationOptions {
  /** The coarse step: which file axis is up. Overrides the detection. */
  up?: UpAxis;
  /** A full rotation, file → scene, from the page's free turn. Overrides `up`. */
  rotation?: Rotation;
  /**
   * Set the mini down on its lowest points after the turn (§5). Default true. False keeps
   * exactly the rotation given; the page never sends false, tests and the library may.
   */
  setDown?: boolean;
}
```

How the paths combine (`resolveOrientation` in `orient.ts`, called by the `orient` step):

| Options    | What happens                                                                                                                                                              | `method`        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| none       | The one pass (§4.1). Base found on an axis → that axis, no levelling. Otherwise the stance score (§4) picks a direction, then set down on all vertices (§5).              | `base` / `feet` |
| `up`       | That axis. If the pass found a base on it (coverage ≥ `MIN_BASE_COVERAGE`), no levelling. Otherwise set down.                                                             | `manual`        |
| `rotation` | That rotation, then set down (unless `setDown: false`). No base can be read off a tilted rotation; `base` is null unless the set-down snaps to an axis (§5) that has one. | `manual`        |

The set-down after a manual axis choice is a turn the user did not ask for. It is not silent: the figures row shows `manual, set down 4°`. It is a design choice the PM can veto (§8).

The page keeps `window.__mt.setUp(axis)` and adds `turn(axis: 'pitch' | 'roll', deg)` (a preview, no conversion), `setDown()` (converts with the previewed rotation) and `resetTurn()`; `state.orientation` holds the pending preview and the last result. `choices` gains `orientation: OrientationOptions`.

## 4. Detection

### 4.1 One pass over the triangles

`detectUpAxis(mesh)` keeps its name and its loop, and that loop becomes the only pass over the triangles in the orient and size steps. It collects, in one tight loop without per-triangle allocations and without `Math.hypot` (use `Math.sqrt` of the sum of squares: `hypot` is slow and its last digit differs between engines):

- the bounding box (as today);
- the resting area per candidate axis (as today), returned as `coverageByAxis: number[]` indexed like `UP_AXES`;
- the volume and the volume centroid by the divergence theorem (signed tetrahedra from the bounding-box centre, which keeps the terms small), plus the area-weighted surface centroid as the fallback when the volume comes out zero, negative or not finite (an open or inside-out shell).

```ts
export interface UpDetection {
  orientation: Orientation;
  /** Resting-area coverage per candidate axis, indexed like UP_AXES: what a forced axis reads its base from. */
  coverageByAxis: number[];
  /** What the stance score needs, kept for the manual path so nothing is recomputed. */
  scan: MeshScan;
}
export interface MeshScan {
  min: Vec3;
  max: Vec3;
  /** Volume centroid, or the surface centroid when the volume is unusable. */
  centroid: Vec3;
  volume: number;
}
```

`measureBase(mesh, coverage)` in `base.ts` loses its triangle loop: it takes the coverage of the axis the mesh now stands on and only collects the floor outline (the vertex pass within `RESTING_BAND` of y = 0), returning null below `MIN_BASE_COVERAGE`. `orientAndPlace(mesh, orientation, coverage)` passes it through. The rotations that are pure quarter turns keep every coordinate exactly (sign flips and swaps), so the coverage computed before the turn is the coverage after it. Story 10 (#70) will call `detectUpAxis` on the base file anyway and gets its coverage from there.

Expected effect on the largest corpus file: the orient step drops by about the second pass (1.95 s today, 0.94 s before PR #74). The detection's own time is measured in build step 2 (§7).

### 4.2 Candidates: set the mini down from many sides

When no axis reaches `MIN_BASE_COVERAGE`, `findStance(mesh, scan)` in a new module `src/pipeline/stance.ts` scores stances. A stance is a plane the mini can rest on, which is always a facet of its convex hull. Rather than building a 3D hull, the design generates candidate facets by setting the mini down from many directions:

1. **Sample.** Every k-th vertex, k = ⌈vertices / `SAMPLE_VERTICES`⌉, `SAMPLE_VERTICES = 20_000` _(proposal)_. Deterministic, no random numbers. A sculpt's vertices are spread evenly over its surface, so a stride sample is a fair thinning; a paw or a wing tip with thousands of vertices keeps tens of them.
2. **Directions.** The cube-sphere: the six faces of a cube divided into `CANDIDATE_CELLS × CANDIDATE_CELLS` cells, `CANDIDATE_CELLS = 6` _(proposal)_, each cell centre normalised onto the sphere: 216 directions about 14° apart, using only + − × ÷ and sqrt (the same trick as `addBlob` in `src/regression/shapes.ts`), so the candidate set has the same bits on every machine.
3. **Resting facet per direction** (`restingFacet(points, down)`, the gift-wrapping of one hull facet): p0 is the lowest sample point along `down`; p1 the point that tilts the plane through p0 the least (the smallest angle between the horizontal through p0 and the segment p0–p1, with all points above p0 by construction); p2 the point that tilts the plane containing the edge p0–p1 the least. The plane through p0, p1, p2 is the hull facet adjacent to p0 whose normal is closest to `down`: the plane the mini lands on when it is dropped from that direction and does not roll further. Ties within `SLOPE_EPS = 1e-3` radians _(proposal)_ go to the farthest point, so a flat foot pad yields a long, well-conditioned edge instead of a neighbour a few microns away. The facet's normal, oriented towards the mesh, is the candidate up direction.
4. **Merge.** Directions whose facet normals lie within `MERGE_ANGLE_DEG = 2` _(proposal)_ of each other are the same stance; keep one. 216 directions collapse to a few dozen stances.

Cost: 216 directions × three passes over 20,000 points, about 13 M slope evaluations, tens of milliseconds on the development PC.

### 4.3 Features per stance

For each stance with up direction n, on the sample (heights h = p · n; hmin, hmax; height = hmax − hmin; a fixed 2D basis u, v in the plane, built from n and the axis least aligned with it):

- **Resting set** R: sample points with h − hmin ≤ `SUPPORT_BAND × height`, `SUPPORT_BAND = 0.05` _(proposal; the paws of a sculpt lie within a couple of millimetres of a plane, and the facet plane touches only the lowest three)_.
- **`support`** (sign 1, "a wide, level cluster rather than a line or a point"): area of the convex hull of R in (u, v), divided by the bounding-rectangle area of all sample points in (u, v). Four paws cover most of the footprint; a mini on its edge or on its nose covers almost none. `convexHullArea` in `base.ts` already computes the hull; extend it to return the polygon (`convexHull`) so the margin below can use it.
- **`margin`** (stability, the physical gate): the centroid from the scan projected into (u, v); its inward distance from the support polygon's boundary, negative outside. Then **`tipping`** = clamp(margin / (c · n − hmin), 0, 1): the tangent of the angle the mini can be tilted before it falls. A stance with margin ≤ 0 cannot rest at all (a hound on its nose, a figure on one toe) and is dropped, unless every stance is dropped, in which case all are kept and `confidence` is 0.
- **`aboveMiddle`** (sign 2): (c · n − (hmin + hmax) / 2) / height, in −0.5…0.5. Positive when bodies and heads sit over legs.
- **`heightShare`**: height / the longest side of the bounding box from the scan, clamped to 1. Creatures are posed standing, not lying; on its own this was the old "tallest" rule and wrong for long, low creatures, so it carries a small weight.
- **`convention`** (the tie-break): `CONVENTION_BONUS = 0.05` _(proposal)_ when n lies within `CONVENTION_CONE_DEG = 15` _(proposal)_ of the file's +z, half of it for +y.

```ts
export interface StanceCandidate {
  /** Up direction in file coordinates. */
  up: Vec3;
  support: number;
  tipping: number;
  aboveMiddle: number;
  heightShare: number;
  convention: number;
  score: number;
}
```

### 4.4 Score

```
score = support
      + ABOVE_MIDDLE_WEIGHT × aboveMiddle     // 2   (proposal)
      + STABILITY_WEIGHT    × tipping         // 0.2 (proposal)
      + HEIGHT_WEIGHT       × heightShare     // 0.1 (proposal)
      + convention
```

The best stance by score is the direction. Sign 1 carries the mounds and swarms (whose volume sits low, against sign 2), sign 2 carries the creatures on legs against lying on their side or back (whose support is as wide), stability keeps rounded shapes from standing on a tip, height is a weak nudge and the convention only breaks ties.

### 4.5 Why these weights, and how to tune them

Paper estimates of the features for the stances that compete on the corpus (the build replaces them with measured ones):

| Shape and stance                 | support | aboveMiddle | tipping | heightShare | score |
| -------------------------------- | ------- | ----------- | ------- | ----------- | ----- |
| Humanoid on its feet             | 0.10    | +0.12       | 0.2     | 1.0         | 0.48  |
| Humanoid on its back             | 0.37    | −0.08       | 0.9     | 0.46        | 0.44  |
| Hound on four paws               | 0.40    | +0.10       | 0.6     | 0.55        | 0.78  |
| Hound on its side                | 0.35    | 0           | 0.7     | 0.27        | 0.52  |
| Hound on its back                | 0.05    | −0.10       | 0.2     | 0.55        | −0.05 |
| Mound (a swarm) on its underside | 0.60    | −0.10       | 0.8     | 1.0         | 0.66  |
| Mound on its edge                | 0.10    | 0           | 0.3     | 1.0         | 0.26  |
| Ellipsoid (the boulder) flat     | 0.15    | 0           | 0.67    | 0.45        | 0.33  |
| Ellipsoid on its tip             | 0.16    | 0           | 0.20    | 1.0         | 0.30  |

The humanoid on its back and the boulder on its tip are the two close calls, and they bound the weights from opposite sides: the humanoid needs `STABILITY_WEIGHT` below about 0.25 and the boulder needs it above about 0.15. That such a window exists on paper is the reason to build this and not a learned model; whether it exists on the corpus is what build step 7 finds out.

Tuning method: the corpus report (§6) prints for every mini the chosen stance and the two runners-up with all features. Read the table, move a weight, run again (`npm run corpus -- --no-bake` converts the corpus in a few minutes). Every weight change is a commit with the table that motivated it in the message, and the final table goes into the journal. If no single set of weights puts all 30 corpus minis and the generated shapes upright, stop (§8).

### 4.6 Confidence

`confidence = clamp((best.score − runnerUp.score) / CONFIDENCE_GAP, 0, 1)`, `CONFIDENCE_GAP = 0.25` _(proposal)_. A lonely stance has confidence 1. The figures row shows it as today's coverage is shown: `+z (feet, 0.7, tilted 12°)`.

### 4.7 Budget

The issue proposes 200 ms on the development PC for the largest corpus file (5.6 M triangles, 2.8 M vertices). Expected: the one pass 150–300 ms (it is today's loop, tightened), the stance search under 100 ms, the set-down on all vertices (§5) 30–60 ms. The pass is the uncertain part; measure it in build step 2 before any of the new code exists. If the total is above 200 ms, do not sample triangles in the pass on your own: report the number (§8). A triangle stride (`DETECTION_STRIDE`) would make coverage an estimate and could flip a marginal base, so it needs the PM's say.

## 5. Setting down

`setDown(positions, down)` levels a mini on its lowest points: the resting facet of §4.2 step 3 computed on **all** vertices, starting from the direction the stance score (or the user) chose, and its normal becomes the final up. One pass to find p0, one for p1, one for p2; deterministic; no `Math.hypot`, `acos` or `atan2` in anything that feeds a coordinate (`tiltDeg` and `setDownDeg` may use `acos`, they are reported, not applied).

Rules:

- **Not moved when it already rests flat.** If the final up lies within `LEVEL_TOLERANCE_DEG = 2` (the issue's number) of the coarse axis, snap to the axis: `tiltDeg` 0, and the rotation applied is the exact quarter turn of today's `TO_Y_UP` table, so a flat-resting mini gets the same bits as before this story. The regression baseline depends on this.
- **The rotation is the quarter turn followed by the smallest turn that levels.** `rotation = fromTo(R_up(n), +y) · R_up`, where `R_up` is the quaternion of `TO_Y_UP[up]` and `fromTo(a, b)` is the minimal rotation taking a to b (`[cross(a, b), 1 + a · b]` normalised). This fixes the yaw: the mini faces the way the six-way convention would have it; facing is the table's job.
- **A base is never levelled.** The base path skips set-down, and a forced axis with a base on it too.
- **Manual rotation.** Set-down works in file space: `down = rotation⁻¹(−y)`, so the mesh is rotated once, by the final rotation, not twice.
- **Rotating the vertices.** Quarter turns use `TO_Y_UP` (exact). Anything else uses the 3 × 3 matrix of the quaternion, 9 multiplications and 6 additions per vertex; on 2.8 M vertices about 20 ms.

`stance.ts` exports `restingFacet` and `restingPoints(positions, up, band)`: story 10 (#70) finds the feet with them before matching them to a recess.

## 6. Corpus index, regression shapes, report

- **`scripts/corpus-index.json`** gains `"up": "+z"` per mini, the expected six-way direction. For the 23 minis upright today it is today's value from `results.json`. For the seven, the build fills in what the new detection gives and the PM confirms on the comparison sheets: the levelling cannot be indexed, so the sheet is the check. Unknown fields stay untouched, as before.
- **`npm run corpus`** writes an "Orientation" section into `results.md`: matches and mismatches against the index (up, method, confidence, `tiltDeg`, `setDownDeg`), and for every `feet` mini the three candidates with their features (`stats.orientation.candidates`), so the tuning of §4.5 reads off one table. `results.json` keeps `orientation` per mini. The comparison sheet's heading shows the tilt.
- **`src/regression/shapes.ts`** gains `generateQuadruped()` (a long, low body blob, four leg blobs, a head blob; Z-up; no base; about 35 mm long, 18 mm tall) and `generateTiltedFigure()` (`generateFigure(false)` turned about the file's x axis by the 3-4-5 rotation, cos 0.8 and sin 0.6, so it stays bit-identical across machines). `REGRESSION_CASES` gains `quadruped` and `figure-tilted`, and every case gets `up: UpAxis` and, for the tilted one, `tiltDeg` expected within 1° (the tilt after levelling should be near 0: the figure stands on the rounded bottom of its body blob, so it will not be exactly 0). `baseline.test.ts` checks `up` per case in addition to the figures. The three cases that are `tallest` today change `upMethod` to `feet`: `figure-no-base` (which must keep `+z` and its figures), `boulder` (its orientation changes on purpose: it lies flat, 40 × 28 × 18 mm, instead of standing on its 28 mm side, and its figures move with it) and `sheet` (the bumpy sheet has no flat underside, so today it stands on its edge, `+y`; its lowest bumps form a wide cluster and it will lie flat, `+z`, with its figures moving too). `npm run baseline:update` and the explanation in the PR. The page's `loadGenerated` hook converts the same sheet, so e2e assertions on its dimensions or up axis change with it; that is expected, not a stop. If `figure-no-base`'s `up` or figures change, stop (§8).

## 7. Build order

Each step is a commit with its tests; `npm run check` green after each.

1. **`rotation.ts`**: `Rotation`, `fromTo`, `multiply`, `toMatrix`, `apply`, `nearestUpAxis`, `angleDeg`, the six quaternions `AXIS_ROTATION[up]` that match `TO_Y_UP`. Tests: each `AXIS_ROTATION` moves sample points exactly as `TO_Y_UP` does; `fromTo` on perpendicular and on nearly parallel vectors; determinant +1 (no mirroring); `nearestUpAxis` of each quarter turn and of a 10° tilt.
2. **The one pass.** `detectUpAxis` collects `coverageByAxis`, volume and centroid; `measureBase(mesh, coverage)` loses its loop; `orientAndPlace` passes the coverage. Tests: `base.test.ts` unchanged in what it proves, called with the coverage; centroid of a generated disc and of `generateFigure(true)` where expected; the surface-centroid fallback on an open sheet. The baseline must not move at all (bit-identical). Measure before and after on the development PC: the orient step of `large-creature/large-01` and the detection alone (`performance.now()` around `detectUpAxis` in a Node script over the STL, or the step timing of `npm run corpus -- --no-bake`). Record both numbers.
3. **`stance.ts`: the facet and the features.** `sampleVertices`, `candidateDirections`, `restingFacet`, `restingPoints`, `convexHull` (from `convexHullArea`), `polygonMargin`, `stanceFeatures`. Tests on point sets: a level tripod plus noise above is found level; a tripod tilted 10° gives the tilt; the farthest tie wins on a flat pad; margin positive inside, negative outside; support of four corners is the whole square.
4. **`findStance` and the wiring.** Scoring, merging, the gate, confidence; `detectUpAxis` returns `feet` with the direction; `setDown` on all vertices; snapping; `orientAndPlace` with a general rotation; `Orientation` in result and stats; `'tallest'` gone. Tests (`orient.test.ts`, the criterion's list): a standing figure, a long low quadruped, a flat plate (a thin box: the base path, never levelled), a figure tilted by 10° and by 30° (with `Math.sin`/`cos` in the test; the tolerance covers it), each in Y-up and Z-up, each found and levelled within `LEVEL_TOLERANCE_DEG`; a flat-resting baseless figure has bit-identical positions to today's path; a mini on a base is never levelled; the ellipsoid lies flat; an empty mesh. `run.test.ts`: `stats.orientation`, `upMethod` `feet`; a plain base goes under a levelled figure at y = 0. Baseline update as §6 says.
5. **Options.** `OrientationOptions` through `run.ts`, `protocol.ts`, `handle.ts`, `client.ts`, `main.ts`, `corpus.mjs`; the forced-axis and rotation paths of §3 with set-down. Tests: forced axis on a based mini is not levelled, on a baseless one is; a 30° manual rotation with set-down comes back level and reports `setDownDeg` ≈ 30; `setDown: false` keeps the rotation; `handle.test.ts` passes the options through.
6. **Regression shapes** (§6): the two generators, cases with expected `up`, `tiltDeg` in the figures, the baseline check on `up`. Baseline update.
7. **Corpus.** The index's `up` field, the report section, `orientation` in `results.json`. Run `npm run corpus -- --no-bake`, tune the weights as §4.5 says, then one full baked run at the end. Put the orientation table (all 30: up, method, confidence, tilt; for the seven the candidate rows) in the PR and the journal. Time the detection on `large-01` again. Stop rule §8.
8. **Page.** Figures row `Up`: `+z (feet, 0.7, tilted 12°)` / `+y (base, 0.42)` / `+z (manual, set down 4°)`. In the plain form beside the up select: four buttons `Pitch −15°`, `Pitch +15°`, `Roll −15°`, `Roll +15°` (`TURN_STEP_DEG = 15`, the issue's proposal), a checkbox `Turn by hand` that shows a rotate gizmo in the viewer (three.js `TransformControls` in rotate mode with the yaw ring hidden; disable `OrbitControls` while it drags, its `dragging-changed` event does that), a line `Turned 30°, not set down yet`, and buttons `Set down` and `Reset`. Turning rotates the shown object in the viewer only; nothing converts until `Set down`, and the six-way select converts as today. Hooks `turn`, `setDown`, `resetTurn`, `state.orientation`. e2e: the demo turned by 30° shows the pending line and no conversion; `setDown()` converts, `upMethod` is `manual`, `setDownDeg` ≈ 30, the mini is level again; the figures row text. Screenshots with `verify-3d`: a levelled generated quadruped from the side, and the form with a pending turn. #41 restyles this; do not design it.
9. **GLB extras** `rotation`; `glb.test.ts` reads it back; the validator still passes.
10. **Docs**: `CLAUDE.md` (layout: `rotation.ts`, `stance.ts`, the one pass; conventions: the up axis paragraph; the hook list), spec story 11 status line, the journal entry `docs/journal/<date>-figure-stands-upright.md` (numbers with the device: the detection and the orient step on `large-01` before and after, the corpus table, every weight change and why, the flyers if they rest on wing tips).

## 8. When to stop and ask

- **No weights put all 30 corpus minis and the generated shapes upright.** Stop with the feature table of the offenders on the PR. The PM decides: accept those as manual cases, change a sign, or file the learned model as the follow-up the issue names.
- **The detection is over 200 ms on `large-01`** after the tight pass. Report the measured numbers; a triangle stride needs the PM's say.
- **The baseline moves** on a case other than `sheet`, `boulder`, `figure-no-base` and the two new ones, or `figure-no-base` changes its `up` or its figures by more than the levelling explains.
- **A levelled corpus mini looks wrong on the sheet.** A flyer whose wing tips hang below its feet will be set down on the wing tips; that is what the issue asks for, and whether it stands right is the PM's judgement. List every such mini in "Needs a human look".
- **A decision here the PM may want to change**, flagged in the PR: set-down after the six-way select (§3); the boulder lying flat as the expected regression orientation (§6); the weights (§4.4).
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 9. Out of this note

`NO_BASE_SIZE` (a baseless mini is suggested Medium, PM decision on PR #74) is to be revisited after this story, not in it. A restart of the pipeline from the orient step after a correction, instead of a full conversion, is a follow-up like the size step's. The recess matching of #70 builds on `restingPoints`.

## 10. PM decisions

On PR #79, 2026-09-25, after the build stopped on §8 (evidence in the PR's comments):

1. **Detection is a help, not an acceptance criterion.** The user's placement is final. A mini without a base keeps the guess (the taller of Y-up and Z-up), shown as such. Standing baseless minis up by detection leaves Phase 1's acceptance.
2. **The detection budget scales with the mesh** instead of a fixed 200 ms on the largest file.
3. **Setting down happens only on request.** The six-way select and the free turn's Apply keep exactly what the user chose (`OrientationOptions.setDown` defaults to false); the page's Set down button asks for it.
