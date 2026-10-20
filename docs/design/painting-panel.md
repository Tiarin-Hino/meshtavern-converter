# Design: the painter's panel as a library entry, on MeshTavern's components (#166)

Status: design pass (Fable 5.1), 2026-10-20, for the build on Opus 5.5 · Epic #164 · Spec: the application's spec 10, story M4 and decision 9 (item C6); `docs/specs/look-and-feel.md` L1 and L4 · Rests on: `docs/design/painting-engine.md` (#126 to #128, §10: the view mounts the canvas and the cursor, the panel was the consumer's), `docs/design/look-and-feel.md` §4.9 and the mockup `docs/design/look-and-feel/app-painting.html` (`shots/app-painting-desktop-*.png`, the reference), `docs/design/questions-view.md` (#119, the pattern of a view entry with replaceable words), the notes of the tools that landed after the mockup: `lift-eraser.md` (#137), `paint-mask.md` (#138), `paint-groups.md` (#139, §9 and §16 for #180), the paint file (#165, `painting-engine.md` §17), and `src/page/paint-tool.ts`, the `?dev` Paint tool, which is today the only panel.

Everything below marked _(proposal)_ is the pass's call for the PM to confirm or change on the PR; what is marked PM is decided already.

## 1. What the pass delivers

- The name and the shape of the new entry, `meshtavern-converter/painting-panel`, and its stylesheet.
- How the panel drives the engine's view, and the three small additions to the view it needs.
- Every section of the panel: its markup on the components, its words, its behaviour, in one fixed order, with the tools of #137, #138 and #139 placed (they have all landed since the issue was written, so nothing is left "for when they land").
- The phone layout.
- The decision for the `?dev` Paint tool: it mounts the panel.
- How the page mounts it (#167 builds that) and how the application's dialog does (its T3).
- The quality bar extended to the panel, the build order with the test that proves each step, and where the build stops and asks.

## 2. The decision in one paragraph

The panel is a second library entry beside the engine, `meshtavern-converter/painting-panel`, that takes a `PaintingView` and an element, fills the element with sections built on `components.css`, and drives the view from them; it holds no state of its own but what is on screen, so everything it shows is `view.state` (the tool, the brush, the colour, the regions, the history, the mask, the groups, the look) plus the colours the consumer passes in. The view gains what a panel outside it needs and the `?dev` tool had to work around: a second listener (`subscribe`), the look in its state, and a one-shot colour pick on its own canvas. The panel's words are `PAINT_COPY`, extended with the sections' titles and the look's labels, replaced field by field as the question view's are. The `?dev` Paint tool mounts the panel in place of its hand-made controls and keeps a small team section for what the product panel does not show. The page's painter (#167) and the application's dialog (T3) mount the same panel into their own frame: a header and a footer are the consumer's, the sections are the panel's.

## 3. The entry

```ts
// src/lib/painting-panel.ts (package export "./painting-panel"; its stylesheet "./painting-panel.css").
export {
  mountPaintingPanel,
  type PaintingPanelOptions,
  type PaintingPanel,
  type PaintingPanelState,
  SLIDERS,
  DIRECTIONS,
  panelSwatches,
  sliderValue,
} from './painting-panel/mount';
```

- `src/lib/painting-panel/` holds `mount.ts` (the template, the wiring, the `show` that writes every state), `controls.ts` (the pure tables and functions: `SLIDERS`, `DIRECTIONS`, `panelSwatches`, `sliderValue`, Node-tested in `controls.test.ts`) and `icons.ts` (generated, §7). The entry imports the engine through `../painting` (the entry) and the data through `../index`, never `../painting/*`: the panel is a consumer of the view's public interface, which proves that interface is enough for the application to build on, and the ESLint rule gains `**/lib/painting-panel/*` for the page, the regression net and the e2e.
- `package.json` `exports` gains `"./painting-panel": "./src/lib/painting-panel.ts"` and `"./painting-panel.css": "./src/lib/painting-panel.css"`. `src/lib/index.test.ts` pins the entry's value exports (the list above without the types). `src/theme-files.test.ts` adds the stylesheet to `STYLESHEETS`, so the CSS budget (40 KB after gzip; 17.3 KB used today) and the no-`url()` rule cover it.
- No `footer` option, and nothing of the panel's goes into a footer. _(differs from the issue's bullet "a footer slot for the consumer's buttons, as `QuestionsOptions.footer`": the question view has that option because its own Confirm belongs beside the consumer's Cancel; the panel has no button that belongs beside Close and Save. The consumer's frame is its own, the footer with it, laid out as the mockup: `section.panel` > `.panel-body.flush` (the panel mounted here) + `.panel-footer` (the consumer's buttons).)_

## 4. Mounting and the interface

### 4.1 The options

```ts
export interface PaintingPanelOptions {
  /** The engine's view the panel drives: mounted by the consumer with `mountPainting`. */
  view: PaintingView;
  /** The panel's sections go here, nothing else: a `.panel-body.flush` or any element the consumer frames. */
  controls: HTMLElement;
  /** Words to replace, field by field (§6); the same object the consumer gave the view. */
  copy?: Partial<PaintCopy>;
  /**
   * The consumer's colours for the palette, as sRGB hex: the page's last PALETTE_MAX used on this
   * device (#167), the application's per account. Shown after the mini's own (§5.4). Left out: none.
   */
  palette?: readonly string[];
  /** The files' names, by the file index of a part's group (`describeGroup`); left out: "Part 2". */
  names?: readonly (string | undefined)[];
  /** What the pipette picks (#135): PICK_MODE, `'shown'`, unless the consumer says otherwise. */
  pickMode?: PickMode;
}

export function mountPaintingPanel(options: PaintingPanelOptions): PaintingPanel;
```

Mounting puts the class `mt-painting-panel` on `controls`, writes the template once (`innerHTML`, as the question view's `template(copy)`), wires every control to a method of the view, subscribes to the view (§4.3) and shows the view's state at once. Mounting twice into one element is an error (a `WeakSet` of elements, as the view's). The panel is shown while the view is open; with `state.open` false every control is disabled and the sections keep their place (the consumer hides the frame, as the page hides `#paint-view`). No ids in the template: every element the tests and the consumer reach is found by a `data-` attribute under the root (§5), so a page may hold a panel beside the `?dev` tool's.

### 4.2 The panel

```ts
export interface PaintingPanel {
  /** What the panel adds to the view's state; replaced, not changed, on every change. */
  readonly state: PaintingPanelState;
  /** The consumer's colours changed (a step committed, another mini): the swatches are built again. */
  setPalette(colours: readonly string[]): void;
  setNames(names: readonly (string | undefined)[]): void;
  setPickMode(mode: PickMode): void;
  /** Unsubscribes from the view, releases the listeners and empties `controls`. The view is untouched. */
  dispose(): void;
}

export interface PaintingPanelState {
  /** The swatches as shown, in order: the mini's colours, then the consumer's not among them. */
  swatches: string[];
  pickMode: PickMode;
}
```

Nothing else: every action goes to the view, and every change comes back through its state. A consumer that needs to know what the painter did (the page's device palette, the application's dirty flag) reads the view, not the panel.

### 4.3 Three additions to the view _(proposal; `painting-engine.md` §10.1 gets an "as built" line for each)_

1. **`subscribe(listener: (state: PaintingState) => void): () => void`** on `PaintingView`. The options' `onChange` stays the consumer's; subscribers are called after it, in the order they subscribed, on every `emit`; the function returned unsubscribes. The panel subscribes at mount; without this the consumer would have to forward every state to the panel by hand, and the two would drift the first time someone forgot.
2. **`PaintingState.look: Look`**: the look the open mini is drawn with (`MiniToPaint.look` at `open`, DEFAULT_LOOK without one; replaced by `setLook`, which emits as it does today). The panel's Look section reads it like every other section reads the state, and the consumer learns of a change the same way (the page updates its viewer and its Adjust section from it, #167; the application saves it with the mini).
3. **The pipette on the view:** `pickColour(mode?: PickMode): Promise<string | null>` and `cancelPick()`, with `PaintingState.picking: boolean`. `pickColour` waits for the next primary pointer-down on the canvas (the left button, a pen's tip, one finger), resolves with `colourAt(x, y, mode)` at that point (null off the mini, or bare in `painted` mode) and starts no stroke; while waiting the host carries the class `mt-painting-picking` (`painting.css`: `cursor: crosshair`) and the cursor ring is hidden. `cancelPick`, `close`, `dispose` and a second `pickColour` end a pending pick without a tap, resolving `undefined`, so a panel tells a cancel from the `null` of a tap that hit nothing _(as changed on the review of the build: the first build resolved both with null and the panel kept a flag to tell them apart)_. Picking is still not a tool (#135, PM decision): no `ToolId`, no step, `state.tool` untouched. This replaces the capture listener the `?dev` tool put on the host before the view's own (`paint-tool.ts`), which a consumer could only copy; the view owns its pointer, so the one-shot wait belongs to it.

Each is additive: a consumer that calls none of them sees the view as before, and `e2e/painting.spec.ts`'s pixel tests do not change bytes (the build checks the regression painting replays to the same colours).

## 5. The sections

The order, top to bottom _(proposal)_: **History**, **Tool**, **the tool's settings**, **Colour**, **Regions**, **Mask**, **Groups**, **Look**. Each is a `div.panel-section` with `data-section`, titled by `h3.panel-section-title` where the mockup has a title. The mockup's five sections (Tool, Brush, Colour, Regions, the history row) are built as drawn; the three it did not know (Mask and Groups landed after it, Look was in the spec but not in the picture) follow them. The history row moves from last to first: with eight sections the panel scrolls (the mockup's dialog body is 37 rem, the sections come to about 50), and Undo is what a painter reaches for most, so it is never under the fold, on a desktop or on the phone's sheet. _(differs from the mockup's order by that one row; the PM may put it back, it is one line of the template)_

Every control reads `view.state` on each change (`show`); the two lists that change shape (the swatches, the groups' rows) are rebuilt only when their key changes, as the `?dev` tool does today, so a stroke's `onChange` costs a few attribute writes. While `state.open` is false every control is `disabled`.

### 5.1 History (`data-section="history"`, no title)

`div.actions` with a `.btn-group` (role `group`, `aria-label` = `undo` and `redo` joined by the copy's `history`) of two `.btn.btn-sm.btn-icon`: Undo (`undo-2`, `aria-label` and `title` = `copy.undo`, `data-action="undo"`, disabled while `steps === 0`) and Redo (`redo-2`, `data-action="redo"`, disabled while `undone === 0`); then Turn the mini, `.btn.btn-sm` with `orbit` and the text `copy.navigate`, `aria-pressed` = `state.navigating`, `data-action="navigate"` → `setNavigating(!navigating)`. Under the row `p.hint` with `copy.hint` ("Paint with one finger or the left button; two fingers or the right button turn the mini."), which says what Turn the mini is for. _(proposal: the hint on every device; it is one muted line)_

### 5.2 Tool (`data-section="tool"`, title `copy.panel.tool`)

A `.toolbar-group` (role `group`, `aria-label` = the title) of eight `.tool` buttons, one per paint tool in this order: `flat`, `fill`, `eraser`, `lift`, `wash`, `ink`, `dry`, `airbrush`; each `data-tool="<id>"`, `aria-label` and `title` = `copy.tools[id]`, `aria-pressed` = `state.tool === id`, its icon (§7) inside, a click → `setTool(id)`. Under the group two lines: `p.tool-hint[data-hint]` with `copy.toolHints[state.tool]` (whichever section's group the tool is in), and `p.tool-hint[data-status][role="status"][aria-live="polite"]` for a notice: the lift's refusal (`copy.lift.nothingPainted` or `tooLongAgo`, shown while the tool is `lift` and `state.lift` is a refusal, as the `?dev` tool shows it in its perf line) and the pipette's `copy.pick.nothing` (shown until the next state change); empty otherwise. The mask's and the groups' tools are in their own sections (5.6, 5.7), but the pressed tool is one across the three groups, and this hint line is the one line for all of them.

The eight at 30 px each (`--control-height` − 6 px, plus the 2 px gap) are 16 rem: they fit the panel's 20 rem of content width on a desktop and, at the coarse pointer's 44 px, the phone's 343 px; the group wraps if a consumer gives it less (`flex-wrap: wrap`).

### 5.3 The tool's settings (`data-section="brush"`, title = `copy.tools[state.tool]`)

The sliders of the tool in use, from the table the `?dev` tool holds today, moved into `controls.ts` as `SLIDERS: Record<ToolId, { show: (keyof BrushSettings)[]; opacity: keyof PaintCopy['sliders'] }>` (the fill: opacity and tolerance; the wash: size and strength; the ink and the airbrush: size and flow, the airbrush with its direction; the dry brush: size and pressure; the group brush: size and hardness; the group fill: nothing, and the section is hidden). The title is the tool's name, so with the fill it reads "Fill" over Opacity and Tolerance rather than "Brush" _(proposal; the mockup shows "Brush" with the brush chosen, which this gives)_.

Each slider is a `label.field[data-slider="<key>"]` whose label is `<span>copy.sliders[key] <span class="muted" data-value>value</span></span>` and whose control is `input[type=range]` with the view's bounds: `sizeMm` from `BRUSH_MIN_MM` to `BRUSH_MAX_MM` step `SIZE_STEP_MM`; `hardness`, `opacity` and `tolerance` 0 to 1 step `UNIT_STEP`; `input` → `setBrush({ [key]: Number(value) })`. The opacity slider's label is the tool's word (`SLIDERS[tool].opacity`: Opacity, Strength, Flow, Pressure). The value in the label is `sliderValue(key, value, copy)`: the size as millimetres, whole or with one decimal ("4 mm", "0.5 mm"), the others as a whole percentage ("80 %", a thin space before the sign as the specs write it) _(proposal: percentages read like the hobby's pots and the application's other sliders; the mockup shows only the size's value, and the issue asks for every value in its label)_.

The airbrush's direction (`direction`) is a `.field[data-slider="direction"]` with a `.segmented` of three `.btn.btn-sm` (`data-direction="none" | "above" | "front"`, `aria-pressed`): `copy.directions.none`, `above`, `front`, from `DIRECTIONS: Record<'none' | 'above' | 'front', Vec3 | null>` (`null`, `[0, 1, 0]`, `[0, 0, 1]`: minis stand Y-up and face +z at the camera's first angle, as the `?dev` tool has it); a press → `setBrush({ direction })`, and the pressed one is the entry whose vector equals `state.brush.direction` (none when no entry does).

### 5.4 Colour (`data-section="colour"`, title `copy.panel.colour`)

One `.field` with a `.field-row`: the colour input (`input[type=color]`, `aria-label` = the title, `data-colour`, `value` = `state.colour`, `input` → `setColour`), the pipette (`.tool`, `pipette`, `aria-label` and `title` = `copy.pick.button`, `aria-pressed` = `state.picking`, `data-action="pick"`: a press while not picking → `view.pickColour(pickMode)` whose result, when not null, goes to `setColour`, else to the status line; a press while picking → `cancelPick`), then the swatches: `div.swatches` (role `group`, `aria-label` = `copy.panel.colours`) of `button.swatch` (`data-swatch="#rrggbb"`, `style="--swatch: #rrggbb"`, `aria-label` = `` `${copy.recent.swatch} ${hex}` ``, `aria-pressed` while `hex === state.colour.toLowerCase()`, a click → `setColour(hex)`).

The swatches are `panelSwatches(recentColours(view.history()), palette)`: the mini's colours newest first (at most `RECENT_COLOURS_MAX`, the eraser, the lift and the mask's steps left out, as #136 built), then the consumer's colours in the order given, each lower-case and once, the consumer's that are already among the mini's skipped. Rebuilt when `steps`, `undone` or the palette move. The panel stores nothing: the consumer's palette is the consumer's (#167 keeps the page's last `PALETTE_MAX` = 16 in `localStorage`, the application its own), and "the colours used on this mini" are read from the view's history whenever asked. The pipette's mode has no control in the panel _(proposal: `'shown'` is the PM's default on #135 and what a painter means by "take that colour"; `'painted'` is a tester's reading, kept in the `?dev` tool's team section, which calls `setPickMode`; if the PM wants it on the page it is a `.segmented` pair in this row)_.

### 5.5 Regions (`data-section="regions"`, title `copy.panel.regions`)

`div.actions` (role `group`, `aria-label` = the title) with The base and The figure as `.btn.btn-sm` (`data-region="base" | "figure"`, `copy.regions.base`, `.figure`), each disabled while `state.regions` lacks it, a click → `fillRegion(region)`; under them `p.hint` with `copy.panel.regionsHint` ("Fills the region with the colour in one tap."). The section stays with both buttons disabled for a mini without a base, as the mockup draws it; the hint explains what the buttons would do.

### 5.6 Mask (`data-section="mask"`, title `copy.mask.label`)

- A `.toolbar-group` (role `group`, `aria-label` = the title) of the four mask tools as `.tool` buttons like 5.2: `mask` (`shield`), `unmask` (`shield-off`), `mask-fill` (`shield-plus`), `unmask-fill` (`shield-minus`), `data-tool`, `aria-pressed`, → `setTool`.
- `div.actions`: Mask the base and Mask the figure (`.btn.btn-sm`, `data-action="mask-base" | "mask-figure"`, `copy.mask.base`, `.figure`, disabled by `state.regions` as 5.5) → `maskRegion`; Clear mask and Invert mask (`data-action="mask-clear" | "mask-invert"`) → `clearMask`, `invertMask`.
- Show mask as the components' `label.switch` with a checkbox (`data-action="mask-show"`, text `copy.mask.show`, checked = `state.maskShown`) → `setMaskShown`: view state, not a step, which a switch says better than a pressed button.

### 5.7 Groups (`data-section="groups"`, title `copy.groups.label`)

The `?dev` tool's row of boxes and selects becomes rows, so a group reads as one thing with its actions beside it:

- A `.toolbar-group` of the two group tools, `group` (`group`) and `group-fill` (`lasso-select`), as 5.6. Choosing a group tool switches the tint on and leaving one switches it off, as the `?dev` tool does (`setGroupTint(isGroupTool(tool))` when `isGroupTool` changes between the old tool and the new).
- `ul.rows` (role `group`, `aria-label` = the title), a `li.row[data-group="k"]` per group and one more for a new group: `button.row-main` (`data-target`, `aria-pressed` while `state.groups.target === k`, or `'new'` for the last row; the text is `describeGroup(made, k, names, copy.groups)` with `<small>` holding the triangle count as `toLocaleString()`, and `copy.groups.newGroup` for the last row) → `setGroupTarget(k | 'new')`; then, for every real group, Hide or Show as a `.tool` (`eye` while shown, `eye-off` while hidden; `aria-label` and `title` = `copy.groups.hide` or `.show`, `aria-pressed` while hidden, `data-shown`) → `setGroupShown(k, hidden)`; and, for every group but 0, Apart as a `.tool` (`move-3d`, `aria-label` = `` `${copy.groups.pullApart}: ${name}` ``, `aria-pressed` while `state.groups.apart` has it, `data-apart`) → `pullApart(k, pressed ? null : undefined)`, the box reflecting what `pullApart` returned (a group the rule leaves in place stays unpressed), as the `?dev` tool has it. The row of the hidden group takes `.row-hidden`; the target row `.row-selected`. The two tools are direct children of the row, not in `.row-actions`, which the components reveal on hover only; a toggle that is state must stay visible. Rebuilt when `list`, `hidden`, `apart` or `target` change (the key the `?dev` tool uses).
- `div.actions`: Show all (`data-action="groups-all"`) → `showAllGroups`; Pull apart (`data-action="groups-apart"`, `copy.groups.pullApart`) → `pullAllApart`; Put together (`data-action="groups-together"`, disabled while nothing is apart) → `putTogether`; Fill the group, Mask the group, Unmask the group (`data-action="group-fill" | "group-mask" | "group-unmask"`, disabled while the target is `'new'`) → `fillGroup(target)`, `maskGroup(target, true | false)`; Show groups as a `label.switch` (`data-action="groups-tint"`, `copy.groups.tint`, checked = `state.groupTint`) → `setGroupTint`.
- `p.hint` with `copy.groups.hint`, then `copy.groups.apartHint`.

### 5.8 Look (`data-section="look"`, title `copy.look.label`)

The page's Look section (`index.html`, `#look`), built once more on the same components so the two look the same until #167 decides whether the page's Adjust keeps its own:

- `.field` titled `copy.look.presets` ("Starting points") with `div.chips` (role `group`) of a `button.chip` per `LOOK_PRESETS` entry (`data-preset`, a `span.chip-dot` with `--chip-color` = the preset's base, the label), `aria-pressed` while `presetOf(state.look) === id` → `setLook(preset.look)`.
- `label.check` with a checkbox (`data-look="enabled"`, `copy.look.enabled`, "Primed and washed") → `setLook({ ...look, enabled })`.
- `.field` `copy.look.base` ("Base coat"): a `.field-row` with `input[type=color]` (`data-look="base"`) and `span.muted` with the hex; `input` → `setLook({ ...look, base })`.
- Three sliders as 5.3 (`label.field[data-look="occlusion" | "wash" | "edges"]`, `copy.look.occlusion` "Shadows", `.wash`, `.edges`, 0 to 1 step `UNIT_STEP`, the value as a percentage) → `setLook({ ...look, [key] })`.

The panel sends the whole look each time and reads `state.look` back (§4.3), so the viewer under the page and the material in the view never disagree.

## 6. Words

`PAINT_COPY` (`src/lib/painting/copy.ts`) gains four objects and one field; the existing ones are used as they are (`tools`, `toolHints`, `sliders`, `regions`, `pick`, `lift`, `mask`, `groups`, `recent`, `undo`, `redo`, `navigate`, `hint`), but for four the panel's shape retired, dropped on the review of the build: `groups.show` (the rows have one Hide toggle, pressed while hidden), `groups.into` (the pressed row is the target), `groups.apart` (the Apart toggle is named by `pullApart`) and `recent.label` (the swatches' group is `panel.colours`). `pick.hint` is the pipette button's tooltip. `PaintCopy` stays "a string, or an object of strings one level deep", so each new object is top-level. _(every string a proposal)_

```ts
panel: {
  tool: 'Tool',
  colour: 'Colour',
  colours: 'Colours',            // the swatches group
  regions: 'Regions',
  regionsHint: 'Fills the region with the colour in one tap.',
  history: 'History',            // the Undo/Redo group's name
  mm: 'mm',
  percent: '%',
},
directions: { none: 'Everywhere', above: 'Above', front: 'The front' },
look: {
  label: 'Look',
  presets: 'Starting points',
  enabled: 'Primed and washed',
  base: 'Base coat',
  occlusion: 'Shadows',
  wash: 'Wash',
  edges: 'Edges',
},
// and, in the existing object:
mask: { label: 'Mask', ... },
```

The panel's `copy` option is merged as the view's is (`{ ...PAINT_COPY, ...options.copy }`, nested objects replaced whole); `copy.test.ts` checks the new keys exist and that `sliderValue` writes the units it is given. The page's Look section keeps its HTML words for now (#167 may point `index.html` at `PAINT_COPY.look` through `COPY`, which already spreads `QUESTION_COPY`; not this issue).

## 7. The stylesheet and the icons

**`src/lib/painting-panel.css`**, every rule under `.mt-painting-panel`, every colour a role, imported once by the consumer after `tokens.css`, `components.css` and `painting.css` (the entry imports nothing, for the reason `questions.ts` gives). What it holds, from `mock.css`'s `.paint-panel` rules and the page's panel rules, nothing a component already says:

- `[hidden] { display: none !important }` under the root, as `questions.css`.
- `.toolbar-group { width: fit-content; flex-wrap: wrap }`.
- `.tool-hint { margin: var(--space-2) 0 0; font-size: var(--text-sm); color: var(--text-muted) }`; `.hint` the same with `--space-1`.
- `.actions { display: flex; flex-wrap: wrap; gap: var(--space-2) }` (the page's; the components have none).
- `.field { margin-bottom: var(--space-3) }`, the last `0`; `input[type=range] { width: 100%; margin: 0; accent-color: var(--accent) }`; `input[type=color]` at 2.75 rem by `--control-height` on `--surface-sunken` with the `--line` border and `--radius-control`, as the page's.
- `.swatches { display: flex; flex-wrap: wrap; gap: var(--space-1) }`; `.swatch` 1.5 rem round, `background: var(--swatch)`, border `--line-strong`, `[aria-pressed='true']` outlined 2 px in `--accent` at 2 px offset; on a coarse pointer the swatch grows to `--tap-min` through a `pointer: coarse` query, _(proposal: 44 px swatches at 1.75 rem pitch would be two rows of 7 on a 375 px phone; a 1.5 rem swatch is below the tap size, so the query makes them 2.25 rem (36 px) with the gap bringing the pitch to 44 px)_.
- `.rows .row` with its two `.tool`s: `.row-main` as a button (`font: inherit; text-align: left; background: none; border: 0; color: inherit`), `.row-hidden` and `.row-selected` are the components'.
- `.chips { display: flex; flex-wrap: wrap; gap: var(--space-1) }`.
- `.segmented` of the direction: `display: flex`, each `.btn` `flex: 1`.

About 1.5 KB after gzip, well inside the budget. `npm run check:colours` covers it as it covers `questions.css`.

**Icons**: a third generated module, `src/lib/painting-panel/icons.ts`, in `ICON_SETS` of `scripts/lib/icons.mjs`, written by `npm run icons` and checked by `src/icons.test.ts`: `undo-2`, `redo-2`, `orbit`, `paintbrush`, `paint-bucket`, `eraser`, `layers` (the lift: the layer beneath, _(proposal)_), `droplet`, `pencil`, `brush`, `spray-can`, `pipette`, `shield`, `shield-off`, `shield-plus`, `shield-minus` (the mask brush, the unmask brush, the mask fill, the unmask fill, _(proposal: a shield is what a mask does; plus and minus are the two fills)_), `group`, `lasso-select` (the group brush and the group fill, _(proposal)_), `eye`, `eye-off`, `move-3d`. All exist in `lucide-static` 1.55.0 (checked). The page's own list (`src/page/icons.ts`) is unchanged; `index.html` draws none of these itself.

## 8. The phone

The panel has no layout of its own on a phone: it is sections in whatever frame the consumer gives, and the frame is the page's bottom sheet (`look-and-feel.md` §4.8: the viewport above, the sheet below, the handle between `SHEET_PEEK_VH` and `SHEET_FULL_VH`). What the panel does for it: every control is `--tap-min` tall under a coarse pointer by the tokens alone; the toolbar groups wrap; the swatches grow (§7); nothing scrolls sideways. One finger paints and two orbit on the canvas above the sheet, the engine's rule (`painting-engine.md` §9), and Turn the mini is in the first row for a pen without a free finger. The sheet's first screen (44 vh, about 357 px at 812) shows the history row, the Tool group and its hint, and the top of the tool's settings; the handle expands it for the rest. #167 wires the sheet; this issue's phone proof is the `?dev` tool on the sheet (§12).

## 9. Constants _(proposal)_

| Name                 | Value                        | Where                                |
| -------------------- | ---------------------------- | ------------------------------------ |
| `SIZE_STEP_MM`       | 0.5                          | `painting-panel/controls.ts`         |
| `UNIT_STEP`          | 0.05 (the 0 to 1 sliders)    | `controls.ts`                        |
| `DIRECTIONS`         | none, above, front (as §5.3) | `controls.ts` (from `paint-tool.ts`) |
| `SLIDERS`            | the table of §5.3            | `controls.ts` (from `paint-tool.ts`) |
| `PALETTE_MAX`        | 16 (the page's, #167)        | `src/page/`, not the panel's         |
| `SWATCH_TAP_REM`     | 2.25 (a swatch on a phone)   | `painting-panel.css`                 |
| `RECENT_COLOURS_MAX` | 12, as #136                  | `brush.ts`, unchanged                |

## 10. The `?dev` Paint tool mounts the panel

The issue leaves the choice to this note: **the tool mounts the panel in place of its hand-made controls** (`index.html` `#paint-controls` becomes the panel's `controls`; the tool buttons, the sliders, the colour, the swatches, the pipette, the regions, the mask row, the groups row, Undo, Redo and Turn the mini go out of `index.html` and `paint-tool.ts`), and keeps a **team section** under it, `#paint-team`, for what the product panel does not show: Open (`#paint-open`, "Paint this mini", as today), the pick mode select (`#paint-pick-mode` → `panel.setPickMode`), Save (`#paint-save`, the PNG download of the paint, as today) and Close (`#paint-close`), and the perf line (`#paint-perf`, the frame counter, errors). Reasons: the panel is then exercised by every pixel test and by the PM's brush sessions, so a slip in the panel's wiring is seen before #167; and two panels of the same controls would be two places to change. `createPaintTool` keeps its hooks (`open`, `close`, `view`, `table`, `regions`, `sample`, …) and gains `panel()`, so `window.__mt.painting.panel()` reaches the panel in tests.

The team section keeps `data-dev` and the page's classes (`.btn.btn-sm`, `.input`); it is not restyled (spec L2). `?dev` is still what reaches the painter until #167.

What changes in the tests that drive the old ids (the build rewrites them, no behaviour change): `e2e/painting.spec.ts` reads `#paint-colour`, `#paint-recent`, `#paint-hint`, `#paint-pick`, `#paint-tools`, `#paint-groups`, `#paint-groups-all`, `#paint-groups-tint`, `#paint-groups-apart`, `#paint-groups-together`, `#paint-group-target`, `#paint-group-fill`, `#paint-group-mask` in the pipette, recent-colours, groups and pull-apart tests; they become the panel's `data-` selectors of §5 under `#paint-controls` (`[data-colour]`, `.swatches`, `[data-hint]`, `[data-action="pick"]`, `[data-tool="group"]`, `[data-group="2"] [data-shown]`, …). `#paint-pick-mode` stays. `e2e/accessibility.spec.ts` reads `#paint-open`, `#paint-controls`, `#paint-perf`: unchanged. `scripts/measure-painting.mjs` reads `#paint-view` only: unchanged.

## 11. How the consumers mount it

### 11.1 The page (#167, for its build; nothing of this is built here)

```ts
import { mountPainting } from 'meshtavern-converter/painting';
import { mountPaintingPanel } from 'meshtavern-converter/painting-panel';
import 'meshtavern-converter/painting.css';
import 'meshtavern-converter/painting-panel.css';

const view = mountPainting({ scene: paintView, onChange: showPainting });
const panel = mountPaintingPanel({ view, controls: paintPanel, palette: devicePalette(), names });
```

_(proposal for #167, as the spec M4 reads)_: a sixth page state, `painting` (`body[data-state="painting"]`, `pageStateOf` with `painting` in the app state), entered by **Paint** beside Adjust in the done panel (disabled with `PAINT_COPY.cannotPaint` as its hint when `baked` is null) and left by the header's Close (back to `done`, the paint kept in the view until the next conversion). In it `#paint-view` shows over the viewport as the `?dev` tool shows it, the panel's header keeps the file name, `#panel-body` shows `#paint-panel` (`data-in="painting"`, the panel's `controls`) and nothing else, and `#panel-footer` holds the page's own **Open paint file** and **Save paint file** (`data-in="painting"`; `writePaintFile`, `readPaintFile`, `matchSources` of #165), the sheet on a phone as every state. The page's device palette: `localStorage` `mt-palette`, the last `PALETTE_MAX` colours a committed step used (read from `recentColours(view.history(), 1)` when `steps` grows), given back to the panel with `setPalette`. The look: `state.look` of the view and the page's `state.look` are one (the page's `setLook` calls `view.setLook`, and `showPainting` writes `state.look` back to the viewer and Adjust's Look). The `?dev` tool's `#paint-team` then sits under the page's own Paint as a `data-dev` section.

### 11.2 The application's dialog (its T3, in the private repo)

The mockup's structure as it stands: `div.dialog.dialog-wide` > `h2` + `.view-grid` > `.mt-painting` (the view's `scene`, 37 rem tall) + `section.panel.paint-panel` > `.panel-body.flush` (the panel's `controls`) + `.panel-footer` (the application's Close and Save). The application links its own `tokens.css` and `components.css`, imports `painting.css` and `painting-panel.css`, passes its `copy` to both mounts and its account palette to the panel, and reads `view.state` for Save's dirty flag and the look to store. The same panel, so the two look the same: the reference picture of §12 is what the application's own screenshot is compared with by eye (spec L1's last criterion).

## 12. The quality bar, extended to the panel (#146, spec L4)

- **Accessibility**: `e2e/accessibility.spec.ts` already scans the `?dev` Paint tool open, in both themes; with the panel mounted there the scan covers the panel. The build adds the groups' rows and a group pulled apart to what is on screen before the scan (`?dev&ask=off&bake=256` to keep the bake short in software rendering; the test's 180 s wait stays). Serious and critical fail.
- **Keyboard**: a new test in `e2e/keyboard.spec.ts`, "the painting panel": the sweep reaches every control of the panel with the focus ring (the tools, the sliders, the colour input, the pipette, the swatches, the regions, the mask's and the groups' controls, the look's chips and sliders), and by keys alone: Space on a tool button sets `state.tool`, ArrowRight on the size slider moves `state.brush.sizeMm` by `SIZE_STEP_MM`, Space on a swatch sets `state.colour`, Space on a preset chip sets `state.look`, Space on a group's Hide hides it.
- **Reference screenshots**: `e2e/reference-screens.spec.ts` gains, per frame (desktop, phone 375, phone 390) and both themes, `${frame}-painting-${theme}.png`: the page with the `?dev` Paint tool open on the generated figure (`?dev&ask=off&bake=256`), the canvases hidden by `reference-screens.css` and held by `freezeFrames`, `#dev-paint` opened and scrolled to the top of `#panel-body`, on a phone the sheet expanded; `#paint-perf` masked. One set per platform as the others; the first CI run writes the Linux set (`docs/guides/reference-screenshots.md`). These pictures, beside `shots/app-painting-desktop-*.png`, are the human look in the PR.
- **The frame rate**: `scripts/measure-painting.mjs` on the development PC before and after the panel is mounted in the tool it measures through; the panel does nothing per frame (`onChange` fires at a stroke's end), so the numbers should be within noise, and the PR says what they were.
- **The budget**: `src/theme-files.test.ts` with the new stylesheet in its list.

## 13. Build order, with the test that proves each step

1. **The view's additions** (§4.3) in `src/lib/painting/mount.ts`: `subscribe`, `state.look`, `pickColour`, `cancelPick`, `state.picking`, the host class and `painting.css`'s cursor rule. Proof: `e2e/painting.spec.ts` gains "a subscriber hears every change after onChange", "the state carries the look it is drawn with", "pickColour takes the next tap's colour and paints nothing" (replacing the pipette test's capture-listener path once step 5 lands); the regression painting (`src/regression/painting.mtpaint`) replays to the same colours.
2. **The words** (§6) in `copy.ts`; `copy.test.ts`.
3. **The icons** (§7): the third set in `scripts/lib/icons.mjs`, `npm run icons`, `src/icons.test.ts` passes with the new module.
4. **`controls.ts`** with `SLIDERS`, `DIRECTIONS`, `panelSwatches`, `sliderValue`, `SIZE_STEP_MM`, `UNIT_STEP`; `controls.test.ts`: the swatches' order and deduplication (a consumer colour already on the mini appears once, in the mini's place; upper-case input lower-cased), the value strings, the table's shape (every `ToolId` has an entry).
5. **`mount.ts`, the entry, the stylesheet**, `package.json` `exports`, the ESLint rule, `index.test.ts`, `theme-files.test.ts`. Proof: the `?dev` tool on the panel (step 6) is what runs it; `npm run check` for the rest.
6. **The `?dev` tool on the panel** (§10): `index.html`, `paint-tool.ts`, `main.ts`'s hook `panel()`, the e2e selectors rewritten (§10). Proof: `e2e/painting.spec.ts` and `accessibility.spec.ts` pass unchanged in meaning.
7. **The quality bar** (§12): the keyboard test, the reference pictures, the accessibility scan with the rows; `npm run docker:e2e`.
8. **Measurements**: `scripts/measure-painting.mjs` before and after on the development PC; the CSS budget's number.
9. **Docs**: README "Use it as a library" gains the panel mounted (the snippet of §11.1 with the application's framing), CLAUDE.md's layout line for `src/lib/painting-panel/` and the sixth entry, "as built" lines in `painting-engine.md` §10.1 and `look-and-feel.md` §4.9 (which said the `?dev` tool keeps its markup: it does not any more), and the journal entry.

Commits: one per step or two, Conventional Commits, the e2e rewrite with step 6.

## 14. Where the build must stop and ask

- **A view addition that changes bytes**: if step 1 moves any colour of the regression painting or any pixel test, stop; the additions are meant to be inert.
- **A control none of the components covers** (a shape §5 does not give): build it from `.btn`, `.tool`, `.field`, `.switch`, `.rows` as §5 does for its neighbours and show the PM a screenshot on the PR; never a literal colour, never a role that is not in `tokens.css` (a missing role goes to the application's file first, `look-and-feel.md` §12).
- **An icon that reads wrong on screen** (the lift's `layers`, the mask's shields, the group fill's lasso are proposals): keep the name, screenshot it for the PM, do not pick another in the build.
- **The CSS budget** (`theme-files.test.ts`) or the e2e's time budget on CI: if the panel's picture needs more than the 240 s the reference test has, split it into a test of its own rather than raising the limit.
- **An existing test that cannot stay true** without changing the engine's behaviour (a pixel test's bytes, a step's shape, a problem's message): stop and ask.
- The application's dialog (§11.2) and the page's Paint state (§11.1) are not built here; a build that finds §11.1 needs something the panel does not offer notes it on the PR for #167, and does not add it unless the panel cannot be mounted without it.

## 15. Out of this note

- The page's Paint beside Adjust, the paint file's Save and Open, the device palette's storage, the unsaved painting kept on the device, the promise test with a painting: #167.
- Keyboard shortcuts for Undo and Redo (Ctrl+Z, Ctrl+Shift+Z): a painter expects them; the page has no shortcuts yet and the application has its own map, so they are a follow-up of the panel once both consumers say where the keyboard focus lives while painting.
- A collapsible section (the look, the groups) to shorten the panel: the components have no disclosure; the page's own `.disclosure` is the page's; if the PM wants the panel shorter, the application's repo decides on a disclosure component first.
- Hobby-pot names for the colours, a colour's name in the swatch's label beyond its hex, and a colour history across minis in the application: the consumer's.
- The pick mode as a product control (§5.4).

## 16. Files

| File                                                                           | Change                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/lib/painting-panel.ts`                                                    | new: the entry (§3)                                                              |
| `src/lib/painting-panel.css`                                                   | new: the stylesheet (§7)                                                         |
| `src/lib/painting-panel/mount.ts`                                              | new: `mountPaintingPanel`, the template, `show`, the wiring (§4, §5)             |
| `src/lib/painting-panel/controls.ts`, `.test.ts`                               | new: `SLIDERS`, `DIRECTIONS`, `panelSwatches`, `sliderValue`, the constants (§9) |
| `src/lib/painting-panel/icons.ts`                                              | new, generated (§7)                                                              |
| `src/lib/painting/mount.ts`, `painting.css`                                    | `subscribe`, `state.look`, `pickColour`, `cancelPick`, `state.picking` (§4.3)    |
| `src/lib/painting/copy.ts`, `copy.test.ts`                                     | the new words (§6)                                                               |
| `scripts/lib/icons.mjs`, `src/icons.test.ts`                                   | the third icon set                                                               |
| `package.json`, `eslint.config.js`                                             | the entry and its stylesheet; the deep-import rule                               |
| `src/lib/index.test.ts`, `src/theme-files.test.ts`                             | the entry's exports; the stylesheet in the budget                                |
| `index.html`, `src/page/paint-tool.ts`, `main.ts`                              | the `?dev` tool on the panel, the team section, the `panel()` hook (§10)         |
| `e2e/painting.spec.ts`                                                         | the selectors of §10; the tests of step 1                                        |
| `e2e/keyboard.spec.ts`, `reference-screens.spec.ts`, `accessibility.spec.ts`   | the panel (§12)                                                                  |
| `README.md`, `CLAUDE.md`, `docs/design/painting-engine.md`, `look-and-feel.md` | the sixth entry; "as built" lines                                                |
| `docs/journal/2026-10-<dd>-painting-panel.md`                                  | the journal entry, written by the build                                          |
