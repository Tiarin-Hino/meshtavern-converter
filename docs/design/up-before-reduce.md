# Design: show which way is up before anything is reduced (#92)

Status: design pass by Fable 5.1, 2026-09-29, for Opus 5.5 to build · Spec: Phase 1, stories 11 (#72) and 10 (#70), follow-up asked for by the PM on 2026-09-29 · Issue: #92 · Sibling: #93 (marks where the parts meet; it builds on the stop designed here)

This note fixes the decisions the build should not have to make: how a conversion stops after the orient step and waits for a person, what travels to the page and back, how a pair asks about its base and then its figure, what the result records, what the page shows and which conversions ask at all, how unattended runs answer, the budgets, and the build order with the test that proves each step. Product behaviour comes from the issue; where this note picks a number or a wording, it is a named constant or a `COPY` string marked _(proposal)_ and the PM can change it. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§11).

Corpus minis are named by their generic index names (`large-creature/large-01`), never by their product names, here and in everything the build writes.

## 1. What the problem looks like

The corrections of #72 and #70 exist (the six-way select, the free turn, Set down), but they sit behind a finished conversion, and each one converts again. What comes before the first useful look is mostly the reduction:

| Mini (development PC, Chrome 153, no bake) | Triangles | read + weld + orient  | simplify alone |
| ------------------------------------------ | --------- | --------------------- | -------------- |
| `terrain/terrain-03`, the smallest         | 0.14 M    | 0.08 s                | 0.3 s          |
| median of the 30 corpus minis              | 0.5 M     | 0.34 s                | 1.6 s          |
| `humanoid/M-001a`, an ordinary mini        | 1.25 M    | 0.6 s                 | 2.0 s          |
| `large-creature/large-01`, the largest     | 5.6 M     | 5.4 s                 | 64 s           |
| the same with its base file (a pair)       | 6.1 M     | 8.2 s (+ 0.4 s place) | 79 s           |

Single files: `out/corpus/results.json`, 2026-09-23, before #72 made the orient pass faster (the largest file's orient step went from 1.95 s to 0.76 s, #72 journal). Pairs: `out/corpus-70b/results.json`, 2026-09-29. Both runs were started unattended, so they are upper bounds.

Three facts shape the design:

- **Everything the question needs exists after the weld.** The orient step's pass (`resolveOrientation`) already yields the proposal; the welded mesh is the full-detail sculpt the issue wants shown. The stop costs a copy of that mesh and nothing else.
- **The worker can wait.** Pipeline steps block the worker, but between steps `runPipeline` is an `async` function: while it awaits an answer, the worker's message loop is free and an answer can arrive. Cancelling stays what it is (the worker is ended).
- **For a pair, the figure's up is decided by the pair.** A registered pair stands the figure the way its base does, and a confident print cut overrides the detector (#70, design note §4.4 and §12). What the question shows for the figure must be what the pipeline would do, or the person confirms one thing and gets another.

## 2. The decision: one job that stops and asks

The issue leaves two shapes open. **Chosen: one conversion job that stops after orient, posts a question, and continues when the answer arrives.** Inside the pipeline it is a callback (`askUp`), so the pipeline stays free of workers and DOM and is testable in Node with a plain function.

|                                            | One job that stops (chosen)                                                                                                    | Two jobs (an orient job, then the full job)                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read and weld                              | once                                                                                                                           | twice: the second job reads and welds again, +3.5 s on the largest file, +0.5 s on an ordinary one (development PC), and the page reads the file from disk twice |
| Trying an axis or Set down at the question | a message to the waiting worker, answered from the pass it kept (no triangle loop; Set down is three passes over the vertices) | a job per try, each reading and welding again, or the orientation code exported to the page                                                                      |
| What is confirmed is what converts         | the same welded mesh and the same pass continue                                                                                | two runs over the same bytes; equal only because the pipeline is deterministic                                                                                   |
| Worker state                               | a promise per waiting job                                                                                                      | none                                                                                                                                                             |
| Cancel                                     | as today: end the worker                                                                                                       | as today                                                                                                                                                         |
| A pair's two questions and a swap          | a loop inside the orient step                                                                                                  | three or four jobs                                                                                                                                               |

A third shape, a worker that keeps welded meshes between jobs so that every later correction restarts from orient, is the follow-up the #44, #72 and #70 notes each named. It is not this story (§12): it changes what the worker holds after a conversion and needs its own memory budget.

**Without the callback nothing changes.** `runPipeline` without `askUp` runs the code it runs today: the regression baseline, `placePairOnly`, the benchmark and every script that calls the pipeline in Node are untouched, bit for bit (§11).

## 3. Data shapes

### 3.1 The question and the answer (`src/lib/pipeline/ask.ts`, new)

