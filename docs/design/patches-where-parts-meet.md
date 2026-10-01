# Design: patches where the parts meet (#93, the rework)

Status: design pass by Fable 5.1, 2026-10-01, for Opus 5.5 to build on the branch of PR #95 · Issue: #93 · Replaces the marking of `docs/design/marks-where-parts-meet.md` (the note PR #95 was built to); everything that note says about several files, roles, the `assemble` step, `shown` and the worker deciding every transform stays.

The PM tried what PR #95 built and asked for the marking to be rethought (2026-10-01, [PR #95 comment](https://github.com/Tiarin-Hino/meshtavern-converter/pull/95#issuecomment-5922310339), §15). This note fixes what the build should not have to decide: what a mark is now, how the converter proposes marks without placing anything, how confirmed marks become a placement, what the page shows at each stop, what is recorded, the build order with the test that proves each step, and where to stop and ask. Numbers and wordings marked _(proposal)_ are named constants or `COPY` strings the PM can change. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§13).

Corpus minis are named by their generic index names. Library minis are not named.

## 1. What changes, in one paragraph

A mark is no longer a pin. It is a **patch**: an area of a part's surface. Two patches that touch are a **pair**, drawn in one colour on both parts; a connection may have several pairs (two feet, a peg and a tail). The converter **proposes** pairs first and shows them on the parts **apart, not put together**. The person confirms the proposal or marks their own. Only then does the converter **fit**: it finds the position that brings the paired patches onto each other, puts the parts together, and shows the result as a **final view**. The person confirms that view (or goes back to the marks), and the mini is reduced and baked.

```
files → which way is up (#92, unchanged)
      → PAIRS    parts apart, proposed pairs in colour     Confirm · or mark your own
      → FIT      the worker places by the pairs            (no stop)
      → FINAL    parts together                            Confirm · Raise/Lower/Turn · Back to marking
      → reduce → bake
```

The same two stops serve a figure's parts (in the `assemble` step) and the figure on its base (in the `place` step).

## 2. What the prototype found

A prototype (`out/research95/fit-proto.mjs`, git-ignored, development PC: i7-11700F, 64 GB, Node 20, 2026-10-01) ran on the 15 corpus pairs and on four joints of three library kits. It took each pair's automatic placement, found where figure and base touch, and then tried to put the figure back from those patches alone.

- **Where two parts touch can be found, fast.** Triangles of one part whose vertices lie within 0.5 mm of the other, in connected pieces, with the other part's triangles within 0.5 mm of each piece. 12 of 15 pairs have such contact at 0.5 mm, the other three at 1 or 2 mm. One to four pieces per pair (feet, a puddle, a tail), 1 to 900 mm². With a search tree: 50–370 ms per pair for figures up to 1.2 M triangles. This is the proposal (§5.3).
- **Moving the centres of the patches onto each other, without turning the figure, puts it back within 0.1–0.4 mm.** That is how far the patch centres of the two sides are apart in the true placement.
- **Turning is where it goes wrong.** Letting the patches also decide the tilt (their normals, or an ICP between them) leaves the figure 0.2–7 mm off at the far corner of its box, even after an ICP between the patches: a 2–15 mm² sole cannot fix the tilt of a 40 mm figure. The same ICP made a fit that only moves and turns about the vertical worse on 7 of 12 pairs. The fit therefore changes as little as it can (§5.4), and there is no ICP.
- **A tap that grows without a limit is unpredictable.** Growing from a tapped triangle across everything that faces the same way covered 3–65 % of the real contact and often ran past it: the centre of what grew was up to 5 mm from the centre of the contact. A tap therefore marks the surface **near** it (§5.2); the brush and more taps make it larger.
- **Two of three library kits "in place" do not touch.** Their wings sit 6–7 mm from the body where the files put them. They get no proposed pairs and stay where their files put them, as before.
- A search tree over 1.17 M triangles builds in 335 ms; over 54 k–490 k in 9–183 ms.

## 3. Data shapes

### 3.1 Strokes, patches, pairs (`src/lib/pipeline/marks.ts`, rewritten)

```ts
/** One thing a person did on a part's surface, in that file's coordinates. */
export type Stroke =
  /** A tap: the surface around this point that faces the same way (§5.2). */
  | { tap: Vec3 }
  /** A dab of the brush: every triangle within the radius that faces the way the surface does at the point. */
  | { brush: Vec3; radiusMm: number }
  /** A dab of the eraser: every triangle of the patch within the radius. */
  | { erase: Vec3; radiusMm: number };

/** A patch as the person made it: what is recorded. */
export interface PatchPick {
  file: number;
  strokes: Stroke[];
}

/** A patch as resolved on its file's welded mesh. */
export interface Patch {
  file: number;
  /** Triangle indices into the welded mesh, ascending. */
  triangles: Uint32Array;
  areaMm2: number;
  /** Area-weighted centre and mean normal, file coordinates. */
  centre: Vec3;
  normal: Vec3;
  /** |Σ area × normal| / Σ area: 1 for a flat patch, towards 0 for one that wraps around. */
  flatness: number;
}

/** Two patches that touch: `on` the part in place (the base, the body), `of` the part that goes there. */
export interface PatchPair {
  on: PatchPick;
  of: PatchPick;
}

/** Where two parts meet: their pairs, and what the person adjusted at the final view. */
export interface Meeting {
  pairs: PatchPair[];
  /** Along the mean normal of the `on` patches, positive away from the surface. */
  liftMm?: number;
  /** About that normal through the centre of the `on` patches, degrees. */
  turnDeg?: number;
  /** `keep`: the part is never turned. `free`: it is turned to fit. Left out: the least change that fits (§5.4). */
  turn?: 'keep' | 'free';
}

/** A part placed against another: every pair's `on.file` is `onto`, every `of.file` is `part`. */
export interface PartJoint extends Meeting {
  part: number;
  onto: number;
}
```

