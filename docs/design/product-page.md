# Design: the product page (#41)

Status: design pass by Fable 5.1, 2026-09-26, for Opus 5.5 to build · Spec: Phase 1, story 6 · Issue: #41

This note fixes the decisions the build should not have to make: the four states of the page and how they follow from the app state, the layout on a desktop and on a phone, the wording, what moves behind `?dev`, how the downloads are cut, the module boundary between wording and wiring, the end-to-end test that proves the promise, the changes to the existing tests, and the build order. Product behaviour comes from the issue and the spec; where this note picks a number or a sentence, it is a named constant or a quoted string marked _(proposal)_ and the PM can change it. How the page looks is the PM's call, first on the wireframes in `docs/design/product-page/`, then on the screenshots the PR attaches. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§11).

The spec's risk list says the page is polish for an audience of few while nothing is published, and asks to keep #41 small. So: no framework, no new dependency, nothing loaded from another origin (§7 relies on that), and the same files that make the page today (`index.html`, `src/style.css`, `src/main.ts`) plus one small module for the wording.

## 1. Who uses the page now, and what it must do

The PM and the team, converting their own minis and judging the result; the table application will use the library (#50), not this page; hobbyists only after publishing (#47, parked). The page has one job: a person drops an STL and, without reading anything, sees what is happening, gets an upright, sized, baked mini, and downloads it for the table, or reads why it did not work. Everything that served the spike (stress scene, benchmark, raw figures, GLB round trip) stays available to the team behind `?dev` and disappears for everyone else.

The controls that already exist keep their behaviour and their test ids: the six-way up select and the turn controls (#72), the size form (#44), the look controls, the level buttons, cancel. This story arranges and restyles them; it changes no conversion behaviour.

## 2. The four states

```ts
// src/page-state.ts
export type PageState = 'empty' | 'converting' | 'done' | 'error';

/** The state of the page follows from the app state; nothing sets it by hand. */
export function pageStateOf(app: {
  busy: boolean;
  stats: unknown | null;
  imported: unknown | null;
  error: string | null;
}): PageState {
  if (app.busy) return 'converting';
  if (app.error !== null) return 'error';
  if (app.stats !== null || app.imported !== null) return 'done';
  return 'empty';
}
```

- `AppState` gains `page: PageState`, refreshed by one `render()` function in `main.ts` that every state change calls (the start of a conversion, progress, the result, an error, cancel, a GLB opened). `render()` sets `document.body.dataset.state`, and the CSS shows and hides by `body[data-state='…']`; the `hidden` attribute is no longer flipped panel by panel. Tests assert `window.__mt.state.page` and `body[data-state]`.
- **Empty:** the page as opened, and again after a cancelled conversion (`#status` then reads "Cancelled.", the test of #42 relies on the word). A large drop card in the middle of the viewport with the heading, the button that opens the file picker, and the promise (§4).
- **Converting:** the same card, now with the file name, the step in words, a progress bar and a Cancel button. The mini appears when the conversion ends, as today; showing the per-vertex mini early while the bake finishes is the spec's open product question (story 9) and not part of this story.
- **Done:** the mini in the viewport, the panel (§3) with the file name, the size line, the two downloads and the Adjust sections, the level chips in the corner of the viewport. A GLB opened under `?dev` (`state.imported`) is also `done`: the panel shows the file name and the status line, and hides the size line, the downloads and Adjust, because there is nothing to adjust or export.
- **Error:** the card again, with the heading, the file name, the message from `PROBLEM_MESSAGES` in `#status` with the class `problem` (the tests of #43 read both), and the button to choose another file. Dropping a file works in every state, so the error state needs no extra affordance beyond the button.

`#status` stays the one message line of the page, in the card or the panel depending on the state: the hint or "Cancelled." when empty, the step when converting, the ready line when done, the problem when in error. That keeps every existing assertion on `#status` true.

## 3. Layout

Wireframes: `docs/design/product-page/desktop-{empty,converting,done,error}.svg` and `phone-{empty,done}.svg`, each with a PNG export. They are drawn as SVG by hand and rendered with Playwright's Chromium (`npx playwright screenshot --viewport-size=1280,800 file:///…/desktop-done.svg desktop-done.png`); a PM who wants to move boxes can open the SVG in any vector editor, and the build is not expected to touch them. Converting and error on a phone are the desktop cards at the phone card's width, so they have no frame of their own.

The layout has three parts:

- **Top bar** (`<header>`, `TOP_BAR_HEIGHT_PX = 56` _(proposal)_): the name, the short form of the promise, and one button that opens the file picker (§4). Under `?dev` a small badge reads "dev", so every screenshot says which mode it shows.
- **Viewport** (`#viewport`): the canvas fills everything below the top bar, in every state; the grid is the table the mini will stand on, and in the empty state it is the background of the drop card. The **level chips** sit in the viewport's bottom-left corner in the done state (`#levels`, the same element and behaviour as today, restyled as small chips): available, not the first thing one sees. The chips read "Original", "Close", "Table", "Far" _(proposal)_, and each carries its triangle count as a title attribute; the table level is pressed by default, as today.
- **Card or panel** over the viewport: the drop card, centred, `CARD_WIDTH_PX = 520` _(proposal)_, in the empty, converting and error states; the **panel**, `PANEL_WIDTH_PX = 360` _(proposal)_, along the right edge in the done state, scrolling on its own when it is taller than the viewport. Same element (`#panel`), two positions by state. The size-warning screenshot of the sizing test moves from `header` to `#panel`.

**The panel, top to bottom** in the done state:

1. File name (without `.stl`) and `#status` ("Ready. Converted from 1,250,000 triangles." §4).
2. `#mini-size`: the size line (§4).
3. **Download as GLB**: two buttons, "Download table level" and "Download far level" (§5).
4. **Adjust**, a `<details>` (`#adjust`) with three sections, in the order a person meets the problems: **Up and turn** (the six-way select, the four 15° buttons, Turn by hand, the pending line, Apply, Set down, Reset), **Size** (units, creature size, scale to a base diameter, plain base, the warning with its button), **Look** (the checkbox, the base coat, the three sliders; #45 puts its presets at the top of this section). Open by default on a desktop, closed on a phone _(proposal)_, and opened by the code when a conversion ends with a size warning, so the warning is never hidden behind a closed summary.
5. Under `?dev` only: **Figures** (`#stats`, the `<dl>` as today) and the stress buttons (`#stress`). The perf line (`#perf`) and the benchmark panel (`#bench`) stay outside the panel, under the viewport, as today, and only under `?dev`.

**Phone** (`@media (max-width: 600px)`, `PHONE_MAX_WIDTH_PX = 600` _(proposal)_): the top bar keeps the name and the file button and drops the promise text (it is in the card and in the drop hint). The card takes the width minus `16 px` margins. In the done state the panel becomes a **bottom sheet** with a grab handle, `SHEET_MAX_HEIGHT = 40vh` _(proposal)_, scrolling inside; the viewport keeps the rest, at least half of the screen. The size line and both download buttons fit in the sheet's first screen without scrolling; Adjust starts closed. Every button and input is at least `TOUCH_TARGET_PX = 44` _(proposal)_ high. Nothing on the page scrolls horizontally. The rotate gizmo of #72 already uses pointer events and works with a finger; whether it is comfortable is a note for the PR's limits, not a criterion.

**Drag over the page** _(proposal)_: `dragenter` and `dragleave` on the body toggle `body[data-dragging]`, and the CSS shows a full-page dashed frame reading "Drop to convert". Cheap, and it tells a person on a desktop that dropping works in every state.

**Colours and type:** the existing dark scheme, moved into custom properties on `:root` (`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`, `--warn`, with today's values) so #45 and later restyles change one place. `system-ui` as today; no web font, no icon font, nothing fetched from another origin. Focus rings visible; `prefers-reduced-motion` switches the progress shimmer (§4) off.

## 4. Wording

All page copy lives in `src/page-state.ts` as constants and pure functions, so the wording has unit tests in Vitest and `main.ts` only puts strings into elements. Every string here is a _(proposal)_ the PM may change on the PR, and changing one is a one-line change.

```ts
export const COPY = {
  title: 'MeshTavern Converter',
  promise: 'Your file never leaves your computer.',
  promiseShort: 'Runs in your browser. Your file never leaves your computer.',
  dropHeading: 'Drop an STL here',
  chooseFile: 'Choose a file',
  chooseAnother: 'Choose another file',
  dropHint: 'You get a game-ready mini in seconds. Everything runs in this tab.',
  dropOverlay: 'Drop to convert',
  errorHeading: 'This file did not become a mini',
  cancelled: 'Cancelled.',
  downloads: 'Download as GLB',
  downloadTable: 'Download table level',
  downloadFar: 'Download far level',
  adjust: 'Adjust',
} as const;
```

The promise appears three times, all reading the same sentence: the short form in the top bar, the full sentence in the drop card, and the full sentence in the error card. It must be true (§7) and it must stay a plain sentence: no "100 % private", no lock icon, nothing that reads like marketing on a page that collects nothing.

**Steps in words**, one label per pipeline step, shown in `#status` while converting:

```ts
export const STEP_LABELS: Record<StepName, string> = {
  read: 'Reading the file',
  weld: 'Joining the surface',
  orient: 'Finding which way is up',
  size: 'Measuring the base',
  simplify: 'Reducing the detail',
  shade: 'Priming and washing',
  levels: 'Making the detail levels',
  unwrap: 'Unwrapping the surface',
  bake: 'Baking the detail',
  compress: 'Compressing the texture',
};

/** "Unwrapping the surface · 40 %" while a step reports its own progress, else "Baking the detail…". */
export function describeProgress(progress: Progress): string;
```

The `<progress>` bar shows `progress.percent`, the share of steps finished; the number is not printed a second time. While a step runs without `stepPercent` (the bake takes 10 s on the reference laptop and says nothing meanwhile) the bar's fill shimmers, a CSS animation, off under `prefers-reduced-motion`.

**The size line** (`describeMini(stats)`), the one thing the done state tells about the mini besides showing it:

```
38 mm tall · Medium, 1 square · 25 mm round base
120 mm tall · Huge, 3×3 squares · 76 mm base
32 mm tall · Medium, 1 square · no base
32 mm tall · Medium, 1 square · 32 mm plain base added
```

Height is `stats.sizeMm[1]`, rounded to whole millimetres, to one decimal under 10 mm. The size is `sizeLabel(size)` with "1 square" for a footprint of one and "n×n squares" above. The base is `base.diameterMm` rounded, "round" when `shape === 'round'`, the plain base as "added", else "no base". Units other than millimetres add ", read as inches" or ", read as metres" at the end. The warnings of `stats.sizing.warnings` stay where they are today, in the Size section, with their buttons.

**The ready line** (`describeReady(stats)`): "Ready. Converted from 1,250,000 triangles." `stats.sourceTriangles`, formatted with `toLocaleString()`. The format (binary or ASCII) is a figure, not something a hobbyist needs; it stays in `#stats` under `?dev`.

## 5. Downloads

Two buttons, one per level the PM allowed out of the browser (decision of 2026-09-20): "Download table level" writes `<name>-table.glb`, "Download far level" writes `<name>-far.glb`, both through `exportGlb(level, compact)` as today; the close level is shown on screen and never exported; the full-detail mesh never was. The buttons always export their own level, whatever chip is pressed, so switching the view to inspect the close level cannot change what a download contains.

**Plain GLB is the product download** _(proposal)_: the compressed variant (quantised plus meshopt) is what a table stores and sends, and it will travel through the library API (#50); a person who downloads here wants a file that Blender and other viewers open. The "Compressed (smaller; not for Blender)" checkbox therefore moves behind `?dev` and the hook `exportGlb(level, compact)` keeps both paths tested. The PM can veto this and keep the checkbox on the product page; it is a one-line change in the markup.

## 6. What moves behind `?dev`

`PageOptions` gains `dev: boolean`: the key `dev` present in the address, with any value, switches the development tools on; `KNOWN` gains `'dev'`, and `?bake=` and `?ktx=` stay independent of it (a device run without `dev` is still a valid product run). Under `?dev` the page shows, otherwise it does not have:

| Tool                   | Element        | Why it is a tool, not a feature                                           |
| ---------------------- | -------------- | ------------------------------------------------------------------------- |
| Figures                | `#stats`       | Triangles, timings, memory, stall: for measuring, not for using           |
| Live rendering figures | `#perf`        | Same                                                                      |
| Stress scene           | `#stress`      | Phase 0's table benchmark (#12)                                           |
| Benchmark this device  | `#bench`       | #35's tool; its mode links become `?dev`, `?dev&ktx=off`, `?dev&bake=off` |
| Opening a GLB          | the file input | The round-trip check of the export; `accept` is `.stl` without `dev`      |
| Compressed download    | `#compact`     | §5                                                                        |
| The dev badge          | in the top bar | So a screenshot says which mode it shows                                  |

**How:** every such element carries `data-dev` in the markup. `main.ts` wires them as today, and at the end of start-up, when `pageOptions.dev` is false, removes them from the document (`element.remove()`), not hides them: a product page then has no benchmark button to find, and a test can assert `#stats` has count 0. References taken before the removal stay valid, and listeners on detached elements are harmless, so nothing else changes. The `window.__mt` hooks that drive these tools (`startStress`, `runBenchmark`, `loadGlb`, `exportGlb(level, true)`, `detailKtx2`) keep working in both modes; tests that look at the elements open the page with `?dev`. A dropped `.glb` without `dev` gets the existing "is neither an STL nor a GLB file" line reworded to "…is not an STL file" in product mode.

## 7. The promise, and the test that proves it

The sentence "Your file never leaves your computer." is on the page (§4). It is true today because the page makes no request with user data; the test makes sure it stays true when someone adds a font, a CDN script or an error reporter later. `e2e/promise.spec.ts`:

1. Before `page.goto('/')`, record every request (`page.on('request')`: URL, method, `postData()`, resource type) and count WebSockets (`page.on('websocket')`). The normal path, with baking: the transcoder's WebAssembly is fetched during a baked conversion, and it must be in the recorded set.
2. Build a small binary STL (`generateBumpySheet(20)`) and overwrite its 80-byte header with a marker such as `MESHTAVERN-E2E-NEVER-UPLOADED` (not starting with `solid`, so it stays binary), pick it through `#file` with `setInputFiles`, wait until `state.page === 'done'`.
3. Click both download buttons and take the `download` events: a download is a `blob:` URL and no request; the assertions below hold across them.
4. Assert for every recorded request, page load included: same origin as the page (`new URL(url).origin === new URL(page.url()).origin`), method `GET`, `postData()` null, URL shorter than `MAX_URL_LENGTH = 2048` _(proposal)_ and not containing the marker; and every request made after the file was picked has a path under `/assets/` or `/basis/` (the page's own code and WebAssembly). Zero WebSockets. Then `expect(page.getByText(COPY.promise)).toBeVisible()` in the done state's panel or card, wherever it shows.

That is the whole proof: nothing left the tab except requests for the page's own files, and none of those carried a byte of the file. It does not prove what a future third-party script might do; it fails the moment one is added, which is the point.

## 8. Module boundary and hooks

- **`src/page-state.ts`** (new, no DOM, no three.js): `PageState`, `pageStateOf`, `COPY`, `STEP_LABELS`, `describeProgress`, `describeMini`, `describeReady`, and the chip labels. Imports types only from `src/pipeline/run.ts` and `src/pipeline/size.ts`, so the split of #50 moves import paths and nothing else. Unit tests in `src/page-state.test.ts`.
- **`src/main.ts`** keeps the wiring and the hooks. It gains `render()` (§2) and loses the per-panel `hidden` flips; the element lookups stay at the top as today. `AppState` gains `page`. No hook is renamed or removed; `window.__mt` is the test surface and eleven tests use it.
- **`src/options.ts`** gains `dev` (§6).
- **`index.html`** is rewritten for the new structure but keeps every id the tests and `main.ts` use: `#file`, `#status`, `#progress`, `#cancel`, `#up`, `#up-label`, `#turn` and its children, `#sizing` and its children, `#levels`, `#stress`, `#export`, `#download`… the last becomes two buttons, `#download-table` and `#download-far`; `#compact` gains `data-dev`; `#look` and its children; `#stats`, `#perf`, `#bench` and its children. New: `#panel`, `#mini-size`, `#adjust`, `#choose` (the button that opens the picker; the input itself is visually hidden, not `display: none`, so `setInputFiles('#file')` keeps working).
- **`src/style.css`** is rewritten around `body[data-state]` and the custom properties (§3).

## 9. Changes to existing tests

`e2e/smoke.spec.ts` opens `/?bake=off` in `beforeEach`; that becomes `/?dev&bake=off`, and the four tests that navigate themselves (`/`, `/?bake=256&ktx=off`, `/?settle=1`) add `dev` where they read `#stats`, the stress buttons or the benchmark panel. The behaviour they prove does not change; the list of every touched expectation, so the builder does not guess:

| Test                                  | Change                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| converts the demo mini                | `#stats` needs `?dev`: covered by `beforeEach`                                                                                                                                             |
| switches between detail levels        | the button is `{ name: /^Far/ }` (chip label, §3)                                                                                                                                          |
| fills the table with 100 minis        | `?dev`; button names unchanged                                                                                                                                                             |
| suggests a creature size              | the screenshot locator `header` becomes `#panel`; `#stats` text unchanged                                                                                                                  |
| exports a level as GLB                | `'Download GLB'` becomes `'Download table level'` (file `generated-50-table.glb`), plus one click on `'Download far level'` expecting `generated-50-far.glb`; `#compact` is `?dev`, unused |
| bakes and compresses a mini           | `page.goto('/?dev')` for `#stats`                                                                                                                                                          |
| runs the device benchmark             | `page.goto('/?dev&settle=1')`                                                                                                                                                              |
| a running conversion can be cancelled | unchanged: `Cancel` and "cancelled" in `#status` are product behaviour                                                                                                                     |
| everything else in `smoke.spec.ts`    | unchanged                                                                                                                                                                                  |
| `e2e/messy-files.spec.ts`             | unchanged: `#file`, `#status`, `.problem` stay; its screenshots now show the error card, which is what the PM wants to see                                                                 |

`src/options.test.ts` gains the `dev` cases. Nothing in `src/pipeline/`, `src/worker/` or `src/regression/` changes; the baseline does not move.

## 10. Build order

Each step is a commit with its tests; `npm run check` green after each, `npm run e2e` green at steps 3, 5, 6, 7 and 8.

1. **`options.ts`: `dev`.** Tests: `?dev`, `?dev=1` and `?dev&bake=off` give `dev: true` and no problem; an address without it gives `false`; `?dev` is not reported as unknown.
2. **`page-state.ts`.** Tests: `pageStateOf` for the four states and for a GLB opened; `describeProgress` with and without `stepPercent`; `describeMini` for the four example lines of §4 (round base, non-round base, no base, plain base added) plus inches; `describeReady`; every `StepName` has a label.
3. **Markup, styles, `render()`.** New `index.html` and `style.css`; `main.ts` gets `render()` and `state.page`, and the `data-dev` removal (§6). The old test suite passes with the URL and label changes of §9. New `e2e/page.spec.ts`, test "shows the empty, converting, done and error states": empty (`state.page`, `body[data-state]`, the heading and the promise visible), converting during `loadGenerated(300)` (a `STEP_LABELS` value in `#status`, the bar and Cancel visible), done (the size line reads "50 mm tall · Medium, 1 square · no base" for the generated sheet, both download buttons visible, the chips present, `#stats` count 0), error after picking an empty file (`#status.problem` with `PROBLEM_MESSAGES.empty`, the heading, the button). A screenshot of the whole page attached at each state, with `verify-3d`: these are what the PM judges.
4. **Downloads** as §5; the export test as §9.
5. **Adjust and the chips**: the three sections, the chip labels, the `<details>` opened on a size warning. Tests: the sizing test's screenshot locator; a check that a conversion ending with a warning opens `#adjust`.
6. **Phone.** The media query, the sheet, the touch targets. Test "fits a phone screen" in `page.spec.ts` with `page.setViewportSize({ width: 390, height: 844 })`: no horizontal overflow (`scrollWidth <= innerWidth` on the document), the file button at least 44 px high, and after `loadDemo()` the canvas at least half the viewport height, both download buttons `toBeInViewport()`, Adjust closed. Screenshots of the phone's empty and done states attached.
7. **`?dev` moves**: `data-dev` on every element of §6, the `accept` attribute, the benchmark's mode links, the badge; the smoke tests get their `?dev`. Test: without `dev`, `#stats`, `#stress`, `#bench` and `#compact` have count 0 and a dropped `.glb` gets the "not an STL file" line; with `dev` they exist.
8. **The promise** (§7): the sentence in the top bar and the cards; `e2e/promise.spec.ts`.
9. **Docs and journal.** `CLAUDE.md` (the intro's list of address options gains `?dev`; the layout gains `src/page-state.ts` and describes `main.ts` as the wiring with `render()`; the conventions keep the hook list), `README.md` ("Run it" mentions `?dev` for the team's tools), the spec's story 6 status line, and the journal entry `docs/journal/2026-09-<dd>-product-page.md` (topics `ui`, `testing`, `workflow`): what a user sees now, why the tools went behind `?dev`, the promise test, what the phone layout cost, every wording the PM changed and why, and the screenshots' devices.

## 11. When to stop and ask

- **A wording or layout decision the PM may want to change**, flagged in the PR's "Needs a human look" with the screenshot: every string of §4, the plain-GLB download (§5), GLB opening and the compressed variant behind `?dev` (§6), Adjust closed on a phone (§3). Build with the proposals, do not wait for the answer, and change what the PM decides.
- **An existing test cannot be kept true** without changing behaviour this story does not own (a hook, a conversion result, a message of `problems.ts`). Stop and ask; do not change the behaviour to fit the layout.
- **The promise test finds a request** that is not the page's own files. Stop: that is a finding for the PM, whatever the request is, and the test must stay red until it is gone.
- **The phone layout cannot keep a control usable** (the gizmo, a slider) without changing how it works. Note it under limits and go on; the criterion is a phone-sized screen, not a phone-first redesign of #72's controls.
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 12. Out of this note

The look presets (#45) go at the top of the Look section; this story leaves the five controls as they are. The second drop target and the placement view of #70 go into the panel as a fourth Adjust section and a second accepted file; this story builds neither, and its drop handling stays "one file, the first one". The library split (#50) moves `src/pipeline/` and `src/worker/`; `page-state.ts` imports types from them and moves with the paths. Showing the per-vertex mini while the bake finishes is the spec's open question of story 9. Remembering the look or the last choices in the browser's storage is not asked for, and "the page collects nothing" is easier to prove without it. The privacy note and the third-party notices belong to publishing (#47). A favicon is a same-origin request the browser makes on its own; adding an inline SVG one avoids a 404 in the log and is a nicety the build may add without asking.
