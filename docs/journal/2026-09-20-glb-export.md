---
title: Export each detail level as a GLB, plain or compressed
date: 2026-09-20
phase: 0
issues: [11]
prs: [27]
topics: [export, compression, testing]
---

## What we did

The converter can now save the level on screen as a GLB file, the binary form of glTF 2.0, the common 3D format for the web and game engines. There are two variants: a plain file that opens everywhere, including Blender, and a compressed one about a third of the size. The viewer can also open GLB files, which is how we check that an export survives the round trip.

## Why

GLB is the converter's output format (issue #11, `docs/specs/phase-0-spike.md`). Whatever the converter produces has to load back into our own viewer and into standard tools, and its size decides how much other players of a campaign download.

## How

`src/pipeline/glb.ts` is a GLB writer with no dependency on three.js, so it can run anywhere the pipeline runs.

- **Plain**: float positions and normals, no extensions.
- **Compressed**: 16-bit positions and 8-bit normals (the `KHR_mesh_quantization` extension), packed with `EXT_meshopt_compression`. It needs a loader with meshopt support: three.js, Babylon.js and Godot 4 have one; Blender does not.

Both variants bake the current look (see the primed-and-washed look entry) into the standard `COLOR_0` vertex colour, and also store the raw occlusion and cavity numbers as a custom attribute `_SHADING`, so an application can re-tint a mini later without the source mesh. Vertex data stays in millimetres and the node scale converts to glTF's metres, so a 32 mm mini is 0.032 units tall in other tools, as the format expects.

**One file per level, not one file with all three.** The issue asked for "LODs" in the export (LOD, level of detail: the same mini at close, table and far resolution). A single file holding all three would be drawn with all levels on top of each other by generic viewers, and the only glTF extension for levels, `MSFT_lod`, is barely supported. So each level is its own file, named `<mini>-<level>.glb`.

**A validator instead of eyeballing.** The issue asked for a check in "one external glTF viewer". We replaced that with something stricter that runs in CI: the unit tests run the **Khronos glTF validator** (`gltf-validator`, Apache-2.0, a test-only dependency) on both variants and require zero errors. A human check in an external viewer was left as optional.

`scripts/export-sizes.mjs` prints the size table for the corpus and re-opens every compressed file.

## Problems and how we solved them

- **Problem.** The validator cannot look inside meshopt-compressed buffers, so for the compressed variant it checks structure only. **Fix:** a unit test decodes the compressed file and checks that every position is within one quantisation step of the original, and an end-to-end test re-opens an export in the viewer.
- **Problem.** The PR was stacked on the look PR (#26), since the export reuses the look's colour code. GitHub only closes an issue automatically when the closing PR merges into `main`. **Fix:** merge bottom-up (#27 into #26's branch, then #26 into `main`) and close #11 by hand.

## Dead ends

- A single GLB with all levels, via `MSFT_lod`: dropped before building, for the support reasons above.

## Numbers

Sizes per corpus mini, close / table / far level, measured with `scripts/export-sizes.mjs` on the development PC:

| Mini                        | STL   | Compressed GLB       | Plain GLB              |
| --------------------------- | ----- | -------------------- | ---------------------- |
| Large detailed giant, 77 mm | 24 MB | 1,398 / 439 / 150 KB | 5,463 / 1,284 / 425 KB |
| Detailed 48 mm figure       | 56 MB | 659 / 359 / 63 KB    | 2,018 / 1,067 / 175 KB |
| 554k-triangle mini          | 26 MB | 461 / 233 / 40 KB    | 1,417 / 689 / 107 KB   |
| Smooth goblin sculpt        | 60 MB | 350 / 165 / 33 KB    | 1,074 / 486 / 86 KB    |
| 546k-triangle mini          | 26 MB | 350 / 137 / 38 KB    | 1,075 / 402 / 102 KB   |

- Table plus far level, compressed, which is what other players would download: 0.2 to 0.6 MB per mini, against the spike's target of a typical GLB at 1 MB or less.
- Compressing takes 2 to 130 ms per file.
- All 15 compressed exports re-opened in the viewer with matching triangle counts.
- Tests at merge: 67 unit, 6 end-to-end.

## Still open

- Encoding runs on the page, not in the worker. At 130 ms worst case that was fine; it should move once exports carry textures.
- 8-bit normals are coarser than the plain file's floats. No difference was visible on screen, but that is a judgement call.
- Baked minis cannot be exported yet: object-space normal maps are not part of glTF and need a tangent-space conversion first (#36).

## Story angle

Why a spec's "check it in an external viewer" turned into the Khronos validator in CI, and why "LODs in one file" is a trap. Possible title: "A 60 MB sculpt in 200 KB: exporting minis as GLB".