- **Strokes are recorded, not triangles.** Points in file coordinates survive a re-weld and a repaired copy of a file, as the picks of the first build did. The worker resolves them in order; the same strokes give the same triangles on every machine.
- **For the figure on its base** every `on.file` is the base file; an `of.file` may be any of the figure's parts.
- `MarkPick`, `Mark`, `resolveMark`, `nearestTriangle` and `meetingRotation` go (§10). No record holds them: `scripts/corpus-placements.json` has no marks yet.
- At most `MAX_PAIRS = 4` pairs per meeting and `MAX_STROKES = 400` strokes per patch _(proposals)_; more is ignored and the question says so (`note`).

### 3.2 Options and results

`PlacementOptions.marks?: Meeting` and `PartsOptions.joints: PartJoint[]` keep their names and places; only what a `Meeting` holds changes. `UpChoices` is unchanged in shape.

```ts
/** A resolved patch without its triangles, in the frame stated where it is used. */
export interface PatchSummary { file: number; areaMm2: number; centre: Vec3; normal: Vec3; flatness: number }

/** How a meeting was fitted (§5.4). */
export interface Fit {
  /** `standing`: moved only. `upright`: also turned about the base's up. `free`: turned to fit. */
  kept: 'standing' | 'upright' | 'free';
  /** How far the paired centres are apart after the fit, weighted rms. */
  centreRmsMm: number;
  /** The largest angle by which a pair's normals fail to oppose each other. */
  normalsDeg: number;
}

// place.ts: Placement.marks for method 'marked'
marks?: {
  /** The pairs as they ended, base frame. */
  pairs: { on: PatchSummary; of: PatchSummary }[];
  rotation: Rotation;      // the figure's standing frame to the base's frame
  liftMm: number;
  turnDeg: number;
  fit: Fit;
};

// assemble.ts: PartResult.joint for source 'marked'
joint?: { onto: number; pairs: { on: PatchSummary; of: PatchSummary }[]; liftMm: number; turnDeg: number; fit: Fit };
```

For a marked placement `spot.kind` stays `'marked'`, `spot.centre` and `offsetMm` are the weighted centre of the `of` patches where it ended, `candidates` is empty. `Orientation.method` is `'marked'` when `marks.rotation` is not exactly the identity, as today.

### 3.3 The question (`ask.ts`)

```ts
/** A patch for the page to draw: the summary and the triangles (transferred). */
export interface ShownPatch extends PatchSummary {
  triangles: Uint32Array;
}

export interface MeetQuestion extends QuestionBase {
  kind: 'meet';
  about: 'parts' | 'base';
  /** `pairs`: the parts apart, with the pairs to confirm. `fitted`: put together, to confirm. */
  stage: 'pairs' | 'fitted';
  /** What to draw as pairs, in order: the person's, or the proposal when they have marked nothing. */
  pairs: { on: ShownPatch | null; of: ShownPatch | null }[];
  /** True while `pairs` is the converter's proposal. */
  proposed: boolean;
  /** The marks as they are: what a `set` action would send back. Null while the proposal stands. */
  marks: Meeting | PartJoint[] | null;
  /** The figure's parts as they are put together now, the body first. */
  parts: PartResult[];
  /** `fitted`, `base`: the placement shown. */
  placement: Placement | null;
  /** `pairs`, `parts`: the parts pulled apart, so a joint's faces can be seen and tapped; null otherwise. */
  apart: { shown: Shown[]; box: Box } | null;
  /** What a `pick` action hit, or what the last action could not do (`missed`, `full`, `one-part`). */
  picked?: { file: number; point: Vec3 } | null;
  note?: 'missed' | 'full' | 'one-part';
}

/** Where a finger is: a ray in the coordinates `shown` is drawn in, or a point on a file (tests, scripts). */
export type Target =
  { ray: { origin: Vec3; direction: Vec3 }; apart?: boolean } | { file: number; point: Vec3 };

export type MeetAction =
  | { do: 'tap'; at: Target; pair: number }
  | { do: 'brush'; at: Target[]; pair: number; radiusMm: number; erase?: boolean }
  | { do: 'clear'; pair?: number } // one pair, or everything: back to the proposal
  | { do: 'undo' }
  | { do: 'set'; marks: Meeting | PartJoint[] | null } // the whole state at once: records, scripts, tests
  | { do: 'fit' } // `pairs`: these are the pairs, put them together
  | { do: 'back' } // `fitted`: back to the pairs
  | { do: 'nudge'; part?: number; liftMm?: number; turnDeg?: number; turn?: 'keep' | 'free' | null }
  | { do: 'pick'; at: Target } // what is there? changes nothing
  | { do: 'confirm' }; // `fitted`: go on

export interface MeetAnswer {
  kind: 'meet';
  action: MeetAction;
}
```