```ts
/** Which file a question is about: the only file, or for a pair the base first, then the figure. */
export type UpRole = 'mini' | 'base' | 'figure';

/** Why the file stands as the question shows it: what the page puts into words. */
export type UpReason =
  /** A flat underside of its own decided (`Orientation.method` `base`). */
  | 'base'
  /** No base: the taller of Y-up and Z-up (`tallest`). */
  | 'tallest'
  /** The figure of a pair: its print cut (`cut`, #90). */
  | 'cut'
  /** The figure of a pair: the files were exported together, so it stands the way its base does. */
  | 'registered'
  /** The base file: its flat underside within `UNDERSIDE_BAND_MM` (`FileOrientation.how` `band`). */
  | 'underside'
  /** The base file: its dominant plane, a tilted export (`dominant-plane`). */
  | 'tilted'
  /** The base file after a swap, without an underside: the up detection's guess (`detector`). */
  | 'guess'
  /** An axis or a turn that was chosen: by the person at the question, or by the options the conversion came with. */
  | 'chosen';

export interface UpQuestion {
  role: UpRole;
  /** Which of the files given: 0 the first, 1 the second. */
  file: 0 | 1;
  /** How the file stands now: the proposal, or what was last tried. */
  orientation: Orientation;
  reason: UpReason;
  /**
   * The box of the mesh turned by `orientation.rotation`, scene axes, file units, before
   * any shift: the page stands the mesh on the grid with it.
   */
  box: { min: Vec3; max: Vec3 };
  /** The base the file would stand on, measured as the pipeline will measure it; null without one. */
  base: BaseMeasurement | null;
  /**
   * The welded mesh in file coordinates, positions and indices only: a copy, sent the first
   * time a file is asked about and never again. The page turns it by `orientation.rotation`.
   */
  mesh?: IndexedMesh;
}

export interface UpAnswer {
  /**
   * How the file should stand, resolved from scratch like `PipelineOptions.orientation`:
   * an axis, a rotation, Set down. Empty: as the converter proposes.
   */
  orientation: OrientationOptions;
  /** True: this is right, go on. False: show me how this stands (the question comes again, without the mesh). */
  confirm: boolean;
  /** A pair only: the other file is the base. The roles are exchanged and the questions start again with the base. */
  swap?: boolean;
}

/** Asked between the orient step and everything after it. Rejecting ends the conversion with that error. */
export type AskUp = (question: UpQuestion) => Promise<UpAnswer>;

/** Which files are asked about. A file that is not asked about stands as its options say, as today. */
export interface AskOptions {
  /** The single file, or the figure of a pair. Default true. */
  up?: boolean;
  /** The base file of a pair. Default true. */
  baseUp?: boolean;
}

/** One confirmed question, for the figures. */
export interface AskedUp {
  role: UpRole;
  /** Answers with `confirm: false` before the confirming one: 0 is the one click of a right detection. */
  tries: number;
  /** From posting the first question of this file to its confirming answer. Not part of any step's time. */
  waitedMs: number;
}
```

Decisions in these shapes:

- **An answer is absolute, not relative.** `{ up: '+x' }` means that axis, `{ rotation }` that rotation, `{}` the converter's proposal, exactly as the same object means in `PipelineOptions.orientation` today. The page composes a turn being tried out with the rotation last shown (`multiply(turn, question.orientation.rotation)`), as `applyTurn` does after a conversion. One meaning per object, one resolver (`resolveOrientation`).
- **The worker resolves, the page shows.** The page never computes an orientation. Every press of the select, Set down or Reset is an answer with `confirm: false`; the worker resolves it from the pass it kept and asks again with the resulting `Orientation`. The turn buttons and the gizmo stay a local preview in the viewer, as they are after a conversion; Confirm sends the composed rotation.
- **Confirm carries the final options.** The confirming answer is resolved like any other, so what the person sees when they press Confirm (a pending turn included) is what converts, and a script can confirm an axis in one message.
- **The mesh travels once per file.** Later questions about the same file carry only the orientation, the box and the base. A swap asks about the other file, whose mesh then travels once too.
- **No normals in the question's mesh.** The page draws it flat-shaded (§6.3), which needs none: no pass over the triangles in the worker, 34 MB less for the largest file.

### 3.2 Options

```ts
// PipelineOptions (run.ts) gains:
/** Stops after the orient step and asks which way is up. Left out, nothing is asked: the path of today. */
askUp?: AskUp;
/** With `askUp`: which files are asked about. */
ask?: AskOptions;
/** For a pair: the user's axis or turn for the base file. Left out, the base stands by its underside (#70). */
baseOrientation?: OrientationOptions;

// ConvertOptions (protocol.ts) gains `ask` and `baseOrientation`, not `askUp`: a function does not cross to a worker.
```

`Converter.convert(stl, onProgress, options, askUp?)` takes the callback as a fourth parameter. With it, the client sends `ask` (the given one, or both true); without it, the client removes `ask` from what it posts, so a question nobody would answer is never asked.

### 3.3 What the result records

