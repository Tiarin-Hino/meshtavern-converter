# Design: the painter on the page (#167)

Status: design pass (Fable 5.1), 2026-10-21, for the build on Opus 5.5 · Epic #164 · Spec: the application's spec 10, stories M4 and M5, decisions 7, 8, 10 and 13 (item C7); `docs/specs/look-and-feel.md` L1 to L4 · Rests on: `docs/design/painting-panel.md` (#166, §11.1 proposed how the page mounts the panel; this note is that design, and where the two differ this one stands), `docs/design/painting-engine.md` (§10 the view, §17 the paint file), `docs/design/look-and-feel.md` (§4.4 the done panel with its item 5, §4.8 the phone, §4.9 the painting panel), `docs/design/product-page.md` (the states, `render()`, the promise test), the mockups `docs/design/look-and-feel/page-done.html` (the Paint section) and `app-painting.html` (the panel in a frame with a footer), and `src/page/paint-tool.ts`, the `?dev` Paint tool, which already opens the view on the converted mini and mounts the panel.

Everything below marked _(proposal)_ is the pass's call for the PM to confirm or change on the PR; what is marked PM is decided already.

## 1. What the pass delivers

- The page's sixth state, `painting`: how it is entered and left, what the panel shows in it, and that the painting view stays open behind the done panel so Paint again continues the same session with its undo.
- The Paint section of the done panel and the painter's frame: the header, the status line, the panel of #166, the footer with Open paint file, Save paint file and Done; the sheet on a phone.
- The look as one value for the viewer, Adjust and the painter.
- How the paint reaches the downloads: the table level's GLB with the painted look as its colour texture, the far level's with the paint per vertex, and the shape of that in `glb.ts`.
- Save and Open of the paint file on the page, a drop of STL files with a paint file, a paint file dropped alone, the refusals and the older-engine line.
- What stays on the device: the unsaved painting in IndexedDB and the offer to continue it, the palette in `localStorage`, every read and write guarded, and the lines that say so.
- The words, the constants, the quality bar extended to the state, the measurements, the build order with the test that proves each step, and where the build stops and asks.

## 2. The decision in one paragraph

