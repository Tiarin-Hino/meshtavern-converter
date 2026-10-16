# Design: an eraser that lifts a step and shows the paint beneath it (#137)

Status: design and build by Opus 5.5, 2026-10-16 (the PM said to go on without a Fable pass) · Issue: #137 · Builds on: `docs/design/painting-engine.md` (#127, §5 the passes, §8 undo and redo), `docs/design/dry-brush-crests.md` (#133)

Every number and name marked _(proposal)_ is the PM's to change.

## 1. What the PM asked

PM feedback after #128: a stroke that went over the line should be correctable without erasing the paint that was there before it. Today's eraser lowers alpha toward bare, so erasing the stray edge of a wash over a painted cloak erases the cloak too.

PM decision on the issue (2026-10-13): not only the last step. The eraser removes what the strokes under it laid, as long as they are in the recorded history, revealing what was beneath them. The PM's proposed approach: where the stroke starts, the engine finds the newest step that changed the texel under it (a per-texel map of the last step to change each texel, written at each commit); within the stroke's coverage it brings texels to the paint as replayed without that step, from the keyframe before it; the stroke records the step it removes, so undo and redo replay it; where no step in the history covers the spot, nothing is erased and the view says why: "nothing painted here" (bare, or the paint the view was opened with) or "painted too long ago" (older than the oldest step still undoable).

## 2. The decision in one paragraph

A new tool, **`lift`** _(proposal: the painter's word for taking paint off again; the panel calls it "Lift")_, beside the eraser. Every committed step writes its number into a **stamp map** (`stamp`, an RG8 target, 2 MB) at every texel whose bytes it changed. At a lift stroke's start the view reads the stamp under the first hit and so finds the step `i` to lift; it makes sure a keyframe of the paint **before step `i`** exists (built once by replay from the nearest keyframe, then kept while the lift stroke is in the history: a **pinned** keyframe) and composites toward it: every texel whose stamp is still `i`, that is every texel where step `i` is the top layer, goes from the paint toward the paint beneath step `i` by the stroke's coverage. The stroke records `lifts: i`. Undo and redo replay it like any stroke, the beneath taken from its pinned keyframe. A lift never stamps itself: where it took step `i` away fully, the texel takes the stamp it had beneath step `i`, so the next lift stroke started there lifts the layer under it.

## 3. Why the stamp decides which texels change

The PM's approach says "the paint as replayed without that step". Taken literally across the whole coverage, that is a replay of every step after `i` without `i`, and a lift step among them would need its own replay without its own step, inside that replay: the cost grows with every lift in the history, without a bound the undo schedule (§8 of the engine's note) can hold.

The stamp gives the same bytes without any of it where it matters: at a texel whose stamp is `i`, no step after `i` changed it, so the paint there is step `i` applied to the paint before `i`, and the paint without `i` is exactly the paint before `i`, which the keyframe holds. Texels where a later step lies over step `i` (a wash over the stray stroke) are left as they are; the person lifts the wash first (its stamp is newer, so a lift started on it takes it), then the stroke under it. So one lift stroke takes away one layer, the top one where it starts, and only where that layer is still on top. **This is a narrowing of the PM's wording, asked on the PR**: if the PM wants a lift to reach under a later layer, the build needs the replay without the step and a bound on the lifts it replays (§9).

A texel whose bytes a later step left unchanged (a dry brush whose mask was 0 there, a stroke of the same colour at full opacity over itself) keeps its stamp: "changed" is the bytes, compared in the stamp pass.

## 4. Data

```ts
// src/lib/pipeline/brush.ts
export const TOOL_IDS = [
  'flat',
  'fill',
  'eraser',
  'lift',
  'wash',
  'ink',
  'dry',
  'airbrush',
] as const;

export interface PaintStroke {
  // … as before
  /** The lift (#137): the step it takes away, as an index into the history (`history()`, oldest first). Only on a `lift` stroke. */
  lifts?: number;
}
```

