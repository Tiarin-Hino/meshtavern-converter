---
title: Baked, compressed minis as the normal path
date: 2026-09-21
phase: 1
issues: [42, 38]
prs: [53]
topics: [bake, compression, textures, worker, performance, ui]
---

## What we did

Dropping an STL now gives the best-looking mini without any option: it is unwrapped, its detail texture baked and compressed, all in the background. A converted mini opens on its table level, baked, which is what the table will show; it used to open on the full sculpt. If any of these steps fails, the mini still arrives with the simpler per-vertex look and a stated reason. A new Cancel button stops a running conversion at once.

## Why

Phase 0 had shown that baking and texture compression work, but only behind address options. Phase 1 story 2 (#42 with #38, [spec](../specs/phase-1-converter.md)) makes them the default, so what a user sees is what the table will show.

Three terms: **unwrap** lays the mini's surface flat into islands on a square texture (texture coordinates, from xatlas); **bake** samples the full sculpt's fine detail into that texture for the lighter table level; **KTX2** is a GPU texture container that stays compressed in video memory.

## How

- Unwrap, bake and encode run in the conversion worker as timed steps with progress. The texture size comes from the size policy (by surface area). Encoding is KTX2 with UASTC at effort 0, the Phase 0 setting, plus Zstandard supercompression, using `ktx2-encoder` 0.6.0 (pinned). three.js transcodes the file to the GPU's format in its own workers.
- The raw texture is dropped inside the pipeline; the KTX2 file is the only copy that reaches the page.
- **Fallback:** a failing unwrap, bake, encode or transcode, or a texture larger than the GPU's size limit, leaves a whole mini with the per-vertex look and the reason in `stats.bakeSkipped`. #38 had asked for an uncompressed texture when the encoder fails; the accepted spec asks for the per-vertex look, so that no raw texture is ever kept. The PR followed the spec and #38 was amended.
- **Cancel** ends the worker and starts a fresh one. A pipeline step can run for minutes of WebAssembly and cannot be interrupted by a message; ending the worker also frees its memory.
- `?bake=` and `?ktx=` remain as development switches.

## Problems and how we solved them

- **Problem.** The first corpus run over 30 minis showed page stalls of 91 to 121 ms for the first four minis, at or over the proposed 100 ms limit. **Cause:** showing the full sculpt first. **Fix:** open on the table level, which costs 0 to 1 ms to show.
- **Problem.** While measuring, a finished conversion never finished in a hidden tab or with the screen locked. **Cause:** it waited two animation frames to count the GPU upload in the stall, and a hidden tab gets no frames. **Fix:** a 500 ms timer races the frames. No automated test for the hidden-tab case.
- **Problem.** Times from the full 30-mini run were unusable. **Cause:** the PC ran at about half speed for most of it; untouched steps such as weld and simplify doubled too. **Fix:** a separate five-mini measurement at normal speed; sizes, counts and fallbacks from the full run stayed valid. From then on every timing run was checked against steps the change does not touch.
- **Problem.** CI draws in software on two shared cores. **Fix:** e2e enforces 100 ms only with `STALL_LIMIT=strict`, 400 ms on CI.

## Numbers

**Development PC**, Chrome 153, fresh page per mini:

- Longest page stall from conversion start until the mini is on screen: 18, 18, 24, 24 and 49 ms for five corpus minis of 144k to 1.25M triangles (software rendering locally: 33 ms).
- Texture file sizes, all 30 corpus minis: 512 px 315 to 317 KB (raw 1,024 KB); 1024 px 1,120 to 1,244 KB (raw 4,096 KB); 2048 px 3,601 to 4,865 KB (raw 16,384 KB). 3.2 to 4.5 times smaller as a file, 4 times smaller on the GPU.
- Encoding: 0.4 s at 512 px, 1.9 s at 1024 px, 6.6 s at 2048 px.
- 30 of 30 baked, no fallback; sizes chosen 512 px × 3, 1024 px × 11, 2048 px × 16.
- Whole conversions: 9.5 to 14 s with a 1K texture; 38 s for a 150k-triangle mini with a 2K texture.

## Still open

- Against the 15 s target, compression adds about 2 s at 1K and 6 to 7 s at 2K on the development PC, and the unwrap still dominates. The next corpus run put the unwrap at 52 % of all conversion time (see 2026-09-21-unwrap-spike.md).
- An empty STL gets a blank baked texture instead of a refusal; moved to #43.
- #38 stays open for the dependency review of `ktx2-encoder`.

## Story angle

Making the expensive path the default, and what "never freeze the page" costs in practice. Title idea: "The mini you see is the mini you get".
