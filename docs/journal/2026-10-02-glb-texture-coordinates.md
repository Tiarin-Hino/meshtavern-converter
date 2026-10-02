---
title: Texture coordinates in the table level's GLB
date: 2026-10-02
phase: 2
issues: [109]
prs: []
topics: [export, glb, bake, library]
---

## What we did

A mini's table level exported as a GLB file now carries its texture coordinates, so an application that stores the GLB and the detail texture can put the two together again. Nothing changes for a file exported from a level that was never unwrapped: it is the same file as before, byte for byte.

## Why

Issue #109, a release blocker found in the design pass of the table view (the table application's own repo). The converter bakes the sculpt's fine detail into a texture for the table level. For that it unwraps the level: every vertex gets a position on the texture (its texture coordinates, `uvs`), and the mesh is cut along seams. On the page the baked mini is drawn straight from memory, where the coordinates are at hand. The table application instead stores two files per mini, the GLB and the KTX2 texture, and draws them later. The GLB writer (`src/lib/pipeline/glb.ts`) wrote positions, normals, colours and the shading data only, so the stored texture had nothing to hold on to.

## How

- **`TEXCOORD_0` when the mesh has `uvs`.** In the plain variant two floats per vertex, the unwrap's values unchanged. In the compact variant two normalised 16-bit numbers, which the `KHR_mesh_quantization` extension the file already requires allows; one step is 1/65535 of the texture, far below a texel at any size we bake (up to 4096). The coordinates are written exactly as the unwrap made them, not flipped: three.js's glTF loader does not flip them either and KTX2 textures are not flipped on load, so `createBakedMaterial` gets the same values from the file as from memory.
- **Last in the accessor list.** The new accessor comes after the shading data (index 5, or 4 for a mesh without shading), so the indices of everything else stay and a mesh without `uvs` produces the same bytes.
- **Through the renumbering.** The compact variant reorders vertices for the codec; the helper that carries the vertex data along (`reordered`) now carries `uvs` too. It dropped them silently before.
- **No texture in the file.** The GLB has no material texture and no image; the coordinates are there for our own material, which takes the KTX2 file separately and reads the occlusion from `_SHADING`. A baked mini any glTF viewer can show (tangents, a tangent-space normal map, embedded textures) is #36 and builds on this.
- **Which mesh to export.** The unwrapped mesh is `result.baked.mesh`, not `result.lods[BAKED_LEVEL].mesh`: same triangles, more vertices. The README example now exports `result.baked?.mesh ?? table.mesh`. The page's download buttons still write the level without coordinates, because the page offers no texture to go with them outside `?dev`; the test hook `exportGlb(level, compact, unwrapped)` writes the unwrapped one.
- **Proof.** Unit tests run the Khronos validator on both variants with coordinates, with and without shading data; compare the plain floats with the input; and decode the compact file and check every vertex's coordinates against its own decoded position, which only holds when they travelled with their vertex. The regression net records the two file sizes of the baked level in the `figure` case. The e2e round trip exports the unwrapped level in both variants, opens it on the page and checks that the geometry has `uv` and the triangle count is the level's.

## Problems and how we solved them

- **Problem.** "Byte for byte as before" cannot be pinned by a permanent test without freezing the look, the test mesh and the codec's version in a hash. **Fix:** a one-off comparison while building: the encoder from `main` and the new one, on the generated sheet and the generated figure, with and without shading data, plain and compact: eight files, identical. Permanently, the baseline's per-level sizes (unchanged) and a test that a mesh without `uvs` still has five accessors and no `TEXCOORD_0`.
- **Problem.** `npm run check` stops at the format check on the development PC when a large archive lies in the repo folder (Prettier cannot read it). **Cause:** a local, untracked file, nothing in the repo. **Fix:** none here; the steps were run one by one.

## Numbers

Generated figure (`figure` case of the regression net, 35,012 triangles at the table level, baked at 512 px), sizes of the exported file. Node, development PC; sizes do not depend on the device.

| Table level                        | Vertices | Plain GLB       | Compact GLB   |
| ---------------------------------- | -------- | --------------- | ------------- |
| as a level (no coordinates)        | 17,516   | 772,032 bytes   | 259,716 bytes |
| unwrapped, coordinates left out    | 30,721   | 1,194,596 bytes | 425,068 bytes |
| unwrapped, with `TEXCOORD_0` (new) | 30,721   | 1,440,512 bytes | 514,060 bytes |

Most of the growth is the unwrap's seams (1,895 charts: 75 % more vertices), not the coordinates: they add 8 bytes per vertex plain and 2.9 bytes per vertex compact.

## Still open

- The table's GLB is about twice the size of the level without coordinates. Fewer charts would mean fewer split vertices; nobody has measured what that costs the bake.
- #36: a baked mini for any glTF viewer.

## Story angle

The texture was there, the mesh was there, and one missing attribute kept them apart. "Two files, one mini: what a GLB needs to find its texture."
