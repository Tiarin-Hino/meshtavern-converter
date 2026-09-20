# Phase 0 spike: can the browser make a good-looking mini?

Status: ready · Owner: PM · Time box: 1–2 weeks

## Goal

Answer three questions before building the product:

1. Can a browser process a real sculpted STL (up to ~100 MB, 2M triangles) without running out of memory, in acceptable time?
2. Does a reduced mini look good enough — with vertex shading only (Variant A) and with baked detail maps (Variant B)?
3. Can a laptop with an integrated GPU show 100 different minis at 30 fps or more?

Code written here is throwaway-quality unless it lands in `src/pipeline/` with tests.

## Pipeline under test

All steps run in a Web Worker as pure functions on typed arrays.

1. Parse STL → weld duplicate vertices → indexed mesh.
2. Orient (Z-up → Y-up), place on y = 0, report size in mm. Manual override always possible.
3. Decimate to a triangle budget (start: 50k detail LOD, 15k and 4k table LODs). Candidates: meshoptimizer WASM simplifier; Fast-Quadric-Mesh-Simplification WASM.
4. **Variant A:** bake ambient occlusion and curvature into vertex colours → "primed + wash" look.
5. **Variant B:** auto-UV unwrap (xatlas WASM) → bake normal, AO and curvature maps from the original mesh → 2K textures. This is the prerequisite for texture painting later.
6. Export GLB (meshopt-compressed).

Out of scope: support removal, painting UI, accounts, anything server-side.

## Exit criteria

| #   | Criterion                                                                      | Measure                                                                                                     |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | A 100 MB binary STL converts in the browser on the reference hardware          | **Met:** 3.4 s on the reference laptop, 5.5 s on a phone, no crash. Peak memory is calculated, not measured |
| 2   | Variant A and Variant B screenshots for every mini in the corpus (20–30 files) | Side-by-side contact sheet in `docs/design/` (renders only, no source files)                                |
| 3   | 100 unique converted minis on screen                                           | **Met:** 60 fps on Intel Iris Xe; holds 60 fps up to 400 minis at table level                               |
| 4   | Output size                                                                    | Typical GLB ≤1 MB (A) / ≤4 MB with textures (B)                                                             |
| 5   | Decision                                                                       | Go/no-go on Variant B; chosen simplifier; triangle budgets                                                  |

## Work items

1. Web Worker harness + progress reporting + memory/time measurements.
2. Weld + index + orientation/placement, with unit tests.
3. Decimation: integrate and compare the two simplifiers.
4. Variant A: AO/curvature → vertex colours, wash shader.
5. Variant B: xatlas unwrap + normal/AO bake.
6. GLB export + reload in viewer.
7. 100-mini stress scene with LODs and an fps readout.
8. Contact-sheet generator (Playwright) for the corpus.
9. Write up results and decisions.

## Results so far

### Simplifier (issue #8, 2026-09-20)

**Recommendation: meshoptimizer.** Decision on looks is the PM's.

- Maintained, MIT, on npm, works directly on typed arrays inside the worker, and has an attribute-aware mode we will need once minis carry vertex colours or UVs.
- Fast-Quadric-Mesh-Simplification was not integrated: it has no npm package, and the only WebAssembly builds are unmaintained (2022) and exchange data through temporary files, which costs extra 60–100 MB copies per mini. It stays the fallback if meshoptimizer's quality disappoints.
- Settings: `Prune` flag (drops tiny floating components), no error ceiling (the triangle budget wins), each LOD simplified from the previous one. Simplifying every LOD from the source instead gives about 30 % lower error at 15k and 4k but takes 2–3 times as long.

Measured in Chrome 153 on the primary reference machine, three of the PM's own minis:

| Mini     | Source triangles | 50k LOD           | 15k LOD           | 4k LOD           | Simplify | Whole conversion |
| -------- | ---------------- | ----------------- | ----------------- | ---------------- | -------- | ---------------- |
| M-001a   | 1,253,380        | 50,000 (±0.02 mm) | 14,998 (±0.07 mm) | 3,990 (±0.22 mm) | 1288 ms  | 1698 ms          |
| MINI-001 | 554,316          | 50,000 (±0.03 mm) | 15,000 (±0.09 mm) | 4,000 (±0.28 mm) | 377 ms   | 526 ms           |
| MINI-014 | 546,406          | 50,000 (±0.01 mm) | 14,998 (±0.06 mm) | 3,990 (±0.25 mm) | 371 ms   | 533 ms           |

The ± figure is the simplifier's own estimate of the largest deviation from the source surface. Comparison images: `npm run build && node scripts/compare-lods.mjs` writes them to the git-ignored `out/lods/`.

### Detail levels driven by error (issue #24, 2026-09-20)

The PM's verdict on fixed budgets: fine for simple minis, awful for detailed commercial ones at 15k. Triangle count turned out to be a poor measure of detail: to stay within 0.05 mm, one 1.25M-triangle mini needs 14k triangles and a 0.5M-triangle hill giant needs 144k. Levels are therefore defined by allowed deviation, with a floor and a cap:

| Level | Error limit | Floor | Cap  |
| ----- | ----------- | ----- | ---- |
| close | 0.02 mm     | 50k   | 200k |
| table | 0.05 mm     | 15k   | 60k  |
| far   | 0.2 mm      | 4k    | 20k  |

Every level also carries the normals of the full-detail mesh, and the final reduction weighs those normals so creases and facial features survive.

Result on the five local corpus minis (Chrome 153, primary reference machine):

| Mini                        | Source | close                | table               | far                 | Simplify step |
| --------------------------- | ------ | -------------------- | ------------------- | ------------------- | ------------- |
| Large detailed giant, 77 mm | 500k   | 200k (cap, ±0.04 mm) | 60k (cap, ±0.14 mm) | 20k (cap, ±0.34 mm) | 3.6 s         |
| Detailed 48 mm figure       | 1,172k | 94k (±0.02 mm)       | 50k (±0.05 mm)      | 8k (±0.20 mm)       | 6.7 s         |
| M-001a                      | 1,253k | 50k (floor)          | 23k (±0.05 mm)      | 4k (floor)          | 2.3 s         |
| MINI-001                    | 554k   | 66k (±0.02 mm)       | 32k (±0.05 mm)      | 5k (±0.20 mm)       | 1.0 s         |
| MINI-014                    | 546k   | 50k (floor)          | 19k (±0.05 mm)      | 5k (±0.20 mm)       | 0.9 s         |

Costs and open points:

- The simplify step is 2–3 times slower than with fixed budgets, because each level needs up to three simplifier runs. Acceptable once per upload on the fast desktop; to be checked on the weak reference device.
- Levels are chained, and the error a level inherits counts against its limit. That is conservative: the table level gets more triangles than a direct reduction from the source would need (50k instead of 32k for the 48 mm figure).
- Mixed stress scene, 80 % MINI-014 and 20 % giant: 100 minis with LOD by distance draw 1.9M triangles per frame; 400 minis 3.0M; both at the display cap, with 1279 and 352 fps when the cap is lifted. All 100 at the table level: 2.7M triangles, 711 fps uncapped. Primary reference machine only.
- Who may receive the close-up level is a licensing question (a 200k-triangle mesh at 0.04 mm is close to print quality). Tracked in the private repo.

### Primed-and-washed look (issue #9, 2026-09-20)

Variant A from the pipeline list, done without textures. Two numbers are measured per vertex on the close level and inherited by the lower levels: **occlusion** (how buried a spot is; short rays marched through a 160-voxel grid, with the table counted as solid) and **cavity** (signed curvature: creases negative, edges positive). Colour = base coat, darkened by occlusion and creases, lightened on edges. Strengths and base coat are adjustable live, because only the colours are recomputed, not the conversion.

The shade step costs 0.16–0.86 s on the corpus minis (25k–100k vertices) on the primary reference machine. Defaults: shadows 0.75, wash 0.6, edges 0.45, base coat #9aa0a8. Visual call: PM.

### Unwrap and baked detail maps (issue #10, spike, 2026-09-20)