- **The worker owns the marks while a question is open.** The page sends what the finger did; the question that comes back holds the marks and what to draw. The page keeps no marks and composes no transform (#92's rule, kept).
- **`stage: 'pairs'` for the base** draws the base and the figure standing beside it (today's `apart` layout, now simply `shown`). **For parts** `shown` is every part where its file puts it, and `apart` is the same pulled apart: each part other than the body moved `EXPLODE_MM = 15` _(proposal)_ away from the body's box centre, parts already further than `IN_PLACE_GAP_MM` from every other left where they are.
- **`fit` with nothing marked** keeps the placement the proposal came from, exactly (§5.3). **`fit` at the parts question with no joints** confirms at once: the final view would be the same picture (§15, Q5).
- **`confirm` at `pairs`** is treated as `fit`, so a script that only confirms still passes both stops.

## 4. Search tree (`bvh.ts`)

`TriangleBvh` gains two queries, each with unit tests against brute force on generated meshes:

- `raycast(origin, direction): { triangle: number; t: number } | null`: the nearest triangle a ray hits, either side.
- `within(x, y, z, radius, visit: (triangle: number) => void)`: every triangle whose centroid lies within the radius.

The worker builds one tree per file the first time a meet question needs it and keeps it until the last question is answered; then they are released (before `size`). After posting a meet question it builds the trees of the files shown before it waits for the answer (`const pending = ask(question); resume(step, buildTrees); await pending`), so the first tap does not wait. `TREE_BYTES_PER_TRIANGLE = 28` _(from the tree's arrays)_ goes into `estimateAssemblyBytes` and the pair's estimate in `memory.ts`.

**Picks move to the worker.** `viewer.pick` (three.js testing every triangle, 0.9 s on the largest file) goes. The page sends the ray; the worker carries it into each shown file's frame by the inverse of that file's `Shown` and takes the nearest hit. This answers the open question of PR #95 about a search tree on the page: no new dependency.

## 5. The pipeline

### 5.1 Resolving a patch (`marks.ts`)

`resolvePatch(mesh, tree, pick): Patch` applies the strokes in order to a set of triangles; `applyStroke(mesh, tree, set, stroke)` applies one, so a brush drag costs one stroke at a time. `summarise(mesh, triangles): Patch` computes area, centre, normal and flatness. Only + − × ÷ and sqrt.

### 5.2 A tap

`{ tap: p }`:

1. The seed is the triangle nearest to `p` (`tree.closest`).
2. The surface's normal there: the area-weighted mean of the triangles within `TAP_NORMAL_RADIUS_MM = 1` whose normal is within 60° of the seed's (what `resolveMark` did).
3. Candidates are the triangles whose centroid lies within `TAP_REACH_MM = 3` of `p` (`tree.within`).
4. From the seed, across shared edges among the candidates: a neighbour joins when its normal is within `TAP_CONE_DEG = 30` of the surface's normal and within `TAP_CREASE_DEG = 40` of the triangle it is reached from. Visited in ascending triangle order.

So a tap on a recess floor takes the floor up to its walls, on a sole the sole, on a broad rock top a disc 6 mm across around the finger, on a peg's end the end. The centre of the patch is near where the person tapped, which is what makes the fit predictable. All four constants are _(proposals)_; the PM's marking session (§11 step 11) is where they are judged.

A brush dab adds the triangles within `radiusMm` of the point whose normal is within 90° of the surface's normal there (the other side of a thin wall stays out); an erase dab removes the patch's triangles within the radius.

### 5.3 The proposal (`src/lib/pipeline/contact.ts`, new)

```ts
/** Where two parts touch, as pairs of patches: `on` the part in place, `of` the other. Largest first. */
export function contactPatches(
  inPlace: { file: number; mesh: IndexedMesh; tree: TriangleBvh },
  other: { file: number; mesh: IndexedMesh; positions: Float32Array }, // its vertices where it is placed, in `inPlace`'s frame
): { on: Patch; of: Patch }[];
```

For the first gap of `CONTACT_GAPS_MM = [0.5, 1, 2]` that yields anything: the `other` triangles whose three vertices lie within the gap of `inPlace`'s surface, in pieces connected through shared vertices, pieces under `CONTACT_MIN_AREA_MM2 = 1` dropped, the `MAX_PAIRS` largest kept; for each piece, the `inPlace` triangles whose three vertices lie within the gap of the piece (a small tree over the piece). Vertices outside `inPlace`'s box grown by the gap are skipped before any query. _(all proposals)_

- **The figure on its base:** from the automatic placement of #70 (the place step runs it first, as today, without showing it). A registered pair gives the files' contact.
- **Parts:** for each part other than the body, where its file puts it, against every other part; the part it touches with the largest area is its `onto`. A part that touches nothing gets no pair and stays where its file puts it. `proposedJoints` and `proposedMeeting` go.
- **A proposal is all or nothing.** It is drawn as resolved patches and never recorded. Confirmed untouched, the placement is the one it was read from, bit for bit: the automatic placement, or the files' own. So every path without marks stays what it was, and `choices` holds no marks. The person's first tap or dab starts their own marking from nothing; "Start over" brings the proposal back (§15, Q1).
- Nothing found: `pairs` is empty, `proposed` true, and the page says so; Confirm still places automatically.

### 5.4 The fit (`src/lib/pipeline/fit.ts`, new)

```ts
export function fitMeeting(
  pairs: readonly { on: PatchSummary; of: PatchSummary }[], // `on` in the target frame, `of` as the part stands now, same frame
  options: { up?: Vec3; turn?: 'keep' | 'free' }, // `up`: the base's up, for the figure on its base only
): { rotation: Rotation; translation: Vec3; fit: Fit };
```

Weights `w = min(on.areaMm2, of.areaMm2)`. Three candidates, **the least change first**:

1. **`standing`**: no rotation; the weighted centre of the `of` patches onto that of the `on` patches.
2. **`upright`** (only with `up` and two or more pairs): the turn about `up` that best lays the `of` centres on the `on` centres (closed form in the plane across `up`; the quaternion from the sum's cosine and sine without trigonometry), then the centres as in 1.
3. **`free`**: one pair: the smallest turn that sets `of.normal` against `on.normal` (`fromTo`). Several: Horn's closed form over the centres, with each pair's normals as a further direction pair weighted by `FIT_NORMAL_LEVER_MM = 10` and by both patches' flatness (largest eigenvector of the 4×4 matrix by Jacobi sweeps: + − × ÷ sqrt only). Then the centres as in 1.

A candidate **fits** when the paired centres end within `max(FIT_CENTRE_SLACK_MM = 0.3, FIT_CENTRE_SLACK_SHARE = 0.1 × the spread of the on centres)` of each other (weighted rms) and every pair whose two patches are flat (`flatness ≥ FLAT_MIN = 0.5`) has its normals opposed within `FIT_NORMAL_SLACK_DEG = 15`. The first that fits is taken; if none does, `free`. `turn: 'keep'` takes `standing`, `turn: 'free'` takes `free`. One pair whose patches are not flat cannot be turned by its normals: `standing`. _(all proposals)_

Why: the person has just confirmed how the figure stands (#92; their placement is final). A sole and a recess floor, a peg and a hole in the side of a spire, a wing exported in its own frame beside the body: all are a move, not a turn, and the prototype's moves are right within 0.4 mm. A wing laid flat on a print plate fails the normals test by 90° and is turned. A figure that must lean more than 15° is leaned; one that must lean less stays upright, and the final view has a button for it (§7.2).

Then the nudges: with `a` the normalised weighted sum of the `on` normals (the base's up when it vanishes) and `p` the weighted `on` centre, a point ends at `W · (R·x + t − p) + p + liftMm × a`, `W = fromAxisAngle(a, turnDeg)`.

### 5.5 Assemble and place

- `jointTransform` (assemble.ts) resolves the joint's patches on their files, carries the `on` summaries into the body's frame by `onto`'s transform, and calls `fitMeeting` without `up`. The tree order, the cycle check and the union stay.
- `placeMarked` (place.ts) takes the fitted rotation and translation instead of two marks: `on` summaries in the base's placed frame (`R_b · p − shift`), `of` summaries carried by their part's transform and the figure's standing rotation, `fitMeeting` with `up = [0, 1, 0]`. The merge is unchanged.
- Without marks or parts, the same statements run in the same order as on `main`.

### 5.6 The question loops (`run.ts`)

One helper for both steps, `askMeeting(step, about, context)`, replacing the two loops of today:

```
state = { marks: options' marks or null, history: [], stage: 'pairs' }
proposal = contactPatches(...)                  // once, in the step's time
loop:
  question = build(stage, state)                // resume(step, …)
  action = (await ask(question)).action
  tap | brush | clear | undo | set  → state.marks changes (applyMeetAction), stage stays 'pairs'
  pick                              → question.picked, nothing changes
  fit                               → place by state.marks (or keep the proposal's placement); stage = 'fitted'
  back                              → stage = 'pairs'
  nudge                             → the meeting's liftMm, turnDeg, turn; place again
  confirm                           → done; asked.push({ role: 'meet' | 'parts', tries, waitedMs })
```

`applyMeetAction(state, action, context): MeetState` is a pure function in `marks.ts`, unit-tested without a pipeline. **Which side a tap marks, without a mode:** with `F` the file hit and `k` the pair named by the action,

- a side of pair `k` is already on `F`: the stroke is added to that side;
- pair `k` has a free side: at the base question the base goes to `on`, a figure part to `of`; at the parts question a part in place (the body, or a part some joint already places) goes to `on`, another to `of`, and when one side is set the other takes `F` if `F` is a different file. A part may meet one other part only: a pair that would give it a second `onto` is refused (`note: 'one-part'`);
- both sides are set and neither is on `F`: refused (`note: 'full'`); the page says to add a pair.

`fit` drops pairs with an empty side. `undo` pops `history` (one action, a whole drag, at a time; 50 deep). `tries` counts the actions before the confirming one.

## 6. Worker protocol

`handle.ts` and `client.ts` still do not look inside the payloads. The transfer list of a question gains the `triangles` buffers of `question.pairs`. `Converter.convert` keeps its signature.

## 7. The page

### 7.1 The pairs stop

```
┌───────────────────────────────────────────┐
│ figure + base                        (h2) │
│ Is this where they meet?                  │  #meet-question (COPY.askPairs)
│ ● 1  base · figure        proposed        │  #meet-pairs: one chip per pair, in its colour
│ ● 2  base · figure        proposed        │
│ Confirm, or tap where they touch to mark  │  #meet-hint (describePairs)
│ your own.                                 │
│ [Add a pair] [Brush] [Erase]              │  #meet-add, #meet-brush, #meet-erase (toggles)
│ [Undo] [Start over] [Pull apart]          │  #meet-undo, #meet-clear, #meet-apart (parts only)
│ [ Yes, put them together ]                │  #meet-confirm (COPY.confirmPairs)
│ [Cancel]                                  │
└───────────────────────────────────────────┘
```

- **Both sides of a pair share one colour** (`--pair-1` … `--pair-4` in `style.css`); a proposal is drawn paler. That is the pairing the person confirms.
- **A tap needs no mode** (PM decision 2026-09-30, kept): the worker decides the side (§5.6). The chip selected is the pair a tap goes to; a new mini starts with pair 1, "Add a pair" selects the new one, a tap on a chip selects it, its × clears it.
- **The brush is a toggle** (§15, Q4). Off: a drag orbits, as today. On: a drag with one finger or the left button paints the selected pair on the part under it (dabs `BRUSH_STEP_PX = 6` apart, sent once per frame as one `brush` action, `BRUSH_RADIUS_MM = 1`); two fingers, or the right button, orbit. Erase is a second toggle that makes the dabs erase. A tap marks either way.
- **Confirm is disabled while a pair has one side only**, with the hint "Mark the other side, or clear the pair."
- `Pull apart` switches between `shown` and `apart` at the parts question; taps then carry `apart: true`.
- The camera frames the parts on the first question of a stage and when the layout changes, as today.

### 7.2 The final view

```
┌───────────────────────────────────────────┐
│ figure + base                        (h2) │
│ Is the figure where it belongs?           │  COPY.askMeet (parts: COPY.askParts)
│ Set where you marked · kept upright       │  #meet-placement (describePlacement)
│ [Raise 0.5 mm][Lower 0.5 mm]              │  #meet-adjust
│ [Turn −15°][Turn +15°]                    │
│ [Let it tilt to fit]                      │  #meet-tilt: `turn: 'free'`; then "Keep it upright" (`'keep'`)
│ [Back to marking]                         │  #meet-back
│ [ Yes, convert ]                          │  #meet-confirm (COPY.confirmUp; parts: COPY.confirmParts)
│ [Cancel]                                  │
└───────────────────────────────────────────┘
```

- Raise, Lower and Turn are `nudge` actions. For a marked meeting they run along and about the `on` patches' normal; for the automatic placement they are #70's `liftMm` and `turnDeg` (about the vertical), and the tilt button is hidden (§15, Q7). At the parts question they act on the part named (`#meet-parts` lines select it; the last one marked by default), and only on marked parts.
- After the conversion nothing changes from the PM's decision of 2026-09-30: a marked placement has no Move, Raise or Turn in the Base section; "Mark where they meet" converts again and asks.

### 7.3 The viewer

- `setPatches(patches: { file; triangles: Uint32Array; pair: number; proposed: boolean }[])` replaces `setPins`: per patch one `THREE.Mesh`, a child of its file's mesh, sharing its position attribute, indexed by the patch's triangles; drawn once solid with a polygon offset and once faint with `depthTest: false`, so a patch under a foot or inside a joint shows through.
- `rayAt(x, y): { origin: Vec3; direction: Vec3 } | null`: the camera's ray through a canvas point, in the holder's local coordinates (what `shown` is expressed in). `pick` goes.
- `setBrush(on)`: OrbitControls leaves one finger and the left button to the page while the brush is on.
- `screenOf(file, point)` stays for tests.

### 7.4 Wording _(`page-state.ts`, unit-tested; proposals)_

| Key or function                                                             | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COPY.askPairs`                                                             | "Is this where they meet?"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `describePairs(question)`                                                   | proposal: "Confirm, or tap where they touch to mark your own." · nothing proposed: "Nothing found. Tap where they touch, or confirm to let the converter place it." · marking: "Tap the base and the figure where they touch." (parts: "Tap a part in place and the part that goes there, where they touch.") · one side set: "Mark the other side, or clear the pair." · `note: 'full'`: "This pair has both sides. Add a pair to mark another place." · `note: 'one-part'`: "A part meets one other part." |
| `COPY.confirmPairs`                                                         | "Yes, put them together"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `COPY.addPair`, `brush`, `erase`, `startOver`, `pullApart`, `backToMarking` | "Add a pair", "Brush", "Erase", "Start over", "Pull apart", "Back to marking"                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `COPY.letTilt`, `keepUpright`                                               | "Let it tilt to fit", "Keep it upright"                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `describePlacement` (`marked`)                                              | "Set where you marked" + " · kept upright" (`standing`), " · turned to fit" (`upright`), " · tilted 18° to fit" (`free`), then raised, lowered, turned as today                                                                                                                                                                                                                                                                                                                                              |
| `describePart`                                                              | "wing-l · where its file puts it" · "wing-r · set where you marked" (with the fit as above)                                                                                                                                                                                                                                                                                                                                                                                                                  |

`COPY.meetHint`, `partsHint`, `undoMark` ("Undo") and `resetMarks` are replaced by the above.

### 7.5 Hooks (`window.__mt`)

`state.question` gains `stage`, `pairs` (summaries without triangles), `proposed`, `note`, `picked`; `state.marking` goes. `tap(file, point, pair?)`, `brush(file, points, { erase?, pair? })`, `addPair()`, `selectPair(k)`, `clearMarks(pair?)`, `undoMark()`, `fitMeeting()`, `backToMarks()`, `liftMeeting(mm)`, `turnMeeting(deg)`, `setTilt('keep' | 'free' | null)`, `confirmMeet()`, `answerMeet(action)`, `pickAt(x, y)` (now a `pick` action; resolves with what was hit), `screenOf`. Each resolves when the question that comes back is on screen. `mark`, `resetMarks` go.

## 8. Scripts and records

- `scripts/lib/answer-up.mjs`: a meet question is answered with `set` (the record's `choices.placement.marks` or `choices.parts.joints`, when it has them), then `fit`, then `confirm`; without marks, `fit` and `confirm`.
- `npm run feedback -- --mark`: unchanged in what it does; the record's `choices` now hold strokes, and `placement.marks` the summaries and the fit.
- `scripts/measure-fit.mjs` (new, the prototype made permanent, Node): for every corpus pair, the contact patches of the automatic placement and their time; the fit from those patches with the figure moved away, against the placement, at the corners of the figure's box (`FIT_CHECK_MM`, §9); a tap at each contact piece's centre, its area and how far its centre is from the piece's; tree, tap and fit times against the budgets.
- `scripts/measure-pick.mjs`: the worker's pick in Node (tree, ray, tap) on the largest corpus file. `scripts/measure-place.mjs`: the place step with the proposal.
- `npm run corpus`: `results.json` gets `fit.kept` per marked pair and part; the sheets as today.

## 9. Budgets _(proposals; development PC, Node)_

```ts
export const TREE_BUDGET_MS_PER_M = 400; // building a file's tree, per million triangles (prototype: about 300)
export const PICK_BUDGET_MS = 20; // one tap once the tree exists: ray, growth, summary
export const PROPOSAL_BUDGET_MS = 1500; // contactPatches on the largest corpus pair
export const FIT_BUDGET_MS = 50; // fitMeeting and placing the figure's vertices excluded
export const FIT_CHECK_MM = 1; // measure-fit: the fit from contact patches, against the placement they came from
```

`MARK_RESOLVE_BUDGET_MS` and the page's `PICK_BUDGET_MS` of the first build go. The place step's time grows by the proposal; report it against the run of PR #95.

## 10. What goes, what stays

- **Goes:** `MarkPick`, `Mark`, `resolveMark`, `nearestTriangle`, `triangleCorners`, `meetingRotation` (marks.ts); `proposedJoints`, `ProposedJoint`, `PROPOSAL_SAMPLES` (assemble.ts); `proposedMeeting`, the two question loops, `MarkedPair`, `MeetQuestion.marks/proposed` as pins (run.ts, ask.ts); `viewer.pick`, `setPins`, the pin constants; `state.marking`, `tapMark`, `pinsOf`, `adjustMeeting` as answers (main.ts); the pin screenshots in `docs/design/marks-where-parts-meet/`.
- **Stays:** several files, roles over N, `baseFile: null`, the `assemble` step and the union, `shown` and `meshes`, `PlacedMesh.shift`, `turnVector`, `Orientation.method 'marked'`, `SpotKind 'marked'`, the Base section's buttons, `too-many-files`, the corpus part convention, the marking session, the replay fixes of the review round, `figureTranslation` as discussed on the PR.
- **New:** `contact.ts`, `fit.ts`, `TriangleBvh.raycast` and `.within`, `applyMeetAction`, `askMeeting`, `setPatches`, `rayAt`, `scripts/measure-fit.mjs`.
- **Library entry:** the types `Stroke`, `PatchPick`, `PatchPair`, `PatchSummary`, `Fit`, `MeetAction`, `Target` replace `MarkPick` and `Mark`; `index.test.ts` pins them.

## 11. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green from step 9. No regression row moves except `peg-marked-in-hole` in step 5.

1. **Tree queries.** `raycast`, `within`. Tests: against brute force on `generateBumpySheet` and the recess base, 200 seeded rays and balls; a ray that misses; a mesh without triangles.
2. **Patches.** `marks.ts` rewritten. Tests: a tap on the generated recess floor's centre gives the floor and nothing of the walls or the top (its area within 1 % of the floor's inside `TAP_REACH_MM`), normal `[0, 1, 0]` exactly, flatness 1; on a plate larger than the reach, a disc of the reach's radius centred on the tap within 0.1 mm; on the bumpy sheet, flatness above 0.9 and a centre within 0.5 mm of the tap; a second tap adds; a brush dab adds the triangles in its radius and not the far side of a 1 mm wall; erase removes; the same strokes give the same triangles twice; `MAX_STROKES`.
3. **The fit.** `fit.ts`. Tests: a flat sole patch over a flat floor patch: `standing`, rotation exactly the identity, centres together; a peg's end and a hole's floor in a vertical face, figure upright: `standing`; a plate tilted 30° (the 3-4-5 rotation): `free`, tilt within 0.01°; tilted 10°: `standing`, and `turn: 'free'` tilts it; two feet with the figure turned 20° about the vertical: `upright`, the turn within 0.1°; three pairs under an arbitrary rotation and move: `free`, centres within 0.01 mm; one pair of patches with flatness 0.2: `standing`; `turn: 'keep'`; lift and turn about the `on` normal leave the `on` centre where it is.
4. **The proposal.** `contact.ts`. Tests: the puddle figure seated in the recess base by `placeOnBase`: one pair, the `of` area within 10 % of the puddle's underside; the winged figure's body and wing in place: one pair at the cut; the wing 50 mm away: none; a figure hovering 0.8 mm: found at the 1 mm gap; four largest kept of six.
5. **Assemble and place by pairs.** `Meeting` with pairs through `jointTransform`, `placeMarked`, options, results, `choices`. Tests (`assemble.test.ts`, `place.test.ts`, `run.test.ts`): the peg figure tapped at its end into the hole base tapped at the hole's floor lands the peg's axis on the hole's within 0.05 mm, `fit.kept: 'standing'`, `method: 'marked'`; the wing 50 mm away and turned a quarter turn, joined by taps on the two cut faces plus a second pair, comes back within 0.1 mm of the one-piece mesh (`free`); `choices` convert again to the same bits without questions; the path without marks is bit-identical (`score-placements` as on `main`). `baseline:update` for `peg-marked-in-hole` only, explained in the PR.
6. **The questions.** `MeetQuestion` stages, `MeetAction`, `applyMeetAction`, `askMeeting`, the trees, `apart` for parts. Tests: every side rule of §5.6 as a table over `applyMeetAction`; a pair asks at `pairs` with the proposal (`proposed`, the figure beside the base), `fit` brings `fitted` with the automatic placement, `confirm` converts with no marks in `choices` and the same bits as `?ask=off`; two taps then `fit` give `method: 'marked'`; `back` returns with the marks kept; `clear` brings the proposal back; `undo`; `nudge`; a kit in place: `fit` with no joints confirms at once; `set` then `fit` then `confirm` reproduces a record; `waitedMs` is in no step.
7. **Protocol and library entry.** Transfers, types, `index.test.ts`, the README's call.
8. **Wording.** §7.4 with a unit test per string.
9. **The page.** (a) `setPatches`, `rayAt`, the two stops, chips, taps, hooks. (b) the brush and erase toggles. `e2e/meet.spec.ts` and `e2e/parts.spec.ts` rewritten: the pairs stop shows the figure beside its base with a proposed pair (`state.question.proposed`, `pairs[0].on.areaMm2 > 0`); Confirm brings the final view, Confirm converts once; `tap` on base and figure replaces the proposal, the hint and chips follow, Confirm is disabled with one side set; `pickAt` over the base returns the base; `brush` grows the patch's area and `erase` shrinks it; `backToMarks`; `setTilt`; a phone viewport with `page.touchscreen.tap`; three files with a wing apart joined by two pairs; seven files refused. Screenshots with `verify-3d`: the proposal apart, the person's two pairs in two colours, a patch seen through a foot from above, the final view, the phone, a kit pulled apart.
10. **Scripts and numbers.** §8; every budget of §9 measured; `measure-memory.mjs` on the largest pair against the estimate with the trees.
11. **Corpus and the PM's session** (development PC). `npm run corpus -- --no-bake --up index`: untouched steps against the run of PR #95, every pair's placement unchanged (nothing is marked yet). Then the PM's `npm run feedback -- --mark`: the bat `flying/flying-01`, the pairs placed by hand, the kits the PM adds. The session judges criterion 5 and the tap constants.
12. **Docs.** `CLAUDE.md`, `CONTRIBUTING.md`, the README, the spec's status line, and a new journal entry for the rework (the entry of 2026-09-30 stays as the account of the first build; the new one starts from the PM's rethink and this note, and names what was thrown away and why).

## 12. Out of this note

- Editing a proposal (dropping one of its pairs, painting onto it): all or nothing for now (§15, Q1).
- Finding sockets on parts that lie apart: nothing is proposed for them; the person marks.
- Seating by the surfaces' shape (an ICP): the prototype did not earn it; the nudges and a second pair do the rest.
- A brush size control; undo across stops; more than six files.

## 13. When to stop and ask

- **A path without marks is not bit-identical**: a baseline row other than `peg-marked-in-hole` moves, `score-placements` changes, or a pair confirmed as proposed converts to other bits than `?ask=off`.
- **`measure-fit` finds the fit from contact patches further than `FIT_CHECK_MM` from the placement** on more than two corpus pairs, or further than 2.5 mm on any. The prototype saw 0.1–0.4 mm.
- **A budget of §9 is missed on an ordinary mini** (the 1.25 M-triangle humanoid), or the largest pair's peak memory is above the estimate with the trees.
- **The PM's session finds taps marking the wrong surface** on several minis: tune the four tap constants with the PM, do not add rules.
- **The fit's order turns a figure the PM stood upright**, or leaves flat a wing that should have turned, on a real kit: report the pair, its normals and centres.
- Ask on the PR, label the issue `needs-human` when the answer is the PM's, and go on with what does not depend on it.

## 14. How each criterion is proven

| Criterion (issue #93)                                                                                                         | Proof                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Both files upright, shown apart at full detail; marks on base and figure taken from the full geometry                      | `marks.test.ts` (step 2); `e2e/meet.spec.ts` (step 9: apart, the pairs); screenshots                                       |
| 2. The marked surfaces meet; raise, lower and turn; "Set where you marked"; nothing guessed once marked; automatic by default | `fit.test.ts`, `place.test.ts` (steps 3, 5); the pairs stop confirmed as proposed is bit-identical (step 6); wording tests |
| 3. Marks in the result and the records, `method: 'marked'`; the feedback mode records them                                    | `run.test.ts` (step 5: `placement.marks`, `choices` reproduce); `e2e/feedback.spec.ts` (step 10)                           |
| 4. Several files, each placed against a part already placed; one mesh; `MAX_PARTS = 6`                                        | `assemble.test.ts`, `e2e/parts.spec.ts`; the regression case `figure-in-parts`                                             |
| 5. The corpus gets a multi-part mini and the bat with its peg marked, judged by the PM                                        | step 11                                                                                                                    |
| 6. Marking works on a phone with a finger                                                                                     | the phone e2e test and screenshot; comfort is the PM's note                                                                |

The criteria's words "spot" and "contact" now read "the patch on the part in place" and "the patch on the part that goes there"; the PM's rethink is the reason (§15).

## 15. PM decisions and questions

### PM decisions (2026-10-01, the rework session, recorded on PR #95)

1. Marks are painted areas, in pairs; the converter proposes pairs on the parts **without placing them**; the person confirms or marks differently; only then the converter fits by the pairs, shows the result, and after a second confirmation reduces and bakes.
2. A tap selects the patch of surface around it; dragging paints or erases.
3. Several pairs per connection.
4. A wrong final view is fixed by going back to the marks; Raise, Lower and Turn stay at the final view for small misalignment.
5. Files exported in place still pass the pairs stop: one Confirm.
6. The marking session records pairs; pin records are not carried over.

After trying the rework (2026-10-01, later the same day, on PR #95):

7. A proposed pair can be edited: a tap, a brush stroke or × on it changes it, instead of replacing the whole proposal. This replaces the answer to question 1 below.
8. The camera can be moved about a part while marking, since two models side by side (and kits of more parts) are not served by orbiting the middle of everything.

The decisions of 2026-09-30 that this does not touch stay: the meeting is shown before the conversion for every pair; a tap needs no mode; no Move, Raise or Turn after a marked conversion; the marking session; no base means no meeting.

### Questions (the build proceeds with the proposals)

1. **A proposal is confirmed whole or replaced.** The first tap starts the person's own marks from nothing; "Start over" brings the proposal back. Editable proposals could not be recorded as strokes: a record would depend on the version of the heuristic.
2. **A tap marks the surface within 3 mm that faces the same way**, not the whole sole or the whole top; more taps or the brush extend it. Unlimited growth put the figure up to 5 mm off in the prototype.
3. **The least change that fits**: a figure keeps standing as confirmed unless its marks disagree by more than 15°; "Let it tilt to fit" and "Keep it upright" override at the final view.
4. **The brush is a toggle**: on, one finger paints and two orbit; off, a drag orbits. A tap marks either way.
5. **A kit whose parts all stay where their files put them skips the final view** of the parts: it would be the picture just confirmed.
6. **A proposal confirmed untouched is the placement it was read from**, exactly; the fit runs only on the person's own marks.
7. **Raise, Lower and Turn at the final view also for the automatic placement** (as #70's lift and turn about the vertical).
8. **Up to four pairs per connection.**

Still open from PR #95: which kit goes into the corpus (at most five parts and a base, or should `MAX_PARTS` grow), and the PM's marking session itself.
