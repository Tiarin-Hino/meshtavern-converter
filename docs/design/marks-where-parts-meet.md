# Design: mark where the parts meet (#93)

Status: design pass by Fable 5.1, 2026-09-30, for Opus 5.5 to build · Spec: Phase 1, story 10 (#70), follow-up asked for by the PM on 2026-09-29 · Issue: #93 (supersedes #91) · Builds on: `docs/design/base-file.md` (#70) and `docs/design/up-before-reduce.md` (#92)

This note fixes the decisions the build should not have to make: what a mark is and how it is taken from the full-detail geometry, how two marks place one part on another, how a mini of several files is put together, which questions the conversion asks and in which order, what the result and the records carry, what the page shows, how unattended runs answer, and the build order with the test that proves each step. Product behaviour comes from the issue; where this note picks a number, a rule or a wording, it is a named constant or a `COPY` string marked _(proposal)_ and the PM can change it. §14 lists the decisions this note asks the PM for; the build proceeds with the proposals unless the PM says otherwise on the PR. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§12).

Corpus minis are named by their generic index names (`flying/flying-01`), never by their product names, here and in everything the build writes. The library survey of §1 names no mini either; the list with names stays on the development PC.

## 1. What the problem looks like

The automatic placement of #70 finds seats and flat patches on the base's top from above. It cannot see a hole in a vertical face (the giant bat, `flying/flying-01`: its peg goes into the side of its spire), it guesses on sculpted tops, and it knows nothing about a figure shipped in several files. The PM placed four corpus pairs by hand this week with move, raise and turn (#70 §12); that corrects a guess after a full conversion, and it cannot tilt a figure into a sloped socket at all.

Three facts shape the design:

- **A point and a normal on each surface fix five of six degrees of freedom.** Turn the figure so its contact normal opposes the spot normal (`fromTo` in `rotation.ts`), move it so the two points coincide, and the only freedom left is the turn about the normal. That is what a peg in a hole, a sole on a floor and a wing in its socket all are. Raise and lower run along the spot's normal, turn runs about it: the issue's controls fall out of the geometry, nothing else is needed.
- **The page already has the full-detail meshes at the stop of #92.** Marks are picked on those meshes, in the parts' own file coordinates, so a mark survives every later choice of up axis and every re-conversion of the same files. The worker resolves the normal and the placement, the page only picks and shows: the rule of #92.
- **Most multi-part kits in the PM's library are exported in place.** A survey on 2026-09-30 (development PC, bounding boxes only, `out/research93/partsurvey.mjs`, git-ignored) over the 50 kits of the library with separate wing files: in **34 of 50** every part's box overlaps the body's where it belongs (wings beside the shoulders, a head on the neck, the base under the feet, all in one Y-up or Z-up frame), **7** lay every part out apart (a print plate: the wings 60–100 mm from the body, each part flat on its back), **1** exports every part centred on the origin, and **8** mix the two (some parts in place, others apart). So "where the files put them" is the right default for parts, and marks are the correction for the rest, not the only path. This changes criterion 4 of the issue (§14, Q1).

The rest of #70 stays as it is: the height map, the seats, the flattest patch, the centre guard and the registration test place a pair when nobody marks anything (criterion 2: the automatic placement remains the default).

## 2. The decision in one paragraph

