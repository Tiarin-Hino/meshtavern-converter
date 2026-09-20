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
