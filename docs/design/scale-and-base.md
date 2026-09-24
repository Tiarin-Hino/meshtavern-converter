# Design: scale and base (#44)

Status: design pass by Fable 5.1, 2026-09-23, for Opus 5.5 to build · Spec: Phase 1, story 4 · Issue: #44

This note fixes the decisions the build should not have to make: the data shape the result carries, the module boundaries, the heuristics for units and base measurement, the corpus index, and the build order. Everything about product behaviour comes from the issue and the spec; where this note picks a number, it is a named constant marked _(proposal)_ and the PM can change it. Whoever builds this changes the code, not this note, unless a decision here turns out wrong on a real mini; then stop and ask (see "When to stop").

## 1. What the result carries

Today `ConversionStats` has `sizeMm`, `up` and `upMethod`. The story adds one object, `sizing`, on the result and in the stats, and mirrors the parts the table needs into the GLB's `extras`.

```ts
// src/pipeline/size.ts
export const GRID_SQUARE_MM = 32; // PM decision, 2026-09-23. The viewer imports it from here.

/** SRD 5.1 size categories (CC-BY-4.0, Wizards of the Coast); the footprint in squares is ours. */
export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export const SIZES: Record<CreatureSize, { squares: 1 | 2 | 3 | 4; plainBaseMm: number }> = {
  tiny: { squares: 1, plainBaseMm: 25 },
  small: { squares: 1, plainBaseMm: 25 },
  medium: { squares: 1, plainBaseMm: 32 },
  large: { squares: 2, plainBaseMm: 50 },
  huge: { squares: 3, plainBaseMm: 75 },
  gargantuan: { squares: 4, plainBaseMm: 100 },
};

export type Units = 'mm' | 'in' | 'm';

export interface BaseMeasurement {
  shape: 'round' | 'other';
  /** Round bases: the diameter. Other shapes: the longer side of the footprint. */
  diameterMm: number;
  /** Width and depth of the resting footprint, scene x and z. */
  footprintMm: [number, number];
  /** Resting area as a share of the footprint, from the up detection. */
  coverage: number;
}

export interface Sizing {
  units: Units;
  unitsMethod: 'guessed' | 'manual';
  /** Factor applied to the file's coordinates to get mm: units × any requested scale. 1 when nothing changed. */
  scale: number;
  /** The base the file came with; null when none was found. */
  base: BaseMeasurement | null;
  /** The plain round base the converter added; null when none. */
  plainBase: { diameterMm: number; heightMm: number } | null;
  size: CreatureSize;
  sizeMethod: 'suggested' | 'manual';
  footprintSquares: 1 | 2 | 3 | 4;
  /** The base the table should draw or expect: measured, or the plain one, in mm. */
  baseDiameterMm: number;
  /** Why the suggestion was made from what it was made. */
  suggestedFrom: 'base' | 'figure';
  warnings: SizingWarning[];
}

export type SizingWarning =
  /** The base is larger than the chosen footprint; the page offers to scale it to fit. */
  | { kind: 'base-exceeds-footprint'; baseMm: number; footprintMm: number }
  /** The base does not fit even Gargantuan; the mini is probably in the wrong units. */
  | { kind: 'larger-than-gargantuan'; baseMm: number };
```

- `ConversionResult.sizing: Sizing` and `ConversionStats.sizing: Sizing` (stats is what the page and `npm run corpus` read).
- `sizeMm` stays; after this story it is the size in scene mm after any scale.
- The mesh's origin is the centre of the resting footprint (the base when found, the contact patch otherwise), not the centre of the bounding box as today. That is the "origin at the centre of its base" criterion and it changes `orientAndPlace`, see §3.
- GLB `extras` gains `meshtavern: { gridSquareMm: 32, size, footprintSquares, baseDiameterMm, units, scale }`. The existing `units` sentence and `sizeMm` stay. The table (Phase 2) reads this block; #50 exposes the same `Sizing` type from the library.

## 2. Options: how the user's choices reach the pipeline

The page never scales or rebuilds anything itself. Like `setUp(axis)` today, every choice converts the file again with fixed options; the cost is one conversion (10–30 s for a large mini on the development PC). A cheaper re-run that starts at the size step is a follow-up, not this story.

```ts
// PipelineOptions and ConvertOptions both gain:
sizing?: {
  units?: Units;               // overrides the guess
  size?: CreatureSize;         // overrides the suggestion
  scaleToBaseMm?: number;      // scale so the (measured or plain) base has this diameter
  plainBase?: boolean;         // add a plain round base when none is found; default false
};
```

Defaults, with no options: units guessed, size suggested, nothing scaled, no base added. The page's `?dev`-free controls set these; the test hook is `window.__mt.setSizing(partial)`, which merges into the last options and reconverts.