A mini is up to `MAX_PARTS = 6` files _(proposal, the issue's number)_: at most one base and one or more **parts** of the figure, the first part in file order being the **body**. The figure is put together first (a new `assemble` step between weld and orient: every part where its file puts it relative to the body, or where a pair of marks puts it) into one mesh in the body's file frame, and from there on the pipeline is the pair path of #70 and #92 unchanged: the figure stands, the base stands, the figure is placed on the base, the two are merged before reduction. A pair of marks on figure and base replaces the spot search of #70 in the place step (`Placement.method: 'marked'`). The page asks about the parts (a mandatory stop for a mini of several files, one click when the kit is exported in place), then which way is up as in #92, and marks the figure on its base **on request**: a button at the figure's question and one in the Base section after a conversion (§14, Q2). Every tap on a part is a mark, every change is an answer the worker resolves and shows again.

## 3. Data shapes

### 3.1 Marks and meetings (`src/lib/pipeline/marks.ts`, new)

```ts
/** A point a person tapped on the full-detail mesh of one file, in that file's coordinates. */
export interface MarkPick {
  /** Which of the files given: 0 the first. */
  file: number;
  point: Vec3;
}

/** A mark as resolved: the surface point and the normal around it, in the frame stated where it is used. */
export interface Mark {
  point: Vec3;
  normal: Vec3;
}

/** Where two parts meet: a spot on the part already in place, a contact on the part that goes there. */
export interface Meeting {
  spot: MarkPick;
  contact: MarkPick;
  /** Along the spot's normal, positive away from its surface; 0 puts the two points together. */
  liftMm?: number;
  /** About the spot's normal, degrees, counter-clockwise seen from the spot's outside. */
  turnDeg?: number;
}

/** A part placed against another by a meeting: the tree of a figure's parts. */
export interface PartJoint extends Meeting {
  /** The part placed: a figure part that is not the body. */
  part: number;
  /** The part it is placed against: the body or a part already placed; `spot.file === onto`, `contact.file === part`. */
  onto: number;
}
```

Decisions in these shapes:

- **A pick is a point, not a triangle.** The worker finds the triangle nearest to the point (`nearestTriangle`, one pass over the file's triangles, brute force: 40 ms on 5.6 M triangles, development PC, estimated from the passes of #72) and takes its plane. Records therefore survive a re-weld, a repaired copy of a base and a change of `WELD_TOLERANCE_MM`; the page never sends a triangle index.
- **The normal is the surface's around the point, not one triangle's.** `resolveMark(mesh, point)`: the area-weighted mean of the normals of the triangles whose centroid lies within `MARK_NORMAL_RADIUS_MM = 1` _(proposal)_ of the point and whose normal is within `MARK_NORMAL_CONE_DEG = 60` _(proposal)_ of the nearest triangle's; the nearest triangle alone when no other qualifies. On a sculpted rock a single 0.05 mm triangle points anywhere, the surface around it points at the sky; the cone keeps the other wall of a thin recess and the rim of a hole out of the mean. Only + − × ÷ and sqrt, so the same bits everywhere. The point itself is kept as picked, never snapped.
- **Marks are in file coordinates** in every option and every record, and in the base's placed frame in the result (§3.4), so the page can turn a part any way and the mark stays on its surface.
- **A meeting has an orientation of its own only about the normal.** `liftMm` and `turnDeg` are the two controls the issue names, relative to the two normals; there is no move across, because a spot is a point: to move, mark again (§14, Q4).

### 3.2 Options

```ts
// PipelineOptions (run.ts) and ConvertOptions (protocol.ts) gain:
/** The third file onwards: the figure's other parts, or its base when the second file is a part. Transferred like `stl` and `secondStl`. */
moreStl?: ArrayBuffer[];
/** How the figure's parts are put together. Left out: every part where its file puts it. */
parts?: PartsOptions;

export interface PartsOptions {
  /** One joint per part that is not where its file puts it; a part without one stays where its file puts it. */
  joints: PartJoint[];
}

// place.ts, PlacementOptions gains:
/** The figure placed on the base by two marks (#93): then `moveMm`, `liftMm` and `turnDeg` are ignored, the meeting has its own. */
marks?: Meeting;

// pair.ts, PairingOptions:
/** This file is the base, whatever the shapes say; null: no base, the files are the parts of one figure (#93). Overrides the guess and `swap`. */
baseFile?: number | null;   // was 0 | 1
```

`secondStl` stays what it is, so the two-file path of #70 and #92 does not change a line for a pair: `files = [stl, secondStl?, ...moreStl]`, at most `MAX_PARTS`; more is refused with the problem `too-many-files` before anything is read ("Drop up to 6 files: a figure, its base and its parts." _(proposal)_, in `problems.ts`; the page refuses it in `loadFiles` with the same words). `Converter.convert` adds `moreStl` to the transfer list.

### 3.3 Roles for several files (`pair.ts`)

```ts
export interface Pairing {
  /** Which file is the base; null when the files are the parts of a figure without a base file (#93). */
  baseFile: number | null; // was 0 | 1
  method: 'guessed' | 'manual';
  warnings: PairWarning[];
  /** One per file given, in the order given. */
  files: FileShape[]; // was [FileShape, FileShape]
}
```

- `guessRoles(files, options, whenNone)` over N files: the files with a flat underside are the candidates; one candidate is the base; several: the lowest aspect, warning `both-look-like-bases` or `figure-has-its-own-base` as today, judged against the next lowest; none: `refuse` (`not-a-pair`, as today, only when N = 2) or `propose` (the lowest aspect, warning `no-flat-underside`, N ≥ 2). `options.baseFile` (a number or null) sets the roles without a guess, `method: 'manual'`. `swap` keeps its meaning for two files.
- **The figure parts** are every file that is not the base, in file order; `bodyFile(pairing)` is the first of them. Helpers `figureFiles(pairing)` and `bodyFile(pairing)` replace every `1 - baseFile` in the code and the page.
- A change of type from `0 | 1` to `number | null` is deliberate: a mini of one file has no `Pairing` (as today, `pair: null`), and a mini of two parts without a base has one with `baseFile: null`.

### 3.4 What the result records

```ts
// place.ts
export interface Placement {
  spot: Spot;                       // for a marked placement: kind 'marked', centre the spot's x and z, sizeMm [0, 0], depthMm 0, fit 0
  contactMm: [number, number];
  offsetMm: [number, number, number]; // marked: the contact mark's point in the base's frame, x, z, and its height
  yawDeg: number;                   // marked: the turn about the spot's normal (`turnDeg`), 0 without one
  /** `marked`: the figure was placed by two marks (#93). */
  method: 'detected' | 'manual' | 'marked';
  candidates: Spot[];               // marked: empty
  /** A marked placement: the two marks in the base's frame as they ended, and the rotation applied to the standing figure. */
  marks?: {
    /** The spot on the base: the point picked and the normal resolved, base file units, base frame (Y-up, y = 0, centred). */
    spot: Mark;
    /** The contact where it ended: `spot.point + liftMm × spot.normal`, normal opposite to the spot's. */
    contact: Mark;
    /** The figure's standing frame (how it stood at its question) to the base's frame. Identity when a flat sole met a flat floor. */
    rotation: Rotation;
    liftMm: number;
    turnDeg: number;
  };
}
export type SpotKind = 'hole' | 'recess' | 'flat' | 'registered' | 'marked';

export interface PartResult {
  file: number;
  /** `files`: where its file puts it. `marked`: a joint. `body`: the body itself. */
  source: 'body' | 'files' | 'marked';
  /** The part's file coordinates to the body's file frame. Identity for `body` and `files`. */
  rotation: Rotation;
  translation: Vec3;
  /** Its joint as resolved, in the body's frame: the spot on `onto`, the contact where it ended. Only for `marked`. */
  joint?: { onto: number; spot: Mark; contact: Mark; liftMm: number; turnDeg: number };
  /** Its triangles in the merged mesh: the figure lists the body first, then the parts in file order, then the base. */
  triangles: number;
}

export interface PairResult {
  pairing: Pairing;
  /** Null for a figure without a base file (parts only). */
  placement: Placement | null;
  figureVertices: number;
  figureTriangles: number;
  baseOrientation: Orientation | null;
  /** The figure's parts, the body first; one entry for a figure of one file. */
  parts: PartResult[];
}

// orient.ts
Orientation.method: 'base' | 'tallest' | 'manual' | 'cut' | 'marked';

// run.ts
UpChoices gains `parts?: PartsOptions` and `placement?: PlacementOptions` (the marks); `choices.pairing.baseFile` may be null.
AskedUp.role: UpRole | 'parts' | 'meet'.
```

- **`result.orientation` for a marked figure** is how the figure stands in the mini: its confirmed orientation composed with the meeting's rotation (`multiply(marks.rotation, standing.rotation)`), `up` the nearest axis, `tiltDeg` measured, `method: 'marked'` unless the meeting's rotation is exactly the identity (a flat sole on a flat floor: `fromTo` returns `[0, 0, 0, 1]` bit for bit when the normals are exactly opposite), in which case the confirmed orientation stays as it is. Precedent: a registered figure reports its base's orientation. The GLB's `extras.meshtavern.rotation` therefore says how the figure really stands; `choices.orientation` (what reproduces the mini) is unchanged by the marks, as it is for a registered pair.
- **`PairResult` for parts without a base** (`baseFile: null`): `placement: null`, `baseOrientation: null`, `pairing` with the roles, `parts` with the joints; the pipeline runs the single-file path after the assemble step (no place step), so `sizing.base` comes from the union's own underside if it has one (a figure with an integral base and separate wings) and `plainBase` works as for one file.
- `Sizing` and the GLB `extras` do not change shape. `stats.pair` is the same object as `result.pair`.

### 3.5 The questions (`ask.ts`)

```ts
/** What the page draws at a question: each file at its transform, file coordinates to the scene. */
export interface Shown {
  file: number;
  rotation: Rotation;
  translation: Vec3;
}

interface QuestionBase {
  /** The welded meshes of the files not yet sent in this conversion, as copies (positions and indices only). Each file travels once. */
  meshes: { file: number; mesh: IndexedMesh }[];
  /** What the page draws, and where; the box of all of it in scene axes, file units, for the camera. */
  shown: Shown[];
  box: { min: Vec3; max: Vec3 };
}

export interface UpQuestion extends QuestionBase {
  kind: 'up';
  role: UpRole; // 'mini' | 'base' | 'figure'; the figure of a multi-part mini is its union
  file: number; // the file asked about: the base, or the body of the figure
  orientation: Orientation;
  reason: UpReason;
  base: BaseMeasurement | null;
  warnings: PairWarning[];
  /** A pair or more: every file's name index and role, for the base select. */
  roles: { baseFile: number | null; figureFiles: number[] };
}

export interface MeetQuestion extends QuestionBase {
  kind: 'meet';
  /** `parts`: how the figure's parts go together. `base`: the figure on its base. */
  about: 'parts' | 'base';
  /** `parts`: one per figure part, the body first; `base`: one entry, the body, standing for the whole figure. */
  parts: PartResult[];
  /** `base` only: the meeting as resolved so far; null before both marks are set. */
  placement: Placement | null;
  /** The marks set so far, resolved, in the file coordinates of their file: what the page draws the pins from. */
  marks: { spot?: Mark & { file: number }; contact?: Mark & { file: number } }[];
  /** `parts`: which parts have no joint and are not in place by their file (nothing the worker can tell; empty). Reserved. */
}

export type Question = UpQuestion | MeetQuestion;

export interface UpAnswer {
  kind: 'up';
  orientation: OrientationOptions;
  confirm: boolean;
  swap?: boolean;
  /** This file is the base (or null: no base, parts of one figure). The questions start again with the parts (#93). */
  baseFile?: number | null;
  /** With `confirm` at the figure's question: ask where the figure meets the base next. */
  meet?: boolean;
}

export interface MeetAnswer {
  kind: 'meet';
  /** `parts`: the joints (a part left out stays where its file puts it). `base`: one meeting, or none for the automatic placement. */
  joints: PartJoint[];
  meeting: Meeting | null;
  confirm: boolean;
}

export type Answer = UpAnswer | MeetAnswer;
export type AskUp = (question: Question) => Promise<Answer>; // the name stays; it asks every question

export interface AskOptions {
  up?: boolean; // the mini, or the figure
  baseUp?: boolean; // the base
  /** The parts question of a mini of several parts. Default true; false leaves them to the options. */
  parts?: boolean;
  /** The meeting of the figure and the base: asked at once, without a button. Default false. */
  meet?: boolean;
}
```

Decisions:

- **`shown` replaces `UpQuestion.mesh` and its `box`.** The worker decides every transform: the page draws each file's mesh at `rotation` and `translation` and never composes an orientation, at any question (#92's rule, kept). A single file's up question has one entry standing on the grid; the figure's question of a multi-part mini has one entry per part (the union as it stands); the meet question has the base and the parts. `meshes` carries the copies not yet sent, once per file per conversion, as #92 did for one mesh.
- **Every answer to a meet question is resolved by the worker** (§4.3), inside its step's time, and the question comes again with `placement` and `parts` updated: a mark, a lift, a turn, a reset each cost one message and one pass over the marked file's triangles (§8). The page keeps no placement mathematics.
- **The figure's confirming answer may ask for the meeting** (`meet: true`): the figure's orientation is confirmed and the conversion stops once more. A conversion started with `ask.meet` asks it without a button (the Base section's "Mark where they meet" after a conversion, §6.4).
- **Roles are confirmed at the base's question** as in #92; `baseFile` in an answer replaces Swap for more than two files and adds "no base" (§14, Q7). `swap` stays for two files.

## 4. The pipeline

```
read → weld (every file)
→ assemble (N ≥ 3, or N = 2 with baseFile null): the roles, the union of the figure's parts
    └ ask.parts: question 'meet' about 'parts' … until confirmed
→ orient: as #92 over [union, base] or [union]
    └ base question (roles; baseFile changed → back to assemble), figure question (meet: true → the meet question below)
→ place (a base): decided as #92; with marks, placeMarked instead of the spot search
    └ ask.meet or meet asked for: question 'meet' about 'base' … until confirmed
→ size → simplify → …
```

### 4.1 Roles before anything is assembled

`standFiles(meshes)` is `standPair` over N files: each stood the way a base would (`baseOrientation`, the 2 mm band) and its shape; `guessRoles` over the shapes. The pass over each file is kept for the orient step (the figure's union gets a pass of its own, §4.2). Time: one `baseOrientation` per file, as a pair pays for two today.

### 4.2 The `assemble` step (`src/lib/pipeline/assemble.ts`, new)

Runs only when the figure has more than one part (`STEPS` gains `'assemble'` after `'weld'`; `stepCount` counts it then, as `place` is counted for a pair; `STEP_LABELS.assemble = 'Putting the parts together'` _(proposal)_).

- **Where the files put them.** A part without a joint keeps its file coordinates: `rotation` identity, `translation` zero, `source: 'files'`. The union is the concatenation of the body's welded mesh and each part's positions turned and moved by its transform, indices offset (`mergeMeshes` chained; `PartResult.triangles` per part). No re-weld: the parts stay separate surfaces, as a figure and its base do after #70.
- **A joint.** `jointTransform(part, onto, meeting)`: the spot resolved on `onto`'s file (`resolveMark`), then turned into the body's frame by `onto`'s own transform (the tree is resolved body first, then parts in file order; a joint onto a part later in the order is resolved after it; a cycle is a `ConversionProblem('unexpected')` with the detail, and the page never makes one because a part becomes `onto` only once it is placed); the contact resolved on `part`'s file. The part's transform: `A = fromTo(n_contact, −n_spot)`, `W = fromAxisAngle(n_spot, turnDeg)`, `rotation = W · A`, `translation = spot + liftMm × n_spot − rotation · contact`. `source: 'marked'`, `joint` with both marks in the body's frame as they ended.
- **The parts question** (`about: 'parts'`): `shown` has every figure part at its transform, all turned by the **body's detected up** (`resolveOrientation(body, {})`, one pass over the body; the pass is kept and not the union's) and stood on the grid by the union's box, so a Y-up or Z-up kit stands on screen. The page shows a part in place or lying apart; the person marks the ones apart (§6.2). An answer replaces the joints and the union is built again; confirming keeps the union. `resume('assemble', …)` for every answer, as #92 resumes `orient`. The base file, when there is one, is not shown at the parts question: it has its own question next, and the meet question shows both.
- **Memory.** The union is a copy the size of all parts together, on top of the parts' welded meshes, which are kept until the last question is answered (a re-answer rebuilds the union; the meet question's meshes are the parts'). `estimateAssemblyBytes(sizes, formats)` in `memory.ts`: the sum of the files' estimates minus `(N − 1) × FIXED_BYTES` plus the union's bytes (`BYTES_PER_TRIANGLE` × the parts' triangles, once more); `checkNeeded` as for a pair. Build step 8 measures the largest kit.

### 4.3 The marked placement in the place step (`place.ts`)

`placeMarked(figure: PlacedMesh, base: PlacedMesh, files: PairFiles-like, meeting, parts)`:

1. The spot resolved on the base's file, turned into the base's placed frame: `s = R_b · p − c_b`, `n_s = R_b · n` (`R_b` the base's orientation rotation, `c_b` the shift `placeOriented` applied; both are known: keep the shift on `PlacedMesh` as `shift: Vec3` _(new field, the translation applied after the rotation)_, so no mesh is compared to find it, as `registeredFigure` does today).
2. The contact resolved on its part's file, turned into the body's frame by the part's transform, then into the figure's standing frame: `c = R_f · (T_k · p) − c_f`, `n_c` likewise without the shifts.
3. `A = fromTo(n_c, −n_s)`, `W = fromAxisAngle(n_s, turnDeg)`, `Q = W · A`. The figure's vertices: `Q · (v − c) + s + liftMm × n_s`. Then `mergeMeshes(figure, base)` as today.
4. `Placement` as §3.4; `spot.kind: 'marked'`; `method: 'marked'`; `candidates: []` (the basins are not searched: nothing is guessed once a mark exists, as the issue says).

`placeOnBase` takes the branch when `options.marks` is given, before `decideFigure`: the base's top is not read, the registration test does not run, the centre guard does not apply. The path without marks is the same statements in the same order as today. `decideFigure` at the figure's question is unchanged: the figure's question shows what the automatic rules would do; the marks come after it.

**The degenerate case.** When the contact normal already opposes the spot normal (a flat sole under an upright figure, a flat floor), `A` is the identity and the figure keeps its standing yaw: what the person expects. When the two normals are equal (the person marked a sole and the underside of an overhang), `fromTo` turns by a half turn about the axis least aligned with the normal, and the figure comes out upside down about some horizontal axis: the meeting is shown, and the person turns or marks again. No special rule.

### 4.4 The meet question about the base

After the figure's question is confirmed with `meet: true`, or when `ask.meet` is set: the place step begins with the question (`run('place', …)` announces it; every answer is resumed into `place`). `shown`: the base at its placed transform (the scene is the base's frame: `R_b`, `−c_b`) and the figure's parts at the figure's standing transform composed with the meeting when both marks are set (`Q · R_f`, the translation of §4.3), else at the standing transform alone: the page lays the two apart itself in that state (§6.3). `placement` is the resolved meeting or null; `marks` what is set so far. A `meeting: null` answer goes back to the automatic placement (`placement` null, the question again); confirming without a meeting continues with the automatic rules, as if the button had not been pressed.

### 4.5 What the orient step sees

The union is one `IndexedMesh` in the body's file frame: `standFigure`, `figureUpCandidates`, the registration test (`PairFiles.figure` is the union; the base's frame test of #70 works when the kit and its base are in one frame, which the survey saw in the kits exported in place) and `decideFigure` run over it unchanged. `UpQuestion.file` is the body's file; `shown` has one entry per part, each `R_f · T_k` with `−c_f`.

## 5. The worker protocol

```ts
export type WorkerRequest =
  | { type: 'convert'; id: number; stl: ArrayBuffer; options?: ConvertOptions }   // options.moreStl transferred too
  | { type: 'answer'; id: number; answer: Answer };
export type WorkerResponse =
  | …
  | { type: 'question'; id: number; question: Question };   // transfer: the buffers of every mesh in question.meshes
```

`handle.ts` and `client.ts` do not look inside the payloads; the transfer list is `question.meshes.flatMap(({ mesh }) => meshBuffers(mesh))`. `Converter.convert(stl, onProgress, options, askUp?)` keeps its signature; with a callback the client sends `ask` as given or `{ up: true, baseUp: true, parts: true }`. Cancel and a rejecting callback stay what they are.

## 6. The page

### 6.1 Files in

`loadFiles` takes up to `MAX_PARTS` files (the constant from the library); more give the `too-many-files` line. `sources` holds them in the order given; `convert(buffers)` sends the first as `stl`, the second as `secondStl`, the rest as `moreStl`. The heading and `state.fileName` list the figure's parts first (the body, then the other parts in file order), then the base: `body + wing-l + wing-r + base` _(proposal)_, names without `.stl`. `choices` gains `parts: PartsOptions` and its `placement` may carry `marks`; `noChoices()` clears both. Adding parts to a mini already on screen is a follow-up (§11); "Add a base file" stays for a figure of one file.

### 6.2 The parts question (`about: 'parts'`)

```
┌──────────────────────────────────────┐
│ body + wing-l + wing-r + base   (h2) │
│ Are the parts where they belong?     │   #meet-question (COPY.askParts)
│ wing-l · where its file puts it      │   #meet-parts: one line per part (describePart)
│ wing-r · marked, raised 0.5 mm       │
│ Tap the spot on a part that is in    │   #meet-hint (COPY.partsHint)
│ place, then the contact on the part  │
│ that goes there.                     │
│ [Raise 0.5 mm][Lower 0.5 mm]         │   #meet-lift   (for the joint last made)
│ [Turn −15°][Turn +15°]               │   #meet-turn
│ [Undo the last mark] [Reset]         │   #meet-undo, #meet-reset
│ [ Yes, the parts are in place ]      │   #meet-confirm (COPY.confirmParts)
│ [Cancel]                             │
└──────────────────────────────────────┘
```

`<section id="meet" data-in="asking">` next to `#ask`; `#ask` and `#meet` show by `state.question.kind` (`body[data-question]`, set by `render()`). **Marking is tapping**: a tap on a part (pointerdown and pointerup within `TAP_MAX_PX = 6` px and `TAP_MAX_MS = 400` ms _(both proposals)_; a drag stays the orbit) is a raycast against the parts on screen (`Raycaster` on the shown meshes; §8 has the budget). A tap on a part that is in place (the body, or a part with a joint, or, at the base question, the base) sets the **spot**; a tap on a part that is not (a part with no joint yet, at the base question the figure) sets the **contact**. When a spot and a contact are both set, they are one joint (`part` the contact's file, `onto` the spot's) and the page answers; the worker's next question shows the part moved. A part already joined keeps its joint until a new pair of marks names it again; Undo drops the joint last made; Reset drops them all. No mode button, so it works with a finger (§14, Q3): the pins (§6.5) say what was set. A part that is in place by its file needs no mark: Confirm accepts what is shown.

### 6.3 The meet question about the base (`about: 'base'`)

```
┌──────────────────────────────────────┐
│ figure + base                   (h2) │
│ Where do they meet?                  │   #meet-question (COPY.askMeet)
│ Tap the spot on the base, then the   │   #meet-hint (COPY.meetHint)
│ contact on the figure.               │
│ Set where you marked · raised 0.5 mm │   #meet-placement (describeMeeting), after both marks
│ [Raise 0.5 mm][Lower 0.5 mm]         │   #meet-lift
│ [Turn −15°][Turn +15°]               │   #meet-turn
│ [Reset marks]                        │   #meet-reset
│ [ Yes, convert ]                     │   #meet-confirm (COPY.confirmUp)
│ [Cancel]                             │
└──────────────────────────────────────┘
```

Before both marks are set, the page lays the two **apart**: the base where the worker puts it (centred on the origin), the figure to its right with `APART_GAP_MM = 10` _(proposal)_ between the two boxes (the page adds the offset to the figure's `shown` translation; nothing else is composed on the page). Once `placement` arrives, the parts stand as the worker's transforms say and the offset is dropped: the assembled mini, the base's frame being the scene. Raise, Lower and Turn are answers (`liftMm` by `LIFT_STEP_MM`, `turnDeg` by `TURN_STEP_DEG`, on the meeting as it is); "Reset marks" answers `meeting: null`. The camera does not move between the two states (`setCamera` only on the first question of the conversion, as #92 reframes a new mini).

**Reaching the meeting on request.** The figure's question (`#ask`, #92) gets a second button next to Confirm, `#ask-mark` "Mark where they meet" _(proposal, COPY.markMeeting)_, shown at the figure's question of a pair; it confirms the orientation on screen with `meet: true`. After a conversion, the Base section gets the same button (§6.4). A conversion of a mini with parts asks the parts question whenever the files are new (§6.6); the meeting of figure and base is never asked without the button or the section.

### 6.4 The Base section after a conversion

`<fieldset id="pair">` becomes "Base and parts" _(proposal)_: the files line lists every file with its role (`Base: base.stl · Figure: body.stl + wing-l.stl + wing-r.stl`); the placement line says `Set where you marked` (`describePlacement`, method `marked`; with `· raised 0.5 mm, turned 15°` when the meeting has them _(proposal)_); a parts line `Parts: wing-l where its file puts it · wing-r marked` (`describeParts`) when there are parts. Buttons: **Mark where they meet** (`#mark-meeting`: converts again with `ask: { up: false, baseUp: false, parts: false, meet: true }`, so only the meet question comes, with both meshes), **Mark where the parts meet** (`#mark-parts`, parts only: `ask: { parts: true }` alone), Swap (two files), Remove the base (drops the marks too, `choices.placement = {}`). After a marked placement, **Raise, Lower and Turn** in the section change `choices.placement.marks.liftMm` and `.turnDeg` along and about the spot's normal, previewed by `viewer.setFigureOffset` with the spot's normal as its axis (scene mm, the base's units × `sizing.scale`), and Apply converts; **Move by hand is disabled** with the title "Mark again to move a marked figure" (§14, Q4). `figurePlacement()` (the feedback record) keeps its shape and reads the preview along the normal.

### 6.5 The viewer

- `viewer.showShown(entries: { mesh, rotation, translation }[], box)` replaces `showQuestion`/`turnQuestion`: one `THREE.Mesh` per file in the question material under one holder in the pivot (so the turn preview of #92 turns the whole), each at its transform; a later call with the same files only moves them (the geometries stay on the GPU; a file not shown before is added, one no longer shown is removed). `setCamera(34, 22, 1)` on the first call of a conversion.
- `viewer.pick(x, y): { file, point } | null`: a `Raycaster` from the canvas point over the shown meshes, nearest hit; the hit point in the mesh's local coordinates (`worldToLocal`), which are the file's. Brute force: three.js tests every triangle; §8 has the budget.
- `viewer.setPins(pins: { file, point, normal, kind: 'spot' | 'contact' }[])`: a disc of `PIN_RADIUS_MM = 1.5` _(proposal)_ (scaled by the mini's size, at least 4 px on screen: `PIN_MIN_PX = 4`) and a line of three radii along the normal, a child of the file's mesh so it moves with the part; spot and contact in two colours of `style.css` (`--pin-spot`, `--pin-contact`).
- The grid does not hide the parts from below: OrbitControls may go under the horizon (`maxPolarAngle` stays π), because a sole is marked from below. `verify-3d` takes a screenshot from below to prove it.
- `clear()` releases the pins and every shown mesh.

### 6.6 State, choices and which conversions ask

`state.question: (Omit<Question, 'meshes'> & { name: string; serial: number }) | null`; `state.page` is `asking` at any question. After every conversion the page takes `result.choices` into `choices` (now with `parts` and `placement.marks`).

| What starts the conversion                                               | `ask.up` | `ask.baseUp` | `ask.parts` (parts only) | `ask.meet` |
| ------------------------------------------------------------------------ | -------- | ------------ | ------------------------ | ---------- |
| Files dropped or picked                                                  | yes      | yes          | yes                      | no         |
| Add a base file                                                          | as #92   | yes          | no                       | no         |
| Remove the base                                                          | as #92   |              | no                       | no         |
| Swap, or the base select at a question                                   | yes      | yes          | yes                      | no         |
| Mark where they meet (Base section)                                      | no       | no           | no                       | yes        |
| Mark where the parts meet (Base section)                                 | no       | no           | yes                      | no         |
| Adjust: up, size, placement Apply; `loadDemo`, the benchmark; `?ask=off` | no       | no           | no                       | no         |

### 6.7 Wording _(in `page-state.ts`, unit-tested; proposals)_

| Key or function                      | Text                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COPY.askParts`                      | "Are the parts where they belong?"                                                                                                                      |
| `COPY.partsHint`                     | "Tap the spot on a part that is in place, then the contact on the part that goes there."                                                                |
| `COPY.confirmParts`                  | "Yes, the parts are in place"                                                                                                                           |
| `COPY.askMeet`                       | "Where do they meet?"                                                                                                                                   |
| `COPY.meetHint`                      | "Tap the spot on the base, then the contact on the figure."                                                                                             |
| `COPY.markMeeting`                   | "Mark where they meet"                                                                                                                                  |
| `COPY.markParts`                     | "Mark where the parts meet"                                                                                                                             |
| `COPY.undoMark`, `COPY.resetMarks`   | "Undo the last mark", "Reset marks"                                                                                                                     |
| `describePlacement` (`marked`)       | "Set where you marked", then " · raised 0.5 mm" / " · lowered 0.5 mm" / ", turned 15°" as set                                                           |
| `describePart(part, name)`           | "wing-l · where its file puts it" · "wing-r · marked" (with raised/turned as above) · the body: "body · the body"                                       |
| `describeMeeting(placement)`         | the placement line at the meet question: `describePlacement` of it; "Tap the spot on the base, then the contact on the figure." while a mark is missing |
| `describeTooManyFiles(max)`          | "Drop up to 6 files: a figure, its base and its parts."                                                                                                 |
| `STEP_LABELS.assemble`               | "Putting the parts together"                                                                                                                            |
| `PROBLEM_MESSAGES['too-many-files']` | the same line as `describeTooManyFiles`                                                                                                                 |

### 6.8 Hooks (`window.__mt`)

- `state.question` with `kind`, `about`, `parts`, `placement`, `marks`, `shown`.
- `mark(file, point)`: as a tap on that file at that point (file coordinates); resolves when the question that comes back is on screen. `pickAt(x, y)`: the tap itself, canvas pixels, for a test of the raycast; returns what `viewer.pick` found.
- `liftMeeting(mm)`, `turnMeeting(deg)`, `undoMark()`, `resetMarks()`: answers; resolve when the next question is on screen. `confirmMeet()`. `askToMark()`: the button at the figure's question. `markMeeting()`, `markParts()`: the Base section's buttons.
- `answerUp`, `confirmUp`, `swapAtQuestion` as #92; `chooseBase(file | null)`: the select at the base's question.

## 7. Unattended runs and records

- **`scripts/lib/answer-up.mjs`**: `convertAnswering(page, pick)` answers an `up` question with `confirmUp(pick(question))` as today and a `meet` question with `confirmMeet()` after `pick` returned `{ meeting }` or `{ joints }` (then the page answers them first) or `{}` (what is shown). `asDetected` returns `{}` for every kind.
- **`npm run corpus`**: a corpus figure's parts sit next to it as `<name>-part-<label>.stl` (`flying/flying-05-part-wing-left.stl`) _(proposal, the convention of `-base.stl`)_; `corpusFiles()` leaves them out and `partFilesFor(figure)` lists them sorted; the run picks `[figure, base?, ...parts]`. `--up index` answers the parts and meet questions from `scripts/corpus-placements.json` when a record has `choices.parts` or `choices.placement.marks`, else confirms what is shown. `results.json` gets `parts` per mini (source and joint per part) and `pair.placement.method`; `results.md`'s Base files table gets a Parts column; the placement sheet shows the assembly (the merged mini at level 0 as today: the assembly is in it).
- **`npm run feedback`**: nothing new to drive: the PM presses "Mark where they meet" on the page, marks, and presses S; the record holds `choices` (with the marks in file coordinates) and `placed` as today, plus `marks: stats.pair.placement.marks` and `parts: stats.pair.parts`. `score-placements` passes a record's `choices.parts` and `choices.placement.marks` on when scoring "the record's axis" (so the recorded assembly is what the automatic placement of the figure is compared with) and never to the automatic run itself. `PlacementRecord.verdict` gains nothing: a marked placement is `placed`.
- **`scripts/corpus-index.json`**: `parts` per mini is not needed (the files name themselves); an optional `partsNote`.
- **`scripts/measure-place.mjs`**: also times `resolveMark` and `placeMarked` on the largest pair, against `MARK_RESOLVE_BUDGET_MS` (§8).
- **e2e.** `pair.spec.ts`, `up-question.spec.ts` and the others keep passing unchanged in what they assert (`?ask=off` or confirmations); the marks get `e2e/meet.spec.ts`, the parts `e2e/parts.spec.ts` (§10).

## 8. Budgets _(proposals)_

```ts
// marks.ts
export const MARK_NORMAL_RADIUS_MM = 1;
export const MARK_NORMAL_CONE_DEG = 60;
/** One answer at a meet question, resolved in the worker, on the largest corpus pair (development PC, Node): a pass over the marked file's triangles and the figure's vertices. */
export const MARK_RESOLVE_BUDGET_MS = 300;
// page
/** A tap's raycast over the parts on screen, on the largest corpus file. */
export const PICK_BUDGET_MS = 300;
export const MAX_PARTS = 6;
```

Expected on the development PC: a mark on a 1 M-triangle base under 20 ms, on the 5.6 M-triangle figure 40–60 ms for the pass plus 20 ms for the vertices (`placeMarked` turns them once); a raycast in three.js over 5.6 M triangles 150–400 ms (no BVH; the number is a guess from three's per-triangle test, to be measured in step 7). Over the pick budget on an ordinary mini: stop (§12); on the largest file alone, report it. Time to the parts question of a kit (read and weld of every part): reported like the time to the question of #92, not gated (a kit is several files, as a pair is two: the PM's decision of #92 §14.7 extends).

## 9. Where the code goes

- **`src/lib/pipeline/marks.ts`** (new): `MarkPick`, `Mark`, `Meeting`, `PartJoint`, the constants, `nearestTriangle`, `resolveMark`, `meetingRotation(nContact, nSpot, turnDeg)`.
- **`src/lib/pipeline/assemble.ts`** (new): `PartsOptions`, `PartResult`, `assembleFigure(meshes, figureFiles, joints)`, `jointTransform`, `MAX_PARTS`.
- **`src/lib/pipeline/place.ts`**: `PlacementOptions.marks`, `Placement.method 'marked'` and `.marks`, `SpotKind 'marked'`, `placeMarked`, the branch in `placeOnBase`, `PairResult.parts`, `placement | null`.
- **`src/lib/pipeline/pair.ts`**: `Pairing` over N files, `baseFile: number | null`, `guessRoles` over N, `figureFiles`, `bodyFile`.
- **`src/lib/pipeline/orient.ts`**: `Orientation.method 'marked'`; `PlacedMesh.shift`.
- **`src/lib/pipeline/ask.ts`**: `Question`, `Answer`, `MeetQuestion`, `MeetAnswer`, `Shown`, `AskOptions.parts`/`.meet`, `AskedUp.role`.
- **`src/lib/pipeline/run.ts`**: `moreStl`, `parts`, the `assemble` step and its question, the base select in the loop, the meet question in the place step, `choices.parts` and `.placement`.
- **`src/lib/pipeline/memory.ts`**: `estimateAssemblyBytes`. **`problems.ts`**: `too-many-files`.
- **`src/lib/worker/protocol.ts`, `handle.ts`, `client.ts`**: §5.
- **`src/lib/index.ts`**: the types `Question`, `Answer`, `MeetQuestion`, `MeetAnswer`, `Shown`, `MarkPick`, `Mark`, `Meeting`, `PartJoint`, `PartsOptions`, `PartResult`; the value `MAX_PARTS`. `index.test.ts` pins them. The README's call shows a mini of several files.
- **`src/page/page-state.ts`, `main.ts`, `viewer.ts`, `index.html`, `style.css`**: §6.
- **`src/regression/shapes.ts`, `measure.ts`, `baseline.json`**: §10 step 1 (the marked case) and step 2 (the parts case).
- **`scripts/lib/answer-up.mjs`, `corpus-files.mjs`, `corpus.mjs`, `feedback-session.mjs`, `placements.mjs`, `score-placements.mjs`, `measure-place.mjs`**: §7.
- **`e2e/meet.spec.ts`, `e2e/parts.spec.ts`** (new).

## 10. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green from step 7 on. No existing regression case moves at any step; the two new cases are added with `npm run baseline:update` in their step.

1. **Marks and the marked placement.** `marks.ts`, `placeMarked`, the options and result fields, `Orientation.method 'marked'`, `PlacedMesh.shift`. Tests (`marks.test.ts`, `place.test.ts`, `run.test.ts`): `resolveMark` on the generated recess base at the recess floor's centre gives `[0, 1, 0]` exactly and the point as given; on `generateBumpySheet` a normal within 5° of the sheet's mean normal and never a single bump's; the nearest triangle of a point on an edge is one of the two sharing it; the peg figure marked at its peg's end centre into the hole base marked at the hole's floor centre lands the peg's axis on the hole's axis within 0.01 mm and its tip on the floor (lift 0), `method: 'marked'`, `spot.kind: 'marked'`, `candidates` empty, the figure's `orientation` unchanged (the identity meeting) and its `method` too; the same figure on a plate tilted by 30° (`generatePlate` turned by a 3-4-5 rotation, marks on the plate's face) stands tilted by the plate's angle (`placement.marks.rotation` within 0.01°, `orientation.tiltDeg` ≈ 36.87, `method: 'marked'`); `liftMm: 1` moves it 1 mm along the plate's normal, `turnDeg: 90` turns it about the normal and leaves the contact point; two marks with equal normals give a half turn and no error; the pair path without `marks` is bit-identical (the baseline does not move; `npm run score-placements` gives the same table as on `main`); `choices.placement.marks` converts the same pair again to the same bits without questions. Regression: `REGRESSION_CASES` gains `peg-marked-in-hole` (the peg figure and the hole base of `place.test.ts` moved to `shapes.ts`, with the two marks in the case's options; expected `spot: 'marked'`); `baseline:update` adds its row.
2. **Parts.** `assemble.ts`, `moreStl`, roles over N, the `assemble` step, `PairResult.parts`, `estimateAssemblyBytes`, `too-many-files`. Tests (`assemble.test.ts`, `pair.test.ts`, `run.test.ts`): a generated figure cut into a body and a "wing" (a box against its side, in place in the file) assembles to the same bits as the one-piece mesh (`generateWingedFigure()` in `shapes.ts` returns both the one-piece soup and the parts); the wing moved 50 mm away in its file and joined by a spot on the body's flank and the contact on the wing's root comes back within 0.01 mm of the one-piece mesh; a joint onto a part that has its own joint resolves after it; roles over three files: body + wing + base finds the base, body + wing without a base gives `no-flat-underside` with `propose` and `baseFile: null` makes parts of one figure that run the single-file path after assembly; `stats.pair.parts` lists the triangles in order; seven files are refused before reading; the one- and two-file paths are bit-identical (the baseline does not move). Regression: `figure-in-parts` (the winged figure as body + wing in place, with the recess base; expected the same levels' figures as `figure-on-base` within `RELATIVE_TOLERANCE`, and `spot: 'recess'`).
3. **The questions.** `Question`/`Answer`, `shown`, `meshes`, the parts question, the meet question, `meet: true`, `baseFile` in an answer, `ask.parts`/`.meet`, `AskedUp`. Tests (`run.test.ts`): a pair's questions carry `shown` with one entry each and the meshes once; a kit asks about its parts first with every part's mesh, then the base, then the figure with one `shown` entry per part; a joint answered at the parts question moves the part in `shown` and in the union; `baseFile: null` at the base's question starts again with the parts and ends without a place step; `meet: true` at the figure's question brings the meet question with both files shown, a `meeting` answer brings `placement` back and a confirming one converts with `method: 'marked'`; `meeting: null` brings `placement: null`; `ask.meet` asks it without the button; `waitedMs` is in no step; converting again with `result.choices` and no callback gives the same bits.
4. **The protocol.** `moreStl` in the transfer list, the union payloads, the transfer of `meshes`. `handle.test.ts`, `client.test.ts`.
5. **The library entry.** Types and `MAX_PARTS`; the README.
6. **State and wording.** `page-state.ts` (§6.7), `pageStateOf` unchanged, unit tests for every string.
7. **The page.** `viewer.showShown`, `pick`, `setPins`; the sections; taps; the hooks; the Base section; more files. `e2e/meet.spec.ts` (the generated puddle figure and the recess base through `#file`): `askToMark()` at the figure's question brings `kind: 'meet'` with the two apart (the figure's `shown` translation offset by the page); `mark(base, floor centre)` sets a spot pin, `mark(figure, sole centre)` a contact pin and the placement line "Set where you marked"; `liftMeeting(0.5)` says "raised 0.5 mm"; `pickAt` on the canvas over the base returns the base and a point on its top (the raycast works, and its time is recorded in the test's output); `confirmMeet()` converts once (`progressLog` has one `simplify`), `stats.pair.placement.method === 'marked'`, the Base section says "Set where you marked", `markMeeting()` from the section asks only the meet question (`stats.asked` has one entry, role `meet`); Move by hand is disabled after it; `resetMarks()` then Confirm converts with the automatic placement. `e2e/parts.spec.ts` (the winged figure's body and wing, the wing moved apart in its file, and the recess base): three files stop at the parts question with both parts shown, the wing lying apart; two `mark` calls join it and the union stands; Confirm continues to the base's question, then the figure's; the heading reads `body + wing + recess-base`; the parts line in the Base section; a body and a wing without a base: `chooseBase(null)` at the base's question, the parts question, the mini's question, `stats.pair.placement === null`; seven files give the error line. Screenshots with `verify-3d`: the two apart with one pin set, the assembled pair with both pins, the parts question with a wing apart, and the meet question on a phone-sized viewport (the sheet closed, the pins visible), and the figure seen from below the grid.
8. **Scripts and numbers.** `answer-up.mjs`, the corpus part convention, `--up index` from records, the feedback record's fields, `score-placements`, `measure-place.mjs` with the marks (development PC, Node, the largest corpus pair: `resolveMark` on each file, `placeMarked`, against `MARK_RESOLVE_BUDGET_MS`). `measure-memory.mjs` on the largest kit in the corpus, against `estimateAssemblyBytes`.
9. **Corpus** (development PC, window in front). The PM copies one multi-part kit from the library into `corpus/` under a generic name with the `-part-<label>.stl` convention (the list of kits with their layout, in place or apart, is `out/research93/kits.txt` on the development PC; §14, Q6) and, in a feedback session, marks the bat's peg into its spire (`flying/flying-01`) and the kit's parts if they lie apart; the records are promoted into `scripts/corpus-placements.json`. `npm run corpus -- --no-bake --up index`: the bat and the kit assembled on their sheets; the time to the parts question; the untouched steps against the last run. The sheets are the PM's judgement (criterion 5).
10. **Docs.** `CLAUDE.md` (layout: `marks.ts`, `assemble.ts`, the `assemble` step, the questions, the hooks, the corpus convention, `MAX_PARTS`; conventions: parts and marks), the spec (a status line under story 10), `CONTRIBUTING.md` (the `-part-` convention, marking in a feedback session), the README, and the journal entry `docs/journal/2026-<mm>-<dd>-marks-where-parts-meet.md` (topics `placement`, `ui`, `worker`, `tooling`): the survey of §1 and what it changed, why marks are picked as points, why the parts question is mandatory and the meeting on request, every number with its device, what went wrong.

## 11. Out of this note

- Finding pegs and holes in vertical faces automatically, cutting a figure off a printed base, scaling parts separately: out by the issue.
- Adding parts to a mini already on screen (a button like "Add a base file"): drop the files together for now.
- A test that tells an in-place kit from a plate layout automatically (the survey's bounding boxes are a survey, not a rule): the parts question is the test, one click.
- Showing the automatic placement of a pair before reduction (the meet question with the #70 rules previewed): §14, Q2 names it as the alternative; it is a follow-up if the PM wants it.
- Several spots on one part (a figure standing on two separate rocks, both marked): one meeting per part.
- A worker that keeps the welded meshes after a conversion, so "Mark where they meet" in the Base section does not read and weld again (7 s on the largest pair): the follow-up every note since #44 names.

## 12. When to stop and ask

- **A path without marks or parts is not bit-identical**: the baseline moves on an existing case, `score-placements` changes a row, or a pair without `marks` places differently after step 1 or 2.
- **A tap takes longer than `PICK_BUDGET_MS` on an ordinary corpus mini** (the 1.25 M-triangle humanoid) on the development PC. Report the numbers; a BVH on the page (three-mesh-bvh, a dependency, or a ray query on `bvh.ts` behind the library entry) is the PM's call.
- **The largest kit's peak memory is above `estimateAssemblyBytes`** (step 8), or a six-part kit of ordinary files does not fit the estimate on the reference laptop's budget.
- **The kit the PM chose is not one the tree can express** (a part that meets two others, a part with no surface to tap on a phone). Report; the second meeting per part is §11.
- **Criterion 5 cannot be ticked from the development PC**: the sheets are the PM's judgement; leave the box unticked and list the two minis under "Needs a human look".
- A decision of §14 turns out to cost more than it looked; a criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 13. How each criterion is proven

| Criterion (issue #93)                                                                                                                                                                                                            | Proof                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Two files, both upright, shown apart at full detail; a spot on the base and a contact on the figure, each a surface point with its normal from the full geometry                                                              | `marks.test.ts` (step 1: the normal of a flat floor and of a bumpy sheet, the point kept); `e2e/meet.spec.ts` (step 7: apart, two pins); screenshots                                                                  |
| 2. The contact meets the spot: normals opposed, points coincident; raise and lower along the spot's normal, turn about it; "Set where you marked"; nothing guessed once a mark exists; the automatic placement stays the default | `place.test.ts` (step 1: the peg in the hole, the tilted plate, lift and turn, `candidates` empty); `describePlacement` unit test; `e2e/meet.spec.ts` (the line, Reset marks → automatic); the baseline unchanged     |
| 3. Marks kept in the result and the records like a manual placement (`method: 'marked'`, the points and normals in the base's frame); the feedback mode records them                                                             | `run.test.ts` (step 1: `placement.marks`, `choices` reproduce); `e2e/feedback.spec.ts` (step 8: the record's `marks` and `choices`); `scripts/corpus-placements.json` with the bat (step 9)                           |
| 4. Several files; each file after the first placed against a part already placed, by its file or by one pair of marks; one mesh before reduction; `MAX_PARTS = 6`                                                                | `assemble.test.ts`, `run.test.ts` (step 2: in place, a joint, the chain, seven files refused); `e2e/parts.spec.ts` (step 7); the regression case `figure-in-parts`. The default "where the files put them" is §14, Q1 |
| 5. The corpus gets one multi-part mini and the bat pair with its peg marked; the sheets show them assembled, judged by the PM                                                                                                    | step 9: the sheets, the records, the corpus report; the PM's verdict on the PR                                                                                                                                        |
| 6. Marking works on a phone-sized screen with a finger                                                                                                                                                                           | `e2e/meet.spec.ts` on a phone viewport with `page.touchscreen.tap` (step 7); the screenshot; comfort is the PM's note                                                                                                 |

## 14. Questions for the PM

Asked on the hand-over PR; the build proceeds with the proposals.

1. **Parts default: "where the files put them", with a mandatory parts question, instead of one pair of marks per part** (criterion 4). The survey of §1: 34 of 50 winged kits are exported in place, 7 apart, 8 mixed. Proposal: a part without marks stays where its file puts it, the parts question shows the assembly before anything is reduced, and marks fix the parts that lie apart. One click for a kit in place; marks only where needed. The alternative is the criterion as written: every part marked, every time.
2. **The meeting of figure and base on request** (a button at the figure's question and one in the Base section), not a stop for every pair. Keeps a pair at two clicks. The alternative: a third stop for every pair that previews the automatic placement of #70 before reduction and offers the marks there; one more click on every pair and more to build (the place decision before the stop), but the person sees a wrong guess before the conversion instead of after. This note treats it as a follow-up (§11).
3. **Tapping without a mode**: a tap on a part in place is the spot, a tap on a part not yet placed is the contact; the pins say which is which. The alternative is two buttons ("Mark the spot", "Mark the contact") that set a mode.
4. **After a marked placement, Adjust offers Raise, Lower and Turn along and about the spot's normal, and Move by hand is disabled**: to move a marked figure, mark again. The alternative keeps the move gizmo and treats a move as a shift of the spot along the surface, which is not what a spot is.
5. **`Orientation.method: 'marked'`** and the composed rotation in the result and the GLB when the marks tilt the figure; the confirmed orientation stays when they do not.
6. **Which kit for the corpus** (criterion 5): the PM picks from `out/research93/kits.txt` on the development PC (kit, layout, part count). Proposal: one kit whose parts lie apart (marks are exercised), and if a second is cheap, one in place with its base in the same frame (the default and the registration test are exercised). Generic names, `-part-<label>.stl`.
7. **"No base: the parts of one figure" at the base's question** (`baseFile: null`), also for two files: a body with an integral base and a separate pair of wings is two files without a base file. The alternative refuses two files without a flat underside on the page, as before #92.

### PM decisions (2026-09-30, [PR #95 comment](https://github.com/Tiarin-Hino/meshtavern-converter/pull/95#issuecomment-5910656041), Q1 clarified in the build session the same day)

1. **Parts default as proposed, and the proposal is shown as marks.** Parts stand where their files put them, and each question that places something shows the proposed placement with pins at the points where the parts meet: for a part in place by its file, the nearest points between it and the part it touches; for the figure on its base, the automatic placement's spot and contact. The person accepts, or taps to mark their own. Parts that lie apart get no guessed marks: nothing new is detected.
2. **The meeting of figure and base is shown before the conversion, for every pair**: the alternative. The meet question about the base is a third stop after the figure's question, showing the automatic placement of #70 with its pins; `ask.meet` defaults to true for a pair. The "Mark where they meet" button at the figure's question is not built.
3. **One tap, no mode**: as proposed.
4. **Raise, Lower and Turn along and about the spot's normal at the questions, once marks are set; none after the conversion.** After a marked placement the Base section offers no Move, Raise, Lower or Turn; "Mark where they meet" converts again with the meet question.
5. **`Orientation.method: 'marked'`** with the composed rotation: as proposed.
6. **The corpus kit and the marking session.** The minis are the ones placed by hand or called hard before (the records of `scripts/corpus-placements.json` that are not `right`, and the bat `flying/flying-01`), and the kits the PM adds. The PM marks them in a session that opens each in turn with every question, bakes it, and writes a results file that later conversions and the corpus run read to place those minis again without asking.
7. **No base as proposed; once no base is confirmed, the meeting with a base is skipped.**