Variant B from the pipeline list: give the table level texture coordinates with xatlas (WebAssembly, in the worker), then bake the full sculpt's normals and fine creases into textures. Switched on with `?bake=2048` in the address; off by default.

**It works.** Measured in Chrome 153 on the primary reference machine, 2K maps:

| Mini                  | Table triangles | UV islands | Vertices (before → after) | Unwrap  | Bake  | Whole conversion |
| --------------------- | --------------- | ---------- | ------------------------- | ------- | ----- | ---------------- |
| M-001a                | 22,632          | 1,223      | 11,260 → 19,982           | 3.7 s   | 4.4 s | 11.8 s           |
| MINI-001              | 32,054          | 1,029      | 15,999 → 25,476           | 4.5 s   | 4.0 s | 10.4 s           |
| Detailed 48 mm figure | 49,636          | 3,513      | 24,775 → 46,509           | 23.2 s  | 5.7 s | 36.0 s           |
| Large detailed giant  | 59,974          | 6,952      | 29,794 → 64,307           | 132.0 s | 5.6 s | 143.0 s          |

At 1K the bake drops to 1.6–1.9 s; the unwrap time does not change. About half of the texture is covered by islands; for under 2 % of covered texels no sculpt vertex was close enough and the reduced mesh's own normal was used.

**What it buys, by eye:**

