---
title: Unwrap and baked detail maps, and a no-go the PM overruled
date: 2026-09-20
phase: 0
issues: [10, 29, 30, 31]
prs: [28]
topics: [unwrap, bake, planning]
---

## What we did

We tested whether the browser can give a reduced mini the fine detail of the original sculpt through textures. The table level was unwrapped (given texture coordinates) and the sculpt's surface detail was baked into maps. It works, and on a smooth sculpt the original's wrinkles and eyelids come back on a 23k-triangle mesh. The feature stayed off by default, behind `?bake=<size>` in the address.

## Why

"Variant B" of the Phase 0 spike (issue #10, `docs/specs/phase-0-spike.md`). Per-vertex shading cannot be sharper than the mesh (see the primed-and-washed look entry), and texture coordinates are also the prerequisite for painting minis later. The spike was named the main technical risk of the project.

## How

Two terms first. **Unwrapping** cuts a 3D surface into flat pieces ("UV islands") laid out on a square texture, so every point of the mesh has a place in an image. **Baking** fills that image with information taken from another mesh, here the full-detail sculpt.

- `src/pipeline/unwrap.ts` unwraps the table level with xatlas, a C++ unwrapping library, compiled to WebAssembly and run in the worker. It is loaded on first use only, so conversions without baking never download it.
- `src/pipeline/bake.ts` visits every texel (texture pixel) of the unwrapped table level and finds the nearest vertices of the full sculpt with a spatial hash. It stores their blended normal and a fine cavity value, as object-space normals, and dilates each island so seams do not show. A facing filter keeps the inside of a cloak from answering for its outside. Large-scale occlusion is not baked; it is interpolated from the table level's vertices, because it is coarse by design.
- `look.ts` shares one colour formula between both variants; a 256 × 256 lookup table turns the baked maps into a colour texture, so the Look panel stays instant.
- `scripts/compare-bake.mjs` renders sculpt, Variant A (per-vertex look) and Variant B (baked maps) side by side at three zoom levels.

The dependency is `xatlas-wasm` 0.1.3, pinned exactly. It was five months old with one maintainer, so its bundle was checked for network calls and dynamic code (none found) before use.

**The recommendation, and the decision.** The agent's written recommendation was **no-go for release**:

- At table distance, B added nothing visible over A. The gain only showed at zoom levels nobody plays at.
- GPU memory: about 43 MB per mini at 2K (normal map plus colour map, with mipmaps), 11 MB at 1K, against 1 to 2 MB for the per-vertex look. One hundred minis would not fit on an integrated GPU without compressed textures, and a browser-side encoder looked heavy.
- Unwrap time grew steeply, to over two minutes for the large giant on a fast desktop.
- Vertex counts roughly doubled, because every island border splits vertices.

It proposed instead to unwrap on demand when a user first paints a mini, with one colour texture and no normal map.

**The PM decided go on 2026-09-20: baked maps ship at release, on all minis.** The PM weighed the close-up quality higher; the smooth goblin's close-up was named "the look to aim for". The spec records the decision in place of the no-go, with the agent's reasoning kept. What had to be solved first was filed as `release-blocker` issues: **#29** bake sampling, **#30** texture memory, **#31** unwrap time. The later entries on BVH sampling, texture memory and the device benchmark show how each was worked off, and the device results showed the decision to be viable.

## Problems and how we solved them

- **Problem.** Very close on the large giant's beard, B looked **worse** than A: blotchy and noisy. **Cause:** nearest-vertex sampling breaks down where strands lie close together and the sculpt's vertices are no denser than the texels. **Fix:** closest-point-on-triangle sampling through a BVH, filed as #29 and done in #32.
- **Problem.** For under 2 % of covered texels no sculpt vertex was close enough. **Fix:** those texels use the reduced mesh's own normal.

## Numbers

Chrome 153, development PC, 2K maps:

| Mini                  | Table triangles | UV islands | Vertices before → after | Unwrap  | Bake  | Whole conversion |
| --------------------- | --------------- | ---------- | ----------------------- | ------- | ----- | ---------------- |
| Smooth goblin sculpt  | 22,632          | 1,223      | 11,260 → 19,982         | 3.7 s   | 4.4 s | 11.8 s           |
| 554k-triangle mini    | 32,054          | 1,029      | 15,999 → 25,476         | 4.5 s   | 4.0 s | 10.4 s           |
| Detailed 48 mm figure | 49,636          | 3,513      | 24,775 → 46,509         | 23.2 s  | 5.7 s | 36.0 s           |
| Large detailed giant  | 59,974          | 6,952      | 29,794 → 64,307         | 132.0 s | 5.6 s | 143.0 s          |

At 1K the bake drops to 1.6 to 1.9 s; the unwrap time does not change. Islands cover about half of the texture. Nearly all the unwrap time is xatlas finding the islands; packing and baking are minor. Tests at merge: 74 unit, 7 end-to-end.

## Still open

- Object-space normal maps are not part of glTF; exporting baked minis needs a tangent-space conversion (#36).
- The PM later decided to build xatlas from source before release instead of shipping the young package (#33).
- The spec edit in this PR that recorded the PM's decision accidentally deleted three spec sections. It was caught and fixed in #32; see the BVH sampling entry.

## Story angle

An honest no-go from the engineer, overruled by the product owner, and then made to work. Possible title: "The spike said no. The PM said go."
