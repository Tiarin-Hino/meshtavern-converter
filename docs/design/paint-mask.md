# Design: a mask that protects parts of the mini from every tool (#138)

Status: design and build by Opus 5.5, 2026-10-16 (the PM said to go on without a Fable pass) · Issue: #138 · Builds on: `docs/design/painting-engine.md` (#127, §5 the passes, §7 the fill, §8 undo and redo), `docs/design/lift-eraser.md` (#137, the stamp map and the keyframes)

Every number and name marked _(proposal)_ is the PM's to change.

## 1. What the PM asked

PM feedback after #128: a mask that protects parts of the mini from every tool, as masking tape or liquid mask does on a real mini, for example: mask the face, then wash the whole figure freely. PM decisions on the issue (2026-10-13):

- The mask is kept with the mini so painting can continue later: pixels in and out, as the paint.
- The mask can be inverted.
- The mask also cuts the fill. A fill floods connected triangles and treats masked surface as a boundary, so masking a wrist and filling the hand fills the hand. A triangle counts as cut when the mask covers its middle (the fill works on whole triangles), so a band two or three triangles wide is enough.

## 2. The decision in one paragraph

A **mask layer** (`mask`, an R8 target beside `paint`, a byte a texel, 255 fully masked) that every paint composite reads at the texel's owner: the tool's alpha is multiplied by `1 − mask`, so a fully masked texel keeps its bytes exactly (an alpha of 0 returns the paint as it is, the path a dry brush's crease already takes). The mask is made with three new **tools**, `mask` (a brush that lays mask), `unmask` (an eraser that takes it away) and `mask-fill` (a fill that lays mask over a tapped region or a ready region), and changed whole by a new **step kind**, `{ kind: 'mask', change: 'clear' | 'invert' }`. Every one is one step of the history, undone and redone like a stroke. The keyframes hold the mask with the paint and the stamp. The view takes a mask at `open` and gives it back as pixels (`mask()`), shows it as a tint over the masked surface (which the consumer can switch off, `setMaskShown`), and never puts it in `paint()`.

## 3. Data

```ts
// src/lib/pipeline/brush.ts
export const TOOL_IDS = [
  'flat', 'fill', 'eraser', 'lift', 'wash', 'ink', 'dry', 'airbrush',
  'mask', 'unmask', 'mask-fill',
] as const;
/** The tools that change the mask, not the paint (#138). */
export const MASK_TOOL_IDS = ['mask', 'unmask', 'mask-fill'] as const;
/** The tools a tap fills with. */
export const FILL_TOOL_IDS = ['fill', 'mask-fill'] as const;

export interface PaintStroke { kind: 'stroke'; tool: Exclude<ToolId, FillToolId>; … } // `mask`, `unmask` too
export interface PaintFill { kind: 'fill'; tool: FillToolId; … }                      // `mask-fill` too
export interface MaskChange { kind: 'mask'; change: 'clear' | 'invert' }
export type PaintStep = PaintStroke | PaintFill | MaskChange;

/** The mask as pixels (#138): PAINT_SIZE square, one byte a texel, 0 open … 255 masked, row 0 at v = 0. */
export interface PaintMask { width: number; height: number; data: Uint8Array }
```

- A mask stroke and a mask fill record the colour as every stroke does; it is never used. `recentColours` leaves them and the mask changes out.
- `toolMask` of the three mask tools is 1: the mask brush's coverage is the brush's, with its size, hardness and opacity.
- Mask tools read the same sliders as the flat brush, the eraser and the fill (`opacity` is how much mask a stroke lays or takes, `tolerance` the mask fill's).

## 4. The passes

- **`mask`** and **`maskLive`**: R8, `PAINT_SIZE` square, nearest, no colour space. `maskLive` is what the composite and the tint read while a mask stroke is under way; a commit copies it into `mask`, a cancel copies it back, as `live` and `paint`.
- **The paint composite** reads `mask` (the committed one: a paint stroke never runs while a mask stroke does) at the owner: `alpha *= 1 − mask`. For every paint tool, the lift included.
- **The mask composite** (for `mask`, `unmask`, `mask-fill`), a quad pass into `maskLive` from `mask` and the stroke layer at the owner, as the paint's: `a = opacity × coverage`; laying, `m + a × (1 − m)`; taking away, `m × (1 − a)`. A mask step changes no paint, so it writes no stamp and a lift never takes it away.
- **Clear** and **invert**: a quad pass into `maskLive` (0, or `1 − m` at every texel), committed.
- **Keyframes** hold the mask too (1 MB each). `restore` copies it back.
- **Mask in and out**: at `open` the given bytes are uploaded into `mask` (an R8 `DataTexture` copied in); `mask()` draws it into a scratch RGBA target and reads that back (R8 is not a format every GPU reads back).

## 5. The fill's cut

`fillRegion` (pipeline, Node-tested) gains `cut?: Uint8Array | null`: a byte a triangle, non-zero for a triangle the mask covers. A cut triangle is never entered, and a picked seed on a cut triangle fills nothing. Ready regions (`base`, `figure`) take no cut: the mask protects their masked texels anyway.

The cut is measured on the GPU from the mask as it is when the fill is applied, live or replayed (`PaintPasses.readCut`): one point a triangle into a small RGBA target (`⌈√T⌉` square), each at the texel under its centroid's texture coordinates, 255 where the mask there is at least `MASK_CUT` _(proposal: 0.5)_; read back synchronously, since a replay inside undo is synchronous. Only for a picked fill: a 50,000-triangle level reads 224² × 4 bytes, about 0.2 MB, once a fill.

## 6. What the view shows and says

```ts
interface MiniToPaint { … mask?: PaintMask | null }   // left out or null: nothing masked
interface PaintingState { … maskShown: boolean }
interface PaintingView {
  …
  maskRegion(region: 'base' | 'figure'): Promise<void>; // a mask fill of a ready region
  clearMask(): Promise<void>;
  invertMask(): Promise<void>;
  mask(): Promise<PaintMask>;       // the committed mask's pixels
  setMaskShown(on: boolean): void;  // the tint; true at mount (proposal)
}
```

- **The tint** is drawn by the baked material from `maskLive` (`BakedMaterialOptions.tint`: a texture, a colour, a strength), after the look: `mix(colour, MASK_TINT, mask × MASK_TINT_STRENGTH)` _(proposals: `#3a78d8`, the blue of liquid mask, at 0.45)_. The tint colour is paint-like data, beside `DEFAULT_PAINT_COLOUR` in `brush.ts`, one of the colour check's allowed files. Shown or not is the view's state, not a step.
- `PAINT_COPY` gets the tools' names and hints, and `mask: { clear, invert, show }` _(proposals)_.

## 7. Build order and proof

1. Data: the tools, `MaskChange`, `PaintMask`, `recentColours`, `toolMask`, `PAINT_COPY`, `fillRegion`'s cut. Node tests (`brush.test.ts`, `fill.test.ts`, `tools.test.ts`).
2. Passes: the mask targets, the paint composite's factor, the mask composite, clear and invert, keyframes, upload and read-back, the cut pass. The material's tint.
3. View: the tools in `beginLive` and the fill tap, the mask steps in `replay`, the methods and state. The `?dev` Paint tool: the three tools (from `TOOL_IDS`), Clear mask, Invert mask, Show mask, Mask base / Mask figure.
4. E2e (the issue's criteria): a masked area keeps its bytes under every tool, a wash over the whole figure included; mask brush, mask eraser, mask fill, clear and invert are each one undo step, undo and redo the same bytes; the mask comes back from `mask()`, is given back at `open`, and is not in `paint()`; the tint shows on screen where the mask is (pixels of the canvas) and goes when switched off; a fill stops at a masked band.
5. Numbers: `scripts/measure-painting.mjs` with a mask laid before the strokes (the frame-rate criterion of #127).
6. Docs: the engine's note, README, `CLAUDE.md`, the journal entry.

## 8. Open, and when to stop and ask

- **Hidden parts (#139)**: whether a hidden part is also masked is #139's decision. Nothing here assumes it; a hidden part would be a per-triangle state of the view, not mask texels.
- **The paint file (#165)** is not built yet: when it lands, the mask's steps are in the history it saves, and the mask's pixels go with the paint's where a consumer keeps pixels.
- **R8 copies**: if `copyTextureToTexture` between R8 targets or from an R8 `DataTexture` fails on a GPU, copy with a quad pass instead; if that also fails, ask.