- At table distance: nothing visible over variant A (per-vertex look).
- Very close, on a smooth sculpt (M-001a): clearly better. Wrinkles and eyelids of the original come back on a 23k-triangle mesh.
- Very close, on a dense detailed sculpt (the giant's beard): **worse** than variant A. The bake takes the nearest sculpt vertices; where strands lie close together and the sculpt's own vertex spacing is no finer than the texels, that gives a blotchy, noisy surface. Fixing it needs true closest-point-on-triangle or ray-cast sampling with a BVH.

**What it costs:**

- Time: unwrapping grows steeply with triangle count and detail, from 3 s to over 2 minutes on a fast desktop. It is xatlas's chart computation; packing and baking are minor.
- GPU memory: a 2K normal map plus a 2K colour map with mipmaps is about 43 MB per mini; at 1K about 11 MB. The per-vertex look costs 1–2 MB. One hundred baked minis would need 1–4 GB, which integrated GPUs do not have. GPU texture compression (KTX2) would cut that by 6–8 times but needs a heavy encoder in the browser.
- Vertices roughly double, because every UV island border splits them.
- Object-space normal maps are not part of glTF; exporting them needs a tangent-space conversion.
- New dependency: `xatlas-wasm` 0.1.3, pinned. It is a young single-maintainer package. Its bundle makes no network calls, and it is loaded only when baking is requested. Building xatlas from source ourselves is the clean path if this goes to production.

**Decision (PM, 2026-09-20): go. Baked maps ship at release, on all minis.** The improvement on smooth sculpts is what the product should look like. The spike's recommendation had been no-go for release (no gain at table distance, memory, unwrap time); the PM weighed the close-up quality higher. What must be solved before release, each a `release-blocker` issue:

- **#29 Bake sampling.** Closest point on the sculpt's triangles through a BVH, instead of nearest vertices, so dense sculpts like the giant's beard stop looking blotchy.
- **#30 Texture memory.** 11–43 MB per mini does not fit a full table on an integrated GPU. Needs a map-size policy per level, packed or compressed textures, and a fallback to the per-vertex look on weak devices. Better sampling does not change this.
- **#31 Unwrap time.** Up to minutes on large detailed minis; needs cheaper chart settings or another strategy, honest progress, a measurement on the weak device, and a decision on the `xatlas-wasm` dependency.

Unchanged from the spike: painting needs these texture coordinates anyway, and object-space normal maps need a tangent-space conversion before they can go into a GLB export.

### Bake sampling and unwrap time (issues #29 and #31, 2026-09-20)

**Sampling (#29).** The bake now finds, for every texel, the closest point on the sculpt's own triangles through a bounding volume hierarchy, and interpolates normal and cavity across the triangle that was hit. The facing test stays (the inside of a cloak must not answer for its outside), and each search starts from the previous texel's answer, which prunes most of the tree. The blotchy beard on the large detailed giant is gone; on all five corpus minis the baked table level is at least as good as the per-vertex look at the closest view. Visual call: PM.

**Unwrap time (#31).** Two findings, both applied:

- A fresh WebAssembly instance runs its first unwrap two to three times slower than later ones (giant, Node: 111 s cold against 40 s warm, same settings). A throwaway unwrap of a small generated mesh, 0.6 s, takes that penalty instead of the user's mini.
- `maxCost` 8 instead of xatlas's default 2 lets islands grow larger: about 40 % faster, slightly fewer islands, no visible difference. Higher values change nothing. Limits on island area or border length made it slower; a higher normal-deviation weight made it eight times slower.

Chrome 153, primary reference machine, all five corpus minis:

| Mini                  | Table triangles | UV islands | Unwrap           | Bake 2K | Bake 1K | Whole conversion 2K / 1K |
| --------------------- | --------------- | ---------- | ---------------- | ------- | ------- | ------------------------ |
| Large detailed giant  | 59,974          | 6,457      | 61 s (was 132 s) | 17.5 s  | 6.0 s   | 84 s / 67 s              |
| Detailed 48 mm figure | 49,636          | 3,431      | 21 s (was 23 s)  | 18.8 s  | 7.0 s   | 48 s / 32 s              |
| MINI-001              | 32,054          | 996        | 5.2 s            | 13.5 s  | 4.0 s   | 21 s / 10 s              |
| M-001a                | 22,632          | 1,162      | 4.0 s            | 16.3 s  | 5.5 s   | 24 s / 12 s              |
| MINI-014              | 18,686          | 1,774      | 5.0 s            | 15.7 s  | 4.3 s   | 22 s / 10 s              |

Building the search tree takes about 0.2 s and 13–33 MB. Exact sampling makes the bake itself about three times slower than the nearest-vertex version (2K: 14–19 s instead of 4–6 s); at 1K it is 4–7 s. The unwrap reports its progress to the progress line.

Assessed, not built:

- _Unwrapping a lower level and transferring the coordinates_ does not work: the islands' borders of a coarse mesh do not follow the edges of a finer one, so triangles would straddle seams.
- _Splitting the mini into connected parts and unwrapping them in parallel workers_ would help multi-part sculpts on multi-core machines, since xatlas in WebAssembly is single-threaded. Worth trying if one minute for the largest minis is still too long.

Still open under #31: the measurement on the weak reference device, and the dependency decision. Recommendation: keep the pinned `xatlas-wasm` package during development and build xatlas from source before the first public release.

### Texture memory for baked minis (issue #30, spike, 2026-09-20)

**Where the memory went, and what was done.** The first version kept two RGBA textures per baked mini: a normal map and a colour map holding the look. Three changes:

1. **One packed texture.** The sculpt's normal goes in RGB and its fine cavity in alpha; the coarse occlusion stays on the vertices. The look is computed in the fragment shader from those, so there is no colour texture at all, and changing the look is two uniforms shared by every mini. Half the memory, and the Look panel costs nothing.
2. **Size by surface area** (`bake-policy.ts`, `?bake=auto`). The texture gets just enough texels to reach 0.1 mm on the surface: 512, 1024 or 2048. On the corpus that is 1K for the four ordinary minis (1,900–4,200 mm²) and 2K for the giant (16,100 mm²).
3. **GPU-compressed textures** (`?ktx=0..3`). The texture is encoded to KTX2 with UASTC in the browser and transcoded by three.js to the GPU's block format (BC7 on desktops): 1 byte per texel instead of 4. By eye there is no difference, also at the closest view.

GPU memory per baked mini, with mipmaps:

| Texture size | First version (two maps) | Packed  | Packed and compressed |
| ------------ | ------------------------ | ------- | --------------------- |
| 512          | 2.7 MB                   | 1.3 MB  | 0.3 MB                |
| 1024         | 10.7 MB                  | 5.3 MB  | 1.3 MB                |
| 2048         | 42.7 MB                  | 21.3 MB | 5.3 MB                |

One hundred ordinary minis at 1K, packed and compressed: **133 MB**, against 1.1 GB for the first version.

**Cost of compressing**, Chrome 153, primary reference machine, on the page's main thread:

| Texture | UASTC effort 0             | Effort 1     | Effort 2     |
| ------- | -------------------------- | ------------ | ------------ |
| 1K      | 1.4–2.3 s, 1.1 MB file     | 4.0 s        | 15.1 s       |
| 2K      | 5.7–6.3 s, 3.6–4.9 MB file | not measured | not measured |

Effort 0 shows no visible loss, so that is the setting. The encoder is 3.3 MB of WebAssembly, loaded on first use only. File sizes are without KTX2's own Zstandard compression, which is the next thing to switch on for downloads.

**Frame rate** is not the problem on this GPU. 100 baked minis at the table level: 1,081 fps with the cap lifted, against 1,734 with the per-vertex look; 400 baked minis with LOD by distance: 365 fps. The numbers at this level are noisy; what they show is that texturing costs little. Whether an integrated GPU agrees is part of #35.

**Fallback.** The stress scene takes a texture budget: minis are baked until the budget is used up, the rest use the per-vertex look (with 128 MB and compressed 1K textures: 96 of 100). In the table application the order should be nearest-first, and the budget should come from the device, not a constant.

**Recommendation**

- Table level: packed detail texture, size by surface area, compressed at UASTC effort 0. Far level: per-vertex look, no texture.
- A texture budget per device with the per-vertex look as the fallback. Starting value to test on the weak device: 256 MB.
- Encode in the worker, not on the page, before this leaves the spike stage; add Zstandard supercompression and measure the download size.
- Painting adds one colour texture per _painted_ mini (1K compressed: another 1.3 MB). Unpainted minis never need one.

### GLB export (issue #11, 2026-09-20)

One GLB per level, in two variants. **Plain**: float data, no extensions, opens everywhere including Blender. **Compressed**: 16-bit positions and 8-bit normals (KHR_mesh_quantization) packed with EXT_meshopt_compression; about a third of the plain size; needs a loader with meshopt support (three.js, Babylon.js, Godot 4; not Blender). Both pass the Khronos glTF validator with zero errors in the unit tests, carry the look as COLOR_0, and carry the raw shading data as `_SHADING` so an application can re-tint a mini later. Vertex data stays in mm; the node scale converts to glTF metres.

| Mini                  | STL   | Level               | Triangles        | Plain                  | Compressed           |
| --------------------- | ----- | ------------------- | ---------------- | ---------------------- | -------------------- |
| Large detailed giant  | 24 MB | close / table / far | 200k / 60k / 20k | 5,463 / 1,284 / 425 KB | 1,398 / 439 / 150 KB |
| Detailed 48 mm figure | 56 MB | close / table / far | 94k / 50k / 8k   | 2,018 / 1,067 / 175 KB | 659 / 359 / 63 KB    |
| MINI-001              | 26 MB | close / table / far | 66k / 32k / 5k   | 1,417 / 689 / 107 KB   | 461 / 233 / 40 KB    |
| M-001a                | 60 MB | close / table / far | 50k / 23k / 4k   | 1,074 / 486 / 86 KB    | 350 / 165 / 33 KB    |
| MINI-014              | 26 MB | close / table / far | 50k / 19k / 5k   | 1,075 / 402 / 102 KB   | 350 / 137 / 38 KB    |

All 15 compressed files were opened again in the viewer with matching triangle counts. Compressing takes 2–130 ms. What other players would download per mini (table + far, compressed) is 0.2–0.6 MB, against exit criterion 4's "typical GLB ≤1 MB".

### Stress scene (issue #12, 2026-09-20)

Primary reference machine only (RTX 3060, Chrome 153, 1920 × 1000). Copies of mini M-001a, each with its own buffers and draw call. "Cap lifted" runs Chrome without the display frame-rate limit to show headroom.

| Case                       | Triangles per frame | Normal                | Cap lifted | CPU per frame |
| -------------------------- | ------------------- | --------------------- | ---------- | ------------- |
| 100 minis, LOD by distance | 1.0 M               | 165 fps (display cap) | 672 fps    | 1.1 ms        |
| 400 minis, LOD by distance | 1.6 M               | 165 fps (display cap) | 298 fps    | 3.0 ms        |
| 100 minis, all 50k         | 5.0 M               | 165 fps (display cap) | 384 fps    | 2.4 ms        |
| 400 minis, all 50k         | 19.4 M              | 113 fps               | 126 fps    | 7.6 ms        |

Exit criterion 3 is **not met yet**: it needs the same measurement on an integrated GPU. Reproduce with `npm run build && node scripts/measure-stress.mjs`, or by hand with the "100 minis" button.

### Measurements on other devices (issue #35, 2026-09-20)

Taken by the PM with the "Benchmark this device" panel, served over the local network. No baking in these runs. Frame rates are capped by each display; the ramp (all minis at the table level, about 22k triangles each) shows where the cap stops holding.

|                                    | Ubuntu laptop, Intel Iris Xe (Alder Lake), Chrome 149 | Pixel 9, Mali-G715, Chrome 153 | Development PC, RTX 3060                   |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| 100 MB STL, 2 M triangles          | 3.4 s, no crash                                       | 5.5 s, no crash                | 5.6 s                                      |
| Longest stall of the page          | 83 ms                                                 | 150 ms                         | 212 ms                                     |
| Real 60 MB mini, 1.25 M triangles  | not run                                               | 2.5 s                          | 2.7 s                                      |
| 100 minis, detail by distance      | 60 fps (cap), 2.2 ms CPU                              | 60 fps (cap), 3.0 ms CPU       | 165 fps (cap), 1.1 ms CPU                  |
| 400 minis, detail by distance      | 60 fps (cap), 3.8 ms CPU                              | 60 fps (cap), 5.3 ms CPU       | 165 fps (cap), 2.7 ms CPU                  |
| Ramp: holds its display rate up to | 400 minis, 8.8 M triangles; 28 fps at 800             | not run yet                    | 400 minis, 9.0 M triangles; 105 fps at 800 |

**Exit criterion 1 is met** (a 100 MB binary STL converts in the browser on the reference laptop: 3.4 s, no crash) and **exit criterion 3 is met** (100 minis at 30 fps or more on an integrated GPU: 60 fps, with four times that scene in hand). A flagship phone converts as fast as the desktop, because the conversion is single-threaded.

Still owed: the Steam Deck; the ramp on the phone; baked minis (`?bake=auto&ktx=0`) on all of them, which also shows whether compressed textures work on a mobile GPU; a mid-range phone; a session long enough to show thermal throttling.

## Reference hardware

**Primary (PM's desktop, read from the machine on 2026-09-19):**

- Gigabyte B560M DS3H V3, Intel Core i7-11700F (8 cores / 16 threads), 64 GB RAM
- NVIDIA GeForce RTX 3060 (driver 32.0.16.1074), 1920×1080 at 144 Hz
- Windows 11 Home 10.0.26200, Chrome 153, Edge 153

This machine has a discrete GPU and no integrated one (the 11700F has none), and far more RAM than a typical user. Numbers measured here are an upper bound: they can prove something is too slow, but not that it is fast enough.

**Secondary devices (named by the PM on 2026-09-20; exact models come from the benchmark output):**

- an Ubuntu laptop with an integrated GPU: the reference for exit criteria 1 and 3
- a Steam Deck (AMD APU, 16 GB shared memory, Linux): a handheld with a mid-range integrated GPU
- a phone: expected to play, not to convert; the light benchmark shows how far it gets

Criteria 1 and 3 are only met when measured on the laptop. How to measure: `npm run lan` on the development PC, open the address it prints on the device (same network), open "Benchmark this device", run it, and paste the result into issue #35. Add `?bake=auto&ktx=0` to the address for the baked variant.