```ts
// run.ts
/** The choices a conversion ended with. Converting the same files with them, and no questions, gives the same mini. */
export interface UpChoices {
  orientation: OrientationOptions;
  /** A pair only. */
  baseOrientation?: OrientationOptions;
  /** A pair only. */
  pairing?: PairingOptions;
}
// ConversionResult.choices and ConversionStats.choices: the same object.
// ConversionStats.asked: AskedUp[], in the order confirmed; empty when nothing was asked.

// place.ts, PairResult gains:
/** How the base file stands: its detection, or the user's choice. */
baseOrientation: Orientation;

// pair.ts, FileOrientation.how gains 'chosen': the user's axis or turn for a base file.
```

- `result.orientation` stays the figure's `Orientation`, exactly as chosen: a confirmed proposal keeps its method (`base`, `tallest`, `cut`), a changed one is `manual`. `Orientation` itself does not change shape, so the GLB (`extras.meshtavern.rotation`), the regression figures and every `toEqual` on an orientation stay as they are.
- `choices` is what the page and the table keep for the next conversion of the same files. A confirmed proposal is `{}`, not the proposal's rotation: for a pair a chosen rotation skips the registration test (#70), so writing the proposal back as a choice would place a registered figure differently the second time. Deterministic detection makes `{}` reproduce.
- `pairing.files[k]` holds each file's shape as it finally stands (the base's `up` as chosen); `pairing.warnings` stay as the guess computed them.

## 4. The pipeline: where it stops

### 4.1 One file

```
read → weld → orient: the pass, the proposal (options.orientation resolved, else the detection), placed
  └ askUp given and ask.up not false:
      question 1: role 'mini', the proposal, a copy of the welded mesh
      answer, confirm false → resolve(answer.orientation) with the kept pass, place, question again (no mesh)
      answer, confirm true  → resolve(answer.orientation) unless it is what stands already; go on
→ size → simplify → …
```

- `resolve` is `resolveOrientation(mesh, options, pass)` followed by `placeAs`; an empty `options` is the detection. Every resolved orientation is placed, because the question reports the base it would stand on; the last placed mesh is the one the pipeline continues with, the ones before are dropped.
- The conversion's own `options.orientation` is the first answer: a conversion that comes with `{ up: '+y' }` asks with that axis shown and `reason: 'chosen'`; Reset (`{}`) goes to the detection.
- **Time.** The orient step's entry in `timings` covers the pass, the proposal and every resolve; waiting is in none. A helper next to `begin` and `run` does that: `resume(step, work)` adds the time of `work` to the step's existing entry and announces nothing, so `timings` keeps one entry per step and the progress percentages stay what they are. `totalMs` therefore never contains a person's thinking time; `stats.asked[].waitedMs` has it.
- **The copy.** `copyForQuestion(mesh)`: `positions.slice()` and `indices.slice()`, nothing else. The worker keeps its own mesh; the copy's buffers are transferred to the page.

### 4.2 A pair

```
read → weld (both) → orient:
  each file stood the way a base would (baseOrientation), roles guessed (guessRoles; not-a-pair is thrown here, before any question)
  base proposal: options.baseOrientation resolved ('chosen'), else the file's standing (#70)
  └ ask.baseUp: question, role 'base' … until confirmed
        answer.swap → pairing.swap toggled, roles again, baseOrientation and orientation reset to {}, start again with the new base
  base placed (placeOriented)
  figure proposal, in this order:
     options.orientation chosen          → resolved, reason 'chosen'; no registration test, as today
     the registration test passes        → the base's rotation, reason 'registered'
     the print cut is confident          → reason 'cut'
     otherwise                           → the detection, reason 'base' or 'tallest'
  └ ask.up: question, role 'figure' … until confirmed (answer.swap: back to the base question)
        changed → resolved as chosen: no registration test, no second candidate
→ place (with what the orient step decided) → size → …
```

- **The decision moves in front of the question, the placing stays behind it.** Today `placeOnBase` reads the base's top, runs the registration test, picks between two candidates and places, in one call. With a question to ask, the first three happen in the orient step and are handed to the place step, which does not repeat them:

  ```ts
  // place.ts
  /** The base's top, read once. */
  export interface BaseTop {
    map: HeightMap;
    basins: Basin[];
  }
  export function readBaseTop(base: PlacedMesh): BaseTop;

  /** How the figure of a pair stands before it is placed: registered, or the candidate that touches the base better. */
  export interface FigureDecision {
    top: BaseTop;
    /** Which of the candidates stays: 0 the first, 1 the alternative. */
    candidate: 0 | 1;
    /** The figure where its file puts it, when the pair is registered; else null. */
    registered: { mesh: IndexedMesh; heightMm: number } | null;
  }
  export function decideFigure(
    figure: PlacedMesh,
    base: PlacedMesh,
    files?: PairFiles,
    alternative?: PlacedMesh,
  ): FigureDecision;

  // placeOnBase gains a last, optional parameter `decided?: FigureDecision`.
  ```

  `placeOnBase` calls `decideFigure` itself when `decided` is left out, so its body is the same statements in the same order and **a conversion without questions runs the place step exactly as today** (one code path for the decision, two places that call it). With questions, `run.ts` calls `decideFigure` inside the orient step (its time goes to `orient` through `resume`) and passes the result on. A figure the person changed gets a decision with `candidate: 0`, `registered: null` and the top already read.