## 3. Modules and the new step

New pipeline step `size`, between `orient` and `simplify`, in `STEPS`. It must run before `simplify` because the level error budgets are in mm, and before `unwrap`/`bake` because a plain base must be in the table level.

- **`src/pipeline/units.ts`** — `guessUnits(sizeInSourceUnits): Units` and `UNIT_FACTORS = { mm: 1, in: 25.4, m: 1000 }`. Rule _(proposal)_: on the height after orientation, `h ≥ MIN_MM_HEIGHT (8)` → mm; `MIN_INCH_HEIGHT (0.3) ≤ h < 8` → inches; below → metres. A 250 mm terrain piece saved in inches (9.8) reads as mm; that is the known miss, shown and correctable.
- **`src/pipeline/base.ts`** — `measureBase(mesh, detection): BaseMeasurement | null` and `generatePlainBase(diameterMm, heightMm): IndexedMesh`.
  - Measure: the resting vertices are those within `RESTING_BAND` (orient.ts, 2 % of the height) of y = 0 after orientation. Base found when the up detection's `method` is `base` (coverage ≥ `MIN_BASE_COVERAGE`, 15 %). Footprint = x/z extents of the resting vertices. Round _(proposal)_ when the two extents agree within `ROUND_ASPECT (10 %)` and the resting vertices' convex hull covers ≥ `ROUND_FILL (85 %)` of the circle on the mean extent; then `diameterMm` is the mean extent. Otherwise `other`, `diameterMm` the longer side. Export the constants; move `RESTING_BAND` and `MIN_BASE_COVERAGE` to where both files can import them.
  - Generate: reuse the disc construction of `addRoundBase` in `src/regression/shapes.ts` (move it into `base.ts` and let shapes.ts import it, so the no-sin/cos rule holds and the regression figure keeps its bits). `PLAIN_BASE_HEIGHT_MM = 3`, cells so that a segment is about 1 mm. The figure moves up by the height; base triangles are appended to the mesh (a disconnected part is fine since #43).
- **`src/pipeline/size.ts`** — the types above, `suggestSize(footprintMm, from)`, `footprintMm(size)`, `sizingWarnings(...)`. Suggestion: the smallest `squares` with `squares × 32 × (1 + FOOTPRINT_TOLERANCE 0.05) ≥ footprintMm`; within one square, `< SMALL_BELOW_MM (26)` → small, else medium; tiny never suggested. Larger than 4 squares → gargantuan with `larger-than-gargantuan`. Without a base the suggestion uses the figure's own x/z extents (`suggestedFrom: 'figure'`) _(proposal)_.
- **`src/pipeline/orient.ts`** — `orientAndPlace` centres x/z on the resting footprint's centre when a base was found, on the bounding box otherwise. The regression baseline may move by a few triangles because the simplifier sees shifted coordinates; if it does, `npm run baseline:update` and say so in the PR. If a level's triangle count changes by more than 1 % or an error figure moves, stop: that is not a shift.
- **`src/pipeline/run.ts`** — the `size` step: guess or take units, apply the factor to positions, measure the base, suggest or take the size, apply `scaleToBaseMm` (factor = target / base diameter, or / figure footprint when no base), add the plain base when asked and no base was found, compute warnings, fill `sizing`. Peak-memory accounting like the other steps.
- **`src/viewer.ts`** — imports `GRID_SQUARE_MM`; `STRESS_SPACING_MM` becomes `footprintSquares × GRID_SQUARE_MM` per mini (the stress pool carries each mini's footprint; a pool of mixed sizes spaces by the largest).
- **`src/pipeline/glb.ts`** — the `extras.meshtavern` block; `GlbOptions` gains `sizing`.
- **`src/main.ts`, `index.html`** — a plain form beside the up selector: units select, size select showing "Medium (1×1)", a number field plus button "Scale so the base is … mm", a checkbox "Add a plain base", a warning line with a "Scale to fit" button. Figures rows: `Size` → `Medium (1×1), base 32.0 mm round (measured)` and `Units` → `mm (guessed)`. Hook `setSizing`. #41 restyles all of this; do not design here.

## 4. The corpus index

New committed file `scripts/corpus-index.json`, keyed like `results.json` (the path under `corpus/` without `.stl`, forward slashes):

```json
{
  "quadruped/quadruped-02": { "size": "medium" },
  "large-creature/large-02": { "size": "huge" }
}
```

`npm run corpus` reads it, compares `stats.sizing.size` with `size` for every mini that has an entry, and writes a "Size suggestions" section into `results.md`: matches, mismatches (with the suggested and expected size and the measured base), minis missing from the index. A mismatch is reported, not fatal: the PM reads the report. #72 adds an `up` field to the same entries later; leave unknown fields alone.

Filling the file is a judgement about each mini's intended size. The builder proposes an entry per corpus mini from the file name and the measured base and puts the list in the PR; the PM confirms or corrects before merge.

## 5. Attribution

The six size names come from the SRD 5.1 (CC-BY-4.0). Record it in the header of `size.ts` and add a "Third-party content" section to `README.md` with the licence and a link, as ADR-0005 in the private repo asks for every piece of openly licensed content. The footprint-in-squares rule and the plain-base diameters are ours.

## 6. Build order

Each step is a commit with its tests; `npm run check` green after each.

1. `size.ts`: constants, types, `suggestSize`, warnings. Tests: 24 → small, 26 → medium, 33 → medium (tolerance), 34 → large, 50 → large, 96 → huge, 135 → gargantuan + warning; tiny never suggested.
2. `units.ts`: guess and factors. Tests at the boundaries.
3. `base.ts` measure + `orientAndPlace` origin change. Tests on `generateFigure(true)` (25 mm round → `round`, 25 ± 0.5), `generateSwarm()` (50 mm), a generated square plinth (`other`), `generateFigure(false)` (null). Baseline check as in §3.
4. `run.ts` step `size`, `Sizing` in result and stats, options through `protocol.ts`/`handle.ts`/`client.ts`. Tests in `run.test.ts` and `handle.test.ts`.
5. `base.ts` generate + `plainBase` option. Test: figure without base + `plainBase: true` → mesh gains the disc, stands at y = 0, `plainBase.diameterMm` follows the size.
6. `scaleToBaseMm` and the warning path. Test: 25 mm base scaled to 32 → `sizeMm` × 1.28, `scale` 1.28; medium chosen for a 50 mm base → `base-exceeds-footprint`.
7. Viewer grid and stress spacing. `verify-3d` screenshot of the grid with the demo pyramid.
8. GLB extras. `glb.test.ts` reads them back; validator still passes.
9. Page controls, `setSizing`, figures rows. e2e in `smoke.spec.ts`: the demo (25 mm base) suggests small; `setSizing({ size: 'medium' })` shows "Medium (1×1)"; `setSizing({ scaleToBaseMm: 32 })` changes `sizeMm`. No network request carries file data (existing check).
10. `scripts/corpus-index.json` and the report in `corpus.mjs`. Run `npm run corpus` on the development PC; put the suggestion table and the proposed index in the PR.
11. Docs: `CLAUDE.md` (layout, conventions, hook list), spec story 4 status line, journal entry (numbers with the device), README attribution.

## 7. When to stop and ask

- The base measurement calls a sculpted or scenic base `other` or misses it on more than a few corpus minis: the heuristic needs a design change, not a threshold tweak.
- The baseline moves by more than the shift explained in §3.
- The units guess misfires on a corpus mini.
- A criterion needs a product answer the issue does not give (for example what to suggest for a mounted figure whose base is oval).

Ask on the PR, label the issue `needs-human` if the answer is the PM's, and continue with the steps that do not depend on it.

## 8. PM decisions on PR #74

2026-09-23, answers to the questions the build raised under §7:

1. **The origin shift may move the levels.** Moving the origin to the centre of the base changes the far level of three corpus minis by up to 2.5 % triangles at the same error; accepted as the shift's effect.
2. **Small below 18 mm, and an offer to scale up** (2026-09-24). The PM's humanoids on 20–24 mm bases are Medium creatures printed small. `SMALL_BELOW_MM` is 18 (was 26), and a Medium mini on a base under `MEDIUM_MIN_BASE_MM` (25) gets the warning `base-small-for-size` with a button "Scale up to a 25 mm base"; nothing is scaled without the click. 25 rather than 32 mm, because at 32 mm the small humanoids stand taller than any bought one.
3. **A mini without a base is suggested Medium** (`NO_BASE_SIZE`), not sized by its own width; `suggestedFrom` is `'default'` for it. To be revisited after other PRs (#72 among them).
4. **Generic corpus names.** The bought minis in the local corpus are renamed to `<kind>-NN` (a local, git-ignored `corpus/NAMES.md` maps the old names), so the committed index names none of them; the example keys in §4 follow.
5. **The proposed corpus index is confirmed.**

What these decisions changed in the shapes of §1 (the code in `src/pipeline/size.ts` is the reference): `suggestedFrom` is `'base' | 'default'`; `SizingWarning` gains `{ kind: 'base-small-for-size'; baseMm; targetMm }`; the base's centre is used inside `orientAndPlace` only and is not part of `BaseMeasurement` (review of PR #74, 2026-09-25).
