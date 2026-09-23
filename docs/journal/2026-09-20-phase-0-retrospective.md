---
title: Phase 0 in retrospect - can the browser make a good-looking mini?
date: 2026-09-20
phase: 0
issues: [5, 14]
prs: [48]
topics: [planning, devices, workflow]
---

## What we did

Phase 0 was a spike: throwaway-quality code to answer three questions before building a product. Can a browser process a real sculpted STL of up to 100 MB? Does a reduced mini look good enough, with per-vertex shading (Variant A) and with baked detail maps (Variant B)? Can a laptop with an integrated GPU show 100 minis at 30 fps or more? All three came out yes, on real devices. PR #48 wrote that up in `docs/specs/phase-0-spike.md`, closed the write-up issue #14 and the Phase 0 epic #5, and handed over to Phase 1.

## Why

The spike existed to kill the project early if the browser could not do the job. The time box was one to two weeks; it took two days of agent work, 19 and 20 September 2026, across the converter PRs #16 to #48.

## How

The work followed the pipeline in order, each step a pure function on typed arrays in a Web Worker: read and weld the STL, orient and place it, reduce it to detail levels with meshoptimizer, shade it per vertex, unwrap and bake it, export it as GLB, and put a hundred of them on a table. The journal entries for the individual PRs tell each step; the decisions recorded at the end were:

| Decision      | Outcome                                                                                                                                 | Decided by                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Simplifier    | meshoptimizer; the alternative was never needed                                                                                         | PM, on the recommendation in #8 |
| Detail levels | Defined by allowed deviation from the sculpt with a floor and a cap (close 0.02 mm, table 0.05 mm, far 0.2 mm), not by triangle budgets | PM, #24                         |
| Orientation   | Detected from the base, guessed without one, always overridable                                                                         | #21                             |
| Variant A     | Built; the far level's look and the fallback where textures do not fit                                                                  | PM, #9                          |
| Variant B     | Go, at release, on all minis, against the spike's no-go                                                                                 | PM, #10, #29, #30               |
| Export        | One GLB per level, plain or compressed                                                                                                  | #11                             |
| Dependencies  | meshoptimizer stays; `xatlas-wasm` is replaced by our own build before release (#33); `ktx2-encoder` is reviewed with #38               | PM                              |

## Problems and how we solved them

- **Fixed triangle budgets.** The first levels were 50k, 15k and 4k triangles. The PM's verdict: fine for simple minis, awful for detailed commercial sculpts at 15k. **Cause:** triangle count does not measure detail; to stay within 0.05 mm, one 1.25M-triangle mini needs 14k triangles and a 0.5M-triangle giant needs 144k. **Fix:** levels driven by an error limit in millimetres, carrying the sculpt's normals (#24).
- **The spike's own no-go on baked maps.** The agent recommended against baked maps at release: no gain at table distance, 11 to 43 MB of GPU memory per mini, unwraps of over two minutes, blotchy dense sculpts. The PM weighed close-up quality higher and decided go. The objections became three release blockers, and each was worked off the same day: BVH sampling fixed the blotches (#29), one packed, compressed texture cut 100 minis from 1.1 GB to 133 MB (#30), and a warm-up plus one xatlas setting cut the giant's unwrap from 132 s to 61 s (#31). The device runs then showed the decision to be viable.
- **Process slips.** Stacked PRs merged by squash left three PRs (#20, #22, #25) as one commit on `main`, and issues had to be closed by hand; the lesson was to merge stacks bottom-up or avoid deep stacks. A scripted docs edit in #28 silently deleted three spec sections, restored in #32; since then every scripted docs edit compares headings before and after. A `%` typed for `&` in an address made two benchmark runs measure nothing; address options are now strict (#39).

## Dead ends

- Fast-Quadric-Mesh-Simplification was not integrated: no npm package, and its only WebAssembly builds were unmaintained and exchanged data through temporary files.
- A draft carrying source normals into fixed budgets (#23) was closed, superseded by error-driven levels (#25).
- Unwrapping a coarse level and transferring its coordinates cannot work: coarse island borders do not follow the finer mesh's edges.
- Two-channel normal maps break under filtering for object-space normals; packing cavity into alpha saved the same memory.

## Numbers

Exit criteria as recorded in PR #48:

| #   | Criterion                                          | Outcome                                                                                                                                                                                             |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 100 MB STL converts on the reference hardware      | Met: 3.4 s on the reference laptop, 5.5 s on the phone, no crash                                                                                                                                    |
| 2   | A and B screenshots for a corpus of 20 to 30 minis | Partly met: five minis; sheets sent to the PM, not committed, because the minis are the PM's own or licensed                                                                                        |
| 3   | 100 minis at 30 fps on an integrated GPU           | Met: 60 fps on the reference laptop; holds to 400 unbaked or 200 baked minis                                                                                                                        |
| 4   | Output size                                        | Met for A: 0.2 to 0.6 MB for table plus far level. B adds a 1.1 MB texture at 1K (1.3 to 1.7 MB per ordinary mini); a 2K texture is 3.6 to 4.9 MB, over the 4 MB target until Zstandard is on (#38) |
| 5   | Decisions                                          | Met                                                                                                                                                                                                 |

An ordinary mini converts with unwrap, bake and texture compression in 9.3 s on the reference laptop and 10.9 s on the phone. The largest corpus mini took 84 s at 2K on the development PC. The phase ended with 88 unit and 8 end-to-end tests.

## Still open

What Phase 0 did not answer went to Phase 1:

- The corpus was five clean minis. Supported, non-manifold and multi-part files, files in inches or metres, and minis that need scaling to a base size are untested.
- Unwrapping a large detailed mini on weak hardware, and thermal throttling in a long session (#35).
- Download size of baked minis: no Zstandard yet, and encoding runs on the page instead of in the worker (#38).
- On a phone, large tables are bound by draw calls; merging or instancing belongs to the table application.

The hand-over: Phase 1, the converter at product quality, is epic #40 with stories #41 to #47, and the release blockers #33, #35 and #38 linked to it. None was labelled `ready-for-agent`: the PM decides what starts. Publishing (#47) was later moved out of the phase, because the PM decided not to publish the converter before the table exists.

## Story angle

A two-day spike that answered three existential questions, including one where the engineer said no and the product owner said go, and the measurements sided with the product owner. Possible title: "Two days to find out whether a browser can make a mini look good".