- **What the figure's question shows** follows from the decision: registered, `orientation` is the base's (as `placeOrientedPair` sets it today), `box` is the box of `registered.mesh`; candidate 1, the alternative's orientation; else the first candidate's.
- **The base's own choice.** `chosenBase(mesh, options, pass)` in pair.ts returns a `FileOrientation` with `how: 'chosen'`: the detection is `resolveOrientation(mesh, options, pass)`; for a quarter turn `coverage` is the 2 mm underside coverage of that side (`undersideCoverage`) and `flatUnderside` whether it reaches `MIN_BASE_COVERAGE`; for any other rotation `flatUnderside` is true and `coverage` is `MIN_BASE_COVERAGE`, because the person said it is the base and the outline is measured after placing, as for a tilted export. `placeOriented` treats `chosen` like `band`.
- **Registration uses the base as confirmed.** `PairFiles.baseRotation` is the rotation of the base's final orientation, chosen or detected.
- Questions that are not asked (`ask.up` or `ask.baseUp` false) leave that file to its options, as today.

### 4.3 Memory

At the question the worker holds what it holds today after the orient step (the file, the triangle soup, the welded mesh, the placed mesh) and the page holds the copy: 100 MB for the largest file (34 MB positions, 67 MB indices), 23 MB for an ordinary 1.25 M-triangle mini. The conversion's peak comes later, in simplify. **The page gives the copy up when the last question is confirmed** (the geometry disposed, the arrays dropped), so the peak the memory estimate was fitted to (`BYTES_PER_TRIANGLE`, `scripts/measure-memory.mjs`) does not rise. Build step 10 measures it; if the peak of the largest file rises above its estimate, stop (§11).

## 5. The worker protocol

```ts
// protocol.ts
export type WorkerRequest =
  | { type: 'convert'; id: number; stl: ArrayBuffer; options?: ConvertOptions }
  /** The answer to the question last asked by job `id`. */
  | { type: 'answer'; id: number; answer: UpAnswer };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: Progress }
  /** The conversion waits until an `answer` with the same id arrives. The mesh's buffers are transferred. */
  | { type: 'question'; id: number; question: UpQuestion }
  | { type: 'done'; id: number; result: ConversionResult }
  | { type: 'error'; id: number; code: ProblemCode; detail?: string };
```

- **`handle.ts`** keeps `handleRequest(request, post)` as its one entry and a module-level `Map<number, (answer: UpAnswer) => void>` of waiting jobs. A `convert` whose options carry `ask` gets an `askUp` that stores its resolver under the job's id and posts the question (transfer list: `meshBuffers(question.mesh)` when there is a mesh). An `answer` resolves and removes the entry; an answer for an id that is not waiting is ignored. The entry is removed when the job ends either way.
- **`client.ts`**: a job keeps its `askUp`. On `question` the client calls it and posts `{ type: 'answer' }` with what it resolves to, unless the job is gone by then (cancelled). When `askUp` rejects, the job rejects with that error and the worker is restarted, like a cancel: the conversion cannot go on and its memory should be freed.
- **Cancel at the question** is `Converter.cancel()` as it is: the worker ends, the job rejects with `ConversionCancelled`, a fresh worker takes over. Nothing new.
- A second `convert` while one waits is possible in the protocol (ids keep them apart); the page never does it (`state.busy`).

## 6. The page

### 6.1 A fifth state: `asking`

`PageState` gains `'asking'`; `pageStateOf` returns it when `app.question !== null`, before it looks at `busy` (which stays true: a conversion is running, so a drop or a second pick is ignored as while converting, and Cancel works). The viewport shows the mesh and the panel lies over it as in `done` (a bottom sheet on a phone): every CSS rule that lays out `body[data-state='done']` applies to `asking` too; `#cancel` gets `data-in="converting asking"`.

The question gets its own section with its own controls, not the Adjust fieldset moved about: Adjust is a `<details>` that may be closed, and its summary promises four sections.

```
┌──────────────────────────────────────┐
│ figure + base                   (h2) │   #heading: the file names, as while converting
│ Base: base.stl                       │   #ask-file (pairs only; "Figure: figure.stl" for the second question)
│ Is this the right way up?            │   #ask-question
│ Standing on its flat underside.      │   #ask-found  (describeUp)
│ Up axis in file  [ +z ▾ ]            │   #ask-up
│ [Pitch −15°][Pitch +15°]             │   #ask-turn   (the same data-turn / data-deg buttons)
│ [Roll −15°] [Roll +15°]              │
│ ☐ Turn by hand                       │   #ask-turn-by-hand
│ Turned 30°                           │   #ask-pending
│ [Set down] [Reset]                   │   #ask-set-down, #ask-reset
│ [Swap figure and base]               │   #ask-swap   (pairs only)
│ [ Yes, convert ]           (primary) │   #ask-confirm
│ [Cancel]                             │   #cancel
└──────────────────────────────────────┘
```

