# Design: the painting engine as a library entry other code mounts (#126)

Status: design pass by Fable 5.1, 2026-10-13, for Opus 5.5 to build (#127, then #128) · Issues: #126 (this note), #127 (flat brush, fill, eraser, undo, the paint as pixels, the mount), #128 (wash, ink, dry brush, airbrush) · Needed by the table application (Phase 2); not part of the Phase 1 epic · Builds on: `docs/design/library-api.md` (#50), `docs/design/questions-view.md` (#119), the #125 journal entry (`docs/journal/2026-10-12-paint-under-the-look.md`)

This note fixes the decisions the build should not have to make: how a stroke lands in the texture atlas, what a stroke is as data, what each brush reads and writes, how the paint goes in and out, what the entry mounts and what the consumer draws itself, what the engine holds on the GPU and what a frame may cost, the module boundaries, the interface the consumer calls, the build order with the test that proves each step, and where to stop and ask. Every number and name marked _(proposal)_ is the PM's to change. Whoever builds this changes the code, not this note, unless a decision here turns out wrong; then stop and ask (§15). Nothing of the consumer's product is here: not where a paint is stored, not who sees it, not its plans. The engine takes pixels and gives pixels back.

## 1. What exists and what the table needs

Since #125 a baked mini is drawn with a colour texture under its look: `createBakedMaterial(texture, uniforms, { map })` mixes the paint over the base coat by its alpha, and the wash and the edges work on top. The paint is an `Albedo` (`src/lib/pipeline/paint.ts`): RGBA bytes, sRGB colour, straight alpha, row 0 at v = 0, on the table level's texture coordinates (`result.baked.mesh`). The far and close levels take it per vertex (`paintAtVertices`), the thumbnail takes it as `albedo`. What is missing is the thing that makes the paint: a view in which a person paints on the 3D mini and the strokes become texels.

What the engine can read from a baked mini, all of it already on the GPU or one upload away:

| Signal                                            | Where                                                               | Used by                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Fine cavity, −1 crease … +1 edge                  | the detail texture's alpha, `(a − 0.5) × CAVITY_GAIN` (`look.ts`)   | the wash, the ink, the dry brush                                                  |
| Object-space normal                               | the detail texture's RGB, `n × 0.5 + 0.5`                           | the airbrush's direction mask                                                     |
| Coarse occlusion, 0 buried … 1 open               | the vertex attribute `occlusion` (`createBakedGeometry`)            | the wash                                                                          |
| Coarse cavity per vertex                          | `mesh.cavity`                                                       | the fill's crease bound (CPU)                                                     |
| The surface, its normals and texture coordinates  | `result.baked.mesh`: positions, normals, uvs, indices               | the ray from a finger to the surface, the texture-space passes, the fill, regions |
| Which triangles are the base and which the figure | `result.mesh` with `result.pair.figureTriangles` (a pair); `sizing` | the ready regions of the fill (§7.2)                                              |

Facts of the atlas that shape the design (unwrap.ts, bake.ts, the #125 journal entry): xatlas packs thousands of islands (1,000–8,800 on corpus minis) with `ISLAND_PADDING = 3` empty texels between them **at the detail texture's size** (512, 1024 or 2048 px, `detailResolutionFor`); the bake fills the gutters by copying border texels outward four rings deep so filtering never reads an empty texel; islands packed close together overwrite each other's spread when the rings are wider than half the gutter; mipmaps of a paint average neighbouring islands at the small levels, and the fix for that at the table is the same spreading. The table's reference device is the Intel Iris Xe laptop; the Phase 1 exit criterion was 100 baked minis at 30 fps there, met at the 60 fps cap. The question view (#119) showed what a second WebGL context costs on the page: about 40 MB in the GPU process.

## 2. The decision in one paragraph

A fifth entry, **`meshtavern-converter/painting`** (`src/lib/painting.ts`, the folder `src/lib/painting/`, the stylesheet `meshtavern-converter/painting.css`), exports **`mountPainting(options)`**. It mounts a canvas of its own into one element the consumer gives it, as the question view does, and nothing else but a brush cursor; every panel, slider, palette and button is the consumer's, wired to the view's methods. `open(mini)` takes the table level, its detail texture, the look, the paint to continue from (or none) and the ready regions, and refuses a mini without a detail texture. A stroke is projected into the atlas by **a texture-space render of the mesh**: once per frame the mesh is drawn with its texture coordinates as positions, each fragment tests whether its point on the surface was visible from the camera when the stroke began (a depth map rendered at the stroke's start, plus a facing test) and how far it lies from the frame's dabs, and writes its coverage into a stroke layer; a second pass composites the stroke's colour through the tool's mask (cavity, normal, occlusion) over the paint, and a third copies every island's border texels into the gutter so no seam shows. A stroke is data: the tool, its settings, the colour, the camera it was painted from and its dabs as points on the surface; a fill is its seed and its bounds. Undo and redo replay the steps from the nearest of a few keyframes, so the history costs a bounded number of textures and a replayed stroke is the stroke. The paint goes in and comes out as a 1,024 px `Albedo`, whatever the detail texture's size. The engine holds about 20 MB of render targets plus up to 24 MB of keyframes, and a frame while painting is three small passes and the draw of the mini.

|                                     | Texture-space render per frame (chosen)                                                                                                          | Per-dab projection, one draw per dab      | Screen-space painting, unprojected                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Draws per frame while painting      | 2 (the mesh as triangles and as its edges, §5.3) + 2 quad passes                                                                                 | 2 × dabs (16–64 a frame on a fast stroke) | 1 quad pass, then an atlas pass to move screen pixels to texels                                         |
| Texels behind the surface, far side | a depth map from the stroke's camera, one render at the stroke's start (§5.2)                                                                    | the same                                  | free (only what is on screen is painted) but the texel footprint of a pixel is a blob at grazing angles |
| Brush size                          | in mm on the surface, the same at every zoom                                                                                                     | the same                                  | in pixels; changes with the zoom                                                                        |
| Seams                               | the edge pass stamps every texel an island's border crosses; the dilation pass fills the gutter (§5.4)                                           | the same                                  | the same, plus holes where the atlas pass finds no pixel                                                |
| Cost on an integrated GPU           | the mesh twice (15–65 k triangles), about 0.5 M island fragments with a loop over the frame's dabs, two 1 M-fragment quad passes: a few ms (§11) | grows with the dabs                       | cheapest per frame, worst quality                                                                       |

## 3. The entry and the interface

```ts
// src/lib/painting.ts: the entry. Imports three.js (like three.ts and questions.ts).
export {
  mountPainting,
  type PaintingOptions,
  type PaintingView,
  type PaintingState,
  type MiniToPaint,
  type PaintPerf,
  BRUSH_MIN_MM,
  BRUSH_MAX_MM,
  DABS_PER_PASS,
  DEPTH_BIAS_MM,
  FACING_MIN_COS,
  PAINT_DILATION_RINGS,
  KEYFRAME_EVERY,
  UNDO_STEPS,
  CURSOR_MIN_PX,
  FRAME_BUDGET_MS,
} from './painting/mount';
export { PAINT_COPY, type PaintCopy } from './painting/copy';
```

`index.ts` (no three.js, §12) gains the data shapes and the CPU parts: `PAINT_SIZE`, `TOOL_IDS`, `DEFAULT_BRUSH`, `DAB_SPACING`, `spaceDabs`, `toolMask`, `fillRegion`, `regionsOf`, `FILL_ANGLE_DEG`, `FILL_CREASE_CAVITY`, `REGION_REACH_MM`, and the types `ToolId`, `BrushSettings`, `PaintStep`, `PaintStroke`, `PaintFill`, `StrokeCamera`, `FillSeed`, `PaintRegions`. `package.json` `exports` gains `"./painting"` and `"./painting.css"`; `index.test.ts` pins both lists.

### 3.1 Mounting and opening

```ts
export interface PaintingOptions {
  /** The view's canvas fills this element: give it a size. */
  scene: HTMLElement;
  /** Words to replace, field by field (§10.2). */
  copy?: Partial<PaintCopy>;
  /** Called after every change the view shows: a tool or setting changed, a step landed, undo, the perf counter at a stroke's end. */
  onChange?: (state: PaintingState) => void;
}

/** A baked mini as the consumer has it after `convert`, or later from what it stored. */
export interface MiniToPaint {
  /** The table level with texture coordinates, normals, cavity and occlusion: `result.baked.mesh`. */
  mesh: IndexedMesh;
  /** Its detail texture, transcoded (`transcodeDetail`) or uncompressed (`createDetailTexture`). Not disposed by the view. */
  texture: THREE.Texture;
  /** The look to draw with. DEFAULT_LOOK. */
  look?: Look;
  /** The paint to continue from, PAINT_SIZE square; left out or null: bare. */
  paint?: Albedo | null;
  /** The ready regions of the fill (§7.2): `regionsOf(...)`, kept by the consumer or made again. Left out: no ready regions. */
  regions?: PaintRegions | null;
}

export function mountPainting(options: PaintingOptions): PaintingView;
```

`mountPainting` puts a canvas and the cursor ring into `scene`, sets the class `mt-painting` on it, creates the renderer, camera, OrbitControls, grid and light (the question scene's, §10.3), compiles the pass programs once with a triangle without area (as #108 warms the question material), and draws nothing until `open`. One view per element; a second `mountPainting` on the same element throws. Several views in one document are fine: the view has no ids, unlike the question view.

`open(mini)` refuses, synchronously, with a `RangeError` whose message is `copy.cannotPaint`, a mesh without `uvs` or `normals` (no detail texture to paint on: a mini whose bake was skipped, or a level other than the table level), a `paint` that is not `PAINT_SIZE` square, and a `regions` whose length is not the mesh's triangle count. Otherwise it builds the search tree over the table level (`TriangleBvh`, 15–65 k triangles, tens of ms), uploads the paint, renders the atlas maps (§5.1), frames the mini (`setCamera(34, 22, 1)`), starts the loop and resolves once the first frame is drawn. `close()` releases everything of the mini (targets, keyframes, geometry, the tree) and stops the loop; the renderer stays for the next `open`. The paint is not read back by `close`: a consumer that wants it calls `paint()` first.

### 3.2 The view

```ts
export interface PaintingView {
  readonly state: PaintingState;
  open(mini: MiniToPaint): Promise<void>;
  close(): void;
  // The tool and its settings: what the consumer's panel sets.
  setTool(tool: ToolId): void;
  setBrush(changes: Partial<BrushSettings>): void;
  setColour(hex: string): void;
  setLook(look: Look): void;
  /** One finger or the left button orbit instead of painting, until switched off (§9). */
  setNavigating(on: boolean): void;
  // The fill's ready regions (§7.2); a tap with the fill tool fills the region under it.
  fillRegion(region: 'base' | 'figure'): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The paint as pixels: PAINT_SIZE square, sRGB, straight alpha, row 0 at v = 0. Resolves after the GPU read. */
  paint(): Promise<Albedo>;
  /** The steps applied so far, oldest first, as data the consumer may keep (§4). Undone steps are not in it. */
  history(): PaintStep[];
  // For tests and scripts: a stroke given as points on the surface, or as a path on the canvas (CSS px).
  stroke(points: Vec3[], pressure?: number[]): Promise<void>;
  strokeAt(path: [number, number][]): Promise<void>;
  /** The texel under a canvas point, or null off the mini: what a pixel test asserts on. */
  texelAt(x: number, y: number): { texel: [number, number]; point: Vec3; triangle: number } | null;
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void;
  setWireframe(on: boolean): void;
  dispose(): void;
}

export interface PaintingState {
  open: boolean;
  tool: ToolId;
  brush: BrushSettings;
  colour: string;
  navigating: boolean;
  /** Steps applied and steps undone (redo-able). */
  steps: number;
  undone: number;
  /** Which ready regions the mini has: both, or none. */
  regions: ('base' | 'figure')[];
  /** True while a stroke is on the canvas and not yet committed. */
  painting: boolean;
  /** The frame counter of the last stroke (§11.3). */
  perf: PaintPerf;
}

export interface PaintPerf {
  /** Frames drawn during the last stroke, the median and the worst frame time in ms, by `performance.now()` around the frame. */
  frames: number;
  medianMs: number;
  worstMs: number;
  /** Frames over FRAME_BUDGET_MS. */
  slow: number;
}
```

Decisions in these shapes:

- **`open` takes a `THREE.Texture`, not the KTX2 bytes.** The consumer already transcoded the texture to draw the mini (`transcodeDetail` with its own renderer); a second transcode for a second context would double the time and the memory. Textures can be shared between contexts only by uploading twice, so the view uploads from `texture.image` (the transcoded mipmaps of a `CompressedTexture`, or the bytes of a `DataTexture`) into its own GPU texture with `ownCopy`, and disposes that copy at `close`. The consumer's texture is never disposed.
- **The paint goes in as pixels and comes out as pixels.** The consumer's storage is the consumer's; the engine never sees a file, a name or a user.
- **`history()` is a record, not the engine's storage.** The engine keeps the steps for undo and redo while open; the consumer may keep them for its own reasons. Nothing in this repo replays a history into a texture outside the view: a consumer that wants a paint keeps the `Albedo`.
- **Every method that changes the paint resolves when the change is on screen**, after `onChange`, as the question view's hooks do: `stroke`, `strokeAt`, `fillRegion`, `undo`, `redo`. A method called while a stroke is on the canvas commits that stroke first.
- **`state` is replaced, not mutated, on every change**, so the consumer can copy fields without comparing.

## 4. Strokes as data

```ts
// src/lib/pipeline/brush.ts (no DOM, no three.js)
export const PAINT_SIZE = 1024;
export const TOOL_IDS = ['flat', 'fill', 'eraser', 'wash', 'ink', 'dry', 'airbrush'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** Every slider there is; each tool reads the ones it has (§6). The consumer shows only those. */
export interface BrushSettings {
  /** The brush's diameter on the surface, in mm. */
  sizeMm: number;
  /** 0 soft … 1 hard: where the dab's falloff begins, as a share of its radius. */
  hardness: number;
  /** 0–1: the stroke's opacity (flat, eraser, fill), strength (wash), flow (ink, airbrush), or the dry brush's pressure. */
  opacity: number;
  /** The fill's tolerance, 0 strict … 1 loose, scaling both bounds (§7.1). */
  tolerance: number;
  /** The airbrush's direction mask: a unit vector in mesh space it sprays from, or null for none (§6, #128). */
  direction: Vec3 | null;
}
export const DEFAULT_BRUSH: BrushSettings = {
  sizeMm: 2,
  hardness: 0.8,
  opacity: 1,
  tolerance: 0.5,
  direction: null,
}; // (proposal)
/** Dabs along a stroke are this far apart, as a share of the brush's diameter. (proposal) */
export const DAB_SPACING = 0.25;

/** The camera a stroke was painted from: what decides which texels it reached (§5.2). */
export interface StrokeCamera {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  near: number;
  far: number;
  /** The drawing buffer's size in device pixels: the depth map's size. */
  viewport: [number, number];
}

export interface PaintStroke {
  kind: 'stroke';
  tool: Exclude<ToolId, 'fill'>;
  /** sRGB hex, as the look's base. */
  colour: string;
  brush: BrushSettings;
  camera: StrokeCamera;
  /** Four numbers a dab: x, y, z on the surface in mesh mm, and the pointer's pressure (0.5 for a mouse). */
  dabs: number[];
}

export type FillSeed =
  { kind: 'picked'; triangle: number; point: Vec3 } | { kind: 'base' } | { kind: 'figure' };

export interface PaintFill {
  kind: 'fill';
  tool: 'fill';
  colour: string;
  brush: BrushSettings;
  seed: FillSeed;
}

export type PaintStep = PaintStroke | PaintFill;
```

- **A dab is a point on the surface, not a pointer position.** The view casts each pointer sample onto the mesh (`TriangleBvh.raycast`, the tree of the table level built at `open`) and places dabs along the straight line between consecutive hits every `DAB_SPACING × sizeMm` mm (`spaceDabs(hits, spacingMm)`, pure, unit-tested: the first hit is a dab, the distance between dabs never exceeds the spacing, a lift ends the run). A sample that misses the mesh lifts the brush: no dabs are laid across the gap, and the next hit starts a new run inside the same stroke. Pressure is recorded per dab and read by no tool of #127 or #128 (a pen paints as a mouse, #127); it is kept so a later tool can use it without changing the record.
- **The camera is part of the stroke** because the texels a dab reaches depend on what was visible (§5.2). With it, a replay (§8) renders the same depth map and lands on the same texels.
- **Everything is JSON-able**: plain objects, numbers and arrays, no typed arrays, so a consumer can keep a step as it is. A thousand dabs are 4,000 numbers.
- **The eraser is a stroke** with `tool: 'eraser'`; the paint's alpha goes down by its coverage (§6).
- **A fill's bounds are its settings**: `brush.tolerance` scales `FILL_ANGLE_DEG` and `FILL_CREASE_CAVITY`; the region itself is not stored, it is found again from the seed on replay (§7.1).

## 5. The projection of a stroke into the atlas

All passes draw into render targets of the view's renderer with `THREE.RawShaderMaterial`s (GLSL 3), over the geometry `createBakedGeometry(mesh)` shared with the display (one upload). WebGL 2 is given (three.js 0.186 is WebGL 2 only); the formats used, `R8` and `SRGB8_ALPHA8`, are colour-renderable there without extensions.

### 5.1 At `open`: the atlas maps

One texture-space render of the mesh into **`atlas`** (RGBA8, `PAINT_SIZE` square): the vertex shader puts each vertex at its texture coordinates (`gl_Position = vec4(uv × 2 − 1, 0, 1)`), the fragment writes R = 2 (a texel whose centre lies in an island), G = the vertex occlusion interpolated. A second draw of the same geometry as **line segments along every triangle edge** (an index buffer of the edges, `gl.LINES`, width 1) with `max` blending writes R = 1 where an island's border crosses a texel whose centre is outside: the half-covered texels the triangle pass misses (§5.3 says why they matter). Texels with R = 0 are the gutter.

From `atlas` the view reads R back once (`readRenderTargetPixelsAsync`, 4 MB, after `open`'s first frame) and computes on the CPU the **owner map**: for every gutter texel within `PAINT_DILATION_RINGS` of an island, the texel it copies its paint from, chained so that ring 2 points at a stamped texel, not at ring 1. Ring 1 takes a 4-neighbour with R = 2 before one with R = 1; ring 2 takes a ring-1 texel's owner. Uploaded as **`owner`** (RGBA8: x in RG, y in BA, 16 bits each; a texel that owns itself points at itself; a texel beyond the rings points nowhere, flagged in a spare bit). `owner` is the same for the mini's whole session; the atlas maps are kept for the composite (the occlusion).

Why a CPU pass and not a jump flood on the GPU: 1 M texels, two rings, a 4-neighbourhood: about 20 ms once, in a `requestIdleCallback`-free plain loop, with a unit test in Node on a hand-made 16 × 16 mask (`ownerMap(mask, size, rings)` in `brush.ts`).

### 5.2 At a stroke's start: the depth map

When a stroke begins (the first pointer hit) the view renders the mesh from the current camera into **`depth`**: a target of the drawing buffer's size (device pixels, pixel ratio capped at 2 as the question scene's) with a `DepthTexture` (24-bit) and a one-byte colour attachment it does not use. The camera is frozen for the stroke (`StrokeCamera`); orbiting is off while a finger is down (§9). One render per stroke, not per frame.

In the dab pass each fragment projects its surface point with the stroke camera's view-projection, samples `depth` at the projected position, linearises both depths with `near` and `far`, and counts the texel **visible** when its own depth is no more than `DEPTH_BIAS_MM = 0.25` _(proposal)_ behind the stored one, **and facing** when `dot(normal, toCamera) ≥ FACING_MIN_COS = 0.15` _(proposal)_ (about 81°; grazing surface at a silhouette otherwise takes a streak from the dab's sphere). A texel that fails either test is left exactly as it was: that is "the texels behind the surface and on the far side of the mini left alone". The bias is in mm because the depth map and the paint come from the same mesh: nothing but depth precision separates them.

### 5.3 Every frame: the dab pass

The frame's dabs (those laid since the last frame, at most `DABS_PER_PASS = 64` _(proposal)_ per draw; more take a second draw) go into a uniform array of `vec4(x, y, z, pressure)`. The mesh is drawn in texture space twice, as triangles and as its edges (the same two draws as §5.1), into **`stroke`** (R8, `PAINT_SIZE` square, cleared at the stroke's start). Per fragment: the visibility and facing tests, then for each dab the distance `d` in mm from the fragment's surface point to the dab's centre and its coverage `1 − smoothstep(hardness × r, r, d)` with `r = sizeMm / 2`. The frame's coverage is the maximum over the dabs; the blend with what is already in `stroke` is `max` for every tool but the airbrush, which adds `opacity × coverage` and clamps (§6). So a stroke that crosses itself does not darken where it overlaps, as a loaded brush does not; an airbrush builds up, as an airbrush does.

The dab's footprint is a **sphere in mm**, not a disc on the screen: a brush of 2 mm paints 2 mm at every zoom, and does not paint a surface that is visible but lies far behind the brush, which a screen disc would. A surface within the sphere across a gap (the torso 1 mm behind an arm) takes paint, as a real brush would; a smaller brush avoids it.

**Changed (2026-10-15, #134, PM decision on the issue, 2026-10-13):** the physical brush is the measure: the sphere is cut behind the dab along the stroke camera's line of sight. A texel whose surface point lies more than `BRUSH_DEPTH_MM = 1.5` _(proposal)_ behind the dab's centre, measured along the eye's ray through the dab, takes no paint; over the last `BRUSH_DEPTH_SOFT_MM = 0.5` _(proposal)_ the dab fades out, so the cut on a receding surface is not a hard line. Sideways the brush keeps its full radius, and in front of the dab the sphere still bounds it. For every stroke tool (flat, eraser, the hobby brushes), not an option; the fill is not a stroke and is unchanged. Nothing new is recorded: the cut follows from the dabs and the camera, so a replay gives the same bytes. A brush of up to 2 mm (radius 1 mm, inside the fade's start) paints exactly as before.

The edge draw matters at the islands' borders. The paint is `PAINT_SIZE` square whatever the detail texture's size, so at a 2,048 px detail texture the atlas's 3 texels of padding are 1.5 paint texels, and an island's outermost texel is half island, half gutter, with its centre on or outside the border: the triangle rasteriser skips it, the edge draw stamps it. Without that stamp the island's edge samples an unpainted texel and a seam shows.

### 5.4 Every frame: composite and dilate

**`composite`**, a quad pass over the whole texture: `live = over(paint, colour, alpha)` with `alpha = opacity × stroke × mask(texel)` where `mask` is the tool's (§6), reading the detail texture, the atlas maps (occlusion) and `stroke`; the eraser instead takes `alpha` away from the paint's alpha and leaves its colour. Straight alpha throughout: `outA = a + pA × (1 − a)`, `outRGB = (c × a + pRGB × pA × (1 − a)) / outA`, `outRGB = c` when `outA = 0`.

**`dilate`**, a quad pass: `next = live[owner]` for every texel with an owner, `live` itself for the rest. This is the seam fill, run every frame while a stroke is on the canvas, so what the person sees at an island's edge is already seamless, and at Save nothing is left to do. Two rings (`PAINT_DILATION_RINGS = 2` _(proposal)_) are what the gutter holds without islands overwriting each other: with 3 padding texels at the detail's size the gutter is 6 paint texels at 512, 3 at 1,024 and 1.5 at 2,048; the owner rule of §5.1 (a stamped texel first, ring 2 only from ring 1's owner) gives each gutter texel to the island whose border is nearer, and bilinear filtering at an edge reaches half a texel out, which ring 1 covers in every case. The #125 journal's measurement stands behind the number: three rings left the generated figure's vertices covered; four, the bake's, made islands take each other's paint.

Targets: **`paint`** (the committed paint) and **`live`** (the stroke composited and dilated) are both RGBA8 with `colorSpace = SRGBColorSpace`, so three.js allocates them as `SRGB8_ALPHA8`: the GPU decodes on sampling, encodes on writing and blends in linear, and the material samples `live` as it samples the consumer's sRGB `DataTexture`. The display material's `map` is `live`'s texture; while no stroke is on the canvas `live` holds the paint. **A commit is a swap**: at the stroke's end `live` becomes `paint`, the old `paint` becomes the next `live`, and the step is pushed (§8). A cancelled stroke (§9) copies `paint` back over `live` with one quad pass.

**As built (2026-10-13, #127):** composite and dilate are **one** quad pass, each texel computed at its owner (`compositeFragment` in `passes.ts`), not two. A commit is a **copy** of `live` into `paint`, not a swap, because the display material holds `live`'s texture; a cancel, a keyframe and a restore are byte copies too (`copyTextureToTexture`). The behaviour above is unchanged. The journal entry `docs/journal/2026-10-13-painting-engine.md` has why.

Colour exactness: the paint goes in by `renderer.copyTextureToTexture` from a `DataTexture` of the bytes into `paint` (a byte copy, no colour conversion) and comes out by `readRenderTargetPixelsAsync` (the stored bytes). A paint opened and read back without a stroke is the same bytes (a test, §13 step 4).

No mipmaps while open: `live` is sampled with linear filtering only, so no pass regenerates a mip chain each frame, and the person paints zoomed in anyway. The consumer's own texture at the table takes mipmaps from the dilated paint it gets back, as the README says since #125.

## 6. The brushes

One dab pass for every tool (§5.3); what differs is the **blend into `stroke`**, the **composite mode** and the **mask**, a GLSL function per tool in `src/lib/painting/tools.ts` with a CPU twin `toolMask(tool, cavity, occlusion, normal, brush)` in `brush.ts` that `tools.test.ts` pins against the GLSL text, as `look.test.ts` keeps `pointColour` and the material in step. `cavity` is the detail texture's, decoded as the material does (`(a − 0.5) × CAVITY_GAIN`, clamped to −1 … 1); `occlusion` the atlas map's; `normal` the detail texture's object-space normal.

| Tool (issue)      | Sliders                           | `stroke` blend | Composite | Mask _(proposals)_                                                                                                                                                                                                                       |
| ----------------- | --------------------------------- | -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flat` (#127)     | size, hardness, opacity           | max            | over      | `1`                                                                                                                                                                                                                                      |
| `eraser` (#127)   | size, hardness, opacity           | max            | erase     | `1`                                                                                                                                                                                                                                      |
| `fill` (#127)     | opacity, tolerance                | region (§7)    | over      | `1`                                                                                                                                                                                                                                      |
| `wash` (#128)     | size, strength (= opacity)        | max            | over      | `WASH_FLAT + (1 − WASH_FLAT) × saturate(max(−cavity, 0) + WASH_OCCLUSION × (1 − occlusion))`, then `× (1 − WASH_LIFT × max(cavity, 0))`: pools in creases and buried places, tints a flat area faintly and evenly, nearly leaves an edge |
| `ink` (#128)      | size, flow (= opacity)            | max            | over      | `INK_FLAT + (1 − INK_FLAT) × saturate(−cavity)`: stains the whole stroke, more in the creases                                                                                                                                            |
| `dry` (#128)      | size, pressure (= opacity)        | max            | over      | `smoothstep(t, t + DRY_SOFTNESS, cavity)` with `t = DRY_THRESHOLD × (1 − pressure)`: only where the cavity is positive; pressure lowers the threshold, reaching further down the edge; the opacity of a dry brush is `DRY_OPACITY`       |
| `airbrush` (#128) | size, flow (= opacity), direction | add, clamped   | over      | `direction ? smoothstep(AIR_DIR_EDGE, AIR_DIR_EDGE + AIR_DIR_SOFTNESS, dot(normal, direction)) : 1`; the dab's hardness is `AIR_HARDNESS` and each dab adds `AIR_FLOW_GAIN × flow × coverage`: a wide soft spray that builds up          |

Constants, beside the look's in `look.ts` or in `brush.ts`, all _(proposal)_: `WASH_FLAT = 0.15`, `WASH_OCCLUSION = 0.5`, `WASH_LIFT = 0.8`, `INK_FLAT = 0.5`, `DRY_THRESHOLD = 0.5`, `DRY_SOFTNESS = 0.2`, `DRY_OPACITY = 0.9`, `AIR_HARDNESS = 0`, `AIR_FLOW_GAIN = 0.15`, `AIR_DIR_EDGE = 0.0`, `AIR_DIR_SOFTNESS = 0.3`. "From above" is `direction = [0, 1, 0]`: minis stand Y-up in mesh space, so the object-space normal's y is up. The consumer offers the presets it wants (above, the camera's direction, none); the engine takes a vector.

**As built (2026-10-13, #128):** the masks, constants and opacities are as the table says (the constants in `look.ts`; the airbrush's composite opacity is 1, its flow being in each dab's `AIR_FLOW_GAIN × flow`), except that the airbrush's mask divides `dot(normal, direction)` by the normal's length, because the detail texture's normal is not of unit length, and `setBrush` scales the direction to unit length (a zero vector is none). Three things the note did not say. The airbrush lays its dabs exactly `DAB_SPACING × sizeMm` apart (`spaceDabs(…, even)`): with a dab at every pointer sample closer than the spacing, an adding brush sprayed by the pointer's sample rate, not by distance. Each dab adds a whole number of 1/255 steps and a stencil on `stroke` lets one fragment a texel add per draw (the triangles and the edge lines both reach some texels), so a stroke drawn a few dabs a frame and its replay drawn at once are the same bytes. The composite samples the detail texture with `textureLod(…, 0)`: after its early return for untouched texels the implicit mip level was undefined, and a second pass read other normals than the first. The journal entry `docs/journal/2026-10-13-hobby-brushes.md` has the details.

The masks are judged by eye in #128 on the corpus (the `?dev` tool of §13 step 5 exists for that), and the tests pin what the issue says: a dry brush across a crease leaves the crease's texels unchanged (mask 0 where `cavity ≤ t`), a wash across an edge leaves the edge's texels within a tolerance and darkens the crease's, an ink changes every texel under it and the crease's more, an airbrush from above changes no texel whose normal faces down (`dot ≤ AIR_DIR_EDGE`). Each is one assertion on `toolMask` in Node and one on the paint read back through the hook (§13).

## 7. The fill and the ready regions

### 7.1 The flood over triangles

`fillRegion(mesh, seed, options)` in `src/lib/pipeline/fill.ts`: a breadth-first flood over the table level's triangles from the seed triangle, across each shared edge, stopping where the edge is a bound. An edge is a bound when **either** the dihedral angle between the two triangles' face normals exceeds `FILL_ANGLE_DEG × (1 + tolerance)` **or** both its vertices' cavity (`mesh.cavity`, raw) lies below `FILL_CREASE_CAVITY × (1 − tolerance)`; `FILL_ANGLE_DEG = 40`, `FILL_CREASE_CAVITY = −0.1` _(proposals; a 20° fold measures about 0.17 raw)_. Two signals because the table level has two kinds of crease: a sharp fold between a few large triangles (the angle sees it, the vertex cavity may not) and a soft crease the sculpt had that the vertices measured (the cavity sees it, the angle between two small triangles does not). The adjacency is built once per `open` (`buildAdjacency` as in `shade.ts`, over triangles) and kept with the tree. The result is a `Uint32Array` of triangle indices.

**As built (2026-10-13, #127), not decided:** the crease bound is `FILL_CREASE_CAVITY × (1 + tolerance)` (−0.1 at 0, −0.2 at 1), not `× (1 − tolerance)` as written above, which would make a loose fill stop at every negative cavity and contradict §4 and the step-2 test. Asked of the PM on PR #131; the decision goes here with its date.

The region is painted as coverage: the triangles are drawn in texture space (triangles and edges, as §5.1) into `stroke` with value 1, and the composite applies the fill's colour and opacity with mask 1. A fill is one step; its boundary follows triangles (0.3–0.5 mm on a table level), which is the resolution the issue asks for.

### 7.2 The base and the figure

`regionsOf(mesh, about)` in `src/lib/pipeline/regions.ts` gives `PaintRegions`: `{ base: Uint8Array; method: 'pair' | 'plain' | 'disc' }`, one byte per triangle of the table level, 1 for the base, or `null` when no base was found. In order of what `about` offers:

- **`'pair'`**, when `about.source` (the full-detail `result.mesh`) and `about.figureTriangles` (`result.pair.figureTriangles`) are given: a tree over the base part of the source (its triangles from `figureTriangles` on), and a table-level triangle is base when all three of its vertices have a closest point on that part within `REGION_REACH_MM = 1` _(proposal, as `PAINT_REACH_MM`)_ **facing the same way** (`MIN_NORMAL_AGREEMENT`, the bake's), so a foot's side above the base's top is not base.
- **`'plain'`**, when `about.sizing.plainBase` is set: the converter's own base is a cylinder of `PLAIN_BASE_HEIGHT_MM` under the mini (`standOnBase`); a triangle whose three vertices lie at or below `PLAIN_BASE_HEIGHT_MM + REGION_BAND_MM` is base, `REGION_BAND_MM = 0.05` _(proposal)_.
- **`'disc'`**, when `about.sizing.base` is set (a base in the file) and the kind guess found a top (`about.kind.reason === 'base-top'`): the base's top is the height band of `BASE_TOP_BIN_MM = 0.5` _(proposal)_ within `DISC_HEIGHT_MAX_MM` of the floor with the most upward-facing area (faces within `TOP_CONE_DEG` of up, both from `kind.ts`); a triangle whose vertices all lie at or below that band's top is base.
- Else `null`.

The consumer calls it after a conversion with what it has (`regionsOf(result.baked.mesh, { source: result.mesh, figureTriangles: result.pair?.figureTriangles, sizing: result.sizing, kind: result.kind })`) and keeps the bytes with the mini or makes them again from a stored table level and its `sizing` (the GLB carries `extras.meshtavern` with the sizing; the triangle order of a plain GLB is the mesh's). That is why `'plain'` and `'disc'` need no full mesh. `fillRegion` with a `'base'` or `'figure'` seed takes the region's triangles (figure = not base), no flood.

**As built (2026-10-13, #127):** `'disc'` takes the highest up-facing triangle centroid within the band with the most area as the base's top, not the band's upper edge (`regions.ts`).

## 8. Undo and redo

The history is the list of `PaintStep`s applied, a cursor, and **keyframes**: copies of `paint` after every `KEYFRAME_EVERY = 10` steps and one at step 0 (the paint as opened), as render targets of the same format as `paint`, at most `UNDO_STEPS = 50` steps back _(proposals)_. Undo moves the cursor one back, restores the nearest keyframe at or before it (one quad copy) and **replays** the steps between, each exactly as it was applied: a stroke renders its depth map from its `camera` at its `viewport`, runs its dab pass with all its dabs (`DABS_PER_PASS` a draw), composites and dilates; a fill finds its region from its seed and does the same. Redo replays the next undone step. A new step after an undo drops the undone steps and the keyframes beyond the cursor; a step beyond `UNDO_STEPS` drops the oldest keyframe and the steps it covers. Memory: `ceil(UNDO_STEPS / KEYFRAME_EVERY) + 1 = 6` keyframes of 4 MB. Time: an undo is at most `KEYFRAME_EVERY − 1` replays, a few ms each (§11), plus a fill's flood.

Why replay and not snapshots or tiles: a snapshot per step is 4 MB a step, 200 MB for fifty; tiles need the stroke's footprint read back after every stroke; replay needs nothing read back, makes the stroke data the truth, and is bounded by the keyframes. A replayed stroke equals the live stroke because every input is in the step (the camera and its viewport decide the depth map, the dabs the coverage) and the passes are deterministic on one GPU; §13 step 7 proves it with a pixel test (undo, redo, compare the bytes).

**As built (2026-10-13, #127):** a step beyond `UNDO_STEPS` drops the oldest keyframe only; the steps it covered stay in the record (`history()` gives every step since the paint was opened), they can no longer be undone.

`history.ts` holds this logic over an interface of four operations (`snapshot(i)`, `restore(i)`, `apply(step)`, `drop(i)`), so `history.test.ts` runs in Node with a fake backend and pins the schedule: which keyframes exist after n steps, how many replays an undo at step n costs, what a new step after undo drops.

## 9. Input

On the view's canvas, the question view's rules with the brush always on, moved rather than rewritten (`mount.ts` of #119 §7.4, `QuestionScene.setBrush(true)`):

- **Mouse and pen:** the left button (a pen's tip) paints, the right button orbits, the middle pans, the wheel zooms to the pointer. A pen's barrel button is the right button. `getCoalescedEvents()` gives a pen's full sample rate between frames.
- **Touch:** one finger paints, two orbit and zoom (`OrbitControls.touches.TWO = DOLLY_ROTATE`, `ONE` off). A second finger arriving during a one-finger stroke **cancels** the stroke (the person meant to pinch); a cancelled stroke leaves no step.
- **`setNavigating(true)`:** one finger and the left button orbit, nothing paints, until `false`: for a pen in one hand and no finger to spare. The consumer draws the hand button.
- **A stroke** begins at a pointer-down whose ray hits the mesh with the current tool not `fill`, continues through the pointer's samples (each cast onto the mesh and spaced into dabs, §4), and ends at pointer-up or cancel. With the fill tool a pointer-down that hits the mesh is a `picked` fill of the triangle hit; a pointer-down that misses does nothing. The camera is frozen from the first hit to the end (OrbitControls disabled; the depth map holds).
- **The cursor** is a ring (`.mt-painting-cursor`, a `div` moved by the pointer) whose diameter is the brush's `sizeMm` projected at the surface point under the pointer, at least `CURSOR_MIN_PX = 4` _(proposal)_; hidden off the mini, with the fill tool and on touch. The scene draws nothing for it.

## 10. The mount

### 10.1 What the entry mounts and what the consumer draws

**As built (2026-10-15, #135):** the view also has the pipette, `colourAt(x, y, mode?: PickMode): Promise<string | null>`, the colour under a canvas point as `#rrggbb`. `'shown'`, the default (`PICK_MODE`, PM decision on #135, 2026-10-13), is the canvas's pixel there as the next frame draws it, light and shading included (read with `readPixels` inside that frame, since the drawing buffer is not kept); `'painted'` is the committed paint's texel under the point (`texelAt`), its colour whatever its alpha, null where its alpha is 0. Off the mini both give null. Picking is not a tool: the consumer's pipette button waits for the next tap, calls `colourAt` and `setColour`; the view's own input is untouched.

The view mounts the canvas and the cursor ring, nothing else. The consumer draws the tool buttons, the sliders, the palette, Undo and Redo, the region buttons, Save and Close, and wires them to `setTool`, `setBrush`, `setColour`, `undo`, `redo`, `fillRegion`, `paint`, `close`; it reads `state` in `onChange` to disable Undo, show the perf counter or grey the regions a mini does not have. This is the split #119 made for the questions, with the panel left out: a painting panel is where every consumer differs most.

### 10.2 Words

```ts
// src/lib/painting/copy.ts. Every string is a proposal the PM may change.
export const PAINT_COPY = {
  cannotPaint: 'This mini has no detail texture, so it cannot be painted.',
  tools: {
    flat: 'Brush',
    fill: 'Fill',
    eraser: 'Eraser',
    wash: 'Wash',
    ink: 'Ink',
    dry: 'Dry brush',
    airbrush: 'Airbrush',
  },
  sliders: {
    sizeMm: 'Size',
    hardness: 'Hardness',
    opacity: 'Opacity',
    strength: 'Strength',
    flow: 'Flow',
    pressure: 'Pressure',
    tolerance: 'Tolerance',
    direction: 'From',
  },
  regions: { base: 'The base', figure: 'The figure' },
  undo: 'Undo',
  redo: 'Redo',
  navigate: 'Turn the mini',
  hint: 'Paint with one finger or the left button; two fingers or the right button turn the mini.',
} as const;
export type PaintCopy = typeof PAINT_COPY;
```

The engine itself shows only `cannotPaint` (as the refusal's message); the rest is offered so a consumer's panel and this page's `?dev` tool say the same words, as `QUESTION_COPY` does for the questions. `copy` in the options replaces fields; nested objects are replaced whole.

**As built (2026-10-13, #128):** `PAINT_COPY` also has `toolHints`, a sentence or two per tool on what it does, for the consumer's panel to show beside the tool (the `?dev` tool shows it under its tool buttons), added after the PM found the brush, the wash and the ink hard to tell apart.

**As built (2026-10-15, #135):** `PAINT_COPY.pick` holds the pipette's button, its two modes (`shown`, `painted`), a hint and what to say when there is nothing to pick.

### 10.3 The scene and the styles

`src/lib/painting/scene.ts` is the question scene's frame without the question: a canvas in the host, `WebGLRenderer({ antialias: true })` with the pixel ratio capped at 2, the page's background, `addTableLights`, the grid (`GRID_SQUARE_MM × 40`), `PerspectiveCamera(40, …)`, OrbitControls with damping and `zoomToCursor`, a `ResizeObserver`, a loop that runs only while a mini is open, and the mini: `createBakedGeometry(mesh)` with `createBakedMaterial(ownTexture, createLookUniforms(look), { map: live.texture })`. The camera on a sphere (`setCamera`) is the third copy of the viewer's fifteen lines; #119 §7.2 said a shared helper is worth it at the third copy: the build moves it to `src/lib/three/camera.ts` as `placeCameraOnSphere(camera, controls, size, azimuthDeg, elevationDeg, zoom)` and makes the viewer and the question scene call it, in a commit of its own with no behaviour change (the maths is identical; the e2e screenshots prove it). If any screenshot moves, the painting scene keeps its own copy and the commit is dropped (§15).

`src/lib/painting/painting.css`, under `.mt-painting` only: `.mt-painting { position: relative }`, `.mt-painting canvas { display: block; width: 100%; height: 100%; touch-action: none }`, `.mt-painting-cursor { position: absolute; pointer-events: none; border: 1px solid var(--q-accent, #7aa2f7); border-radius: 50%; transform: translate(-50%, -50%) }` reading the page's custom property with the page's value as the fallback, as `questions.css` does. Imported once by the consumer (`import 'meshtavern-converter/painting.css'`), never by the entry, for the reason #119 gave.

## 11. The budget

### 11.1 What the engine holds while a mini is open

| Target or texture                         | Format                          | Bytes at PAINT_SIZE 1,024, a 1,920 × 1,080 drawing buffer |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------: |
| `atlas` (island level, occlusion)         | RGBA8                           |                                                    4.0 MB |
| `owner` (dilation sources)                | RGBA8                           |                                                    4.0 MB |
| `paint`                                   | RGBA8 sRGB                      |                                                    4.0 MB |
| `live`                                    | RGBA8 sRGB                      |                                                    4.0 MB |
| `stroke`                                  | R8                              |                                                    1.0 MB |
| `depth` (24-bit depth + R8 colour)        | per device pixel                |                                                    8.3 MB |
| keyframes, at most 6                      | RGBA8 sRGB                      |                                             up to 24.0 MB |
| the mini's own copy of the detail texture | the consumer's format           | 1.3 MB (1 K) to 5.3 MB (2 K) compressed, 21 MB raw at 2 K |
| the mini's geometry                       | 36 B a vertex + 12 B a triangle |                                                    1–3 MB |
| **Total over the consumer's own**         |                                 |                  **about 50 MB, 32 MB without keyframes** |

Plus the second context itself (about 40 MB on the page for the question view, #119's journal), on top of the consumer's renderer. The `depth` target follows the canvas: at pixel ratio 2 on a phone (a 400 × 800 CSS canvas) it is 5 MB; on a 4 K desktop at ratio 2 it would be 33 MB, which is why the ratio is capped. The README lists this table (#127's criterion).

### 11.2 A frame while painting

| Pass                        | Work                                                                                              | Estimate on an integrated GPU |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------: |
| depth map (once per stroke) | the mesh once, depth only                                                                         |                        1–2 ms |
| dab pass                    | the mesh twice in texture space; about 0.5 M island fragments × (2 texture reads + up to 64 dabs) |                        1–2 ms |
| composite                   | 1 M fragments × 4 texture reads                                                                   |                       ~0.5 ms |
| dilate                      | 1 M fragments × 2 texture reads                                                                   |                       ~0.3 ms |
| display                     | the mini (15–65 k triangles, one draw) and the grid                                               |                        1–2 ms |
| the CPU                     | ray casts for the frame's pointer samples (a few, tens of µs each), dab spacing                   |                         <1 ms |

About 4–7 ms a frame against the 33 ms of 30 fps. The estimate is the builder's to replace with the counter's numbers on the development PC and the laptop (#127's criterion, §13 step 9): a stroke of `BRUSH_MAX_MM` across the generated figure and across the largest corpus mini at 1,920 × 1,080, median and worst frame.

**As built (2026-10-13, #127):** composite and dilate are one pass (§5.4). The development PC's numbers are in the journal entry; the laptop's are not measured yet.

### 11.3 The counter

`state.perf` is measured by the engine around its own frame (`performance.now()` before and after the loop's body, which includes `renderer.render`), kept per stroke: the median and the worst frame from the first dab to the commit. It measures CPU time and whatever the GPU makes the CPU wait for; GPU time itself is not visible without `EXT_disjoint_timer_query_webgl2`, which the README says. A frame over `FRAME_BUDGET_MS = 33` is counted in `perf.slow` _(proposal)_, so a test can assert on it.

## 12. Where the code goes

- **`src/lib/painting.ts`** (new): the entry of §3. **`src/lib/painting.css`**: §10.3.
- **`src/lib/painting/mount.ts`** (new): `mountPainting`, `PaintingView` as a class, the pointer handling (§9), the cursor, the stroke in progress, the constants `BRUSH_MIN_MM = 0.5`, `BRUSH_MAX_MM = 16`, `DABS_PER_PASS = 64`, `DEPTH_BIAS_MM = 0.25`, `FACING_MIN_COS = 0.15`, `PAINT_DILATION_RINGS = 2`, `KEYFRAME_EVERY = 10`, `UNDO_STEPS = 50`, `CURSOR_MIN_PX = 4`, `FRAME_BUDGET_MS = 33` _(all proposals)_.
- **`src/lib/painting/scene.ts`** (new): §10.3. **`src/lib/painting/passes.ts`** (new): the targets and the five passes of §5 with their GLSL. **`src/lib/painting/tools.ts`** (new): the table of §6, the mask GLSL per tool; #128 adds its rows here and its constants beside the look's. **`src/lib/painting/history.ts`** (new): §8. **`src/lib/painting/copy.ts`** (new): §10.2.
- **`src/lib/pipeline/brush.ts`** (new, no DOM, no three.js): the data shapes of §4, `spaceDabs`, `toolMask`, `ownerMap`. **`src/lib/pipeline/fill.ts`** (new): §7.1. **`src/lib/pipeline/regions.ts`** (new): §7.2. Each with its test; `paint.ts` is unchanged.
- **`src/lib/three/camera.ts`** (new): `placeCameraOnSphere`, with the viewer and the question scene calling it (§10.3).
- **`src/lib/index.ts`**: the exports of §3. **`src/lib/index.test.ts`**: the pinned lists, including the fifth entry's. **`eslint.config.js`**: `**/lib/painting/*` joins the restricted group. **`package.json`**: the two exports. **`README.md`**: "Use it as a library" gains the entry with the example of §13 step 10 and the table of §11.1. **`CLAUDE.md`**: the intro and the `src/lib/` paragraph.
- **The page** (`src/page/`): the `?dev` tool of §13 step 5 only, under `data-dev`, through the entry like any consumer.

Nothing in `src/lib/pipeline/run.ts`, the worker or `glb.ts` changes; the regression baseline cannot move.

## 13. Build order

Each step is a commit with its tests, `npm run check` green after each; `npm run e2e` green at steps 4 and after. #127 is steps 1–10; #128 is step 11, on a branch from #127's once it is merged, or stacked on it.

1. **The data and the CPU parts.** `brush.ts`: the shapes of §4, `DEFAULT_BRUSH`, `spaceDabs` (tests: one hit gives one dab; a path of 10 mm at a 2 mm brush gives dabs no further apart than 0.5 mm with the first at the start; a lift between two runs lays nothing across), `ownerMap` (test on a 16 × 16 mask with two islands 1, 3 and 6 texels apart: each gutter texel's owner is the nearer island's stamped texel, no texel points at ring 1, texels beyond ring 2 point nowhere), `toolMask` for `flat`, `eraser`, `fill` (1). `index.ts` and the pinned list.
2. **The fill.** `fill.ts` with its adjacency; test on the generated figure with its base (`generateFigure(true)`, converted with a 256² bake in Node as `paint.test.ts` does): the figure stands on a 25 mm disc 3 mm high, and its body meets the disc's top at a sharp fold; a flood seeded on the disc's top never contains a triangle whose centroid lies more than `REGION_BAND_MM` above 3 mm, and a flood seeded on the figure's chest never contains a triangle of the disc; at `tolerance = 1` the flood is larger than at `0`, never smaller.
3. **The regions.** `regions.ts`; tests: the generated puddle figure with the recess base converted as a pair (`placePairOnly` is not enough: the regions need the table level, so `runPipeline` with both files) gives `method: 'pair'` and marks as base exactly the table-level triangles whose centroids lie below the base's top plus `REGION_REACH_MM`, and no triangle of the figure's top half; `generateFigure(false)` converted with `plainBase: true` gives `'plain'`; `generateFigure(true)` gives `'disc'` with the base's top found at the figure's base height; a figure without a base gives `null`.
4. **The passes and the entry, without input.** `camera.ts` (the shared camera, its own commit, screenshots unchanged), `scene.ts`, `passes.ts`, `tools.ts` with the three tools, `mount.ts` with `open`, `close`, `stroke`, `paint`, `texelAt`, `setCamera`, the entry, the stylesheet. The e2e harness of step 5 is needed to run them, so steps 4 and 5 land together or 5 first. Tests (e2e, through the hooks, the generated figure baked at the default size): **paint in, paint out**: an `Albedo` from `paintWhere` opened and read back is the same bytes; **a stroke lands where it should**: a `stroke` of five points along the figure's chest at `sizeMm = 2` colours the texels whose surface points lie within 1 mm of a dab (checked through `texelAt` on a grid of canvas points over the chest) and leaves the texels of the figure's back (`setCamera(180, …)`, `texelAt` there) at zero alpha; **behind the surface**: the generated plate (`generatePlate`, 30 mm square and 2 mm thick, no opening) seen from above and painted on its top with `sizeMm = 8`, wider than its thickness, leaves its underside's texels bare, though they lie within the dabs' spheres; **the seam**: two triangles of the table level that share an edge and lie in different islands (found from `uvs` and `indices`), a dab on the shared edge's middle at `sizeMm = 3`: the texels at the edge's middle offset half a texel outward on both islands are painted, and so are their ring-1 neighbours in the gutter.
5. **The `?dev` tool** _(proposal)_: a "Paint" button under the team's tools that mounts the view over `#viewport` for the converted mini (its baked table level, the transcoded texture, the look, the regions from the result) with a plain panel of the tools, sliders, colour, regions, Undo, Redo, Save (downloads the `Albedo` as a PNG) and Close, and the hooks `window.__mt.painting.*` forwarding to the view's methods with `state.painting` mirrored for the tests. Not in the product page: `data-dev`, removed without `?dev`; the regression baseline does not move. It is also where the PM judges the brushes of #128 on corpus minis, and the test harness for every pixel test here. If the PM wants no such tool on the page, the alternative is a test page under `e2e/` served by the Playwright config; ask before building it (§15).
6. **Input.** The pointer rules of §9, the cursor, `setNavigating`, `strokeAt`. Tests: `strokeAt` with a path across the figure paints the same texels as `stroke` with the hits of that path (within a texel); a two-finger sequence (Playwright touch) during a stroke leaves `steps` at 0 and the paint unchanged; the right button orbits (the camera moved, `texelAt` at the same canvas point gives another triangle).
7. **Undo and redo.** `history.ts` with its Node tests (§8), the keyframes, replay. E2e: three strokes, undo, redo gives the same bytes as before the undo; undo three times gives the opened paint's bytes; a fourth undo does nothing; `UNDO_STEPS + 5` strokes keep `UNDO_STEPS` undoable; a stroke after an undo drops the redo.
8. **The fill and the eraser through the engine.** A `picked` fill on the figure's chest colours the chest's texels and none of the base's top; `fillRegion('base')` on the pair colours the base's and none of the figure's; the eraser over a painted area brings those texels' alpha to 0 and leaves the rest; each is one step.
9. **Numbers** (development PC and the reference laptop, window in front, on the power cord): `perf` of a `strokeAt` across the whole canvas at `BRUSH_MAX_MM` on the generated figure and on the largest corpus mini (large-01, a 2 K detail texture), median and worst frame, `slow` count; the GPU process's memory with the view open against without (the way #119's journal measured it); the time of `open` for both minis. The criterion is 30 fps: median under 33 ms with no frame over 66 ms _(proposal for "or better")_.
10. **Docs and journal.** README: the entry with this example, the budget table, the counter's limit; `CLAUDE.md`; `docs/journal/2026-10-<dd>-painting-engine.md` (topics `look`, `textures`, `ui`, `performance`, `testing`): why texture space and a depth map, why replay, what the seam needed at 2 K, every number with its device, what went wrong.

    ```ts
    import { mountPainting } from 'meshtavern-converter/painting';
    import 'meshtavern-converter/painting.css';
    import { regionsOf } from 'meshtavern-converter';

    const view = mountPainting({
      scene: dialog.querySelector<HTMLElement>('.scene')!,
      onChange: (state) => panel.render(state), // your tools, sliders, palette, Undo, Redo
    });
    await view.open({
      mesh: result.baked!.mesh,
      texture, // transcodeDetail(result.baked.ktx2, renderer)
      look,
      paint: storedPaint ?? null, // the Albedo you kept, or none
      regions: regionsOf(result.baked!.mesh, {
        source: result.mesh,
        figureTriangles: result.pair?.figureTriangles,
        sizing: result.sizing,
        kind: result.kind,
      }),
    });
    view.setTool('flat');
    view.setBrush({ sizeMm: 2 });
    view.setColour('#b03030');
    // ... the person paints ...
    const albedo = await view.paint(); // 1,024² RGBA bytes: store them; paintAtVertices and renderThumbnail take them
    view.close();
    ```

11. **#128: the hobby brushes.** The four rows of §6 in `tools.ts` and `toolMask`, their constants beside the look's, the `direction` setting; the `?dev` panel's sliders. Tests in Node on `toolMask` and e2e on the paint read back, one per issue line (§6); `perf` for each brush as step 9. A journal entry of its own, or step 10's extended.

## 14. How each criterion is proven

| Criterion                                                                                                                                                                                                                                                             | Proof                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#126** A design note with the decisions, the module boundaries, the data shapes, the interface the consumer calls and the test for every step                                                                                                                       | this note: §5–§9 the decisions, §12 the modules, §4 the data, §3 the interface, §13 the tests                                                    |
| **#126** A draft hand-over PR with the brief for #127 and #128                                                                                                                                                                                                        | the PR this note is opened in                                                                                                                    |
| **#126** Nothing of the consumer's product in this repo                                                                                                                                                                                                               | pixels in, pixels out (§3.1); no storage, no users, no plans; the `?dev` tool is the team's harness, not the page's product (§13 step 5)         |
| **#126** Design pass first (Fable 5.1); depends on #125                                                                                                                                                                                                               | this note; #125 merged (`331a71c`, `83eb613`)                                                                                                    |
| **#127** A library entry mounts into a given element: the table level with its detail texture drawn by the material of #125 with the paint as its albedo, orbit and zoom; mouse, touch (one finger paints, two orbit), a pen as a mouse                               | `mountPainting`, `open` (§3), the scene (§10.3), the input (§9); step 6's tests                                                                  |
| **#127** The flat brush with size, colour and hardness; the stroke projected as the note says, texels behind the surface and on the far side untouched, the seams dilated (a pixel test over a seam of the generated figure's unwrap)                                 | §5; step 4's four e2e tests                                                                                                                      |
| **#127** The fill: bounded by cavity or by the angle between faces, "the base" and "the figure" as ready regions where the pipeline found a base; never crosses a crease above the threshold (a test on the generated figure with its base)                           | §7; steps 2, 3 and 8                                                                                                                             |
| **#127** The eraser back to alpha zero; undo and redo of every stroke and fill, at least 50 steps, each a stroke as data the consumer can keep                                                                                                                        | §6 (erase), §8, §4; steps 7 and 8                                                                                                                |
| **#127** The paint in and out as pixels: a 1,024 px RGBA array whatever the detail texture's size; a mesh without a detail texture refused with a reason                                                                                                              | `PAINT_SIZE`, `paint()`, `open`'s refusal (§3); step 4's paint-in-paint-out test; a refusal test with `result.lods[BAKED_LEVEL].mesh`            |
| **#127** 30 fps or better while painting the largest brush on the development PC and the laptop (the engine's own counter); the render targets and textures listed in the README                                                                                      | §11; step 9's numbers in the PR; the README's table                                                                                              |
| **#127** The wording in a `COPY` the consumer can replace, the styles scoped to the mounted element; README with an example; the API test lists the new exports                                                                                                       | `PAINT_COPY` (§10.2), `.mt-painting` (§10.3), step 10, `index.test.ts`                                                                           |
| **#127** The page does not offer painting (the regression baseline does not move)                                                                                                                                                                                     | nothing under `src/lib/pipeline/run.ts` changes; the tool is `data-dev` only (§13 step 5); `baseline.test.ts` untouched                          |
| **#128** The wash, the ink, the dry brush, the airbrush with its direction mask, each as the issue words it; the mask tests on the generated figure; one undo step per stroke; thresholds and gains named beside the look's; the frame-rate criterion for every brush | §6's table and constants, step 11; `toolMask` in Node and the paint read back; a stroke is one `PaintStep` for every tool (§8); `perf` per brush |

## 15. When to stop and ask

- **The frame budget misses on the laptop** (step 9: a median over 33 ms, or frames over 66 ms, for the largest brush) after the obvious is tried: the depth map at half the drawing buffer's size, `DABS_PER_PASS` smaller with more draws, the composite and dilate passes merged. Report the counter's numbers and the GPU process's memory; do not lower `PAINT_SIZE` or drop the dilation to make it.
- **A format is not renderable on a device at hand**: `R8` or `SRGB8_ALPHA8` as a render target (both are in WebGL 2 without extensions; a browser may still refuse). `R8` has an `RGBA8` fallback worth one line; the sRGB targets have none short of encoding in the shaders, which changes §5.4: ask.
- **The seam test fails on a corpus mini with a 2 K detail texture** (1.5 paint texels of gutter, §5.4) though it passes on the generated figure: report with the thumbnail and the texels; a 2,048 px paint for those minis is a product decision (the issue fixed 1,024).
- **A replayed stroke differs from the live one** (step 7's bytes differ): the depth map or a pass is not deterministic on that GPU; find which, and if it cannot be made so, ask before switching undo to tile snapshots.
- **The regions are wrong on corpus minis**: `'disc'` finds the wrong band on a scenic base, or `'pair'` marks the figure's feet; report the mini's kind and the numbers; the heuristics' constants are the PM's.
- **The `?dev` tool** is more than the PM wants on the page, or the PM wants it without the regions, Save or a slider: ask on the PR before step 5 and build the e2e page instead if told.
- **A consumer needs something at `open` that is not in `MiniToPaint`** (a transcoder path, the renderer itself, the KTX2 bytes): add it only if the table would have it; a change to `three.ts` or `baked-material.ts` beyond what §5 needs is a stop.
- **A decision of this note turns out wrong.** Record the PM's answer in this note with the date, nothing else.

Ask on the PR, label the issue `needs-human` when the answer is the PM's, and continue with the steps that do not depend on it.

## 16. Out of this note

- **Pen pressure driving size or flow**: recorded per dab (§4), read by no tool; a later tool or a setting `pressure: 'size' | 'flow' | 'off'`.
- **A replay outside the view** (strokes to a texture without a canvas, on a server or in a worker): the data allows it (§4, §8); nothing here builds it.
- **Layers, masks, selections, a colour picker from the surface, symmetry, a lasso fill**: the consumer's product decides; each is a `PaintStep` kind when it comes.
- **A shape-following slab cut** so fewer seams cross a painted area: the #57 journal's "idea to keep for then"; measure first whether seams show once painted (they should not, §5.4).
- **A 2,048 px paint for 2 K minis**: §15's third bullet, only if the seam shows.
- **Mipmaps and the gutter at the table**: the consumer's texture (README, #125); a `dilateAlbedo(albedo, owner)` on the CPU for a consumer that edits a paint elsewhere is a one-function follow-up.
- **Drawing into the consumer's renderer** instead of a second context: the alternative #119 §2 weighed; worth it only when step 9 shows the context's cost matters on the phone.
- **The far and close levels while painting**: the view shows the table level only; the table shows the paint per vertex on the other levels through `paintAtVertices` after Save, as #125 built.
