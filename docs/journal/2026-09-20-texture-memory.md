---
title: One packed, compressed detail texture within a budget
date: 2026-09-20
phase: 0
issues: [30]
prs: [37]
topics: [textures, compression, performance]
---

## What we did

A table of one hundred baked minis used to need about 1.1 GB of GPU memory, which no integrated GPU has. It now needs 133 MB, with no visible difference. Each baked mini carries one detail texture instead of two, sized to the mini's surface, and compressed in a format the GPU reads directly. When a device's texture budget runs out, the remaining minis fall back to the per-vertex look.

## Why

The PM decided that baked detail maps ship on all minis (see the unwrap-and-bake spike entry). The spike had measured about 43 MB of GPU memory per mini at 2K and 11 MB at 1K. Better sampling (see the BVH entry) did not change that, so issue #30 was filed as a release blocker: find a policy that lets a full table of baked minis run on the weak reference device.

## How

Four changes, all still behind address options (`?bake=…`, and `?ktx=0` for compression):

1. **One packed texture instead of two.** The first version kept a normal map and a separate colour map holding the finished look. Now `bake.ts` writes the sculpt's normal to the RGB channels and its fine cavity to alpha; the coarse occlusion stays on the vertices. A custom material (`src/baked-material.ts`) computes the look in the fragment shader from those. There is no colour texture at all, and the Look panel became two uniforms shared by every mini. The colour texture code from #28 was removed again.
2. **Size by surface area.** `src/pipeline/bake-policy.ts` picks 512, 1024 or 2048 pixels so that one texel covers about 0.1 mm of surface. With `?bake=auto`, the four ordinary corpus minis (1,900 to 4,200 mm²) get 1K and the large giant (16,100 mm²) gets 2K.
3. **GPU-compressed textures.** A normal image in memory costs 4 bytes per texel. GPUs can read block-compressed formats directly, at 1 byte per texel here, but each GPU family has its own format. KTX2 is a container for textures in a universal intermediate form (UASTC, from the Basis Universal project) that is transcoded on the device into whatever block format its GPU supports (BC7 on desktops). `src/compressed-texture.ts` encodes the detail texture to KTX2 with UASTC in the browser using `ktx2-encoder` 0.6.0 (pinned, MIT, 3.3 MB of WebAssembly, loaded on first use), and three.js transcodes it. `vite.config.ts` serves the Basis transcoder that ships with three.js.
4. **Texture budget with fallback.** The stress scene takes a budget in megabytes: minis are baked until it is used up, the rest use the per-vertex look. The read-out shows how many minis are baked and how much texture memory they use.

## Problems and how we solved them

- **Problem.** Encoding runs on the page's main thread and freezes the page for the seconds it takes. **Fix:** not yet; recorded as the condition for this leaving the spike stage (#38).
- **Problem.** Frame rates above a thousand are noisy, and a web page cannot ask the GPU how much memory it uses. **Fix:** memory figures are calculated from texture sizes, and the frame rates are read only as "texturing costs little on this GPU".

## Dead ends

- **Two-channel normals** were on the issue's list of options and were dropped. Object-space normals need the full sphere of directions, and two-channel encodings of a sphere break under texture filtering. Packing cavity into alpha saved the same memory without that problem.

## Numbers

GPU memory per baked mini, with mipmaps, calculated from texture sizes:

| Texture size | First version (two maps) | Packed  | Packed and compressed |
| ------------ | ------------------------ | ------- | --------------------- |
| 512          | 2.7 MB                   | 1.3 MB  | 0.3 MB                |
| 1024         | 10.7 MB                  | 5.3 MB  | 1.3 MB                |
| 2048         | 42.7 MB                  | 21.3 MB | 5.3 MB                |

Stress scene, Chrome 153, development PC (RTX 3060), frame-rate cap lifted, copies of the smooth goblin sculpt, each owning its texture, measured with `scripts/measure-baked.mjs`:

| Case                                    | 1K packed         | 1K packed and compressed |
| --------------------------------------- | ----------------- | ------------------------ |
| 100 minis, table level, per-vertex look | 1,361 fps, 0 MB   | 1,734 fps, 0 MB          |
| 100 minis, table level, baked           | 1,032 fps, 533 MB | 1,081 fps, 133 MB        |
| 100 minis, baked within 128 MB          | 24 baked          | 96 baked                 |
| 400 minis, detail by distance, baked    | 371 fps, 2,133 MB | 365 fps, 533 MB          |

Encoding on the main thread, same machine: 1K in 1.4 to 2.3 s at UASTC effort 0, 4.0 s at effort 1, 15.1 s at effort 2; 2K in about 6 s at effort 0. Effort 0 shows no visible loss, also at the closest view, so it is the setting. Files: 1.1 MB at 1K, 3.6 to 4.9 MB at 2K, without Zstandard supercompression. Tests at merge: 84 unit, 7 end-to-end.

## Still open

- Memory and frame rate on an integrated GPU: no device was available yet; moved to #35 (see the device benchmark entry).
- Encoding in the worker and Zstandard supercompression for download size: #38.
- The budget is a constant. The table application needs nearest-first ordering and a budget that comes from the device; the spec suggests 256 MB as a starting value to test.
- `ktx2-encoder` carries the same supply-chain caveat as `xatlas-wasm`: fine for development, to be reviewed before release (#38).
- Painting would add one colour texture per painted mini (1K compressed: 1.3 MB); unpainted minis never need one.

## Story angle

From 1.1 GB to 133 MB without losing a pixel: pack two maps into one, let the shader do the look, and ship GPU-native compressed textures from the browser. Possible title: "Fitting a hundred baked minis into an integrated GPU".