- The index is absolute: `history()` keeps every step since the paint was opened (#127 as built), so the index does not move when older keyframes are dropped, and undo and redo give the same bytes.
- `recentColours` leaves lift strokes out, as eraser strokes: their colour is never shown.
- `toolMask('lift', …)` is 1: the lift's coverage is the brush's, with its size, hardness and opacity.

## 5. The passes

- **`stamp`**: RG8, `PAINT_SIZE` square, nearest. A texel holds `(step index + 1) mod STAMP_MODULUS` (`STAMP_MODULUS = 65536`), 0 for "no step": bare, or the paint as opened. Cleared at `open`.
- **The stamp pass** at every commit, live or replayed, before `live` is copied into `paint`: a quad pass into `stamp` that discards every texel whose `live` equals its `paint` (the decoded values, so equal bytes), and writes the step's number elsewhere. For a lift step it writes the beneath's stamp where `live` now equals the beneath, and discards everywhere else (a texel lifted only partly keeps step `i`'s stamp, so the next lift stroke there goes on taking `i` away).
- **The lift composite**: at the texel's owner (as every composite, §5.4), the texel's own paint unless its stamp is `i + 1` and the stroke covers it; then `t = opacity × coverage`; at `t ≥ 1` the beneath's bytes exactly, else the straight-alpha paint mixed toward the beneath's in premultiplied form (`mix(p.rgb × p.a, b.rgb × b.a, t)`, `mix(p.a, b.a, t)`, divided back).
- **Keyframes** hold the paint and its stamp (one more 2 MB copy each). A restore copies both back.
- **The stamp under a point** is read synchronously (`readRenderTargetPixels` of one texel) at the lift stroke's start: one GPU sync per lift stroke, not per frame.

Wrap-around: after 65,535 steps in one open session a stamp could name a step 65,536 back as a recent one. The lift then finds the beneath equal to the paint at that texel (nothing changed it since) and takes nothing away there. Harmless, so not handled.

## 6. Undo, redo and the pinned keyframes

`PaintHistory` (Node-tested over its fake backend) gains:

- **`floor`**: the oldest step count undo may reach. It is what `keyframes[0]` was: the window still drops the old keyframes as before (`UNDO_STEPS`), and `undoable` is `cursor − floor`.
- **`pin(at): boolean`**: a keyframe of the paint after `at` steps for a lift that starts now. False when `at < floor` ("painted too long ago"). If none is kept at `at`, it is built: the paint as it is now is kept under a temporary key, the nearest keyframe at or before `at` restored, the steps between replayed, the keyframe taken, the paint as it was restored, the temporary key dropped. At most `KEYFRAME_EVERY − 1` replays: the PM's "short hitch of up to about 0.1 s".
- A keyframe off the schedule (not `0`, not a multiple of `KEYFRAME_EVERY`) is kept only while a lift step in the history (applied or undone) points at it. When the window moves on, a pinned keyframe below `floor` is kept while a lift step at or above `floor` still needs it, since undo may replay that step; a keyframe nothing needs any more is dropped. A lift stroke that is cancelled, or lays no dab, leaves its pin unreferenced, and it is dropped then (`prune`).
- Undo restores the nearest keyframe at or before the target that is at or above `floor`: a pinned keyframe further back may hold the right paint but the steps after it may need references already dropped.

Memory: the stamp target 2 MB, every keyframe 2 MB more (at most 6 on the schedule: 12 MB), and 6 MB a pinned keyframe, one for each step that lift strokes in the history took away (lifting the same stray stroke in ten strokes pins one keyframe). The README's table gets the rows.

## 7. What the view says

```ts
export type LiftOutcome =
  | { lifted: number } // the step index the last lift stroke took away
  | { refused: 'nothing-painted' | 'too-long-ago' };

interface PaintingState {
  // … as before
  /** What the last lift stroke found under its start (#137); null before the first since `open`. */
  lift: LiftOutcome | null;
}
```

A refused lift stroke draws nothing and leaves no step. `PAINT_COPY.lift` holds the two sentences for a panel to show _(proposals)_: "Nothing painted here to lift: the paint the mini came with stays." and "Painted too long ago to lift: only the last {n} steps can be taken back." (with `UNDO_STEPS` filled in by the panel). The `?dev` tool shows them in its status line, as the pipette's "nothing to pick".

## 8. Build order and proof

1. Data: `lift` in `TOOL_IDS`, `lifts`, `toolMask`, `recentColours`, `PAINT_COPY`. Node tests.
2. History: `floor`, `pin`, pruning. Node tests on the fake: a pin builds the paint before the step; pins live while referenced, go when the lift step is dropped or the window passes it; undo across a lift step replays it from its pin; `undoable` keeps at least `UNDO_STEPS`.
3. Passes and view: the stamp target and pass, keyframes with stamps, the lift composite, `beginLive` finding the step, `state.lift`. E2e (the issue's criteria): two strokes, the second over the first; a lift stroke over both, started on the second, brings every texel back to its bytes after the first stroke and leaves the rest alone; a second lift stroke there lifts the first; one undo step per lift stroke, undo and redo the same bytes, also replayed from a keyframe under a later step; bare and opened paint refused as nothing painted; a step older than the window refused as too long ago.
4. Numbers: `scripts/measure-painting.mjs` gains a lift run at the largest brush after the other brushes have painted (the frame-rate criterion of #127, on the development PC).
5. Docs: the engine's note (as built), README, `CLAUDE.md`, the journal entry.

## 9. When to stop and ask

- **The PM wants a lift to reach under a later layer** (§3): the replay without the step over the whole coverage, with a rule for lift steps inside that replay. Ask before building it.
- **The stamp pass's equality test misses on a GPU** (the decoded values of equal bytes compare unequal): compare the encoded bytes (`round(x × 255)` after encoding back) instead; if that also misses, ask.
- **Memory**: if pinned keyframes on the phone matter more than lifting many steps, a cap on pins (refusing with "too long ago" past it) is the fallback; the PM's call.
