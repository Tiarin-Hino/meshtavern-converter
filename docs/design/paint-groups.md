# Design: groups of the mini's surface, hidden to reach what lies behind them (#139)

Status: design pass by Fable 5.1, 2026-10-19, for Opus 5.5 to build · Issue: #139 · Builds on: `docs/design/painting-engine.md` (#127, §5 the passes, §7 the fill, §8 undo and redo), `docs/design/paint-mask.md` (#138, the mask as the group fill's cut, the cut's read-back), `docs/design/lift-eraser.md` (#137, the keyframes), `docs/design/marks-where-parts-meet.md` (#93, `pulledApart`)

Every number and name marked _(proposal)_ is the PM's to change. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§13).

## 1. What the PM asked

PM feedback after testing the hobby brushes (#128): split the mini into its original parts while painting, or at least hide parts, so surfaces behind them can be reached: the chest behind a shield, the inside of a cloak. The PM's decisions on the issue, as corrected on 2026-10-13:

- **Groups are the core.** A group is a set of the table level's triangles. Hide and show, mask and unmask apply per group, and pulling apart reuses groups to move them.
- **Groups by parts, automatically:** one per file of a mini made of several files, one per separate shell of a single file.
- **Two ways to make a group by hand:** a **group brush** that marks the triangles it covers, and a **group fill**: a tap floods connected triangles and stops at anything treated as disconnected: the mask (#138: mask the wrist, fill the hand), a group pulled apart, and _(the PM's own proposal)_ the edges of the group the tap starts in, so a fill stays within its group and subgroups are easy.
- **Hiding is the main function.** A hidden group is drawn neither on screen nor in the stroke's depth map, and takes no paint, so what lies behind it can be painted. Hiding is not a step: undo and redo are unaffected.
- **Pulling the original parts apart is dropped; pull groups apart instead**, as part of this issue or a direct follow-up: every group stays on screen, each drawn moved by its own offset on screen and in the depth map; a dab on a pulled-apart group paints only that group; the stroke records the offsets at its start so undo and redo render the same depth map; group edges become geometry edges in the view's own geometry.
- **Groups are kept with the mini** (as the mask), so painting can continue later with the same groups.

The issue's own criteria: a `partsOf`-like function gives a part per table-level triangle for a mini from several files and for the shells of one file, with tests on generated minis; the view hides and shows parts, a hidden part is neither drawn nor painted and the surface behind it can be painted (e2e); hiding is not a step; the frame-rate criterion of #127 holds.

## 2. The decision in one paragraph

A **group map**: one byte per triangle of the table level naming the group it is in, groups numbered from 0, group 0 being the body (the whole mini when nothing splits it), at most `MAX_GROUPS` _(proposal: 64)_. `groupsOf(table, about)` in the pipeline makes the automatic map from what a conversion knows: the base from the fill's ready regions, the files by the part whose surface lies nearest each triangle's middle, and within each file its separate shells by the fill's own adjacency. The view draws the mini from **its own de-indexed geometry** (three vertices a triangle, a `group` attribute per vertex) so a group's edges are geometry edges with nothing to split or rebuild, and every vertex shader of the engine (the display material, the dab pass, the region pass, the depth map) reads one uniform array `uGroups[MAX_GROUPS]` of each group's offset and hidden flag: a hidden triangle's vertices are put outside clip space, so it is rasterised nowhere, and it takes no paint because the stroke layer never covers it. Hiding and pulling apart are **view state**, not steps; a step that paints records which groups were hidden and apart when it was made, so its replay sets the same uniforms and gives the same bytes. Groups are **made by three new tools**, `group` (a brush whose covered triangles join the target group, measured on the GPU at the triangle's middle like the mask's cut), `group-fill` (a flood bounded by the mask, hidden and pulled-apart groups and the seed's own group) and `unmask-fill` (the mask fill's opposite, so a group can be unmasked in one tap), each one step of the history; keyframes hold the group map. The map goes in at `open` and comes out of `groups()`, as the mask does. Pulling groups apart is designed here (§9) and **proposed as a direct follow-up issue** _(proposal)_: hiding alone meets #139's criteria, and the apart record is fixed now so the follow-up changes no data shape.

|                                 | De-indexed geometry, one draw per pass (chosen)           | Shared vertices split along group edges                          | One mesh per group, a draw each             |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| A group edit                    | three bytes of one attribute per triangle moved           | which vertices to split changes: positions, normals, uvs rebuilt | the index buffers of two groups rebuilt     |
| Draws a frame while painting    | as today: the mini once on screen, twice in texture space | as today                                                         | × the number of groups shown, in every pass |
| Geometry on the GPU (60 k tris) | about 6.8 MB (3 × the vertices)                           | 2–3 MB plus a few per cent at the edges                          | 2–3 MB plus an index per group              |
| Vertex work a frame on Iris Xe  | about 540 k vertex invocations, under a millisecond       | about a third of that                                            | as the split, plus the draw calls' overhead |

## 3. Data

```ts
// src/lib/pipeline/brush.ts (no DOM, no three.js)

/** Groups a mini may have, group 0 included (#139). _(proposal)_ */
export const MAX_GROUPS = 64;

/** How a group came to be: for a panel's words (`describeGroup`) and for a consumer that keeps names of its own. */
export type GroupOrigin =
  | { by: 'body' }                       // group 0: the body's file, or the whole mini
  | { by: 'part'; file: number }         // another file of the figure (`PartResult.file`)
  | { by: 'base' }                       // the base: the fill's ready region, or the base file
  | { by: 'shell'; of: number }          // a separate shell split from group `of`
  | { by: 'hand' };                      // made in the view with the group tools

/**
 * The groups as data (#139): a byte a triangle of the table level, the group it is in; group 0 always
 * exists. Kept by the consumer beside the paint and the mask, so painting continues later with the
 * same groups. Indices are stable while a mini is open: a group all of whose triangles were moved
 * away stays in `made`, empty.
 */
export interface PaintGroups {
  of: Uint8Array;
  made: GroupOrigin[];
}

export const TOOL_IDS = [
  'flat', 'fill', 'eraser', 'lift', 'wash', 'ink', 'dry', 'airbrush',
  'mask', 'unmask', 'mask-fill', 'unmask-fill',
  'group', 'group-fill',
] as const;
/** The tools that change the mask (#138; `unmask-fill` since #139). */
export const MASK_TOOL_IDS = ['mask', 'unmask', 'mask-fill', 'unmask-fill'] as const;
/** The tools that change the groups, not the paint (#139). */
export const GROUP_TOOL_IDS = ['group', 'group-fill'] as const;
/** The tools a tap fills with. */
export const FILL_TOOL_IDS = ['fill', 'mask-fill', 'unmask-fill', 'group-fill'] as const;
export const isGroupTool = (tool: ToolId): tool is GroupToolId => …;

/** Which groups were hidden and pulled apart when a step was made (#139): what its replay sets. */
export interface StepGroups {
  hidden: number[];
  apart: { group: number; offset: Vec3 }[];
}

export interface PaintStroke {
  // … as before
  /** A `group` stroke's target (#139): the group its covered triangles go into; `made.length` at the time made a new one. */
  into?: number;
  /** The groups hidden and apart at the stroke (#139); left out when none was. */
  groups?: StepGroups;
}

export type FillSeed =
  | { kind: 'picked'; triangle: number; point: Vec3 }
  | { kind: 'base' } | { kind: 'figure' }
  | { kind: 'group'; group: number };      // a group as a ready region (#139)

export interface PaintFill {
  // … as before; `tool` may be `unmask-fill` or `group-fill`
  into?: number;
  groups?: StepGroups;
}
```

- **A partition, not a list of sets.** Hide, mask, fill and pull apart all act on "the triangles of group k"; one byte a triangle answers that and keeps every triangle in exactly one group. Making a group takes its triangles from whichever group they were in: with the arm pulled apart, masking the wrist and group-filling the arm makes an arm-without-hand group, as the PM's example says. Nested groups (a hand inside an arm) are not modelled: a subgroup is made from a group's triangles, and the group keeps the rest.
- **Group 0 is the body**, always present: it is the one that stays in place when groups are pulled apart (§9), as the body does at the parts question. It can be hidden and masked like any other. Nothing can be removed from the list: a group whose triangles were all moved elsewhere stays, empty, so a consumer's names and a step's `into` keep their indices.
- **`into` is the target**, chosen in the view (`setGroupTarget`); `made.length` as the target makes a new group at the step's commit. The index a replay sees equals the index recorded, because the steps replay in order from a keyframe that holds the map.
- **`groups` on a step** is recorded only when something was hidden or apart, so every record made with every group shown is byte for byte today's. `MaskChange` steps record nothing: clear and invert work on the whole mask, hidden texels included.
- **The dabs of a stroke stay four numbers in the coordinates the mini is drawn in** (its own, while nothing is apart). §9 says why that holds for pulled-apart groups too.
- `recentColours` leaves the group steps and `unmask-fill` out, as it does the mask's. `toolMask` of the three new tools is 1.

## 4. The automatic groups: `groupsOf`

```ts
// src/lib/pipeline/groups.ts (no DOM, no three.js)
/** A separate shell smaller than this joins its file's largest shell instead of becoming a group. _(proposal)_ */
export const SHELL_MIN_TRIANGLES = 100;

export interface GroupSources {
  /** The fill's ready regions (`regionsOf`): where given, the base's triangles are the base group. */
  regions?: PaintRegions | null;
  /** The full-detail mesh, the figure's triangles first: `result.mesh`. */
  source?: IndexedMesh;
  /** The figure's parts in the merged mesh, body first (`result.pair?.parts`): their triangle counts give each file's range. */
  parts?: readonly PartResult[];
  /** How many of `source`'s triangles are the figure's (`result.pair?.figureTriangles`); the rest is the base file's. */
  figureTriangles?: number;
}

export function groupsOf(table: IndexedMesh, about: GroupSources): PaintGroups;
```

In order, each rule working on the triangles the rules before it left in group 0:

1. **The base.** With `regions`, every triangle of `regions.base` is the base group (`{ by: 'base' }`). Without regions but with a `source` whose `figureTriangles` leave a base part, the base's triangles are found by rule 2 and get the same origin. The fill's "the base" and the base group are then the same triangles.
2. **The files.** With `source` and `parts` of more than one part: one search tree over the whole source, and each remaining table triangle goes to the part under the **closest point to its middle** that faces its way (`MIN_NORMAL_AGREEMENT`, the bake's), the part read from the hit triangle's range (`PartResult.triangles` in order: body, then the parts in file order; the base file after `figureTriangles`). The body's part is group 0 (`{ by: 'body' }`), every other part a group `{ by: 'part', file }` in `parts` order. A middle that finds no surface within `REGION_REACH_MM` facing its way is tried again without the facing test, and stays in group 0 if that fails too (it should not: the levels stay within 0.2 mm of the sculpt). _(proposal: the middle rather than `regionsOf`'s three corners, so one query decides a triangle without ties, as the mask's cut already judges a triangle by its middle.)_
3. **The shells.** For every group so far, its triangles in connected pieces by the fill's adjacency (`triangleAdjacency`, edges matched by position across the unwrap's seams), as `pieces` in `contact.ts` does over vertices. The largest piece keeps the group; every other piece of at least `SHELL_MIN_TRIANGLES` triangles becomes a group `{ by: 'shell', of }`, largest first; smaller pieces stay with the group. When the groups would exceed `MAX_GROUPS`, the smallest shells stay with their group until they fit.

Without `source`, `parts` and `regions` (a single file, no base found) rule 3 alone runs: a sculpt fused into one shell is one group; the generated figure (`generateFigure`, overlapping closed parts) is body, head and two arms. The function is pure and Node-tested; the consumer calls it after a conversion with what it has (`groupsOf(result.baked.mesh, { regions, source: result.mesh, parts: result.pair?.parts, figureTriangles: result.pair?.figureTriangles })`) and keeps the bytes with the mini, or makes them again from a stored table level with its regions (rule 1 and 3 need no full mesh). `regionsOf` is unchanged, bit for bit.

## 5. The view's geometry and the passes

### 5.1 De-indexed geometry with a group attribute

`createGroupedGeometry(mesh, groups)` in `src/lib/painting/geometry.ts`: three vertices per triangle (positions, normals, uvs, occlusion copied from the table level), and a `group` attribute (`Uint8Array`, one byte a vertex, not normalised) from the map. Triangle `t` is vertices `3t, 3t + 1, 3t + 2`, so the edge index of §5.1 of the engine's note is `(3t, 3t+1, 3t+1, 3t+2, 3t+2, 3t)`, a fill's region is the triangles' own vertices (`drawRegion` builds its index from `t` alone), the cut's points and `texelOf` are unchanged (they read the table level). The display mesh and every texture-space pass draw this geometry; the search tree, the adjacency, the regions and the cut stay over the table level, whose triangle numbering is the same. A group edit writes the three bytes of each moved triangle and sets `needsUpdate` on the attribute: no topology changes while a mini is open.

### 5.2 One uniform array in every vertex shader

`uGroups[MAX_GROUPS]`, a `vec4` a group: `xyz` its offset in mm (0 until §9), `w` 1 where hidden. Each vertex shader reads `vec4 g = uGroups[int(group + 0.5)]`, adds `g.xyz` to the position it transforms and projects, and when `g.w > 0.5` puts the vertex at one point outside clip space (`gl_Position = vec4(2.0, 2.0, 2.0, 1.0)`), so the triangle has no area and no fragment:

- **The display material**: `BakedMaterialOptions.groups?: { uniform: { value: THREE.Vector4[] } }` adds the attribute, the uniform and the two lines to the vertex shader through `onBeforeCompile`, and the group tint of §7 to the fragment shader. Without the option the material is today's, program and all (a fourth program cache key, `-grouped`). The table's own materials never pass it.
- **The texture-space passes** (dab, region): `vPosition` carries the **offset** position, so the dab's distance, the depth-map projection and the brush's depth cut (#134) see the surface where it is drawn.
- **The depth map** (`DEPTH_VERTEX`): the offset position projected; hidden vertices out. A hidden group leaves no depth, so the surface behind it is in sight.
- **The atlas pass** draws the same geometry through the same shader, once at `open`, when nothing is hidden and nothing is apart (both are view state and start at none), so the atlas and the owner map cover the whole table level whatever is hidden later. **The cut's points** have no group logic: the cut and the cover read (§6.1) are over every triangle.

A fragment of a hidden triangle is never produced, so the stroke layer never covers its texels and no composite changes them: "takes no paint" holds for every tool, the fill and the mask's tools included, with nothing added to the composite. The owner map still lets a gutter texel copy a hidden island's paint, which is unchanged: no seam moves.

### 5.3 What the view keeps per mini

`Opened` gains the group map (`Uint8Array`, the live truth), the `GroupOrigin[]`, the uniform array, and the per-triangle `cover` read (§6.1). `Keyframe` gains `groups: Uint8Array` (a copy of the map, 60 KB on a 60 k-triangle level; the GPU targets are unchanged). `snapshot` copies it, `restore` writes it back into the attribute and the state. The search tree is one, over the table level; `TriangleBvh.raycast` gains an optional `accept?: (triangle: number) => boolean` (Node-tested in `bvh.test.ts`), with which `hitAt` skips hidden triangles, so a tap or a stroke never lands on a hidden group and the cursor ring hides over one.

### 5.4 The record and the replay

`beginLive` and a fill record `groups: { hidden, apart }` from the view's state when either is non-empty. `replay` sets `uGroups` from the step's record (all shown and at zero when the step has none), runs the step as today, and puts the view's current state back before the next frame. So a stroke made with the shield hidden replays to the same bytes with the shield shown, and the e2e of §11 step 5 proves it. A fill's flood (§6.2) reads the same record for its bounds.

## 6. The group tools and the per-group actions

### 6.1 The group brush

`group` is a stroke tool: `blend: 'max'`, a composite `'group'` that draws nothing onto the paint or the mask (the composite pass is skipped; `live` stays the paint), `mask: 1`, the brush's size, hardness and opacity. The stroke layer takes its coverage as for every brush, with the stroke's depth map and facing test, so a group stroke marks what the brush would have painted: in sight, facing, within `BRUSH_DEPTH_MM`. At the commit the view reads **which triangles the stroke covers at their middle**: the cut's points (§5 of the mask's note) drawn with a material that reads `stroke` instead of `mask`, 1 where the coverage is at least `GROUP_COVER` _(proposal: 0.5, as `MASK_CUT`)_, read back synchronously into a byte a triangle (`PaintPasses.readCover`). Those triangles go into `into`; the attribute is updated; `state.groups` is replaced. A replayed group stroke draws all its dabs at once and reads the same bytes: the coverage is deterministic, as #127 proved for the paint.

The mask does not protect a triangle from the group tools _(proposal)_: the mask is a paint protection and the group fill's cut, and a group brush over a masked wrist must be able to take it.

### 6.2 The group fill and the fills' bounds

`fillRegion` (pipeline, Node-tested) gains two options beside `cut`: `hidden?: Uint8Array | null` (a byte a triangle, non-zero where the triangle's group is hidden) and `apart?: Uint8Array | null` (the triangle's offset class: 0 for a group at zero, k for the k-th distinct offset), and `within?: number | null` with `groupOf?: Uint8Array` (the group a picked flood may not leave). An edge is a bound for **every picked flood** when the triangle across it is hidden or cut, or has another offset class; for the **group fill** also when it is in another group than the seed's, and the fold and crease bounds of §7.1 do not apply to it (`tolerance` is unused) _(proposal, as the PM's words: it floods connected triangles and stops at what is disconnected)_. A `group` seed takes the group's triangles, no flood, as `base` and `figure` do.

`group-fill` with a picked seed: the flood from the triangle under the tap, bounded as above, into `into`. The PM's case: a band of mask around the wrist, a tap on the hand in group 0: the flood fills the hand up to the band and stops at the body's other groups; the hand is a new group, the band stays in group 0 with the arm.

### 6.3 Per group

```ts
interface PaintingView {
  // … as before
  /** The groups as data (#139): the map and how each group was made. Synchronous: the map is CPU data. */
  groups(): PaintGroups;
  /** Draws group `group` or not; a hidden group takes no paint. Not a step. */
  setGroupShown(group: number, shown: boolean): void;
  showAllGroups(): void;
  /** The group the group tools add to; `'new'` makes a new one at the next group step. */
  setGroupTarget(group: number | 'new'): void;
  /** A paint fill of the group's triangles: one `fill` step with a `group` seed. */
  fillGroup(group: number): Promise<void>;
  /** The group's triangles masked or unmasked: one `mask-fill` or `unmask-fill` step with a `group` seed. */
  maskGroup(group: number, masked: boolean): Promise<void>;
  /** Draws every group but 0 in its colour (§7), or not. Not a step. */
  setGroupTint(on: boolean): void;
}

interface PaintingState {
  // … as before
  groups: {
    /** Groups 0 … n − 1: how each was made and how many triangles it has now. */
    list: { origin: GroupOrigin; triangles: number }[];
    hidden: number[];
    apart: { group: number; offset: Vec3 }[];
    /** The group the group tools add to; `list.length` for a new one. */
    target: number;
  };
  groupTint: boolean;
}

interface MiniToPaint {
  // … as before
  /** The groups to continue with (#139), as `groups()` gave them, or `groupsOf(...)`; left out or null: the whole mini is group 0. */
  groups?: PaintGroups | null;
}
```

`open` refuses a map whose length is not the triangle count, that names a group `made` does not have, or with more than `MAX_GROUPS` groups, with a `RangeError`. Every method commits the live stroke first, as every method does. `setGroupShown` and `showAllGroups` change the uniform and the state, leave the history alone (`steps` and `undone` unchanged, no keyframe) and resolve nothing: they are synchronous, like `setMaskShown`. `unmask-fill` composites as `unmask` does (the mask taken away by the coverage), so `maskGroup(k, false)` and a tap with it are the mask fill's opposite.

## 7. What the view shows and says

- **The group tint**, off at mount _(proposal: `GROUP_TINT_SHOWN = false`; the `?dev` tool turns it on while a group tool is chosen)_: the display material mixes, after the look and the mask's tint, `GROUP_COLOURS[group % GROUP_COLOURS.length]` into every fragment of a group other than 0 by `GROUP_TINT_STRENGTH` _(proposals: eight colours in `src/lib/three/scene-colours.ts` beside `PAIR_COLOURS`, starting with those four; 0.35)_. The fragment reads the group from a `flat` varying of the attribute. While a `group` stroke is on the canvas the material also tints the stroke layer's coverage in the target's colour (a sampler on `stroke`, its strength 0 otherwise), so the person sees what the brush is taking before the commit snaps it to whole triangles.
- **Words** _(proposals)_: `PAINT_COPY.tools` and `toolHints` for `unmask-fill` ("Unmask fill": "Takes the mask away from the surface you tap, up to a fold, a crease or the edge of the mask."), `group` ("Group brush": "Marks the triangles it covers as part of the chosen group. Hide a group to paint what lies behind it.") and `group-fill` ("Group fill": "Marks the connected surface you tap, up to the mask, a hidden or pulled-apart group, or the edge of the group you tap in. Mask a wrist, then tap the hand."); and `PAINT_COPY.groups`: `label` "Groups", `body` "The body", `part` "Part", `base` "The base", `shell` "Shell", `hand` "Group", `hide` "Hide", `show` "Show", `showAll` "Show all", `tint` "Show groups", `newGroup` "New group", `into` "Add to", `fill` "Fill the group", `mask` "Mask the group", `unmask` "Unmask the group", `hint` "A hidden group is not drawn and takes no paint, so you can paint what lies behind it. Hiding is not a step: Show brings it back, not Undo." `describeGroup(origin, index, fileName?)` in `copy.ts` gives a group's name from its origin ("The body", "Part 2", or the file's name when the consumer gives one, "The base", "Shell 2 of the body", "Group 5"), with a Node test (`src/lib/painting/copy.test.ts`, new, on the pattern of the questions' `copy.test.ts`).
- **The `?dev` Paint tool** (`src/page/paint-tool.ts`, `index.html` under `data-dev`): the three tools come from `TOOL_IDS` as the others; a Groups row with a list of the groups (a checkbox per group, checked while shown, labelled by `describeGroup` with the page's file names), Show all, Show groups, the target select (every group and New group), Fill the group, Mask the group, Unmask the group. The page makes the map in `miniForPainting` with `groupsOf` from what it keeps (`state.stats.pair?.parts`, `figureTriangles`, the regions it already makes) and passes it at `open`. The hooks stay `window.__mt.painting.view()`.

## 8. Where the code goes

- **`src/lib/pipeline/brush.ts`**: §3's shapes and constants, `recentColours`, `toolMask`. **`src/lib/pipeline/groups.ts`** (new): `groupsOf`, `SHELL_MIN_TRIANGLES`, with `groups.test.ts`. **`src/lib/pipeline/fill.ts`**: the bounds of §6.2. **`src/lib/pipeline/bvh.ts`**: `raycast`'s `accept`.
- **`src/lib/painting/geometry.ts`** (new): `createGroupedGeometry`, the attribute's update from a map. **`src/lib/painting/passes.ts`**: the grouped vertex shaders and `uGroups`, `readCover`, the keyframe's map. **`src/lib/painting/tools.ts`**: the three rows. **`src/lib/painting/mount.ts`**: the state, the methods, the record on each step, the replay's uniforms. **`src/lib/painting/copy.ts`**: §7. **`src/lib/three/baked-material.ts`**: the `groups` option. **`src/lib/three/scene-colours.ts`**: `GROUP_COLOURS`.
- **`src/lib/index.ts`**: `groupsOf`, `SHELL_MIN_TRIANGLES`, `MAX_GROUPS`, `GROUP_TOOL_IDS`, `isGroupTool`, the types `PaintGroups`, `GroupOrigin`, `StepGroups`, `GroupSources`. **`src/lib/painting.ts`**: `GROUP_COVER`, `GROUP_TINT_SHOWN`, `GROUP_COLOURS`, `GROUP_TINT_STRENGTH`, `describeGroup`. `index.test.ts` pins both lists.
- **`src/page/paint-tool.ts`**, `index.html`, `src/page/main.ts` (`miniForPainting`). **`scripts/measure-painting.mjs`**: a group hidden before the strokes, and a `group` run. **`README.md`** ("Use it as a library": groups, the three tools, the hide methods, `groupsOf` in the example; the memory table: the geometry's size, the map per keyframe), **`CLAUDE.md`** (the intro since #139, the painting paragraph, the library and the Paint tool), the journal entry.

Nothing in `src/lib/pipeline/run.ts`, the worker or `glb.ts` changes; the regression baseline cannot move.

## 9. Pulling groups apart (designed here, built in a direct follow-up)

_(proposal)_ The PM left it to this issue or a direct follow-up. Hiding meets every criterion of #139; pulling apart touches the depth map, the dabs, every flood and the camera's framing, and the painting spec is already the CI's largest cost. So the builder files the follow-up issue (`type:task`, `area:pipeline`, this note's §9 as its brief) and builds it on its own branch once #139 is merged, unless the PM says on the PR to build it here. What the follow-up builds, so that nothing of §3 changes:

- **The offsets**: `groupsApart(mesh, groups)` in `groups.ts`, the `pulledApart` rule of `assemble.ts` over groups instead of files (the box of each group's triangles; group 0 stays; each other group moves along the line from group 0's middle to its own by `APART_SHARE` of group 0's largest side, at least `APART_MIN_GAP_MM`, further while it lands on a group moved before it). `pullApart(group, offset: Vec3 | null)` sets one group's offset by hand or puts it back, `pullAllApart()` applies the rule, `putTogether()` clears every offset. View state in `state.groups.apart`, not steps.
- **The passes** already read `uGroups[].xyz` (§5.2): the display, the depth map and the dab pass draw each group where it is. The scene frames the box of the groups as drawn.
- **The dabs stay in the coordinates the mini is drawn in.** A hit on a pulled-apart group is recorded as drawn, and the dab pass compares drawn positions (`vPosition` carries the offset) with the dab: a texel of the group the dab was on is as far from the dab as it would be with nothing apart, so the paint lands where it belongs; a texel of a neighbouring group in the mini's own coordinates lies far away as drawn and takes nothing, which is the PM's "a dab on a pulled-apart group paints only that group". Two groups pulled apart to lie side by side on screen both take a brush that crosses them, as two separate objects on a table would. The step's `groups.apart` makes the replay render the same depth map and draw the same distances. The PM's note put the dab back into the mini's own coordinates; that would need the dab's group in the record (a fifth number a dab, or a parallel array) for the shader to add the offset back, for the same bytes. The four-number dab and the recorded offsets give the same result and keep `spaceDabs` and the record as they are; the PM confirms on the follow-up's PR. A hit on another group than the last hit's lifts the brush, as a miss does: no dabs are laid across a gap between groups.
- **The casts**: `hitAt` casts once per distinct offset with the ray moved by the opposite offset and `accept` restricted to that offset class, and takes the nearest hit; `texelAt` gives the point in the mini's own coordinates.
- **The floods** take the `apart` bound of §6.2, which this build already honours (every class is 0 until then).

## 10. Budget

| Added while a mini is open                          | Bytes on a 60 k-triangle level  |
| --------------------------------------------------- | ------------------------------- |
| the de-indexed geometry in place of the indexed one | about 6.8 MB in place of 2–3 MB |
| the `group` attribute                               | 180 KB                          |
| the group map, live and in each keyframe (CPU)      | 60 KB each                      |
| the cover read's target                             | shared with the cut's           |
| `uGroups`                                           | 64 vec4                         |

A frame while painting has the same draws as today; each vertex shader does one more attribute read and one uniform lookup. A group stroke's commit adds one synchronous read-back of a few hundred kilobytes (as a picked fill's cut), not per frame. The frame counter and `scripts/measure-painting.mjs` say whether the criterion of #127 (30 fps or better at the largest brush) holds with a group hidden and with the group brush; the README's table gets the geometry's row.

## 11. Build order and proof

Each step a commit with its tests, `npm run check` green after each; the e2e of a step with the step.

1. **Data.** `brush.ts`: the tools, `MAX_GROUPS`, `PaintGroups`, `GroupOrigin`, `StepGroups`, `into`, the `group` seed, `recentColours`, `toolMask`; `tools.ts`: the three rows; `copy.ts`: the words and `describeGroup`; `index.ts`'s lists. Node tests: `recentColours` leaves the new steps out; `toolMask` is 1 for the three; `describeGroup` for every origin; `tools.test.ts` runs the three masks.
2. **`groupsOf`.** `groups.ts` with `groups.test.ts`: the winged figure as three files with a base (`generateWingedFigure`, converted in Node as `run.test.ts`'s kit is, with its regions) gives body, two parts, the base, and every table triangle's group is the file nearest its middle (checked against a tree over each file's range); the puddle figure with the recess base as a pair gives a base group equal to its regions, triangle for triangle; `generateFigure(false)` gives group 0 and three shells, every triangle of each shell connected to the others of its shell by the adjacency and to none of another; a shell under `SHELL_MIN_TRIANGLES` stays (a figure with a dozen-triangle fleck added); a single fused shell gives one group; a mini of more shells than `MAX_GROUPS` (the swarm's twelve on one base, with the cap set low in the test through an option) keeps the largest. `regionsOf`'s tests are unchanged.
3. **The fill's bounds and the cast's filter.** `fill.ts`: `hidden`, `apart`, `within` with `groupOf`; `fill.test.ts`: a flood never enters a hidden triangle, never crosses an offset class, and with `within` never leaves the seed's group while the fold and crease bounds are off; `bvh.test.ts`: `accept` skips the nearer triangle and finds the one behind.
4. **Geometry and passes.** `geometry.ts`; the grouped vertex shaders and `uGroups` in `passes.ts` and the `groups` option of the material; `readCover`; the keyframe's map; `mount.ts`: `groups` at `open`, `groups()`, `setGroupShown`, `showAllGroups`, `setGroupTarget`, `setGroupTint`, the state, the record on each step and the replay's uniforms. E2e on the generated figure (the shared `figurePage`; its shells are the groups): **hidden is not drawn**: with an arm hidden, `texelAt` over the arm gives a body triangle and `colourAt('shown')` there is the body's colour, not the primer at the arm's distance; **hidden takes no paint and what lies behind does**: a 16 mm stroke across the hidden arm paints the body's texels behind it (bare before, alpha 1 after) and leaves every texel of the arm at its bytes, checked after `showAllGroups`; **not a step**: hide and show leave `steps`, `undone` and the paint's bytes as they were, and an undo after a hide does not show the group; **the record**: the stroke made with the arm hidden has `groups.hidden` `[arm]`, undo and redo with the arm shown give the same bytes; a stroke with every group shown has no `groups` field; **in and out**: `groups()` gives the map `open` was given, and a map that is not the mesh's is refused.
5. **The group tools.** The three tools in `beginLive`, the fill tap and `replay`; `fillGroup`, `maskGroup`. E2e: a `group` stroke over the head with the target `'new'` puts into a new group exactly the triangles whose middle the stroke covers (compared with a flat stroke of the same path read back through `texelAt` at the triangles' middles), one step, undo takes the group away and redo brings the same map; a band of mask around the body at 10 mm (the #138 test's band) and a `group-fill` tap above it make a group of the body above the band and nothing of the body below or of the other shells; a `group-fill` tap inside that group with the target 0 moves the whole group back; `fillGroup(head)` paints the head's texels and no other; `maskGroup(head, true)` keeps the head's bytes under a wash of the whole figure, `maskGroup(head, false)` lets it through again; each is one step.
6. **The `?dev` tool** and the page's `groupsOf`; the accessibility and keyboard specs reach the new controls (they run over the Paint tool already).
7. **Numbers.** `scripts/measure-painting.mjs`: a group hidden before the strokes and a `group` run at 16 mm; the development PC and, if at hand, the reference laptop: median and worst frame, `slow`, the GPU process's memory against #138's figures. The criterion is #127's.
8. **Docs and journal.** README, `CLAUDE.md`, this note's "as built" lines where the build differed, `docs/journal/2026-10-<dd>-paint-groups.md` (topics `ui`, `textures`, `testing`, `performance`): why a partition and de-indexed geometry, how a hidden group takes no paint without a composite change, why hiding is recorded on steps though it is not one, every number with its device, what went wrong. The follow-up issue for §9 filed, with its number in "Still open".

## 12. How each criterion is proven

| Criterion (issue #139, and the PM's decisions)                                                                          | Proof                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A part per table-level triangle for a mini from several files and for the shells of one file, tested on generated minis | `groupsOf` (§4), step 2's Node tests                                      |
| The view hides and shows parts; a hidden part is neither drawn nor painted; the surface behind it can be painted (e2e)  | §5.2, step 4's e2e                                                        |
| Undo and redo unaffected by hiding; hiding is not a step                                                                | §6.3, step 4's "not a step" and "the record" tests                        |
| The frame-rate criterion of #127 holds                                                                                  | step 7's numbers in the PR                                                |
| Groups by hand: the group brush and the group fill, bounded by the mask, pulled-apart groups and the seed's group       | §6.1, §6.2, step 5's e2e                                                  |
| Mask and unmask per group                                                                                               | `maskGroup`, `unmask-fill`, step 5                                        |
| Groups kept with the mini                                                                                               | `PaintGroups` in and out (§3, §6.3), step 4's "in and out" test           |
| Pull groups apart                                                                                                       | §9: designed, the record fixed; built in the follow-up issue _(proposal)_ |

## 13. When to stop and ask

- **The PM wants pulling apart in this PR** (§9): build it after step 5 on the same branch, with its own e2e (two groups apart, a stroke across the gap paints only the group it is on, undo and redo the same bytes) and its numbers; the note's §9 stands as the design.
- **The group fill should stop at folds and creases too**, or the mask should protect from the group tools (§6): both are one option each; ask before adding either.
- **A sculpt's table level has far more shells than expected** (hundreds of pieces over `SHELL_MIN_TRIANGLES` on a corpus mini) or the file rule puts a visible band of one part's triangles on another at a junction: report the mini's kind, the counts and a picture; the constants are the PM's.
- **The de-indexed geometry misses the frame budget on the laptop** (step 7): the alternative is the split geometry of §2's table, rebuilt per group edit; ask before switching, with the numbers.
- **A GPU gives different bytes for `readCover` live and on replay** (step 5's undo and redo differ): find which pass is not deterministic there, as #127's §15 says for the paint; the group map on replay must equal the live one.
- **The uniform array does not fit** beside a material's own uniforms on a device (`MAX_VERTEX_UNIFORM_VECTORS` is at least 256 in WebGL 2; the display material uses many): move the per-group data into a 64 × 1 `DataTexture` read in the vertex shader (vertex texture fetch is given in WebGL 2); the shape of the data does not change.
- **A decision of this note turns out wrong.** Record the PM's answer in this note with the date, nothing else.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 14. Out of this note

- **Pulling groups apart**: §9, the follow-up.
- **Names for groups**: the engine has no user text; a consumer keeps names by index (indices are stable, §3) and may pass a file's name to `describeGroup`.
- **Merging or deleting a group as one step**: a group fill into another target moves a connected group in one tap; a `GroupChange` step comes when a panel needs more.
- **Hiding as part of a saved view** (which groups a person had hidden when the paint was saved): view state; a consumer that wants it keeps `state.groups.hidden` itself.
- **Groups on the table**: the table draws the table level with the paint; whether it ever hides a group is the table's product decision. The groups' data is in the record for when it does.
- **A smarter automatic split of a fused sculpt** (by cavity, by the mask alone): the group fill with the mask is the PM's chosen way; nothing here guesses parts of one shell.

## 15. As built (Opus 5.5, 2026-10-19, PR #179)

Where the build differs from the note above, and why:

- **Group order.** The automatic groups are numbered body, the other files in `parts` order, the base, then the shells, with or without regions, so a mini's indices do not depend on whether the consumer had regions. With regions, rule 2 matches the remaining triangles against the figure's files only (the base is the regions'). Without regions the middle rule gives a figure's puddle standing in a base's recess to the figure's file, where `regionsOf`'s three-corner rule counts it as the base (the recess base pair: 93 % of the regions' base is the base group, the rest is the puddle's top).
- **`describeGroup(made, index, fileNames?, copy?)`**, not `(origin, index, fileName?)`: "Shell 2 of the body" needs the other shells of the same group to number one.
- **`fillRegion`'s `folds: false`** turns off the fold and crease bounds for the group fill (§6.2 says they do not apply to it); `within` is the seed's group as the view reads it at the step's replay.
- **A group stroke that covers no triangle leaves no step** and makes no group, as an empty stroke leaves none; a group fill that floods nothing is a step that changes nothing and makes no group.
- **Undo of a step that made a group takes the group away again**: keyframes hold `made` as well as the map, so undo and redo give back the same indices. A group emptied by later steps still stays (§3).
- **`GROUP_STROKE_TINT_STRENGTH`** _(proposal: 0.5)_: how much of the target's colour a group stroke's coverage shows before its commit (§7 named no strength).
- **The `?dev` tool** shows the group brush's size and hardness only (its opacity changes nothing it reads); Fill, Mask and Unmask the group act on the target and are off while the target is New group.
- **`THREE.Vector4()` is `(0, 0, 0, 1)`**: the group stroke's tint and `uGroups` start from `(0, 0, 0, 0)`; with the default the tint mixed black over every covered texel and every group started hidden (journal).

## 16. As built: pulling groups apart (Fable 5.1, 2026-10-19, #180)

§9 built on its own branch, quietly (`/implement-quiet`; the PM told it to go on without the `ready-for-agent` label, 2026-10-19). Where the build differs from §9, and why:

- **One rule, two callers.** The apart rule of `pulledApart` is lifted into `apartTranslations(boxes)` in `assemble.ts`, over boxes, the body's first; `pulledApart` and `groupsApart` both call it, and `groupsApart` on the winged figure's three files as one mesh gives `pulledApart`'s translations bit for bit (`groups.test.ts`). `groupsApart` lists only the groups the rule moves: a group already clear of the body's box, or without a triangle, is not in the list, as its part stays at zero at the parts question. `groupsApart(mesh, groups, only)` moves only the groups named, in that order, for the `?dev` tool's box a group.
- **The brush lifts at a change of offset, not of group.** §9 says a hit on another group than the last hit's lifts the brush. Taken by group, a stroke from the body onto the head, both at zero, would lift and leave the spacing's gap between two groups that touch, and a stroke made with nothing apart would no longer be the one before #180. The view lifts when the hit's group is drawn at another offset than the last hit's (its offset class, the `apart` class the floods use): with nothing apart every hit is in one class and nothing changes; across a gap between groups pulled apart no dab is laid. _(proposal)_
- **A zero offset puts a group back.** `pullApart(group, [0, 0, 0])` is `pullApart(group, null)`: a group at zero is never in `state.groups.apart` nor in a step's record, so an offset class is never a zero one.
- **The camera keeps its angles.** `PaintScene.reframe(box)` frames the box of the groups as drawn with the camera's current azimuth, elevation and zoom; the sphere the camera sits on moves by the change from the mini's own box to the drawn one, so with nothing apart the camera is bit for bit where it was.
- **`texelAt` gives the point in the mini's own coordinates; `stroke`, `screenOf` and the dabs are in the coordinates the mini is drawn in.** A test that strokes along a pulled-apart group adds the offset itself, or strokes along the canvas.
- **The dabs stay four numbers with the recorded offsets** (§9's proposal): the PM confirms on this PR. The record of a stroke made with groups apart carries every offset; a stroke made with nothing apart and nothing hidden has no `groups` field, as before.
- **Words** _(proposals)_: `PAINT_COPY.groups.pullApart` "Pull apart", `putTogether` "Put together", `apart` "Apart" (the box a group), and `apartHint`.