`<section id="ask" data-in="asking">` in `index.html`, between `#cancel` and `#mini-size`. The handlers share their functions with Adjust's controls where the work is the same (`turn`, composing a rotation).

### 6.2 Wording _(all proposals, in `page-state.ts`, unit-tested)_

| Key or function                    | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COPY.askUp`                       | "Is this the right way up?"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `COPY.confirmUp`                   | "Yes, convert" (one file, or the last question of a pair); `COPY.confirmBaseUp`: "Yes, next: the figure"                                                                                                                                                                                                                                                                                                                                                                                                           |
| `COPY.askSetDown`, `COPY.askReset` | "Set down", "Reset"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `describeAskedFile(role, name)`    | "Base: base.stl" / "Figure: figure.stl"; null for `mini`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `describeUp(question)` by `reason` | `base`: "Standing on its base, 25 mm across." · `tallest`: "No base found, so the taller way was taken as up. Check it." · `cut`: "Standing on the flat cut of its feet." · `registered`: "Standing the way its base does: the two files were exported together." · `underside`: "Standing on its flat underside." · `tilted`: "Stored at an angle; standing on its flat underside." · `guess`: "No flat underside found. Check it." · `chosen`: "As you turned it." with ", set down by 4°" when `setDownDeg > 0` |
| `describeAskPending(turnDeg)`      | "Turned 30°"; null at 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `STEP_LABELS`                      | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 6.3 The viewer

- `viewer.showQuestion(mesh, rotation, box)`: the mesh in file coordinates under a group whose quaternion is `rotation` and whose position stands the turned box on the grid (x and z centred on the box, its lowest point on y = 0), inside the existing `pivot` at half the box's height, so `setTurn` and `setTurnGizmo` preview a turn exactly as they do after a conversion. Reframes the camera (`setCamera(34, 22, 1)`), as a new mini does.
- `viewer.turnQuestion(rotation, box)`: a later question about the same file: the group's quaternion and position change, the geometry stays on the GPU.
- **Material:** its own `MeshStandardMaterial`, `flatShading: true`, the colour of `DEFAULT_LOOK.base`, no vertex colours. Flat shading needs no normals and shows the sculpt as the file has it; the look is computed on the reduced level later and does not exist yet.
- `viewer.clear()` releases it; the page drops its references to the arrays at the same time (§4.3).

### 6.4 State, choices and which conversions ask

`AppState` gains `question: (Omit<UpQuestion, 'mesh'> & { name: string; serial: number }) | null` (`serial` counts the questions of a conversion, so a test can wait for the next one) and `questionMs: number | null` (§8). `choices` gains `baseOrientation: OrientationOptions`. After every conversion the page takes `result.choices` into `choices` (orientation, base orientation, swap), so a later conversion of the same files repeats what was confirmed.

A file is asked about when it is new to the person in this role; a conversion that only applies something they chose does not ask:

| What starts the conversion                                | `ask.up` (mini or figure)                                                                                                                          | `ask.baseUp` |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Files dropped or picked (`loadFiles`)                     | yes                                                                                                                                                | yes (a pair) |
| Add a base file                                           | only when `choices.orientation` is empty: the pair may stand the figure another way than the single file's detection did (print cut, registration) | yes          |
| Remove the base                                           | only when `choices.orientation` is empty                                                                                                           |              |
| Swap figure and base (Base section, after a conversion)   | yes                                                                                                                                                | yes          |
| Adjust: up select, Apply, Set down; size; placement Apply | no                                                                                                                                                 | no           |
| `loadDemo`, `loadGenerated`, the benchmark                | no                                                                                                                                                 | no           |
| The address has `?ask=off`                                | no                                                                                                                                                 | no           |

`?ask=off` is a development option in `options.ts` like `?bake=`: the page never asks and converts as before this story. Any other value of `ask` is reported as ignored.

### 6.5 Hooks (`window.__mt`)

- `state.question`, `state.questionMs`, `state.page === 'asking'`.
- `answerUp(options?: OrientationOptions): Promise<void>`: an answer with `confirm: false` (left out: `{}`, the proposal); resolves when the question that comes back is on screen.
- `confirmUp(options?: OrientationOptions): Promise<void>`: confirms. Left out: what is on screen, a turn being tried out included. Sets `state.question` to null before the answer is posted and resolves then.
- `swapAtQuestion(): Promise<void>`: an answer with `swap: true`; resolves when the new base's question is on screen.
- `turn(axis, deg)` and `resetTurn()` work at the question as they do after a conversion (a preview); `setUp`, `applyTurn` and `setDown` stay what they are and do nothing while `busy`.

## 7. Unattended runs

- **`scripts/lib/answer-up.mjs`** (with a `.d.mts`, like `feedback-session`): `convertAnswering(page, pick, timeoutMs)` waits until `state.question !== null` or the conversion ended (`(state.stats || state.error) && !state.busy`), answers each question with `confirmUp(pick(question))`, and returns when the conversion ended. `pick` is a function from the question to `OrientationOptions`; `asDetected = () => ({})`.
- **`npm run corpus`** goes through the question, because that is the path people take and the only way to measure the time to it (§8). `--up detected` (default) confirms every proposal, so the orientation report keeps comparing the detection with the index; `--up index` answers the figure's question with the index's `up` (or its optional `rotation`, a quaternion, for a mini the six ways cannot stand up) and the base's with the optional `baseUp`, else as detected. `--options "?ask=off"` still gives the old straight path. `results.json` gets `questionMs` and `asked` per mini, `results.md` a "Time to the question" table against the budgets.
- **`npm run feedback`**: `--up ask` (default: the PM answers on the page, which is what the mode is for), `--up detected`, `--up index`. A pair of a `--pairs` list may carry `up` and `baseUp`. The overlay says "answer the question on the page" while one is open. A record gains `baseOrientation` (`stats.pair.baseOrientation`) and `choices`; `score-placements` passes a record's `choices.baseOrientation` on when it has one.
- **`scripts/corpus-index.json`**: optional `baseUp` and `rotation` per mini. The build adds none by guessing: values come from the PM's records.
- **e2e.** The specs that prove something else and pick files through `#file` (`pair.spec.ts`, `messy-files.spec.ts`, `smoke.spec.ts`, `feedback.spec.ts` through `reviewPair` with `up: 'detected'`) open the page with `ask=off` or answer as detected; they keep asserting what they assert. `page.spec.ts` (the states) and `promise.spec.ts` (nothing leaves the tab) run the default path and confirm, so the promise is proven with the question in it. The question itself gets `e2e/up-question.spec.ts` (§10 step 8).

