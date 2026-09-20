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

| #   | Criterion                                                                      | Measure                                                                      |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | A 100 MB binary STL converts in the browser on the reference hardware          | Time and peak memory recorded; no tab crash                                  |
| 2   | Variant A and Variant B screenshots for every mini in the corpus (20–30 files) | Side-by-side contact sheet in `docs/design/` (renders only, no source files) |
| 3   | 100 unique converted minis on screen                                           | ≥30 fps on an integrated GPU; frame time recorded                            |
| 4   | Output size                                                                    | Typical GLB ≤1 MB (A) / ≤4 MB with textures (B)                              |
| 5   | Decision                                                                       | Go/no-go on Variant B; chosen simplifier; triangle budgets                   |

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

**Recommendation: no-go for baked normal maps at release; conditional go for unwrapping when painting is built.**

- Ship variant A. The error-driven levels with carried normals already look right at the distances a table is played at, which is where baked maps add nothing.
- Painting is the real reason to unwrap: per-vertex paint on a table-level mesh has a "brush" of about 0.5 mm, too coarse for eyes and trim, while a 1K colour texture gives 0.07 mm. That needs the unwrap and one colour texture (about 5 MB), but no normal map.
- So unwrap **on demand, when a user first paints a mini**, not at upload; show progress; accept seconds to minutes once per painted mini. Before building that, test cheaper unwrap settings on large minis.
- Revisit baked normal maps only together with a BVH-based bake and compressed textures.

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

## Reference hardware

**Primary (PM's desktop, read from the machine on 2026-09-19):**

- Gigabyte B560M DS3H V3, Intel Core i7-11700F (8 cores / 16 threads), 64 GB RAM
- NVIDIA GeForce RTX 3060 (driver 32.0.16.1074), 1920×1080 at 144 Hz
- Windows 11 Home 10.0.26200, Chrome 153, Edge 153

This machine has a discrete GPU and no integrated one (the 11700F has none), and far more RAM than a typical user. Numbers measured here are an upper bound: they can prove something is too slow, but not that it is fast enough.

**Secondary (needed for exit criteria 1 and 3): to be named.** A laptop with an integrated GPU and 8–16 GB RAM, for example a team member's. Criteria 1 and 3 are only met when measured on this device.
