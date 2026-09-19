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
| 1   | A 100 MB binary STL converts in the browser on the reference laptop            | Time and peak memory recorded; no tab crash                                  |
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

## Reference hardware

To be filled in by the PM: laptop model, CPU, iGPU, RAM, browser version.
