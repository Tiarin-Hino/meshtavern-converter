# Design: the question view as a library entry other code mounts (#119)

Status: design pass by Fable 5.1, 2026-10-07, for Opus 5.5 to build · Issue: #119 (needed by the table application, Phase 2; not part of the Phase 1 epic) · Builds on: `docs/design/library-api.md` (#50), `docs/design/up-before-reduce.md` (#92), `docs/design/patches-where-parts-meet.md` (#93)

This note fixes the decisions the build should not have to make: what the entry is called and what it mounts where, the shape of what it returns, how the page keeps every hook and every test while the code moves, where the wording and the styles go and how a consumer replaces them, what stays on the page, the build order with the test that proves each step, and where to stop and ask. The issue is a refactor with one hard rule, **no behaviour change on the page**: every e2e spec of the questions passes unchanged or with import paths updated only, and the regression baseline does not move (it cannot: no pipeline code is touched). Numbers and names marked _(proposal)_ are the PM's to change. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§12).

## 1. What exists and what the table needs

Since #92 and #93 a conversion stops on the full-detail meshes and asks: which way is up (one file, or the base then the figure), how a figure's parts go together and where the figure meets its base (the pairs stop with the parts apart and the proposed pairs, then the final view). The worker owns the marks and decides every transform; the page draws what `Question.shown` says, sends what a finger did, and shows what comes back (`docs/design/patches-where-parts-meet.md` §3.3, §7). That is the right split for a consumer too: the table's "add a mini" dialog has to answer the same `Question`s with the same controls, and a second copy of this view would drift from the worker's protocol the moment a `MeetAction` changes.

Today the view is spread over the page:

| Where                              | What                                                                                                                                                                                                                                                                                                                                                      | Lines (about) |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| `src/page/main.ts`                 | `asking` (the meshes sent, the answer owed, the options a question was resolved from, the framing), `askUp`, `showQuestion`, `showPairChips`, `lastQuestion`, `answerQuestion`, `confirmUp`, `answerAndWait`, `sendMeet`, `targetAt`, `tapAt`, the brush queue, `focusAt`, `showViewButtons`, `nudge`, the pointer handlers, the control wiring, 27 hooks |           770 |
| `src/page/viewer.ts`               | `showShown`, `QuestionFile` and the chunking (#108), `rayAt`, `screenOf`, `setPatches`, `focusOn`, `focusFile`, `lookAt`, `setBrush`, the question material and its warm-up                                                                                                                                                                               |           340 |
| `src/page/mesh-chunks.ts`          | `chunkRanges` (#108)                                                                                                                                                                                                                                                                                                                                      |            45 |
| `src/page/page-state.ts`           | the question strings of `COPY`, `describeUp`, `describeAskedFile`, `describeAskPending`, `describePairWarning`, `describePairs`, `describePart`, `describeParts`, `describePlacement`, `partName`, `LIFT_STEP_MM`, `TURN_STEP_DEG`                                                                                                                        |           230 |
| `index.html`, `src/page/style.css` | `<section id="ask">`, `<section id="meet">`, their rules, the pair colours, the phone rule for `#ask label`                                                                                                                                                                                                                                               |      70 + 130 |

Three facts shape the design:

- **The page's own state is thin.** Everything the view needs comes in the `Question` (`shown`, `box`, `meshes`, `roles`, `pairs`, `parts`, `placement`, `apart`) or was known when the conversion started (the file names, which questions are asked, the orientation options it was started with, the source preset). The page adds only `name` and `serial` to a question, and keeps `questionMs` and the drag-and-drop around it.
- **The tests drive the view through `window.__mt` and element ids,** not through page internals: `state.question` (with `serial`), `state.meet`, `state.orientation`, `state.preset`, `#ask-*`, `#meet-*`, the hooks `answerUp`, `confirmUp`, `tap`, `brush`, `screenOf`, `pickAt`, `setCamera`, and taps at canvas coordinates taken from `#viewport`'s box. All of that can stay exactly as it is when the view moves, as long as the ids and the state shapes survive and the view's canvas lies exactly over `#viewport`.
- **The drawing is already self-contained.** At a question the viewer shows nothing else (`showShown` clears it), so the question's scene needs no mini, no stress table and no GLB import: a grid, the table light, one material, the chunked meshes, the patches, OrbitControls and a turn gizmo.

## 2. The decision in one paragraph

A fourth entry, **`meshtavern-converter/questions`** (`src/lib/questions.ts`, the folder `src/lib/questions/`), exports **`mountQuestions(options)`**. It mounts the view into two elements the consumer gives it: one for the scene (the view puts its own canvas, renderer, camera and controls into it) and one for the controls (`#ask` and `#meet` as the page has them today; left out, the view puts a panel of its own over the scene). `start(conversion)` returns the `AskUp` callback that `Converter.convert` takes as its fourth argument; the view then draws every question, answers through the same `UpAnswer` and `MeetAnswer` actions the page sends today, and tells the consumer about every change through `onChange`. The page mounts the view into the two places the question lived (`#view` and `#panel`), keeps its heading, status, Cancel, states and hooks, and forwards each question hook to the view's method of the same name. The wording is a `QuestionCopy` the consumer can replace field by field; the styles come with the entry and apply under `.mt-questions` only. Nothing in `src/lib/pipeline/` or `src/lib/worker/` changes.

|                                      | Own canvas in the consumer's element (chosen)                                                                                                                          | Draw into the consumer's three.js scene                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a consumer writes               | two elements and one call                                                                                                                                              | a renderer, a scene, a camera, OrbitControls, the grid and the light of its own, and the pointer handling on its canvas: the copy the issue wants to avoid, minus the meshes |
| The page                             | a second canvas, shown only while asking, over `#viewport`; a second WebGL context (§7.3)                                                                              | one context, as today; the view's scene composed into the viewer                                                                                                             |
| Taps, brush, focus, Look at, the ray | the view's canvas, the view's camera: one owner                                                                                                                        | the consumer's canvas and camera, so the view needs them handed in and the consumer must not move them underneath                                                            |
| Tests                                | the page's e2e specs unchanged: the ids, the hooks and `#viewport`'s box (the view's canvas has the same box)                                                          | the same                                                                                                                                                                     |
| Cost                                 | a second context on the page (a few MB, measured in §10 step 6); the camera framing and the turn gizmo exist twice, once for the mini and once for the question (§7.2) | the view cannot be mounted alone, which is the issue's criterion                                                                                                             |

Two elements rather than one: the heading (the file names), the status line and Cancel are the consumer's, and so is the layout (the page's panel on a desktop, a bottom sheet on a phone). A consumer that wants one element gets it: without `controls`, the view lays its own panel over the scene (§6.2).

## 3. The entry

```ts
// src/lib/questions.ts: the entry. Imports three.js (like three.ts) and the view's stylesheet.
export {
  mountQuestions,
  type QuestionsOptions,
  type QuestionsView,
  type QuestionsState,
  type AskedQuestion,
  type AskedMeet,
  type MeetUi,
  type TurnAxis,
  type ConversionToAsk,
} from './questions/mount';
export {
  QUESTION_COPY,
  type QuestionCopy,
  type QuestionSentences,
  describeUp,
  describeAskedFile,
  describeAskPending,
  describePairWarning,
  describePairs,
  describePart,
  describeParts,
  describePlacement,
  partName,
  LIFT_STEP_MM,
  TURN_STEP_DEG,
} from './questions/copy';
export {
  PAIR_COLOURS,
  TAP_MAX_PX,
  TAP_MAX_MS,
  BRUSH_STEP_PX,
  BRUSH_RADIUS_MM,
  FOCUS_HOLD_MS,
  PANEL_WIDTH_PX,
} from './questions/mount';
export { UPLOAD_BYTES_PER_FRAME } from './questions/mesh-chunks';
```

`package.json` `exports` gains `"./questions": "./src/lib/questions.ts"`. `index.test.ts` pins the list above (the values; types leave no key), and its test that `index.ts` stays free of three.js is unchanged: `index.ts` re-exports nothing from `questions/`.

### 3.1 Mounting

```ts
export interface QuestionsOptions {
  /** The view's canvas fills this element: give it a size. */
  scene: HTMLElement;
  /** Where `#ask` and `#meet` go. Left out: a panel of the view's own over the scene's right edge (§6.2). */
  controls?: HTMLElement;
  /** Words and sentences to replace, field by field (§5). */
  copy?: Partial<QuestionCopy>;
  /** Called after every change the view shows: a question arrived or was answered, a turn is tried, a tool toggled, a pair selected. */
  onChange?: (state: QuestionsState) => void;
}

/** What the view needs to word and answer one conversion's questions. */
export interface ConversionToAsk {
  /** The files' names in the order given to `convert` (`stl`, `secondStl`, `moreStl`). */
  names: string[];
  /** The questions this conversion asks: what `convert` was given as `ask`. Decides which Confirm is the last. */
  ask: AskOptions;
  /** The orientation options the conversion was started with: what an untouched Confirm sends back. */
  orientation?: OrientationOptions;
  baseOrientation?: OrientationOptions;
  /** The source preset in force, by id; null for none. */
  preset?: string | null;
}

export function mountQuestions(options: QuestionsOptions): QuestionsView;
```

The view sets the class `mt-questions` on both elements (and `mt-questions-scene`, `mt-questions-controls`), writes the pair colours as custom properties on them (§6.3), puts the canvas into `scene` and the two sections into `controls`, wires the controls, creates the renderer, and warms the question material up (#108) with one draw. Nothing is drawn after that until a question comes: the render loop runs only while a question is on screen (§7.3). Calling it twice on the same elements is an error; the ids are unique per document (§6.1), so there is one view per page.

### 3.2 The view

```ts
export interface QuestionsView {
  /** What is on screen: the page mirrors it into its own state for the tests (§4). */
  readonly state: QuestionsState;
  /** Begins a conversion's questions and returns the callback for `convert`'s fourth argument. */
  start(conversion: ConversionToAsk): AskUp;
  /** The conversion ended (done, cancelled, failed): whatever is shown leaves the screen, every waiting hook resolves. */
  end(): void;
  /** Resolves once every mesh of the question on screen has all its chunks (#108); they are drawn from the next frame. */
  drawn(): Promise<void>;
  // The answers, named as the page's hooks (§4): each resolves when the question that comes back is on screen,
  // at once for the answer that ends the questions.
  answerUp(options?: OrientationOptions): Promise<void>;
  confirmUp(options?: OrientationOptions): void;
  swapAtQuestion(): Promise<void>;
  chooseBase(file: number | null): Promise<void>;
  /** At an up question: the preset's way; the question comes again. Throws for an unknown id. */
  setPreset(id: string | null): Promise<void>;
  tap(file: number, point: Vec3, pair?: number): Promise<void>;
  brush(file: number, points: Vec3[], options?: { erase?: boolean; pair?: number }): Promise<void>;
  addPair(): void;
  selectPair(k: number): void;
  clearMarks(pair?: number): Promise<void>;
  undoMark(): Promise<void>;
  fitMeeting(): Promise<void>;
  backToMarks(): Promise<void>;
  liftMeeting(mm: number): Promise<void>;
  turnMeeting(deg: number): Promise<void>;
  setTilt(mode: 'keep' | 'free' | null): Promise<void>;
  confirmMeet(): Promise<void>;
  answerMeet(action: MeetAction): Promise<void>;
  pickAt(x: number, y: number): Promise<Hit | null>;
  screenOf(file: number, point: Vec3): [number, number] | null;
  focusAt(x: number, y: number): Promise<Hit | null>;
  focusFile(file: number): void;
  // The turn tried out at an up question: a preview, nothing is sent until Confirm.
  turn(axis: TurnAxis, deg: number): void;
  resetTurn(): void;
  // The camera and the material, for screenshots and the dev tools.
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void;
  setWireframe(on: boolean): void;
  /** Releases the renderer, the listeners and the DOM the view made. The page never calls it. */
  dispose(): void;
}

export interface QuestionsState {
  /** The question on screen, without its meshes, with the name of what it is about and a serial per conversion. Null when none. */
  question: AskedQuestion | null;
  /** At a meet question: the pair the next tap goes to, the brush and the eraser, the parts pulled apart, the part the final view moves. */
  meet: MeetUi;
  /** The turn being tried out at an up question: scene axes, after the rotation asked about. */
  turn: { turn: Rotation | null; turnDeg: number };
  /** The source preset in force at the question, by id; null for none. */
  preset: string | null;
}
// AskedQuestion, AskedMeet and MeetUi are main.ts's types today, moved as they are.
```

Decisions in these shapes:

- **`start` returns the callback** rather than the view having an `ask` method: a question cannot arrive before the view knows the names and the options it was started with, and a consumer cannot forget to tell it. `start` resets what today's `convert()` resets in `asking` (the meshes, the framing, the answer owed, the key, the sent options, `swapped`, `asks`, the patches, `serial`) and the state (`meet`, `turn`, `preset`).
- **`end` is what today's `finally` does for the question:** the answer owed dropped, `question` null, `meet` fresh, the brush off and its queue emptied, the meshes given up (`scene.clear()`), the turn gizmo detached and Turn by hand unchecked, every waiter resolved; then `onChange`. A conversion whose last Confirm already gave the meshes up finds nothing to do. The consumer calls it whether the conversion resolved, rejected or was cancelled; the view does not know the `Converter`.
- **One meaning per method, the hooks' meaning.** The bodies move from `main.ts` unchanged: `answerUp` is an answer with `confirm: false` that waits for the next question; `confirmUp` sends what is on screen (a turn being tried out as a rotation, else the options the question was resolved from); `swapAtQuestion` and `chooseBase` restart the questions; `tap` and `brush` send points on a file (tests and scripts), the canvas handlers send rays; `pickAt` and `focusAt` send `pick`; the meet actions go through `sendMeet`, which answers at once for an action that ends the meeting (`endsMeeting`) and waits otherwise.
- **`onChange` fires after the view updated its DOM and scene and before the waiting hook resolves**, in the order the page has today (`showQuestion`, then `render()`, then the waiters). So a test that awaits a hook sees the page already rendered.
- **`state` is replaced, not mutated, on every change** (a fresh object with the same `question` reference while the question is the same), so the page can copy its fields without comparing.

## 4. The page: what stays, what delegates

`main.ts` keeps `AppState` as it is: `question`, `meet`, `questionMs`, `orientation`, `preset` keep their names and shapes, because the tests read them. The page fills them from the view:

```ts
const view = mountQuestions({
  scene: document.querySelector('#question-view')!,
  controls: document.querySelector('#questions')!,
  onChange: (shown) => {
    const was = state.question;
    state.question = shown.question;
    state.meet = shown.meet;
    // While a conversion runs the turn tried out is the view's; after it, the page's own (Adjust).
    if (state.busy) state.orientation = shown.turn;
    if (shown.question && state.busy) state.preset = shown.preset;
    if (shown.question && !was) {
      status.textContent = '';
      // The mini on screen leaves it at the first question, as showShown's clear() did (PM decision, #92 §14.2).
      if (questionsOf.firstShown) {
        viewer.clear();
        questionsOf.firstShown = false;
        measureQuestionMs();
      }
    }
    render();
  },
});
```

`convert()` calls `view.start({ names, ask, orientation, baseOrientation, preset })` where it builds `asking` today and passes the returned callback as the fourth argument (only when it would pass `askUp` today: `ask !== null && pageOptions.ask`); its `finally` calls `view.end()`. `questionMs` stays the page's measurement: from `startedAt` to two frames after `view.drawn()` resolves for the first question, as today. `render()` no longer sets `body[data-question]`.

The hooks of `window.__mt` keep their names and do one of three things:

| Hook                                                                                                                                                                                                                                                                        | After                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answerUp`, `confirmUp`, `swapAtQuestion`, `chooseBase`, `tap`, `brush`, `addPair`, `selectPair`, `clearMarks`, `undoMark`, `fitMeeting`, `backToMarks`, `liftMeeting`, `turnMeeting`, `setTilt`, `confirmMeet`, `answerMeet`, `pickAt`, `screenOf`, `focusAt`, `focusFile` | the view's method of the same name                                                                                                                                                        |
| `setPreset`                                                                                                                                                                                                                                                                 | at an up question `view.setPreset(id)` (the view sets `swapped` for a figure, as the page does today); otherwise the page's own (converts again)                                          |
| `turn`, `resetTurn`                                                                                                                                                                                                                                                         | while a question is on screen the view's; otherwise the page's preview on the viewer (Adjust, #72)                                                                                        |
| `setCamera`                                                                                                                                                                                                                                                                 | while a question is on screen the view's camera; otherwise the viewer's (`e2e/meet.spec.ts` sets the camera at the final view and from below the grid; `pair.spec.ts` after a conversion) |
| `setWireframe`                                                                                                                                                                                                                                                              | both: the viewer's materials and the view's question material                                                                                                                             |
| `markMeeting`, `markParts`, `applyTurn`, `setDown`, `setUp`, `setSizing`, `addBase`, `swapPair`, `removeBase`, the placement previews, `figurePlacement`, downloads, stress, benchmark, thumbnail                                                                           | the page's, unchanged                                                                                                                                                                     |

`scripts/lib/answer-up.mjs` and the feedback session drive the hooks only: unchanged.

## 5. Wording

`src/lib/questions/copy.ts` holds the strings and the sentences of the questions; `src/page/page-state.ts` keeps the page's (the drop card, the states, the downloads, Adjust, the Base section's buttons, `describeMini`, `describeReady`, `describeWrongFile`, `describeTooManyFiles`, `describePendingPlacement`, `describeUnits`, `describeOrientation`, `STEP_LABELS`, `LEVEL_LABELS`).

```ts
/** The words of the questions. Every string is a proposal the PM may change (#92 §6.2, #93 §7.4, #100). */
export const QUESTION_COPY = {
  askUp: 'Is this the right way up?',
  confirmUp: 'Yes, convert',
  confirmBaseUp: 'Yes, next: the figure',
  confirmFigureUp: 'Yes, next: where they meet',
  askSetDown: 'Set down',
  askReset: 'Reset',
  swapPair: 'Swap figure and base',
  noBase: 'No base: these are the parts of one figure',
  base: 'Base',
  upAxis: 'Up axis in file',
  pitch: 'Pitch',
  roll: 'Roll',
  turnByHand: 'Turn by hand',
  source: 'Source',
  noPreset: 'None (guess)',
  askParts: 'Are the parts where they belong?',
  confirmParts: 'Yes, the parts are in place',
  askMeet: 'Is the figure where it belongs on its base?',
  askPairs: 'Is this where they meet?',
  confirmPairs: 'Yes, put them together',
  addPair: 'Add a pair',
  brush: 'Brush',
  erase: 'Erase',
  undo: 'Undo',
  startOver: 'Start over',
  pullApart: 'Pull apart',
  showInPlace: 'Show in place',
  markEveryPart: 'Mark where every part goes, then put them together.',
  backToMarking: 'Back to marking',
  raise: 'Raise',
  lower: 'Lower',
  turn: 'Turn',
  letTilt: 'Let it tilt to fit',
  keepUpright: 'Keep it upright',
  lookAt: 'Look at',
  viewAll: 'All',
  viewHint: 'Right-click a spot, or hold a finger on it, to turn the view about it. The wheel zooms to the pointer.',
  pairs: 'Pairs', // aria-label
  marks: 'Marks',
  adjustMeeting: 'Adjust where they meet',
  clearPair: 'Clear pair', // aria-label of a chip's ×, followed by its number
  proposed: 'proposed', // on a chip
} as const;

/** The sentences with numbers in them, replaceable as a whole. The defaults are the functions below, moved from page-state.ts. */
export interface QuestionSentences {
  describeUp(question: Pick<UpQuestion, 'reason' | 'base' | 'orientation'>, preset?: boolean): string;
  describeAskedFile(role: UpRole, name: string): string | null;
  describeAskPending(turnDeg: number): string | null;
  describePairWarning(warnings: readonly PairWarning[], at?: 'question' | 'done'): string | null;
  describePairs(question: …): string;
  describePart(part: PartResult, name: string, apart?: boolean): string;
  describePlacement(placement: Placement, scale?: number): string;
}
export type QuestionCopy = typeof QUESTION_COPY & QuestionSentences;
```

- **The button texts are composed from the words and the constants**, so they read exactly as today: `${pitch} −${TURN_STEP_DEG}°`, `${raise} ${LIFT_STEP_MM} mm`, `${turn} +${TURN_STEP_DEG}°`. `TURN_STEP_DEG = 15` and `LIFT_STEP_MM = 0.5` move here; `main.ts` keeps its own `TURN_STEP_DEG` for Adjust's buttons or imports this one.
- **The page's `COPY` keeps every key the tests read**: `export const COPY = { ...QUESTION_COPY, title: …, promise: …, … } as const`. `e2e/meet.spec.ts`, `parts.spec.ts`, `up-question.spec.ts` and `source-preset.spec.ts` import `COPY` from `../src/page/page-state` and read `askPairs`, `confirmUp`, `letTilt`, `showInPlace`, `noPreset` and the rest: unchanged. `markMeeting`, `markParts`, `cancel`, `addBase`, `removeBase`, `moveByHand` stay the page's.
- **The sentence functions are exported from the entry one by one** (the page's Base section uses `describePlacement`, `describePart`, `describeParts`, `describePairWarning`, `partName`, `LIFT_STEP_MM` after a conversion) and are the defaults of `copy`: `mountQuestions({ copy: { askUp: 'Which way is up?', describeUp: (q) => … } })` replaces one and keeps the rest. `describeParts` is the Base section's line, not a question's; it moves with `describePart` because they share `partName` and the fit words.
- **The unit tests move with their functions**: the blocks "where the parts meet (#93)", "the up question (#92)", "the base section" (`describePlacement` and `describePairWarning` only) and "names the select and its first entry" of `page-state.test.ts` go to `src/lib/questions/copy.test.ts`; "has the words of the note" asserts `QUESTION_COPY`. What tests page strings stays.

## 6. Markup and styles

### 6.1 The markup

The two sections move from `index.html` into the view's template (`mount.ts`, one HTML string set as `innerHTML` of the controls element, then wired as `main.ts` wires them today), **with the same ids, attributes and nesting**: `#ask`, `#ask-file`, `#ask-question`, `#ask-found`, `#ask-warning`, `#ask-base-choice`, `#ask-base`, `#ask-source`, `#ask-up`, `#ask-turn` with its `data-turn`/`data-deg` buttons, `#ask-turn-by-hand`, `#ask-pending`, `#ask-set-down`, `#ask-reset`, `#ask-swap`, `#ask-confirm`; `#meet`, `#meet-question`, `#meet-parts`, `#meet-marking`, `#meet-pairs`, `#meet-hint`, `#meet-tools` with `#meet-add`, `#meet-brush`, `#meet-erase`, `#meet-undo`, `#meet-clear`, `#meet-apart`; `#meet-final`, `#meet-placement`, `#meet-adjust` with its `data-meet-lift`/`data-meet-turn` buttons and `#meet-tilt`, `#meet-back`; `#meet-look`, `#meet-view`, `#meet-view-hint`, `#meet-confirm`; the chips' `.chip`, `.chip-clear`, `data-pair`, `aria-pressed`, `data-part`, `data-selected`. The `data-copy` and `data-in` attributes go: the view writes its words itself and shows a section by `hidden` (`#ask` for an up question, `#meet` for a meet question, both hidden without a question), which replaces `body[data-question]`.

Why ids and not `data-` attributes: twenty e2e tests in four specs and the verify-3d screenshots address them, and the issue allows import-path changes only. The cost is **one view per document**, said in the README and checked by `mountQuestions` (a second call while a view exists throws).

In `index.html` the sections are replaced by two empty hosts: `<div id="question-view" class="…" data-in="asking"></div>` inside `#view`, after `#viewport` (so it lies over the canvas), and `<div id="questions" data-in="asking"></div>` inside `#panel` where `#ask` was (after `#cancel`; the order on screen stays `body[data-state='asking'] #cancel { order: 1 }`).

### 6.2 The stylesheet

`src/lib/questions/questions.css`, imported by `src/lib/questions.ts` (`import './questions/questions.css'`: the page's Vite and the table's compile it; Vitest loads the entry with the stylesheet as an empty module). Every rule is scoped under `.mt-questions`:

- **The sections' rules as they are** (`#ask`, `#ask p`, `#ask-file`, `#ask-found`, `#ask-question`, `#ask-warning`, `#ask label`, `#ask-turn`, `#ask-pending`, `#meet…`, `#meet-pairs…`, `.chip`), each prefixed with `.mt-questions `, and `.mt-questions [hidden] { display: none !important }`.
- **The page's control rules, copied with the same values**, because they decide the pixels of the view's buttons on the page and a consumer without them would get the browser's: `.mt-questions button, .mt-questions select { min-height: 32px; padding: 4px 12px; border: 1px solid var(--q-line); border-radius: 6px; background: var(--q-control); color: inherit; font: inherit }`, `button { cursor }`, `button:disabled`, `button.primary`, `:focus-visible`, `.check`, `label { display: flex; align-items: center; gap: 6px }`. The page keeps its own rules for the rest of the page; where both apply, they say the same thing, so the page renders the same (step 4 of §10 proves it with screenshots).
- **The phone rule**: `@media (max-width: 600px) { .mt-questions button, select, label, .check { min-height: 44px } }`, the page's touch target (`PHONE_MAX_WIDTH_PX`, `--touch-target`), so the page's `#ask label` line can go.
- **The scene host**: `.mt-questions-scene canvas { display: block; width: 100%; height: 100% }`. The host's own size is the consumer's: the page gives `#question-view { position: absolute; inset: 0 }` so its canvas has `#viewport`'s box, which the tests' taps use.
- **The view's own panel** (`controls` left out): `.mt-questions-panel { position: absolute; top: 0; right: 0; bottom: 0; width: var(--q-panel-width, 360px); overflow-y: auto; padding: 20px; background: var(--q-panel); border-left: 1px solid var(--q-line) }` _(proposal; `PANEL_WIDTH_PX = 360`, the page's)_. A desktop dialog's layout; a consumer on a phone passes its own `controls` in a sheet, as the page does.

The view's rules read the **page's custom properties with the page's values as fallbacks**, through names of its own, so a consumer themes the view by setting the page's names on any ancestor and gets the page's dark scheme otherwise: `.mt-questions { --q-panel: var(--panel, #22252b); --q-control: var(--control, #252830); --q-line: var(--line, #3a3f49); --q-text: var(--text, #e6e8eb); --q-muted: var(--muted, #a9afb8); --q-accent: var(--accent, #7aa2f7); --q-warn: var(--warn, #f0b35e) }`. The view's `font` is inherited: the page's `system-ui` on the page, the dialog's in the table.

What the page's `style.css` loses: the `#ask…` and `#meet…` rules, `body:not([data-question…])`, the `--pair-*` block, `#ask label` in the media query. What it keeps: `body[data-state='asking'] #panel`, `#heading`, `#cancel`, `#stage` (the layout of the question is the page's), and every rule for the rest of the page.