## 8. Budgets

```ts
// scripts/corpus.mjs
/** Time from picking a file to its question on screen, reference laptop. The issue's numbers. _(proposal)_ */
const QUESTION_BUDGET_MS = 3_000; // an ordinary mini: one figure on a base of up to 32 mm
const QUESTION_BUDGET_LARGEST_MS = 15_000; // the largest corpus file
```

- **What is measured.** `state.questionMs`: from the moment the files were picked or dropped (the start of `loadFiles`, so reading the file from disk counts) to two animation frames after the first question's mesh was handed to the viewer (so the upload to the GPU counts). The corpus report prints it per mini.
- **Expected** on the development PC: 0.4–1 s for the ordinary minis, 4–6 s for the largest file. The reference laptop is no slower than the development PC on these steps (read to levels of `humanoid/M-001a`: 1.9 s on the laptop, Phase 1 spec, story 8, against 2.8 s in the unattended development PC run above), so both budgets should hold; only a run on the laptop proves it, and that run is the PM's (§11).
- **Pairs are reported, not gated** _(proposal)_: the first question of a pair needs both files read, welded and stood, because the roles come from both. The largest pair took 8.2 s to that point on the development PC. The issue's budget names a file, not a pair.
- **The stall.** Handing a 5.6 M-triangle mesh to the GPU stalls the page once, as the Original chip does today. The corpus run reports `longestFrameGapMs` as before; a stall over 100 ms on an ordinary mini at the question is reported in the PR, not hidden.

## 9. Where the code goes

- **`src/lib/pipeline/ask.ts`** (new) — the types of §3.1, `copyForQuestion`, `turnedBox(positions, rotation)`, `reasonOf(orientation)` and `reasonOfBase(fileOrientation)`.
- **`src/lib/pipeline/run.ts`** — `askUp`, `ask`, `baseOrientation` in `PipelineOptions`; `resume`; the question loops of §4; `choices` and `asked` in result and stats; `placePairOnly` takes `baseOrientation`.
- **`src/lib/pipeline/pair.ts`** — `chosenBase`, `how: 'chosen'`, `placeOriented` for it.
- **`src/lib/pipeline/place.ts`** — `BaseTop`, `readBaseTop`, `FigureDecision`, `decideFigure`, `placeOnBase(…, decided?)`, `PairResult.baseOrientation`.
- **`src/lib/worker/protocol.ts`, `handle.ts`, `client.ts`** — §5.
- **`src/lib/index.ts`** — types only: `UpQuestion`, `UpAnswer`, `UpRole`, `UpReason`, `AskUp`, `AskOptions`, `AskedUp`, `UpChoices`. No new value is exported, so the list in `index.test.ts` does not change. `README.md` "Use it as a library" shows a call with the fourth parameter.
- **`src/page/page-state.ts`, `options.ts`** — the state, the wording, `?ask=`.
- **`src/page/main.ts`, `viewer.ts`, `index.html`, `style.css`** — §6.
- **`scripts/lib/answer-up.mjs`, `scripts/corpus.mjs`, `scripts/feedback.mjs`, `scripts/lib/feedback-session.mjs`, `scripts/lib/placements.mjs`, `scripts/measure-memory.mjs`** — §7.
- **`e2e/up-question.spec.ts`** (new) and the specs named in §7.

