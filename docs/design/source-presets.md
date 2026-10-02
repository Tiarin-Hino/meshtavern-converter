# Design: source presets, a known scale and up axis per export tool (#100)

Status: design pass by Fable 5.1, 2026-10-02, for Opus 5.5 to build · Not part of the Phase 1 epic: what the table application (Phase 2) needs from the library · Issue: #100 · Builds on #44 (`docs/design/scale-and-base.md`), #72 and #92 (`docs/design/up-before-reduce.md`)

This note fixes the decisions the build should not have to make: what a preset is and where it lives, how it sits under the choices a person makes by hand, what the orient and size steps do with it, how it reaches the worker and the page, which presets are proposed and from what, and the build order with the test that proves each step. Product behaviour comes from the issue; where this note picks a name, a number or a wording, it is marked _(proposal)_ and the PM can change it. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§9).

## 1. The problem

A file says nothing about its units or its up axis (STL has neither), so the converter guesses both: the units from the height (`guessUnits`, #44) and the up axis from a base, else the taller of Y-up and Z-up (#72). The guess is shown and the person corrects it, file by file, with the units select and the up select. A person who always exports from the same tool corrects the same two things every time, and the table application, which converts for many people, cannot tell the converter "this file comes from a tool that writes metres, Z up" except by setting the two options itself.

A preset is that sentence as data: units, an extra scale and the up axis, with a name. Choosing one sets both options at once. It is a statement about the file's source, not a look at the file, so it does not switch off anything the converter shows: the question which way is up still comes (§4), with the preset's axis as the proposal.

## 2. Data shape (`src/lib/pipeline/source-preset.ts`, new)

```ts
import type { UpAxis } from './orient';
import type { Units } from './size';

/** A known export convention: what to take as given about a file instead of guessing it. */
export interface SourcePreset {
  /** Stable, lower-case, for the page's select and the records; the table may pass presets of its own, so this is a string. */
  id: string;
  /** What the person reads. Describes the convention, never names a product (§6). */
  label: string;
  units: Units;
  /** An extra factor on top of the units, for a tool whose unit is a multiple of one of ours (a centimetre tool: `mm` × 10). 1 for most. */
  scale: number;
  /** The file axis that is up in that tool. */
  up: UpAxis;
  /** Where the convention is from, in one sentence, for the PR and the README (§6). Not shown on the page. */
  source: string;
}

/** The presets the page offers, in this order; the first entry of the select is "None (guess)". */
export const SOURCE_PRESETS: readonly SourcePreset[] = [
  /* §6 */
];

/** The preset with this id, or null. The page and the scripts resolve an id with it. */
export function findSourcePreset(id: string): SourcePreset | null;

/** Checks a preset a consumer passes: units known, scale finite and > 0, up one of `UP_AXES`; throws a RangeError otherwise. */
export function checkSourcePreset(preset: SourcePreset): void;

/**
 * Lays the preset under the choices: `up` where the orientation chooses nothing, `units` and
 * `scale` where the sizing says nothing. Returns new objects; the inputs are untouched.
 */
export function applyPreset(
  preset: SourcePreset,
  orientation: OrientationOptions,
  sizing: SizingOptions,
): { orientation: OrientationOptions; sizing: SizingOptions };
```

A preset is applied, not stored, inside the pipeline: once applied, the steps see ordinary options. Pipeline code stays free of the DOM and three.js; the module imports types only.

### 2.1 The one new option in the size step

`SizingOptions` gains `scale?: number`: a factor on top of the units, default 1. `sizeMini` multiplies it into the units factor (`Sizing.scale` already means "units × any requested scale"); a `scaleToBaseMm` replaces both, as it replaces the units today. Not finite or not positive: the `RangeError` `scaleToBaseMm` throws. The page has no control for it; it exists for presets and for the table.

### 2.2 Where the preset goes in

| Where                                  | Field                                                     | What it does                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PipelineOptions` (run.ts)             | `preset?: SourcePreset`                                   | At the top of `runPipeline`, `applyPreset` lays it under `orientation`, `baseOrientation` (a pair's base comes from the same tool) and `sizing`. From there the steps run as they run today with those options.                                                |
| `UpAnswer` (ask.ts)                    | `preset?: SourcePreset \| null`                           | Sets the preset for the rest of this conversion, or clears it (`null`). Every answer's `orientation` is resolved under the current preset: an empty answer (`{}`, the page's Reset) is the preset's axis, an answer with `up` or `rotation` wins over it (§4). |
| `ConvertOptions` (protocol.ts)         | `preset?: SourcePreset`                                   | Carried to the worker as it is: a plain object, structured clone.                                                                                                                                                                                              |
| `UpChoices` (run.ts; `result.choices`) | `preset?: SourcePreset`                                   | The preset the conversion ended with, so `choices` still convert the same mini again without asking. `stats.choices` is the same object.                                                                                                                       |
| `index.ts`                             | `SOURCE_PRESETS`, `findSourcePreset`, `type SourcePreset` | Two new lines in `index.test.ts`. `applyPreset` and `checkSourcePreset` stay inside the library.                                                                                                                                                               |

Nothing new in the GLB: `extras.meshtavern` already carries `units`, `scale` and the `rotation`, and the table passes the preset itself. _(proposal: not recorded; one field if the PM wants it)_

## 3. Precedence: the preset is a layer under the person's choices

Field by field, the first that is set wins:

| Field                    | 1. by hand                                 | 2. preset      | 3. the converter               |
| ------------------------ | ------------------------------------------ | -------------- | ------------------------------ |
| up axis of the figure    | `orientation.up` or `orientation.rotation` | `preset.up`    | detection (base, tallest, cut) |
| up axis of a pair's base | `baseOrientation.up` or `.rotation`        | `preset.up`    | its underside                  |
| units                    | `sizing.units`                             | `preset.units` | `guessUnits`                   |
| scale                    | `sizing.scaleToBaseMm` (replaces both)     | `preset.scale` | 1                              |

A preset's axis counts as a chosen axis in every rule that asks whether the person chose one (`choosesOrientation`): the stance candidates, the print cut of a pair's figure (#90) and the registration test (#70) are skipped, exactly as for `up`. One rule, no new path through the orient step; `Orientation.method` is `manual` and `Sizing.unitsMethod` is `manual`, as for a choice by hand. The page says "(preset)" instead of "(chosen)" from its own state (§5), the pipeline does not need a third method. _(proposal; §9 names the case where the lost registration test would matter)_

`setDown` is not part of a preset: the preset keeps the axis exactly, as every chosen axis is kept (PM decision on PR #79, 2026-09-25).

## 4. The question still comes

With `askUp`, a file new to the person is asked about after the orient step (table in `docs/design/up-before-reduce.md` §6.4). A preset changes what the question shows, not whether it comes: the file stands on the preset's axis, `reason` is what it is for a chosen axis today, and a right preset costs the same one click as a right detection. Reasons: nothing is turned silently (the up paragraph of `CLAUDE.md`), the preset is a claim about the tool and may be wrong for this one file, and the table may decide for itself not to ask (it passes no callback). _(proposal: the PM may decide that a preset skips the up question; then `AskOptions.up` false when a preset is given, one line in the page)_

The question's select of presets (§5) answers with `preset` and `confirm: false`: the question comes again, the file standing the preset's way. Choosing "None" answers `preset: null`: back to the detection. Both are resolved from scratch over the kept pass, inside the orient step's time, like every answer (`resume`). The size step runs after the questions, so units and scale need no question.

## 5. The page

- **Where.** One select "Source" _(proposal for the label; `COPY.source`)_ in `#ask`, above "Up axis in file", and one at the top of Adjust, above the "Up and turn" fieldset, because it sets a field in both fieldsets below it. Entries: "None (guess)" _(proposal)_, then `SOURCE_PRESETS` by `label`, built from the list like the look buttons. Both selects show the same choice.
- **At the question**: changing the select answers as §4; the question comes again; Confirm converts.
- **In Adjust**: changing the select converts again with the preset and asks nothing (the row "Adjust" of the §6.4 table). Picking a preset drops the choices it replaces (`choices.orientation.up` and `.rotation`, `choices.baseOrientation`, `choices.sizing.units`, `.scale` and `.scaleToBaseMm`), so the preset takes effect: that is what picking it means. A later change of the up select or the units select overrides one field and leaves the preset selected: the preset still says where the file came from. Picking "None" drops the preset and converts with the detection and the guess again.
- **Figures.** The `Units` row says `metres (preset)` when the units come from the preset (no `sizing.units` chosen and a preset set), `(chosen)` or `(guessed)` as today otherwise; the same word for the up axis where the page describes it.
- **State.** `Choices` gains `preset: SourcePreset | null`; `choices` take `result.choices.preset` after every conversion like the other choices; a new file starts with none (the page stores nothing between visits, see §8). `AppState` exposes it as `state.preset` (the id or null).
- **Hook.** `window.__mt.setPreset(id | null)`: at a question, the answer of §4; after a conversion, the reconversion above. Resolves when the question or the conversion has come back.
- Visual change: a select in two places; `verify-3d` screenshots of the question and of Adjust with a preset chosen.

## 6. The presets, and the rule on names

**The rule.** This repository names no third-party mini, creator or shop (`docs/journal/README.md`, "Public repo"); third-party software it uses is named with its licence and trademark line in the README's "Third-party content" section. A preset's `id` and `label` therefore describe the convention (units and axis), never a product: a product name in a label would be the one piece of text every user reads. The `source` sentence may name the tool whose documented default the preset is, as a plain statement of fact, and every tool so named gets one line under "Third-party content" in the README (name, that it is a trademark of its owner, link to the documentation cited). Which tools are named at all is the PM's call on the PR (§9).

**The list** _(proposal; the builder verifies each source against the tool's own documentation before the PR, cites it in `source` and in the PR body, and leaves out any entry for which no citation is found, §9)_:

| id            | label                         | units | scale | up   | Source, as this note knows it                                                                                                                                                                                               | Confidence |
| ------------- | ----------------------------- | ----- | ----- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `print-mm-z`  | Print file: millimetres, Z up | mm    | 1     | `+z` | The convention of 3D printing: slicers read STL as millimetres and build along Z; files shared for printing follow it. The converter's own default guess; the preset says "do not guess" for files that are known to be it. | high       |
| `sculpt-mm-y` | Sculpt: millimetres, Y up     | mm    | 1     | `+y` | Sculpting and animation tools whose scene is Y up, exported at 1 unit = 1 mm. The `tallest` fallback of #72 already names Y-up as "from sculpting tools".                                                                   | medium     |
| `scene-m-z`   | Scene units: metres, Z up     | m     | 1     | `+z` | A Z-up modelling tool whose default scene unit is the metre, exported without a scale factor: a 32 mm mini lands as 0.032 units.                                                                                            | medium     |
| `scene-m-y`   | Scene units: metres, Y up     | m     | 1     | `+y` | The glTF and game-engine convention: metres, Y up (the glTF 2.0 specification says both).                                                                                                                                   | high       |
| `cad-in-z`    | CAD: inches, Z up             | in    | 1     | `+z` | CAD tools with an imperial template export STL in model units.                                                                                                                                                              | medium     |

Not proposed: a centimetre preset (no tool found whose STL export is centimetres by default; `scale: 10` on `mm` covers it the day one is), and any preset for a download from a shop or a character-creator site (the rule above, and the scale is not documented).

Three of the five only make the guess explicit (`guessUnits` reads 0.032 as metres already): their value is the up axis and the certainty. That is what the issue asks for.

## 7. Build order, one commit each, with the test that proves it

`npm run check` green after each; the regression baseline must not move (no preset, no change: `applyPreset` runs only when a preset is given).

1. **`source-preset.ts` and `source-preset.test.ts`.** The shape, the list, `findSourcePreset`, `checkSourcePreset`, `applyPreset`. Tests, over `SOURCE_PRESETS` in a loop so that every preset is tested: ids unique and lower-case, labels and sources non-empty, labels without a product name (a list of words the test refuses is overkill; assert the label equals the pattern "<kind>: <units>, <axis> up"), `units` in `UNIT_FACTORS`, `up` in `UP_AXES`, `scale` finite and positive; `applyPreset` fills empty options and leaves set ones alone, field by field; `checkSourcePreset` throws on a made-up unit, a zero scale, an unknown axis.
2. **`SizingOptions.scale`** in `size.ts`. Tests in `size.test.ts`: `scale: 10` on a mm file makes `Sizing.scale` 10 and `sizeMm` ten times; with `units: 'in'` it is 254; `scaleToBaseMm` replaces it; `scale: 0` and `NaN` throw.
3. **The pipeline.** `PipelineOptions.preset`, `applyPreset` at the top of `runPipeline` (orientation, base orientation, sizing), `UpAnswer.preset` and the resolution of every answer under the current preset, `UpChoices.preset`. Tests in `run.test.ts`, over `SOURCE_PRESETS` in a loop: the generated figure written in the preset's units (positions divided by `UNIT_FACTORS[units] × scale`) and laid so that the preset's axis is its up, converted with the preset and without questions, stands (`stats.up === preset.up`, `upMethod` `manual`), measures its height in mm within 1e-6 of the figure's, has `sizing.units === preset.units`, `sizing.scale` the factor and `choices.preset` the preset. Then, once: `orientation.up` beats the preset's axis; `sizing.units` beats its units; with `askUp`, an answer `{ preset, confirm: false }` brings the question again standing on the preset's axis, `{ orientation: {}, confirm: true }` converts with it, and `{ preset: null }` goes back to the detection; a pair gets the preset's axis on its base too (`baseOrientation` in `choices`); `checkSourcePreset` runs on a preset from the options (a bad one is the `unexpected` problem, as every other thrown error).
4. **The worker and the API.** `ConvertOptions.preset` through `protocol.ts`, `handle.ts`, `client.ts`; `handle.test.ts` converts with a preset. `index.ts` exports and the two lines in `index.test.ts`. README "Use it as a library": one line and `preset: findSourcePreset('scene-m-y')` in the example's options.
5. **The page.** `index.html` (the two selects), `page-state.ts` (`COPY`, the "(preset)" word, unit-tested), `main.ts` (the selects built from the list, the wiring of §5, `state.preset`, `setPreset`), `style.css` if the select needs a line. `e2e/source-preset.spec.ts`, with a generated figure picked through `#file` as `up-question.spec.ts` does, written in metres and lying so that `+y` is its up: the question shows the detection; `setPreset('scene-m-y')` brings a new question (`serial` grows) with `orientation.up === '+y'`; Confirm converts once and the figures say `metres (preset)`; in Adjust, `setPreset(null)` converts again with no question (`progressLog` without one) and the guess is back; `e2e/promise.spec.ts` unchanged and green. Screenshots with `verify-3d`.
6. **Docs.** `CLAUDE.md` (the layout line for `source-preset.ts` next to the size line; `setPreset` and `state.preset` in the hook list; one sentence in the up paragraph of the conventions: a preset is the person's choice for every file of the mini and still asks), README (the library line, the "Third-party content" lines for any tool named in a `source`), this note's §6 table updated to what shipped. No spec line: the issue is not in the Phase 1 epic. Journal entry `docs/journal/2026-10-<dd>-source-presets.md`, topics `stl-import`, `orientation`, `ui`: why a layer under the choices and not a third method (§3), why the question still comes (§4), the naming rule (§6), what each source citation turned out to be, and anything that went wrong.
7. **The PR** (`/open-pr`): the §6 table with the citation per preset in the body, for the PM to confirm names and entries (criterion 3 of the issue is met by the PR text, not by code).

## 8. Out of this note

- **Reading the source from the file.** A binary STL's 80-byte header often names the exporter, and an ASCII file's `solid` line sometimes does; a preset proposed from it would save the pick. A follow-up with its own issue: it needs a survey of real headers (corpus) and a rule for when the header lies.
- **The page remembering the preset between visits.** The page stores nothing (spec, "Privacy"); the table has accounts and can.
- **A unit the list does not have** (centimetres as a `Units` value): `scale` covers it; adding a unit touches the guess, the select and the GLB sentence, and is not needed by any proposed preset.
- **A preset that scales to a creature size** (a "28 mm heroic → 32 mm" kind of preset): that is `scaleToBaseMm`, a choice about the mini, not about the tool.

## 9. When to stop and ask

- **No citation for a proposed preset.** Leave it out of the list, say so under "Needs a human look" in the PR with what was looked at. Do not ship a scale from memory.
- **A tool's documented default disagrees with this note's table** (for instance a Y-up tool that exports Z-up): the documentation wins; change the entry and say so in the PR and the journal.
- **The PM wants a product named in a label**, or wants no product named anywhere: the §6 rule is a proposal; follow the decision, record it in §6.
- **The up question should be skipped by a preset**: a product decision (§4); ask on the PR and build the one line when the PM says so.
- **A pair from one tool loses its registration test** (§3) and the PM's own pairs then place worse than before with a preset chosen: that is the case where the preset's axis should not count as "chosen" for the registration test. Stop and ask; the fix is a second flag, not a workaround.
- **The regression baseline moves** without a preset in the path: `applyPreset` leaked into the default path. Find it; do not update the baseline.
- A criterion needing a product answer the issue does not give.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 10. How each criterion is proven

| Criterion (issue #100)                                                                                | Proof                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The library API accepts a preset that sets units, scale and up axis                                | `run.test.ts` and `handle.test.ts` (step 3 and 4): a conversion with `preset` stands and sizes the generated figure by the preset; `index.test.ts` lists the exports |
| 2. The page offers the presets next to the existing manual options                                    | `e2e/source-preset.spec.ts` (step 5): the select at the question and in Adjust; screenshots                                                                          |
| 3. The list is proposed in the PR with a source per scale; names follow the rule on third-party names | The §6 table in the PR body with a citation per entry; the `source-preset.test.ts` label pattern; the README lines                                                   |
| 4. Unit tests per preset                                                                              | `source-preset.test.ts` and `run.test.ts` loop over `SOURCE_PRESETS`: a new entry is tested by being added                                                           |