### 6.3 The pairs' colours

`PAIR_COLOURS = [0xf0b35e, 0x7ee0c3, 0xd78ae6, 0x8fb8f5]` moves to the view and becomes the one source: at mount the view writes `--pair-1` … `--pair-4` on its hosts from it (`#f0b35e` from `0xf0b35e`), the chips use `var(--pair-k)` as today, and the scene draws the patches from the same array. The `:root` block of `style.css` goes. A consumer that wants other colours sets `--pair-k` on the controls host after mounting; the patches in the scene keep the array's colours (a `colours` option is §13).

## 7. The scene

### 7.1 What moves

`src/lib/questions/scene.ts` holds `QuestionScene`: the question half of today's `Viewer` plus what the viewer's constructor makes that it needs. From `viewer.ts`, unchanged in what they do: `showShown`, `chunksAdded`, `addNextChunk`, `dropChunking`, `rayAt`, `screenOf`, `setPatches`, `clearPatches`, `focusOn`, `focusFile`, `lookAt`, `setBrush`, `setTurn`, `setTurnGizmo`, `setCamera`, `setWireframe`, the question part of `clear`, `resize`, the question material and its warm-up (`compileAsync` and one draw of a triangle without area, #108), `QuestionFile`; and `mesh-chunks.ts` with its test. New in it: the renderer on a canvas the scene creates (`antialias: true`, pixel ratio capped at 2, `scene.background` the page's `0x1b1d22`), the camera (`PerspectiveCamera(40, 1, 0.1, 5000)`), OrbitControls with damping, the grid (`GridHelper(GRID_SQUARE_MM * 40, 40, 0x4a4f5a, 0x2c3038)`), `addTableLights` from `three/thumbnail.ts`, the pivot, a `ResizeObserver` on the canvas, `start()` and `stop()` for the loop, `dispose()`.

The viewer keeps `setTurn`, `setTurnGizmo`, `setCamera` and the pivot for the converted mini (Adjust's turn preview, the screenshots after a conversion), `showMesh`, `showPair`, `showBaked`, `showStress`, `showGlb`, `perf`, `setLook`, `setWireframe`, `clear` without the question branch. It loses `showShown`, `chunksAdded`, `rayAt`, `screenOf`, `setPatches`, `focusOn`, `focusFile`, `lookAt`, `setBrush`, `QuestionFile`, the question material, the warm-up and `zoomToCursor`.

### 7.2 Two copies of the camera code

`setCamera` (15 lines), `setTurn` (5), `setTurnGizmo` (28), the pivot, the grid and the lights exist in the viewer for the mini and in the scene for the question. That is the price of a view that mounts alone; a shared helper in `three.ts` for a camera on a sphere and a rotate gizmo is worth it when a third copy appears, not now (§13). The build keeps the two copies identical in what they do (`setCamera(34, 22, 1)` frames a new question as it frames a new mini) and says so in a comment on each.

### 7.3 The second WebGL context on the page

The page has two renderers after this: the viewer's on `#viewport` and the view's on its own canvas over it, shown only in the `asking` state. The GPU holds a mini's buffers in one of them at a time, as today (the viewer is cleared at the first question, §4; the view gives its meshes up at the last Confirm), so what changes is one more context: its own default buffers, one more shader program, a few MB. The view's loop runs only while a question is on screen, so an idle view costs no frames; the viewer's loop runs as today. The time to the question and the longest stall are measured in step 6 of §10 against the last corpus run, and the peak memory of the largest file against the estimate (§12).

Why not one renderer for both: a renderer is bound to its canvas, and two `WebGLRenderer`s on one canvas share one context and fight over its state. A view that takes the consumer's renderer and draws into its scene is the alternative of §2, which the issue's criterion rules out.

### 7.4 Pointer handling

The canvas handlers of `main.ts` (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`: a tap within `TAP_MAX_PX` and `TAP_MAX_MS`, a right-click or a finger held `FOCUS_HOLD_MS` to turn the view about the spot, the brush's dabs every `BRUSH_STEP_PX` sent once per frame, two fingers orbit) move into `mount.ts` on the view's canvas, unchanged. The page does not handle `contextmenu` today and its right-click test passes; the view adds nothing there either.

## 8. Where the code goes

- **`src/lib/questions.ts`** (new): the entry of §3.
- **`src/lib/questions/mount.ts`** (new): `mountQuestions`, `QuestionsView` as a class, the template, the wiring, the `asking` state (today's object and the functions around it), the pointer handling, the constants `TAP_MAX_PX = 6`, `TAP_MAX_MS = 400`, `BRUSH_STEP_PX = 6`, `BRUSH_RADIUS_MM = 1`, `FOCUS_HOLD_MS = 500`, `PANEL_WIDTH_PX = 360`, `PAIR_COLOURS`, the types `AskedQuestion`, `AskedMeet`, `MeetUi`, `TurnAxis`, `ConversionToAsk`, `QuestionsState`, `QuestionsOptions`.
- **`src/lib/questions/scene.ts`** (new): `QuestionScene`, `QuestionFile`. **`src/lib/questions/mesh-chunks.ts`** and its test: moved from `src/page/`.
- **`src/lib/questions/copy.ts`** (new) and `copy.test.ts`: §5.
- **`src/lib/questions/questions.css`** (new): §6.2.
- **`src/page/main.ts`**: the glue of §4; the question code removed. **`src/page/viewer.ts`**: §7.1. **`src/page/page-state.ts`**: §5. **`index.html`**, **`src/page/style.css`**: §6.
- **`eslint.config.js`**: the pattern `**/lib/questions/*` joins the restricted group; `../lib/questions` is an entry like `../lib/three`.
- **`src/lib/index.test.ts`**: the pinned list of `questions.ts`.
- **`package.json`**, **`README.md`**, **`CLAUDE.md`**: §9.

## 9. Package, README, CLAUDE.md

- `package.json`: `"./questions": "./src/lib/questions.ts"`.
- README, "Use it as a library": a paragraph and a snippet under the existing call, about fifteen lines, type-checked once in a scratch file like #50's:

  ```ts
  import { mountQuestions } from 'meshtavern-converter/questions';

  // A dialog: a box for the meshes (give it a size), a box for the controls, your own Cancel.
  const view = mountQuestions({
    scene: dialog.querySelector('.scene')!,
    controls: dialog.querySelector('.controls')!,
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

  Plus the lines: the view draws every `Question` and sends every answer, so the consumer never looks inside one; the words are `QUESTION_COPY` and the sentence functions, replaced field by field through `copy`; the styles come with the entry under `.mt-questions` and read the custom properties `--panel`, `--control`, `--line`, `--text`, `--muted`, `--accent`, `--warn` and `--pair-1` to `--pair-4`; one view per document (the ids); `view.state` and the methods are what this page's `window.__mt` hooks forward to, so `scripts/lib/answer-up.mjs` can drive a consumer the same way.

- `CLAUDE.md`: the intro's mention of `src/page/main.ts` and `viewer.ts` for the questions; the layout's `src/lib/` paragraph gains the `questions.ts` entry and its folder; the `src/page/viewer.ts` paragraph loses the question half and names the view; the `src/page/page-state.ts` paragraph says which wording is the library's; the `mesh-chunks` mention moves.

## 10. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green at steps 1, 3 and after. The regression baseline does not move at any step.

1. **The wording into the library.** `copy.ts` and `copy.test.ts` (the moved blocks), `questions.ts` exporting them, `page-state.ts` spreading `QUESTION_COPY` into `COPY` and dropping the moved functions, `main.ts` importing the sentence functions and the constants from `../lib/questions`, the ESLint pattern, `index.test.ts` pinning `questions.ts` (the copy exports only, for now; the list grows in step 2), `package.json`. Every e2e spec passes unchanged.
2. **The view, beside the page.** `scene.ts`, `mesh-chunks.ts` (moved, with its test), `mount.ts`, `questions.css`, the entry complete, `index.test.ts` pinned. The page is untouched and still passes; the new code is reached by nothing yet, so the test of this step is the typecheck, the lint rule and the pinned list. The commit is reviewable on its own: it is `main.ts`'s and `viewer.ts`'s question code moved, not rewritten; the PR says which lines came from where.
3. **The page uses the view.** `index.html` (§6.1), `main.ts` (§4: the mount, `start`/`end`, `onChange`, the hooks forwarded, the question code removed), `viewer.ts` (§7.1), `style.css` (§6.2). `npm run e2e`: every spec passes; the diff under `e2e/` is empty. The lint rule must fail once in between (a page import of `../lib/questions/mount`) and pass after: note it in the journal.
4. **Screenshots** with `verify-3d`, before (from `main`) and after, from the same hooks and camera: the up question of a lying generated figure, the base's question of the generated pair, the pairs stop with the proposal, the person's two pairs, the final view, the parts question with a wing apart, and the question on a phone viewport. The PR carries them side by side under "Needs a human look": the view must look the same on the page, down to the buttons.
5. **The consumer check**, as #50 did: a throwaway Vite 8 project outside the repo, the library linked by `file:`, a dialog with two elements, `mountQuestions`, the generated puddle figure and recess base converted with every question, each answered by a click on the view's own controls. Proves the stylesheet import, the worker and three.js under a consumer's bundler, and the `controls`-less panel. Record what was needed in the README and the journal; a change inside the library beyond the entry is a stop (§12).
6. **Numbers** (development PC, window in front, a fresh page per conversion): `npm run corpus -- --no-bake` for the time to the question and the longest stall per mini against the last run; `scripts/measure-memory.mjs` on the largest corpus file and on the 1.25 M-triangle humanoid, with the question, against the estimate. A second context must not move either figure beyond the run-to-run noise the #108 journal entry shows.
7. **Docs and journal.** `CLAUDE.md`, the README, and `docs/journal/2026-10-<dd>-questions-view.md` (topics `ui`, `worker`, `tooling`, `workflow`): why the view owns its canvas and what the second context costs (§2, §7.3), what moved and what was duplicated (§7.2), what the consumer check needed, every number with its device, what went wrong.

## 11. How each criterion is proven

| Criterion (issue #119)                                                                                                                                                                                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A library entry exports a function that mounts the question view into a given element and returns the answer callback `convert` takes as its fourth argument; it draws the meshes a `Question` carries with the library's own three.js helpers and sends `MeetAnswer` and `UpAnswer` actions as the page does today | `mountQuestions` and `start()` (§3); `scene.ts` on `addTableLights`, `GRID_SQUARE_MM`, `DEFAULT_LOOK` (§7.1); the consumer check (step 5) answers every question from the view's controls; `e2e/up-question.spec.ts`, `meet.spec.ts`, `parts.spec.ts` prove the actions through the page |
| 2. The page uses the entry; no behaviour change on the page (every e2e spec of the questions passes unchanged or with import paths updated only; the regression baseline does not move)                                                                                                                                | step 3: `npm run e2e` green with an empty diff under `e2e/`; `baseline.test.ts` untouched; the screenshots of step 4 side by side; the figures of step 6                                                                                                                                 |
| 3. The entry's wording is passed in or exported as `COPY` so a consumer can replace it; its styles are scoped to the mounted element                                                                                                                                                                                   | `QUESTION_COPY`, `QuestionSentences`, `copy` (§5) with `copy.test.ts`; `questions.css` under `.mt-questions` (§6.2); the consumer check's dialog with the page's variables unset                                                                                                         |
| 4. The README documents the entry with an example; the API test of #50 lists the new exports                                                                                                                                                                                                                           | §9; `index.test.ts` with the fourth list                                                                                                                                                                                                                                                 |
| 5. Design pass first (Fable 5.1), then built (Opus 5.5)                                                                                                                                                                                                                                                                | this note; the hand-over PR                                                                                                                                                                                                                                                              |

## 12. When to stop and ask

- **An e2e spec needs a change that is not an import path**, or a hook has to change its name, shape or timing to work through the view. The view's contract (§3, §4) is meant to make that unnecessary; if it is not, the contract is wrong, not the test.
- **The page cannot render the same pixels** with the scoped stylesheet (a button, a label or the sheet on a phone differs between the step 4 screenshots). Report with both screenshots; do not change the page's look to fit the view, and do not unscope a rule.
- **The time to the question or the longest stall moves** beyond the noise of the last run on the same machine (the #108 entry: a stall of 7–79 ms run to run, the question of the humanoid within 0.05 s), or **the peak memory of the largest file rises above its estimate** with the second context (step 6).
- **The consumer check needs a change inside the library beyond the entry**: the stylesheet import failing under the consumer's bundler, three.js's addons resolving differently, the worker not found. #50 found `server.fs.allow` and the README says it; a second such line is fine, a change in `src/lib/` is the PM's call.
- **Something the page does at a question turns out not to be in a `Question`** and not in `ConversionToAsk` (a file's size, a choice), so the view would need another input. Add it to `ConversionToAsk` only if a consumer would have it too; else stop.
- A decision of this note turns out wrong. Record the PM's answer in this note with the date, nothing else.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 13. Out of this note

- A shared camera and gizmo helper in `three.ts` (§7.2): when a third copy appears.
- A `colours` option for the patches and the chips, a `background` or grid option for the scene: theming beyond the CSS variables. The table's design decides what it needs.
- Several views in one document: the ids would have to become `data-` attributes, which changes twenty tests. A follow-up once the table needs two dialogs at once, which nothing says it will.
- Dropping the second context on the page by composing the view's scene into the viewer: the alternative of §2; worth revisiting only if step 6 shows a cost.
- The page's `#heading`, `#status`, Cancel and the five states: the consumer's, by design.
- Progress, the error card, the file picker, `readStlFile`: already in `index.ts`; a "whole dialog" entry that bundles them with the questions is a different story, and the table's dialog is the table's.
- An options-only `convert(stl, { onProgress, ask, askUp, signal })`: the follow-up #50 named, still waiting for the table's first use.