## 10. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green from step 8 on. The regression baseline does not move at any step.

1. **The question for one file.** `ask.ts`; `askUp`, `ask`, `resume`, `choices`, `asked` in `run.ts`. Tests (`run.test.ts`, on the generated figure and a lying copy of it): without `askUp` the result equals today's (meshes bit-identical, `asked` empty); confirming the proposal at once gives the same bits as not asking, one question, with a mesh, `role: 'mini'`, `tries: 0`; `{ up: '+x' }` tried and then confirmed gives a second question without a mesh whose `orientation.up` is `+x` and `method` `manual`, a result standing on `+x`, and `timings` with exactly one entry per step; a rotation is kept to the bit; `setDown: true` reports `setDownDeg`; a conversion that came with `orientation` asks with `reason: 'chosen'`, and `{}` brings the detection back; `ask: { up: false }` asks nothing; detaching the question's buffers leaves the result unchanged (the copy is a copy); converting again with `result.choices` and no `askUp` gives identical meshes; a rejecting `askUp` rejects the conversion with its error; `totalMs` does not grow with a slow `askUp` (a 50 ms wait in the test).
2. **The base's own orientation.** `baseOrientation`, `chosenBase`, `how: 'chosen'`, `PairResult.baseOrientation`. Tests (`pair.test.ts`, `run.test.ts`, the generated recess base): turned over by `{ up }` it stands upside down, measured in the 2 mm band, and the figure is placed on what is then its top; a free rotation stands as given and is measured after placing; left out, the pair is bit-identical to today.
3. **The decision apart from the placing.** `readBaseTop`, `decideFigure`, `placeOnBase(…, decided?)`. Tests (`place.test.ts`): for the regression pair, a registered fixture and a two-candidate fixture, `placeOnBase` with `decideFigure`'s result passed in returns the same bits as without. `npm run score-placements` gives the same table as on `main`.
4. **The questions of a pair.** Tests (`run.test.ts`): the base is asked first and the figure second, each with its mesh once; confirming both proposals gives the bits of not asking; a registered pair asks about the figure with `reason: 'registered'` and the base's rotation, and a changed figure skips the registration (`spot.kind` is not `registered`); a base turned over at its question changes what the figure's proposal is tested against; `swap` at the base's question and at the figure's starts again with the other file as the base, `pairing.method` is `manual` and `choices.pairing.swap` true; `not-a-pair` is thrown before any question.
5. **The protocol.** `protocol.ts`, `handle.ts`, `client.ts`. Tests: `handle.test.ts` posts a question with the mesh's buffers in the transfer list, continues on the answer, ignores an answer for an unknown id, and asks nothing without `ask`; `client.test.ts` calls `askUp`, posts what it resolves to, posts nothing for a cancelled job, rejects and restarts when `askUp` rejects, and strips `ask` when no callback is given.
6. **The library entry.** The types in `index.ts`, the README's call. `index.test.ts` passes unchanged.
7. **State and wording.** `page-state.ts` (`asking`, `COPY`, `describeUp`, `describeAskedFile`, `describeAskPending`), `options.ts` (`ask`). Unit tests for each string and for `pageStateOf` with a question while busy.
8. **The page.** `viewer.showQuestion` and `turnQuestion`, the section, the wiring, the hooks, the table of §6.4, `result.choices` into `choices`, the copy given up at the last Confirm. `e2e/up-question.spec.ts`, with generated files picked through `#file`:
   - the generated figure stops in `asking` with the question's text and `describeUp`, and `progressLog` holds `read`, `weld`, `orient` and nothing after; `#ask-confirm` ends in `done` with `stats.asked[0].tries === 0`;
   - the figure stored lying: `answerUp({ up })` shows it standing (the question's `orientation.up`), Confirm converts once (`progressLog` has one `simplify`), `stats.up` is the axis and `upMethod` `manual`;
   - a turn of 30° by the buttons shows "Turned 30°" and sends nothing; Confirm converts with that rotation; Set down and Reset each bring a new question (`serial` grows);
   - the generated pair asks about the base, then the figure, with `#ask-file` naming each; the base turned over and back; `swapAtQuestion()` starts again with the other file;
   - Cancel at the question ends in the empty state with "Cancelled." and the next file converts;
   - adding a base to a confirmed figure asks about the base, and about the figure only when its orientation was not chosen; changing the size in Adjust asks nothing;
   - `?ask=off` converts without a question.
     Screenshots with `verify-3d`: the question for a lying generated figure, the same figure stood up before Confirm, the base's question of the generated pair, and the question on a phone-sized viewport.
9. **Scripts.** `answer-up.mjs`, the corpus flags and report, the feedback flags, the record's new fields, `score-placements`, `measure-memory.mjs` answering the question. `e2e/feedback.spec.ts` asserts `baseOrientation` and `choices` in the record.
10. **Corpus and numbers** (development PC, window in front, a fresh page per conversion; see the #72 and #70 journal entries for why). `npm run corpus -- --no-bake`: the time-to-question table, and the untouched steps against the last run, so the machine is known to have held still. `npm run corpus -- --no-bake --up index`: every mini whose index `up` differs from the detection stands on the index's axis after one conversion (criterion 6); the orientation table goes into the PR. `measure-memory.mjs` on the largest file and on `humanoid/M-001a`, with the question, against the figures the estimate was fitted to.
11. **Docs.** `CLAUDE.md` (layout: `ask.ts`, the question in `run.ts` and the protocol, the decision in `place.ts`, the `asking` state, the hooks, `?ask=`, the script flags; conventions: the up paragraph), the spec (status lines under stories 10 and 11), `CONTRIBUTING.md` (running the corpus and a feedback session with `--up`), the README, and the journal entry `docs/journal/2026-09-<dd>-up-before-reduce.md` (topics `orientation`, `worker`, `ui`, `tooling`): why one job that stops and not two (§2), the pair's decision moving in front of the question and why (§1, §4.2), every number with its device, what went wrong.

## 11. When to stop and ask

- **The path without questions is not bit-identical**: the baseline moves, `score-placements` changes a row, or a pair without `askUp` places differently after step 3.
- **The time to the question is over budget on the development PC**, which is faster than the laptop. Report the step times; do not sample, skip the weld or show a reduced mesh to get under it (the issue rules out reduced levels before Confirm).
- **Criterion 4 cannot be ticked from the development PC.** Put the development PC's table in the PR, ask the PM for the laptop's run (the command and the two minis to convert in the PR's "Needs a human look"), and leave the box unticked until the numbers are there.
- **The peak memory of the largest file rises above its estimate** with the question in the path (§4.3).
- **A corpus mini cannot be stood up through the question** with `--up index`: the six ways do not reach it and the index has no `rotation`. List it; the PM records the turn in a feedback session.
- **Decisions here the PM may want to change**, flagged in the PR's "Needs a human look" with screenshots, built as proposed meanwhile:
  - Confirm is a click. The issue's alternative, going on after a few seconds unless touched, is a timer on the page that calls `confirmUp()`; the protocol does not change.
  - The mini leaves the screen at Confirm and the converting card shows, as today. Keeping it on screen while it converts costs the largest file 100 MB at the conversion's peak.
  - The sculpt is drawn flat-shaded in the base coat's grey (§6.3).
  - Swap is offered at the question (§3.1), not only after the conversion.
  - `not-a-pair` is decided before any question (§4.2): two files of which neither has a flat underside are refused without the person being asked which is the base.
  - Adding or removing a base asks about the figure again unless its up was chosen by hand (§6.4).
  - Pairs are reported against the budget, not held to it (§8).
  - Every string of §6.2.
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 12. Out of this note

- A better detection (#90 stays separate), facing direction, and showing reduced levels before Confirm: out by the issue.
- Showing the base and the figure together at the question, and marking where they meet: #93, which adds its marks to the stop designed here (a further question after the figure's, carrying both meshes the page already has).
- A worker that keeps the welded mesh after a conversion so that a correction in Adjust restarts from orient instead of converting again. Adjust's "Up and turn" stays as built; a button there that opens the question again is the small first step of that follow-up, not part of this story.
- Dropping a new file while a question is open (today: ignored while busy; Cancel first).
- Freeing the triangle soup before the question. It would lower the memory held while waiting; nothing here needs it.

## 13. How each criterion is proven

| Criterion (issue #92)                                                                                                                            | Proof                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The page shows the full-detail mesh with the detected up and asks; nothing after orient runs until Confirm; a right detection costs one click | `run.test.ts` (step 1: one question, `tries: 0`, one entry per step); `e2e/up-question.spec.ts` (`progressLog` at the question; Confirm); screenshots                                                           |
| 2. The same stop for each file of a pair, the base first; the base's detection can be corrected                                                  | `run.test.ts` (steps 2 and 4); e2e (the pair's two questions, the base turned over, swap); screenshot of the base's question                                                                                    |
| 3. The choice goes in as `OrientationOptions` and is recorded exactly as chosen                                                                  | `run.test.ts` (a rotation kept to the bit; `choices` reproduce the mini); `glb.test.ts` unchanged (the rotation in `extras`); `e2e/feedback.spec.ts` (the record's `orientation`, `baseOrientation`, `choices`) |
| 4. Time to the question: under 3 s ordinary, under 15 s largest, reference laptop                                                                | the corpus report's table on the development PC (step 10); the laptop's figures from the PM (§11)                                                                                                               |
| 5. The corpus script and the feedback mode pass the confirmation automatically                                                                   | `--up detected` and `--up index` (step 9); `e2e/feedback.spec.ts` with `up: 'detected'`; a full `npm run corpus -- --no-bake` that ends without a person                                                        |
| 6. Every corpus mini whose index up differs from the detection stands up through the question, without a second conversion                       | `npm run corpus -- --no-bake --up index`: the orientation table, one conversion per mini (step 10); e2e (the lying figure, one `simplify`)                                                                      |