Paint is a section of the done panel; pressing it puts the page into the state `painting`, in which the painting view of the library covers the viewport and the panel holds the painter's panel of #166 between the page's header and a footer of its own (Open paint file, Save paint file, Done). The view is opened once per conversion and kept open, hidden, after Done, so that Paint again is instant and undo reaches back through the whole session; a new conversion closes it. After Done the viewer draws the paint under the look (the table level through the material's `map`, the far and close levels per vertex), and the two downloads carry it: the table level as the unwrapped mesh with a PNG of the painted look per texel as the material's colour texture, the far level with the paint in `COLOR_0`; an unpainted mini exports as today, byte for byte. Save paint file writes #165's file; Open paint file and a drop with a paint file convert without a question and replay. An unsaved painting is written to IndexedDB after every step as the paint file's contents (no pixels) with the files' names, and offered back in a dialog on the next drop of the same files; the last sixteen colours live in `localStorage` and feed the panel's palette. The page says so in its status line when the painter opens and in the Credits. Nothing is sent, and the promise test now paints, saves and downloads before it checks.

## 3. The state `painting`

### 3.1 The app state and `pageStateOf`

`PageState` gains `'painting'`. `AppState` gains:

```ts
/** The painter is on screen: Paint was pressed and Done not yet (#167). Never true while busy. */
painter: boolean;
/** What the page knows of the paint file on this mini (#167); see §7. */
paintFile: {
  /** A paint file dropped alone, waiting for its STL files: its sources; null when none waits. */
  pending: SourceFingerprint[] | null;
  /** The painting on screen replays steps of an older engine (PAINT_COPY.olderEngine). */
  olderEngine: boolean;
  /** The name the last Save paint file wrote, for the status line; null before one. */
  savedAs: string | null;
};
/** The painter's figures of this mini (#167): the time from Paint to the view's first frame. */
painterMs: number | null;
```

`pageStateOf(app)` takes `painter?: boolean` and decides in this order: a question → `asking`; busy → `converting`; an error → `error`; `painter` → `painting`; stats or an import → `done`; else `empty`. `painter` is set only while `stats` is set, so the order never shows the painter on an empty page. `state.painting` (the view's state, already mirrored) stays as it is. `page-state.test.ts` pins the order.

### 3.2 Entering and leaving

- **Paint** (`#paint-open`, the section's button, §4) → `openPainter()`: opens the view on the mini if it is not open on it yet (`paintTool.open()` as today: the regions, the groups, the texture), then `state.painter = true`, `render()`. The view is already open after a Done: nothing is opened again, the session goes on where it was. `painterMs` is measured from the press to the view's first frame after `open` resolves (`view.state.open` and one `requestAnimationFrame`), and written into `state` and, under `?dev`, into `#paint-perf`.
- **Done** (`#paint-done`, the footer) → `closePainter()`: `state.painter = false`, the paint is taken into the viewer (§6), `render()`. The view stays open and is hidden with `#paint-view` (`data-in="painting"`): its frame loop is stopped with the view addition of §3.4, so a hidden painter costs no frames.
- **The header's Close** is not shown in `painting` (`#close` keeps `data-in="done"`): Done is the one way back, and Close then goes to the drop card as today. `closeMini` closes the view as it does now.
- **A conversion** (a new drop, Adjust's reconversions, `loadDemo`, `loadGenerated`, a GLB opened) closes the view at its start (`paintTool.close()` in `convert`), because the steps belong to the surface that was converted; with steps in the view and not saved since (§7.3), Adjust's reconversion first asks with the confirm dialog of §8.3 (`COPY.paintingLost`). A new drop does not ask: the unsaved record (§8) keeps the painting, and the offer brings it back.
- Cancel is not in the painting footer: nothing runs.
- `loadGlb` (`?dev`) never paints: `state.imported` leaves `miniForPainting` null as today.

### 3.3 What the panel shows in `painting`

The panel frame (`#panel.panel`, `render()` gives it `.panel` in `painting` as in `done` and `asking`), top to bottom:

1. `#sheet-handle` (`data-in="done asking painting"`).
2. `.panel-header`: `#heading` with the file name as in `done`; no Close.
3. `#panel-body`: `#summary` gains `painting` in `data-in` and holds `#status` only (`#mini-size` keeps `done`): the painter's one line (§9.2); then `#paint-panel` (`data-in="painting"`, the panel's `controls`, mounted once by `mountPaintingPanel`; today's `#paint-controls` renamed and moved out of the `?dev` details); then, under `?dev` only, `#paint-team` (`data-in="painting" data-dev`): the pipette's mode, Save as PNG and `#paint-perf`, as #166 left them, without Open and Close (the product's Paint and Done replace them).
4. `#panel-footer` (`data-in="converting asking painting"`): in `painting` the page's own three buttons, `data-in="painting"` each: **Open paint file** (`#paint-file-open`, `.btn btn-ghost btn-icon`, `folder-open`, named by `aria-label` and `title`; it opens `#paint-file-input`, `<input type="file" accept=".mtpaint">`), **Save paint file** (`#paint-file-save`, `.btn`, `save` icon with the text) and **Done** (`#paint-done`, `.btn btn-primary`, `check` with the text). _(proposal: Open as an icon button, because three worded buttons do not fit the panel's 20 rem of content width, and Open is the rarer action; the PM may want "Open" worded and Save iconed instead, a swap of two classes)_ Cancel keeps `data-in="converting asking"`.

The `?dev` details `#dev-paint` goes; `#stats`, the thumbnail and the stress buttons keep `done`. `#levels` stays `done`: the level chips are not shown while painting (the painter is on the table level).

### 3.4 One addition to the view _(proposal; `painting-engine.md` §10.1 gets an "as built" line)_

`PaintingView.setShown(shown: boolean)`: while not shown the scene's frame loop is stopped (`PaintScene.stop()`, as `clear` does, without clearing) and pointer input is ignored; `paint()`, `mask()`, `groups()`, `history()`, `engines()`, `surface()`, `setLook` and `open` work as before; `setShown(true)` starts the loop again and draws. Not a step, not in the state. The page calls it at Done and at Paint. It is additive: a consumer that never calls it sees the view as today. If a read-back (`paint`, `surface`) turns out to need the loop, the build stops (§15).

### 3.5 The phone

`body[data-state='painting'] #stage` joins the two-row rule of `done` and `asking` (`style.css` §4.8): the viewport above, the sheet below. The sheet's first screen at 44 vh holds the handle, the header, the status line, the panel's history row and the tools; the footer is the sheet's last row and stays in view (the body scrolls between them). One finger paints and two orbit on the canvas above the sheet, the engine's rule; Turn the mini is in the panel's first row. The footer's three buttons fit 343 px with Open as an icon button; if they do not on the 375 px phone of the reference pictures, Save becomes an icon button there too (`.bar-narrow`-style rule in `style.css`, not a change of the markup).

### 3.6 The `?dev` Paint tool is the page's painter

`src/page/paint-tool.ts` becomes `src/page/painter.ts` _(proposal, a rename so the file says what it is)_: the same `createPaintTool` with its hooks (`open`, `close`, `view`, `panel`, `table`, `regions`, `sample`), driving the product's elements. `window.__mt.painting` keeps every hook: `open(paint?, mask?, groups?, replay?)` opens the view and enters `painting`; `close()` closes the view and leaves `painting` (the tests reset with it). New hooks on `window.__mt`: `openPainter()` (Paint), `closePainter()` (Done), `savePaintFile(): Promise<Uint8Array>` (the bytes Save writes), `openPaintFile(bytes: ArrayBuffer): Promise<void>` (what the Open button and a drop of a paint file alone do), `paint(): Promise<Albedo | null>` (the paint on the mini after Done, null when none), `storage` (§8.5).

## 4. Paint beside Adjust

A `.panel-section` after `#adjust` (`#paint-section`, `data-in="done" data-mini`): `h2.panel-section-title` with `COPY.paint` ("Paint"), then **Paint this mini** (`#paint-open`, `.btn wide` with `paintbrush`, `COPY.paintMini`), as the `page-done` mockup draws it and `look-and-feel.md` §4.4 item 5 lists it. A mini without a detail texture (`baked` null: `stats.bakeSkipped`) shows the button disabled and under it `p.hint` with `PAINT_COPY.cannotPaint` (`#paint-cannot`, hidden otherwise). An opened GLB (`?dev`) hides the section (`data-mini`). The button's `paintbrush` joins `src/page/icons.ts` with `folder-open`, `save` and `check` (`npm run icons`); `check` is already in the questions' set, the page's list gets its own entry.

**Changed (2026-10-25, PM decision in the session on the pre-release ideas):** under Paint this mini the section also has **Save paint file** (`#paint-file-save-done`, `.btn btn-ghost` with `save`, `COPY.savePaintFile`) and under it `p.hint` `#paint-file-keeps` with `COPY.paintFileKeeps` ("The paint file keeps how this mini was put together, painted or not. Drop it with the STL files next time and nothing is asked again."). Before the first stroke the file holds the conversion's choices and the look alone (§7.1), so a mini put together with every question answered once converts the same way next time without entering the painter.

## 5. The look is one value

`state.look` is the page's; the view's `state.look` mirrors it:

- The page's `setLook` (Adjust, the presets, the hooks) calls `view.setLook(look)` when the view is open, as it re-colours the viewer today.
- The panel's Look section calls `view.setLook`; the page hears it through `view.subscribe` and, when `state.look` differs from the view's, writes it into `state.look`, the viewer and Adjust's controls (`showLook`), without calling `view.setLook` again.
- `open` takes `look: state.look`; a paint file's `look` is written into `state.look` before the conversion it opens with (§7.2).

## 6. The paint on the mini after Done

At Done the page takes the paint once, `await view.paint()` (the 1,024² RGBA bytes, `Albedo`), and keeps it as the mini's `paint` until the next Paint changes it or a conversion drops it; `window.__mt.paint()` gives it. What it feeds:

- **The viewer.** `Viewer.setPaint(paint: Albedo | null)` makes a `DataTexture` of it (`flipY` false, `SRGBColorSpace`, as `createBakedMaterial`'s `map` wants) and a new baked material with `map`; the per-vertex levels (the close and far levels, and the table level without its texture under `showBaked(false)`) take `paintAtVertices(level, baked.mesh, paint)` once each, cached per level, and `vertexColours(level, look, perVertex)` wherever the viewer colours a level today (three call sites). `setLook` re-colours with the same paint. Null drops both.
- **The thumbnail** (`?dev`, #99): `renderThumbnail` takes `albedo: paint`; the dev figure shows the painted mini.
- **The downloads** (§6.1).
- **The stress scene** does not take the paint (its pool is the team's).

### 6.1 The downloads carry the paint

The spec (M4, "The downloads carry the paint", a proposal that stands on merge): the table GLB with the paint as its colour texture at 1K, the far GLB with the paint as per-vertex colour, the look in `extras.meshtavern.look` as today and the paint's presence beside it. How, decided here _(proposal)_:

- **`GlbOptions` gains two fields.** `paint?: Uint8Array | null` (RGBA bytes per vertex, as `paintAtVertices` gives them): `COLOR_0` becomes `vertexColours(mesh, look, paint)`, the look over the paint, which `look.ts` already computes; `texture?: { mimeType: 'image/png'; bytes: Uint8Array } | null`: the file gains `images[0]` (a `bufferView` of the bytes in the binary chunk, aligned to four bytes like every chunk), `samplers[0]` (linear filters, clamp to edge), `textures[0]` and the material's `pbrMetallicRoughness.baseColorTexture: { index: 0, texCoord: 0 }`; it requires `mesh.uvs` (a `RangeError` without). With a texture `COLOR_0` is left out: glTF multiplies the vertex colour into the texture's colour, and the look is in the texture already (`_SHADING` stays, so an application can re-tint). The accessor table of `primitive()` becomes a small builder that numbers what is present. `extras.meshtavern.paint` is `'texture'` when the file holds the texture, `'vertex'` when `COLOR_0` carries a paint, left out otherwise. Both variants, plain and compact. Without `paint` and `texture` the bytes are today's: the regression baseline does not move (`baseline.test.ts` covers unpainted minis only).
- **The texture is the painted look per texel, not the paint alone.** A viewer multiplies `COLOR_0` into the texture; the look is not a multiplication (the edges add light, `pointColour`), so the paint cannot sit in the texture with the look in the vertex colours. Instead `paintedTexture(surface, look, albedo): Albedo` (new, pure, in `src/lib/pipeline/paint.ts`, exported from `index.ts`) computes `pointColour(base, look, occlusion[t], cavity[t], paint)` for every texel the view owns (`PaintSurface.owned`, the islands and their dilated gutter, so filtering at an island's edge meets the same colour), with the paint's colour where its alpha is above 0 and null where bare, and the base coat (the look's `base`, or the coat alone with `look.enabled` false) elsewhere; alpha 255 everywhere. `PaintSurface` is what `view.surface()` gives: the cavity and occlusion as the composite reads them, so the texture's shading is the baked one the person saw, not the vertex one. Unit-tested in Node on a hand-made surface: a bare texel is the coat, a painted one is `pointColour` with that paint, an unowned one the coat, the look disabled gives the coat and the paint only.
- **The page encodes the PNG** with a canvas (`putImageData` of the texture's bytes, `toBlob('image/png')`; the 2D canvas is sRGB and converts nothing, and the texture is opaque so premultiplication loses nothing), as the `?dev` Save as PNG does today; the pipeline stays free of an encoder and of the DOM. `glb.test.ts` makes its own 2 × 2 PNG with `node:zlib` to run the Khronos validator on a file with a texture, plain and compact.
- **`exportGlb` with a paint.** The table level: `baked.mesh` (the unwrapped mesh with its texture coordinates, the `unwrapped` path) with `texture: paintedTexture(...)` encoded; the far level: `levels[3]` with `paint: paintAtVertices(levels[3], baked.mesh, paint)`. Without a paint both levels export as today (the table level as `levels[TABLE_LEVEL]`, no texture coordinates), so an unpainted download is byte for byte the old one. The surface is read from the view at the download (`view.surface()`; the view is open after Done, §3.2) and cached per paint. The compact variant with a texture is the `?dev` checkbox's as before.
- **The `_SHADING` and `TEXCOORD_0` rules of #109 stand** for the table level; the KTX2 detail texture is still not in the file.

## 7. The paint file on the page

### 7.1 Save paint file

`#paint-file-save` → `savePaintFile()`: `writePaintFile({ sources, choices, look, steps, engines })` with the sources' fingerprints (§7.4), `choices` as `PaintChoices` from the page's `choices` (`UpChoices` and the sizing: what `result.choices` and `choices.sizing` hold, the preset by its id), `state.look`, `view.history()` and `view.engines()`; the bytes go to a download named `${downloadName()}${PAINT_FILE_EXTENSION}` with `PAINT_FILE_TYPE`, as the GLB downloads are made. Then `state.paintFile.savedAs` is the name, the status line says `COPY.paintSaved(name)` (§9.2), and the unsaved record is deleted (§8.2). Disabled while the view holds no steps (`state.painting.steps === 0`): there is nothing to save. The hook `window.__mt.savePaintFile()` resolves with the bytes.

**Changed (2026-10-25):** Save is never disabled. A paint file with no steps is a valid file (`paintFileOf` with `steps: []`), and it is worth saving: it keeps the choices of a conversion whose questions took a while (a figure in parts with its base). `paintFileNow` reads `view.history()` and `view.engines()` only while the painter is open on this mini, else `steps: []` and this engine; `savePaintFile` is called from the footer's button and from the done panel's (§4), and writes the status line itself when the painter is not on screen (`paintSaved(name)`). The hook is the same.

### 7.2 Open paint file, and a drop with a paint file

Three ways in, one path:

1. **A drop or pick of STL files with one paint file** (any order; two paint files → the refusal `COPY.onePaintFile` on the error card, code `too-many-files` is wrong for it, so `problems.ts` gains `one-paint-file` _(proposal)_). `loadFiles` sets the `.mtpaint` aside, reads it (`readPaintFile`; `not-a-paint-file` and `paint-file-newer` are `ConversionProblem`s and go to the error card as every problem does, the paint file's name as the card's file), reads the STLs as today, then `matchSources(file, buffers)`: a `paint-file-sources` problem goes to the error card in its one sentence (the role missing, different or extra; the STLs' names as the card's file). Matched, the buffers are taken in the file's order, `sources` and the names with them, `choices` are the file's (§7.5), and `convert` runs with `ask = null`: no question. When it is done, `openPainter` with `{ steps: file.steps, engines: file.engines }` and the file's look (§5); `state.paintFile.olderEngine = paintedOnOlderEngine(file)`.
2. **A paint file alone, while no mini is on screen** (the empty state, or the error card): it waits. `state.paintFile.pending` holds its sources, the status line says `describePaintFileWaiting(sources)` ("Now drop the STL files this painting was made on: the figure and its base."), and `#paint-file-forget` (`data-in="empty"`, `.btn btn-ghost btn-sm`, `COPY.withoutPaintFile`, shown while one waits) drops it. The next drop of STL files is matched against it as in 1; a refusal keeps it waiting (the error card's "Choose another file" goes back to the empty state with the line still there), so a wrong file costs one more drop, not the paint file. A new paint file replaces the waiting one.
3. **A paint file for the mini on screen**: `#paint-file-open` in the painting footer, or a paint file dropped or picked alone while a mini is on screen (`done` or `painting`). Its sources are matched against this mini's fingerprints (§7.4): a match replays it on this mini (`paintTool.open(null, null, null, { steps, engines })` and the look, entering `painting`), after the confirm dialog `COPY.replacePainting` when the view holds unsaved steps (§8.3); no match shows the `paint-file-sources` sentence in `#status` as a problem (the callout) and leaves the mini as it is. _(proposal: a paint file for other files, dropped on a mini, does not throw the mini away to wait for files; the person drops the files it wants together with it)_

In every way the olderEngine line is set from the file and shown while it is open (§9.2). A paint file's `converter` is never checked.

**As built (2026-10-21, #167):** way 3 replays at once only when the file's choices are the ones the mini on screen was converted with; when they differ, the matched files convert again with the file's choices first (`convertWithPaintFile`), because steps replayed onto a surface converted another way would paint the wrong places (`openPaintFileOnMini` in `main.ts`). Matching is by fingerprints (`matchFingerprints` in `paint-file.ts`, which `matchSources` uses), not by re-hashing on the page's thread.

**Changed (2026-10-25):** a paint file without steps ends in the done panel, not the painter: `replayOnMini` sets the look and returns when `file.steps` is empty, unless the painter is open on this mini, whose painting the file then replaces (as `COPY.replacePainting` promised) by opening the view with no steps. The empty state says the file is welcome: `p.hint` `#paint-file-hint` (`COPY.paintFileHint`, "Have a paint file? Drop it with the STL files, or open it first."; hidden while a file waits, the status line speaks then) and **Open paint file** (`#paint-file-open-empty`, `.btn btn-ghost btn-sm` with `folder-open`), which opens the same `#paint-file-input` as the footer's button: way 2 by a button.

### 7.3 Unsaved steps

The page keeps `savedSteps: number | null`, the count of `view.history()` at the last Save paint file on this view (null before one); the painting is unsaved while `view.state.steps !== savedSteps`, which Save's disabled state, the confirms of §8.3 and the record of §8.2 read. The hook `state.painting.steps` already gives the count.

### 7.4 The sources' fingerprints

`Source` gains `fingerprint: Promise<{ bytes: number; sha256: string }>`, started in `loadFiles` on the buffers before they go to the worker (`fingerprintOf(buffer, 'figure')` without its role; `convert` transfers the buffers) and for `loadDemo`, `loadGenerated` and `addBase` from what `read()` gives; the roles are put on after the conversion from `sourceRoles(result.pair, sources.length)`. `sourceFingerprints(): Promise<SourceFingerprint[]>` is what Save, the record and the match of way 3 use. A SHA-256 of a 100 MB file is about a quarter of a second on the development PC and runs while the file converts.

**As built (2026-10-21, #167):** the fingerprint is taken once per source, from a fresh `read()`, in `src/page/digest.worker.ts`, when the painter first opens, at a save or a record before that, or when a drop must be matched against a paint file or the unsaved record (`digestOf`, `fingerprintSources` in `main.ts`). Started in `loadFiles` on the buffers, as above, it stalled the page 273–328 ms at the start of large-01's conversion against 55 ms on `main`, because `crypto.subtle.digest` copies its input on the calling thread; now 54–55 ms (journal `2026-10-21-painter-on-the-page.md`).

### 7.5 A paint file's choices on the page

The page's `choices` (orientation, baseOrientation, sizing, pairing, placement, parts, preset) are filled from `file.choices` (`UpChoices` and `sizing`) field by field, the preset through `findSourcePreset(id)` (a preset the converter no longer has falls back to none and the up it names, as `convertOptionsOf` does), so Adjust shows them after the conversion and a later reconversion keeps them. `convertOptionsOf(file)` is the reference for what `convert` must receive; `paint-file.test.ts` already proves it converts to the same bits.

## 8. What stays on the device

### 8.1 The module

`src/page/storage.ts`: the one place the page reads and writes the browser's storage beyond the theme's `mt-theme` (which `theme.js` owns). Every call is wrapped: a storage that is missing, blocked, full or throwing gives null or does nothing, and the page never shows an error for it (a `console.warn` under `?dev`). No DOM.

```ts
/** The unsaved painting: a paint file's contents and what the person would recognise it by. */
export interface UnsavedPainting {
  file: PaintFile;
  /** The files' names in the file's order, so the offer can name them. */
  names: string[];
  /** When it was last written, ms since the epoch. */
  at: number;
}
export function readUnsaved(): Promise<UnsavedPainting | null>;
export function writeUnsaved(painting: UnsavedPainting): Promise<void>;
export function forgetUnsaved(): Promise<void>;
export function readPalette(): string[];
export function writePalette(colours: readonly string[]): void;
/** `colour` first, the rest after it, each once, at most `max`: the palette after a step. Pure. */
export function withColour(palette: readonly string[], colour: string, max?: number): string[];
```

IndexedDB `DB_NAME = 'polywash'`, store `STORE_UNSAVED = 'unsaved'`, one record at the key `'painting'` (structured clone of the object, no gzip, no pixels: a long session is a few hundred KiB); `localStorage` key `PALETTE_KEY = 'mt-palette'`, a JSON array of lower-case hex. `withColour` and the record's shape are unit-tested in Node; the IndexedDB and `localStorage` paths in real Chrome (§12).

### 8.2 When the record is written and forgotten

- Written through `view.subscribe` when `steps` or `undone` move and the painting is unsaved (§7.3), debounced by `UNSAVED_WRITE_DELAY_MS` so a stroke a second costs one write: `{ file: paintFileOf({ sources, choices, look, steps: view.history(), engines: view.engines() }), names, at: Date.now() }`. The look changes alone do not write it (the next step will carry the look).
- Forgotten at Save paint file (it is saved), at "Convert afresh" in the offer (§8.4), and when a painting is replaced through Open (way 3). Not at Close, not at a new drop, not when the tab closes: that is what "until the next visit" means.
- One record: the last unsaved painting on this device. _(proposal: one, not one per mini; the spec says "an unsaved painting", and a person who left two unfinished minis has the paint file for the first)_

### 8.3 The confirm dialog

`src/page/confirm.ts` on `dialog.ts`: `confirm(text, yes, no): Promise<boolean>` opens `#confirm` (a `.scrim` with a `.dialog` of `role="alertdialog"`, `aria-labelledby` its `h2`, the text in `#confirm-text`, two buttons `#confirm-yes` (`.btn btn-primary`) and `#confirm-no` (`.btn btn-ghost`); Escape is no; focus returns to the opener). Three uses: the offer (§8.4), Adjust's reconversion with unsaved steps (`COPY.paintingLost`: yes `COPY.convertAgain`, no `COPY.keepPainting`), Open over unsaved steps (`COPY.replacePainting`: yes `COPY.openIt`, no `COPY.keepPainting`). The hooks answer it: `window.__mt.confirm(answer: boolean)` presses the button, `state.confirm: string | null` is the text on screen.

### 8.4 The offer on a drop

In `loadFiles`, after the STLs are read and before `convert`: `readUnsaved()`, and when a record exists and `matchSources(record.file, buffers)` does not throw, the confirm dialog with `describeUnsavedPainting(record)` ("You left a painting of hero.stl + base.stl unsaved on 21 October. Continue it?"; the names and the day in the person's locale), yes `COPY.continuePainting`, no `COPY.convertAfresh`. Yes: the record's file takes the place of a paint file dropped with the STLs (way 1 of §7.2: no question, the steps replayed, the painter open). No: the record is forgotten and the files convert as today, with every question. No record, or other files: nothing is asked. A drop with a paint file skips the offer (the person brought the painting). `state.unsavedOffer` is the record offered, for the tests.

### 8.5 The hooks

`window.__mt.storage`: `unsaved(): Promise<UnsavedPainting | null>`, `forget(): Promise<void>`, `palette(): string[]`. The e2e tests also block the storage to prove the page works without it (§12).

### 8.6 The palette

On a step committed (`steps` grows): `writePalette(withColour(readPalette(), recentColours(view.history(), 1)[0], PALETTE_MAX))` and `panel.setPalette(readPalette())`; at mount `palette: readPalette()`. The mask's steps, the eraser and the lift carry no colour (`recentColours` leaves them out), so they change nothing. Across minis and visits, sixteen colours at most, newest first; the panel shows the mini's own colours first and these after them, as #166 built it.

## 9. Words _(every string a proposal)_

### 9.1 `COPY` in `page-state.ts`

```ts
paint: 'Paint',
paintMini: 'Paint this mini',
savePaintFile: 'Save paint file',
openPaintFile: 'Open paint file',
done: 'Done',
paintingKept: 'Kept in this browser until you save it as a paint file. Nothing is sent.',
onePaintFile: 'Drop one paint file with the STL files.',
withoutPaintFile: 'Convert without it',
continuePainting: 'Continue painting',
convertAfresh: 'Convert afresh',
paintingLost: 'Converting again clears the painting on this mini. Save the paint file first, or go on without it.',
convertAgain: 'Convert again',
keepPainting: 'Keep the painting',
replacePainting: 'Opening this paint file replaces the painting on this mini.',
openIt: 'Open it',
whatYouGet: 'You get three detail levels, a look, a painter and two downloads.',
paintFileHint: 'Have a paint file? Drop it with the STL files, or open it first.', // 2026-10-25
paintFileKeeps: 'The paint file keeps how this mini was put together, painted or not. Drop it with the STL files next time and nothing is asked again.', // 2026-10-25
collectsNothing:
  'This page collects nothing and sends nothing. It stores only your own choices on this device: the theme, the colours you painted with, and a painting you have not saved yet.',
```

and three sentence functions, unit-tested: `paintSaved(name)` ("Saved as hero.mtpaint."), `describePaintFileWaiting(sources)` ("Now drop the STL files this painting was made on: the figure and its base." / "…: the figure, 2 parts and its base." / "…: the figure."), `describeUnsavedPainting(record)` (§8.4). `credits.test.ts`'s two expectations (`collects nothing`, `your own choices`) still hold; the README's first screen and `index.html`'s description are unchanged (the promise is the same).

### 9.2 The status line in `painting`

`#status` shows one line, the first that applies: a problem (a refused paint file, the callout, until the next state change); `PAINT_COPY.olderEngine` while `state.paintFile.olderEngine`; `COPY.paintSaved(name)` after a Save until the next step; else `COPY.paintingKept`. That last line is where the person reads what stays on the device (spec M4, decision 10), beside the Credits.

## 10. Constants _(proposal)_

| Name                       | Value                     | Where                 |
| -------------------------- | ------------------------- | --------------------- |
| `PALETTE_MAX`              | 16                        | `src/page/storage.ts` |
| `UNSAVED_WRITE_DELAY_MS`   | 1,000                     | `src/page/painter.ts` |
| `DB_NAME`, `STORE_UNSAVED` | `'polywash'`, `'unsaved'` | `storage.ts`          |
| `PALETTE_KEY`              | `'mt-palette'`            | `storage.ts`          |
| `PAINT_OPEN_BUDGET_MS`     | 2,000                     | `scripts/corpus.mjs`  |
| `PAINT_FRAME_BUDGET_MS`    | 33 (30 fps)               | `scripts/corpus.mjs`  |

**As built (2026-10-21, #167):** `UNSAVED_WRITE_DELAY_MS` is in `src/page/main.ts`; a waiting write is flushed before a conversion or Close closes the view and before a drop reads the record (`flushUnsaved`).

## 11. The quality bar (#146, spec L4)

- **`states.ts`**: `painting(page)` becomes the product path (`#paint-open` in the done panel; the caller opens `/?ask=off&bake=256`, with `&dev` only where a test needs the team section), and the three specs that call it follow. `paintEveryKind` of `e2e/paint-file.spec.ts` moves to `e2e/painting-steps.ts`, shared with the promise test.
- **Accessibility** (`accessibility.spec.ts`): the painting state, both themes, with what the panel's test shows today plus the footer and the status line, and the confirm dialog open (`paintingLost`); serious and critical fail.
- **Keyboard** (`keyboard.spec.ts`): the sweep in the painting state reaches Open, Save and Done with the focus ring (the panel's sweep exists); Enter on Done leaves the state; Enter on Save downloads; the confirm dialog's two buttons and Escape by keys; Paint in the done state by keys.
- **Reference screenshots** (`reference-screens.spec.ts`): `${frame}-painter-${theme}.png`, the page in the painting state on the generated figure at the frame's size, canvases hidden and frames held, the sheet at its first screen on the phones; the panel's own tall pictures (`${frame}-painting-${theme}.png`) stay; and `${frame}-done-${theme}.png` move, because the done panel gains the Paint section: rewritten with `--update-snapshots`, as `docs/guides/reference-screenshots.md` says, the Linux set from CI's artifact.
- **The promise** (`promise.spec.ts`): after done, Paint, a stroke of every tool and a fill (`painting-steps.ts`), Save paint file (a download event), Done, both GLB downloads; then the same checks as today over every request. The timeout goes to 300 s. Two more tests beside it: with `indexedDB` and `localStorage` made to throw by an init script, the same painting works and the page shows no error; a stroke, a reload and a drop of the same file bring the offer, Continue gives the stroke back at a sampled point (`painting.sample`).
- **`verify-3d`** for the PR: the done panel with Paint, the painter on a corpus mini, the sheet on a phone, both themes.
- **The budget**: `theme-files.test.ts` covers `style.css`'s growth; the panel's stylesheet is unchanged.

## 12. Measurements

- `npm run corpus -- --paint` _(proposal: opt-in, a painting pass adds seconds per mini)_: for every mini, after its conversion, Paint; `painterMs` against `PAINT_OPEN_BUDGET_MS`; one stroke of the flat brush across the mini's screen box with `strokeAt`, the view's `perf` (frames, median, worst, slow) and the time between frames as `scripts/measure-painting.mjs` probes it, the median against `PAINT_FRAME_BUDGET_MS`; Done. `results.md` gains a "Painting" table and `results.json` the figures; the three minis of the criterion are the PM's pick on the laptop, reported in the PR with the device. The budget is the reference laptop's; the development PC's run says so, as the question budget does.
- `paintedTexture` on a 2,048² surface and the PNG encoding, timed in the e2e on the development PC (a download must not stall the page for seconds; if it does, the texture is computed in a worker, a follow-up, and the PR says the number).
- The CSS budget's number and `docker:e2e`'s time.

## 13. Build order, with the test that proves each step

1. **The state and the frame** (§3, §4): `pageStateOf` and `page-state.test.ts`; `index.html` (the section, the footer, `#paint-panel`, `#paint-team`, `#confirm`), `style.css` (the state's rules, the phone), `painter.ts` from `paint-tool.ts`, `main.ts` (`openPainter`, `closePainter`, `render`), `icons.ts`; the view's `setShown` with its test in `e2e/painting.spec.ts` ("hidden, the view draws no frame and still gives its paint"). Proof: `e2e/painter.spec.ts` (new): Paint enters `painting` with the panel and the footer on screen, a stroke, Done enters `done`, Paint again has the same `steps` and undo works; `cannotPaint` on a `?bake=off` mini; the existing `painting.spec.ts` and `paint-file.spec.ts` pass through `states.painting` rewritten.
2. **The look as one** (§5): a chip in the panel changes `state.look` and the viewer; `setLookPreset` changes the panel; e2e in `painter.spec.ts`.
3. **The paint on the mini** (§6): `Viewer.setPaint`; the thumbnail. Proof: after Done, `thumbnail()` of a red stroke has red pixels where the stroke was (as #125's paint tests look); `showLevel(3)` draws the far level with the paint (`state` pixel read through the thumbnail of that level, or `paintAtVertices` sampled at the stroke).
4. **The downloads** (§6.1): `paintedTexture` and its Node test; `glb.ts` with `paint` and `texture`, the validator tests with the hand-made PNG, "a file without paint is byte for byte the old one"; `exportGlb`. Proof: e2e downloads the table GLB after a stroke, parses its JSON chunk (`images`, `textures`, the material's `baseColorTexture`, `extras.meshtavern.paint`), and the far GLB's `COLOR_0` differs from the unpainted one's at the stroke; `baseline.test.ts` unchanged.
5. **Save and Open** (§7): `savePaintFile`, the three ways in, the refusals, the pending file, the fingerprints, the choices. Proof: `paint-file.spec.ts` gains the page's path: Save through the button gives the bytes the hook gives, a drop of the STL with the file converts without a question and opens the painter at the steps, a drop with the wrong STL shows the sentence on the error card, a file alone waits and the next drop takes it, Open over a painting asks and replaces; `problems.ts` and `page-state.ts` tests for the new sentences.
6. **The storage** (§8): `storage.ts` and its Node tests; the record, the offer, the palette; `confirm.ts`. Proof: the three promise-side tests of §11, and the palette across a reload (`storage.palette()` after a stroke, then after a reload the panel shows the swatch).
7. **The quality bar** (§11): the states helper, the scan, the keyboard pass, the pictures, the promise test; `npm run docker:e2e`.
8. **Measurements** (§12): `corpus --paint`, the development PC's numbers and, where the builder can run it, the laptop's; `verify-3d` screenshots.
9. **Docs**: CLAUDE.md (the intro's "the page does not offer painting" lines, the layout of `src/page/`, the hooks, `painter.ts`, `storage.ts`, `confirm.ts`, the new `__mt` hooks, the corpus flag), `docs/design/product-page.md` (a sixth state, an "as built" line), `look-and-feel.md` §4.4 item 5 ("as built"), `painting-engine.md` §10.1 (`setShown`), `painting-panel.md` §11.1 (a pointer to this note), the README ("Run it" with the painter and the paint file; "Use it as a library" with `paintedTexture` and the GLB's `paint` and `texture`), and the journal entry.

Commits: one per step or two, Conventional Commits.

## 14. The [human] criterion

The PM paints two of their minis on the page, on the development PC and on the laptop: the PR says how (`npm run dev`, or `npm run lan` for the laptop), and leaves the box unticked.

## 15. Where the build must stop and ask

- **`setShown` is not enough**: if `paint()`, `surface()` or `open` need the frame loop, or stopping it loses a pending read, stop; the fallback is to leave the loop running on the hidden canvas, which costs a frame's traversal per frame, and the PR says so.
- **The validator rejects a file with the texture** for a reason the structure of §6.1 cannot meet (an image rule, a sampler rule): stop with the message; do not move the paint into `COLOR_0` for the table level.
- **The footer does not fit** at 22 rem or 375 px with Open as an icon button: make Save one too and show the PM the screenshot; do not widen the panel.
- **A reconversion with unsaved steps**: if the PM does not want the confirm dialog (§8.3), the alternative is to disable Adjust's reconverting controls while steps are unsaved, with a hint; ask before building either twice.
- **The regression baseline moves** with the GLB change: it must not (unpainted minis); a move is a bug in the "without paint, byte for byte" rule.
- **The CSS budget** (`theme-files.test.ts`) or the e2e's time on CI (60 minutes): split a test rather than raise a limit.
- **`paintedTexture` or the PNG stalls the page** for more than a second on large-01: report the number; a worker is a follow-up, not this build.
- **An existing test that cannot stay true** without changing the engine's behaviour or the paint file's shape: stop and ask.

## 16. Out of this note

- What the page says about MeshTavern and where it links: C9, a design pass of its own (spec 10, decision 12).
- Keyboard shortcuts for Undo and Redo: the panel's follow-up, once both consumers say where the focus lives.
- The paint in the thumbnail for a product feature (the page has no list of minis), the close level's export, a worker for the painted texture, a record per mini in the storage.
- The application's dialog (T3) and its import with a paint file (T7): the private repo.

## 17. Files

| File                                                                                                                                                                                   | Change                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/page/page-state.ts`, `.test.ts`                                                                                                                                                   | `'painting'`, `pageStateOf`, the words and the three sentence functions (§3.1, §9)                                                            |
| `src/page/painter.ts` (from `paint-tool.ts`)                                                                                                                                           | the page's painter: open, Done, the record's writes, the palette, Save and Open (§3.6, §7, §8)                                                |
| `src/page/storage.ts`, `.test.ts`                                                                                                                                                      | new: IndexedDB and `localStorage`, guarded (§8.1)                                                                                             |
| `src/page/confirm.ts`                                                                                                                                                                  | new: the confirm dialog on `dialog.ts` (§8.3)                                                                                                 |
| `src/page/main.ts`                                                                                                                                                                     | `openPainter`, `closePainter`, the state, the look as one, `exportGlb` with the paint, `loadFiles` with a paint file and the offer, the hooks |
| `src/page/viewer.ts`                                                                                                                                                                   | `setPaint` (§6)                                                                                                                               |
| `src/page/icons.ts`, `scripts/lib/icons.mjs`                                                                                                                                           | `paintbrush`, `folder-open`, `save`, `check`                                                                                                  |
| `index.html`, `src/page/style.css`                                                                                                                                                     | the Paint section, the footer, `#paint-panel`, `#paint-team`, `#confirm`, the state's rules                                                   |
| `src/lib/painting/mount.ts`                                                                                                                                                            | `setShown` (§3.4)                                                                                                                             |
| `src/lib/pipeline/paint.ts`, `.test.ts`                                                                                                                                                | `paintedTexture` (§6.1)                                                                                                                       |
| `src/lib/pipeline/glb.ts`, `.test.ts`                                                                                                                                                  | `paint`, `texture`, `extras.meshtavern.paint` (§6.1)                                                                                          |
| `src/lib/pipeline/problems.ts`                                                                                                                                                         | `one-paint-file` (§7.2)                                                                                                                       |
| `src/lib/index.ts`, `index.test.ts`                                                                                                                                                    | `paintedTexture`                                                                                                                              |
| `e2e/painter.spec.ts` (new), `painting-steps.ts` (new), `states.ts`, `paint-file.spec.ts`, `promise.spec.ts`, `accessibility.spec.ts`, `keyboard.spec.ts`, `reference-screens.spec.ts` | §11                                                                                                                                           |
| `scripts/corpus.mjs`                                                                                                                                                                   | `--paint` (§12)                                                                                                                               |
| `README.md`, `CLAUDE.md`, `docs/design/product-page.md`, `look-and-feel.md`, `painting-engine.md`, `painting-panel.md`                                                                 | §13 step 9                                                                                                                                    |
| `docs/journal/2026-10-<dd>-painter-on-the-page.md`                                                                                                                                     | the journal entry, written by the build                                                                                                       |

**As built (2026-10-21, #167):** `painter.ts` holds the view, the panel and the `?dev` team section (`createPainter`, `encodePng`, `downloadBlob`); the record's writes, the palette, Save, Open and the offer are in `main.ts` (`keepUnsaved`, `flushUnsaved`, `savePaintFile`, `openPaintFile`, `openPaintFileOnMini`, `offerUnsaved`); the hashing worker is `src/page/digest.worker.ts`; `matchFingerprints` joined `paint-file.ts` and `index.ts`.
