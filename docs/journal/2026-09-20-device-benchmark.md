---
title: A one-button device benchmark, and a typo that measured nothing
date: 2026-09-20
phase: 0
issues: [35]
prs: [39]
topics: [devices, performance, tooling]
---

## What we did

The converter got a "Benchmark this device" panel. It needs no files: it converts a generated test mesh (or the mini that is loaded), runs three table scenes, then keeps adding minis until the frame rate drops, and prints a result to paste into an issue. The PM ran it on a laptop with integrated graphics and on a phone, and those runs met two of the Phase 0 exit criteria. Mistyped address options are now reported instead of silently changing what gets measured.

## Why

The development PC can show that something is too slow, not that it is fast enough. Exit criteria 1 (a 100 MB STL converts on the reference hardware) and 3 (100 minis at 30 fps or more on an integrated GPU) could only be met on a weak device. Issue #35 needed a human holding the device, so the tool had to be easy to run.

## How

- **Benchmark panel** (`src/benchmark.ts`). "Light" converts a generated 0.5M-triangle mesh, "full" a 2M-triangle, 100 MB one. Then three table scenes (100 minis with detail by distance, 100 all at table level, 400 with detail by distance), each reporting frame rate, worst frame, CPU time per frame and triangles. The result is Markdown.
- **Headroom ramp.** Browsers cap the frame rate at the display's refresh rate, so "60 fps" says nothing about how much room is left. The ramp puts 100, 200, 400, 800 and 1,600 minis at table level and stops when the rate falls below 85 % of the best seen. It was added after the first phone runs showed nothing but the cap.
- **Mode links** in the panel (plain, baked compressed, baked uncompressed), so options never have to be typed on a phone.
- **`npm run lan`** builds and serves the page on the local network, so a laptop or phone can open it from the development PC.

## Problems and how we solved them

- **Problem.** Two of the PM's "baked" runs measured nothing baked: the last column showed 0 baked minis. **Cause:** the address was `?bake=auto%ktx=0`, with `%` where `&` belongs. The app accepted that silently: it unwrapped the mini, then "baked" a texture of size NaN. **Fix:** `src/options.ts` parses address options strictly. Unknown or malformed options are ignored and reported in the status line and in the benchmark output, with a specific hint for a stray `%`. Four unit tests, one of them that exact typo.
- **Problem.** One phone run reported a "longest stall of the page" of 6,353 ms, the whole conversion, against 150 ms in an identical earlier run. **Cause:** most likely a throttled or background tab, since the conversion runs in a worker. **Fix:** none needed; the next run was back at 23 ms.

## Numbers

Measured by the PM on 2026-09-20 with the benchmark panel. Laptop: Ubuntu, Intel Iris Xe, Chrome 149. Phone: Pixel 9, Mali-G715, Chrome 153. Development PC: RTX 3060. Baked runs use the smooth goblin sculpt (1.25M triangles) with a 1K KTX2 texture, every mini owning its texture.

|                                             | reference laptop             | Phone                                               | development PC       |
| ------------------------------------------- | ---------------------------- | --------------------------------------------------- | -------------------- |
| 100 MB STL, 2M triangles                    | 3.4 s, no crash              | 5.5 s, no crash                                     | 5.6 s                |
| 100 and 400 minis, detail by distance       | 60 fps (cap)                 | 60 fps (cap)                                        | 165 fps (cap)        |
| Ramp, unbaked, table level                  | 60 fps to 400 minis          | 60 fps to 400 minis                                 | 165 fps to 400 minis |
| Real mini including unwrap, bake, KTX2      | 9.3 s                        | 10.9 s                                              | about 12 s           |
| 100 and 400 baked minis, detail by distance | 60 fps (cap)                 | 60 fps (cap)                                        | 165 fps (cap)        |
| Ramp, baked, table level                    | 60 fps to 200; 44 fps at 400 | 60 fps to 400; 22 fps at 800 (1,067 MB of textures) | 165 fps to 400       |

- Unwrap / bake / encode of the goblin: 2.4 / 3.6 / 1.3 s on the laptop, 3.0 / 3.3 / 1.6 s on the phone.
- Unbaked ramp at 800 minis: laptop 28 fps in the first run and 50 fps in a later one; phone 32 to 39 fps with CPU time per frame rising from 5.5 ms to 17 to 22 ms, so the phone is bound by draw calls (one per mini), not triangles.
- The phone converted the 100 MB file as fast as the desktop: the conversion is single-threaded.
- Tests at merge: 88 unit, 8 end-to-end.

What this settled: **exit criterion 1 met** (3.4 s on the laptop, no crash) and **exit criterion 3 met** (60 fps on an integrated GPU, with four times the target scene in hand). Baked minis at release are viable on an integrated GPU and a flagship phone, and KTX2 textures work on the mobile GPU. That validated the PM's go decision on baked maps (see the unwrap-and-bake spike entry).

## Still open

- A large mini with a 2K texture on the laptop, above all for unwrap time. It was measured in Phase 1 on 2026-09-23: 54.4 s, and 20.1 s after the slab unwrap (#57, PR #61), both on the power cord (see issue #35).
- A session long enough to show thermal throttling; scenes run only about eight seconds each.
- The Steam Deck and a mid-range phone were dropped by the PM on 2026-09-20; the laptop and the Pixel 9 cover the low end.

## Story angle

Display caps hide everything, and one mistyped character can make a benchmark measure nothing. Possible title: "60 fps tells you nothing: benchmarking a VTT on a laptop and a phone".
