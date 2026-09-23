# Phase 1: the converter, product quality

Status: accepted by the PM on 2026-09-20, including the order of the stories · Owner: PM · Epic: #40 · Written: 2026-09-20

Everything marked _(proposal)_ was the agent's suggestion for product behaviour; it stands unless the PM changes it. Phase 0's results and decisions are in [phase-0-spike.md](phase-0-spike.md).

## Goal

Turn the spike into the component the MeshTavern table will use to take in minis: a person drops an STL and, without reading anything or choosing options, gets an upright, correctly sized, good-looking, baked mini, or a clear explanation of why not. The file never leaves their device.

## Decisions taken by the PM for this phase (2026-09-20)

- **No public launch in Phase 1.** The converter stays unpublished until the table exists. The source repository is public already; "launch" means a deployed page and telling people about it.
- When it is published, it goes to **GitHub Pages**.
- **Downloads offer the table and far levels only.** The close level is shown on screen but not exported, in line with what may leave a device.
- **The page collects nothing**: no analytics, no email field.

## Users

- The PM and the team, now: converting their own minis, judging looks, testing devices.
- The table application, in Phase 2: it embeds this converter as its "add a mini" step.
- Hobbyists, later, when the page is published.

## Scope

In: the stories below; the release blockers carried over from Phase 0 (#33, #35, #38); a stable way for another application to call the converter; a faster unwrap (#34, moved into this phase on 2026-09-21, see story 9).

Out: publishing (#47 leaves this phase and waits for the table); accounts, storage, sharing, the table; painting; exporters for other VTTs (Phase 1.5); export of baked minis (#36, only needed once something outside our own app consumes them).

## Stories, in proposed order

Order rationale _(proposal)_: first the net that catches regressions, then the structural change everything else builds on, then correctness on real-world files, then the interface.

1. **Regression corpus and tracked numbers (#46).** One script converts every local corpus file and writes triangles, error, texture size and times per level, plus the comparison sheets. A committed baseline for _generated_ meshes runs in CI and fails on unexplained changes. The local corpus grows to 20–30 minis of different kinds: humanoid, large creature, quadruped, flying or on a stand, mounted, swarm, terrain piece, with and without base, Y-up and Z-up.
   - Status: the script (`npm run corpus`) and the CI baseline (`src/regression/`) exist. The baseline watches triangles, error and file sizes of six generated meshes; times are recorded for the local corpus only, because CI runners say nothing about speed. Growing the corpus is the PM's part and stays open; the script reports which kinds are still missing.
2. **Baked, compressed minis as the normal path (#42, with #38).**
   - Unwrap, bake and texture compression run by default, in the worker, as timed steps with progress; the page never freezes for more than 100 ms _(proposal)_.
   - Texture size from the size policy; KTX2 with Zstandard; the compressed texture is the only one kept.
   - Per-vertex look as the fallback when a step fails or the device cannot hold the texture.
   - A running conversion can be cancelled.
   - `?bake=` and `?ktx=` remain for development.
   - Status: built. A conversion bakes at the policy's size and encodes to KTX2 (UASTC effort 0, the Phase 0 setting, plus Zstandard) in the worker; the raw texture never reaches the page. Per-vertex fallback: a failing unwrap, bake, encode or transcode, or a texture larger than the GPU's size limit, leaves a whole mini with the per-vertex look and a stated reason (`stats.bakeSkipped`). This replaces #38's older "uncompressed texture" fallback, which would keep the raw texture after all. Cancel ends the worker and starts a fresh one, since a step cannot be interrupted from outside; the memory is freed with it. The stall limit is measured from the start of a conversion until the mini is on screen and reported per mini by `npm run corpus`; the e2e test enforces 100 ms only with `STALL_LIMIT=strict`, because CI draws in software. Still open from #38: the review of `ktx2-encoder` as a dependency.
3. **Files that are not clean (#43).** Each of these has a test and ends either in a mini or in a message a hobbyist understands, never in a frozen page, an uncaught error or a crashed tab on the reference laptop: large ASCII STL; zero-area and duplicate triangles; non-manifold edges; several disconnected parts; NaN coordinates; truncated file; empty file; not an STL; too large for the device. Too large means: the memory a file needs is estimated before converting and compared with what the device reports, a file that will not fit is refused with a message that says what to do, and a conversion that runs out of memory anyway ends in the same message. Pre-supported files are not detected (PM decision, 2026-09-21): whoever converts a file with supports gets a mini with supports; removing supports is an idea for after the release (#54).
4. **Scale and base (#44).** Units guessed from the size (mm, inches, metres), shown, and correctable. An existing base is detected and measured. The user can keep the mini as it is, or scale it to a standard base: 25, 32, 40, 50, 75, 100 mm _(proposal)_. Minis without a base can get a plain round one _(proposal)_. Nothing is rescaled silently.
5. **A converter other code can call (#50).** `src/` splits into a library (pipeline, worker, a small typed API: convert a file with options, progress events, cancel, result with levels, texture and figures) and the page that uses it. The table application will import the library, not copy the page. No behaviour change.
6. **The page (#41).** Empty, converting, done and error states, wireframes in `docs/design/` first; usable on a phone; the done state shows the mini, its size and the downloads (table and far); level switching available but secondary; the spike's tools (stress scene, benchmark, raw figures) behind `?dev`; an end-to-end test proves that no network request carries file data. Visual call: PM.
7. **Look presets (#45).** Four to six starting points on top of the existing controls _(proposal: grey primer, bone, black with drybrush, steel, bronze)_; the choice is stored with the mini. Defaults: PM.
8. **Carried-over blockers.** Own xatlas build (#33); measurements on the weak devices (#35). The Iris Xe laptop and the Pixel 9 cover the low end and the development PC the middle and the high end (PM decision, 2026-09-20: no Steam Deck, no further phone). Still owed on the laptop: a large mini with a 2K texture.
9. **A faster unwrap (#34).** Moved into this phase by the PM on 2026-09-21, on the evidence of two corpus runs on the development PC (figures in #34): the unwrap is 52 % of all conversion time; minis that get a 2048 px texture spend 12–84 s in it and none of the 16 converts within 15 s; the time does not depend on the texture size, so a smaller texture does not help; and for an ordinary mini the reference laptop unwraps about as fast as the development PC, so the laptop will not be better. Two steps, because nobody knows yet which lever works:
   - **Spike first, time-boxed to three working days _(proposal)_.** On the six slowest corpus minis and three ordinary ones, measure: (a) the mini split into its connected parts, the parts unwrapped in several workers, one packing pass over all islands at the end (xatlas can pack islands it did not make); (b) cheaper island finding through xatlas's chart options; (c) both together. Per variant: unwrap time, whole conversion, peak memory per worker and in total, number of islands, share of the texture used, and a comparison sheet against today's result. Threads inside one WebAssembly module are not an option: they need response headers that GitHub Pages cannot send, so parallel means several workers. A mini that is one connected piece gains nothing from (a); the spike says how many corpus minis that is.
   - **Then the change itself,** as its own issue, only if the spike finds a variant that meets the target below. Same rules as every step: in the worker, timed, with progress, cancellable, per-vertex look when it fails; the regression baseline is updated on purpose.
   - Target _(proposal)_: on the development PC every corpus mini except the largest file unwraps in 15 s or less, and no mini looks worse on its comparison sheet (PM's call). Texture coordinates also carry painting later, so visibly more seams count as worse.
   - If no variant gets there, the spike's recommendation says what to do instead: for example accept the time for large minis and show the per-vertex mini at once while the baked one finishes _(proposal, a product decision for the PM)_.
   - Status: spike done (#34, 2026-09-22); figures and sheets under "Story 9: what the spike found" below. A variant meets the target with room to spare: the table level cut into 8 slabs and handed to xatlas as 8 meshes of one atlas. The change itself is drafted as #57 and waits for the PM's look at the comparison sheets.

## Story 9: what the spike found (#34, 2026-09-22)

Development PC: RTX 3060, i7-11700F (16 threads), 64 GB, Chrome 153, window in front, a fresh page per conversion. The reference laptop was measured afterwards by the PM (below). The run's "today" column matches the PM's corpus run of 2026-09-21 (85.6 s against 84.1 s for the slowest mini), and the steps no variant touches (weld, simplify, shade) stayed within 0.2 s across the variants for seven minis and within 1 s for the other two, so the machine held still. An earlier run of the same session did not pass that check (up to twice as slow) and is used for the chart options only, as a ratio within each mini.

**Why the unwrap is slow.** xatlas's time grows roughly with the square of the mesh it is given: half the mesh takes about a quarter of the time. Cut into 8 slabs and unwrapped one after the other on one core, the slowest mini drops from 86 s to 6 s. Parallel work was never the lever; smaller pieces are.

**Connected parts (a, as written).** 27 of the 30 corpus table levels are one connected piece, the swarms included (they stand on one base). In the other three the largest piece holds 94–96 % of the triangles. Splitting by connected parts gains nothing on any corpus mini, so the spike cut the mesh instead: slabs of equal triangle count across the longest side of the mini. Every cut becomes a seam.

**Variants measured**, all on the six slowest minis and three ordinary ones:

- **cut8, one worker / eight workers** (variant a with slabs): islands found per slab in nested workers, then one packing pass over all islands (`addUvMesh` + `packCharts`).
- **(b) chart options:** `maxCost` 2, 4, 16 (today 8), `normalDeviationWeight` 1, `straightnessWeight` 0, `normalSeamWeight` 0, `maxChartArea` 25 and 100 mm², `maxIterations` 2, on four minis in Node. None is faster than today beyond noise; `straightnessWeight` 0 and `maxIterations` 2 are 1.4–2.5 times slower. The best, `normalDeviationWeight` 1, then ran on all nine in Chrome: between 11 % faster and 7 % slower on the six large minis, up to 2 % fewer islands. **No lever here.**
- **(c) cut8 + `normalDeviationWeight` 1:** same time as cut8 alone within noise.
- **8 slabs, one atlas / 16 slabs, one atlas** (found during the spike): the slabs go into one xatlas atlas as separate meshes; xatlas finds islands per mesh and packs once. One thread, no workers, no second packing pass.

Unwrap time in seconds, real Chrome:

| Mini                   | Texture | Today | cut8, 1 worker | cut8, 8 workers | **8 slabs, one atlas** | 16 slabs, one atlas | Whole conversion, today → 8 slabs | Islands, today → 8 slabs | Seam length, 8 / 16 slabs | Texture used: today / cut8 / 8 slabs |
| ---------------------- | ------- | ----- | -------------- | --------------- | ---------------------- | ------------------- | --------------------------------- | ------------------------ | ------------------------- | ------------------------------------ |
| SquidlingSwarm_32mm    | 2048 px | 85.6  | 6.2            | 4.6             | **4.7**                | 3.2                 | 109.9 → 28.1                      | 8295 → 8808              | +5 % / +11 %              | 78 / 75 / 78 %                       |
| HillGiant_32mm_FDM     | 2048 px | 49.5  | 5.6            | 4.6             | **4.0**                | 3.1                 | 74.3 → 28.1                       | 6457 → 7100              | +8 % / +17 %              | 80 / 77 / 79 %                       |
| 32mm_SirRichardMounted | 2048 px | 46.4  | 5.4            | 4.4             | **3.9**                | 3.0                 | 70.4 → 26.6                       | 5706 → 6211              | +6 % / +15 %              | 77 / 74 / 77 %                       |
| AbigailMounted_32mm    | 2048 px | 46.1  | 5.8            | 4.7             | **4.2**                | 3.3                 | 76.1 → 33.0                       | 5905 → 6424              | +6 % / +14 %              | 76 / 73 / 76 %                       |
| T-001                  | 2048 px | 43.0  | 5.5            | 4.5             | **4.1**                | 3.2                 | 62.0 → 22.6                       | 6055 → 6561              | +7 % / +11 %              | 77 / 74 / 77 %                       |
| TormentedGiant_32mm    | 2048 px | 42.3  | 5.7            | 4.5             | **4.1**                | 3.3                 | 76.9 → 39.7                       | 5307 → 5737              | +5 % / +9 %               | 76 / 73 / 76 %                       |
| MINI-012               | 1024 px | 12.3  | 3.9            | 3.3             | **3.0**                | 2.4                 | 19.2 → 9.4                        | 2610 → 3280              | +12 % / +35 %             | 83 / 80 / 82 %                       |
| FellWarrior_32mm       | 1024 px | 11.2  | 3.2            | 3.2             | **2.3**                | 2.0                 | 19.6 → 10.8                       | 3626 → 4011              | +8 % / +19 %              | 82 / 79 / 81 %                       |
| SoftDagger_32mm        | 1024 px | 7.5   | 3.3            | 3.2             | **2.4**                | 2.0                 | 15.5 → 10.3                       | 2277 → 2607              | +9 % / +21 %              | 78 / 76 / 78 %                       |

- **Seam length** is the summed length of all island borders on the mini, in mm: a number for "more seams". Today's minis already carry 5–31 m of seams in 2,300–8,300 islands; 8 slabs add 5–12 %.
- **Memory** of the unwrapper (WebAssembly memory, which only grows; the JavaScript side of a worker is not measurable from the page): today 19–34 MB; 8 slabs in one atlas 16–28 MB, less than today; workers 16 MB each plus 16 MB for packing, 144 MB with eight.
- **Workers buy little:** 1.8 s of a cut8 unwrap is the second packing pass, and each worker's unwrapper has to load and warm up. Eight workers are 0.1 s faster to 0.9 s slower than one atlas on one thread, at five times the memory. The second packing pass also loses about 3 points of texture use; one atlas does not.
- **Longest page stall:** 18–61 ms in every variant.
- **The whole corpus, 8 slabs in one atlas** (Node, one core, the table levels of all 30 minis at the texture size the policy gives them; Node's times match Chrome's for today's unwrap): 0.7–9.2 s, median 3.5 s, the largest file 5.3 s. Slowest: `32mm_CaveWallLong` 9.2 s and `32mm_GiantBat` 8.3 s (slabs of equal triangle count are not slabs of equal work); all others 5.3 s or less. Islands −3 % to +31 %, texture use within 1 point of today (one mini +3).
- **Comparison sheets:** `out/spike34/chrome2/<mini>.png` on the development PC, one column per variant, three views of the baked table level. No difference visible to the agent at these views; the call is the PM's.

**Reference laptop** (Intel Iris Xe, on the power cord, `npm run lan` from main after #58, PM, 2026-09-23; full table in #35): M-001a (ordinary, 1024 px) unwrap 2.4 s today, 1.7 s with 8 slabs, whole conversion 9.0 s → 8.3 s; HillGiant_32mm_FDM (2048 px) unwrap 33.8 s → 3.2 s, whole conversion 54.4 s → 20.5 s, of which the bake is 10.4 s and the encode 4.6 s. Longest stall 17 / 33 ms. The untouched steps agree between the pairs and with the run of 2026-09-20. The large mini with a 2K texture that #35 owed is thereby measured: 54 s today, far under the 3-minute criterion.

**Recommendation: build "8 slabs, one atlas"** (#57). It meets the target on every corpus mini, the largest file included, is the simplest of the variants (no workers, no second packing, about 60 lines), uses less memory than today and keeps the texture use. With it a large mini converts in 23–40 s instead of 62–110 s and an ordinary one in about 10 s instead of 15–20 s. 16 slabs save one more second at twice the seam cost: not worth it. Workers and chart options: drop.

What this leaves as the longest steps of a large mini: the bake (11–17 s at 2048 px on the development PC, 10 s on the laptop) and the texture encoding (6 s / 4.6 s). Not measured here: whether the cuts show once minis are painted (a cut that follows the shape instead of a straight slab is the idea to keep for then).

To run it again: `npm run build && node scripts/spike34/measure.mjs` (Chrome, sheets), `node scripts/spike34/dump-tables.mjs` then `node scripts/spike34/sweep.mjs <mini> "base;multi8"` (Node). In the page: `?unwrap=multi8`, `?unwrap=cut8&workers=4`, `?unwrap=whole&chart={…}`.

## Exit criteria

- Every file in the 20–30 mini corpus converts to an upright, correctly scaled, baked mini without manual help, or fails with an understandable message; the PM has looked at every comparison sheet.
- On the reference laptop (Intel Iris Xe): an ordinary mini, meaning a single figure on a base of up to 32 mm _(proposal; to be confirmed by the PM)_, converts, baked and compressed, in 15 s or less; the largest corpus mini in 3 minutes or less _(proposal)_; 100 baked minis run at 30 fps or more.
- The table application can call the converter through the library API.
- #33, #35 and #38 are closed.

## Data and permissions

No server, no storage, no accounts, no analytics. Files are read in the browser and handed to a worker in the same tab. The one new kind of data is a user's choices (units, base size, look preset), kept in the result. Corpus files stay outside the repository; renders of real minis are not committed without the PM's say-so.

## Risks

- **Messy files are open-ended.** Time-box #43 per kind of mess; what cannot be repaired cheaply becomes a clear refusal.
- **Base and support detection are heuristics** and will be wrong sometimes: every guess is shown and overridable, and the corpus decides whether a heuristic is good enough.
- **Unwrap time** is the largest part of a conversion and the reason large minis take a minute or more even on the development PC. The spike #34 (story 9) found the answer: cut into 8 slabs, every corpus mini unwraps in under 10 s on the development PC. Until #57 is built the old times hold. On the reference laptop the spike's option gave 3.2 s instead of 33.8 s for a large mini (#35).
- **Two young dependencies** (`xatlas-wasm`, `ktx2-encoder`) sit in the critical path until #33 and #38 are done.
- **The page is polish for an audience of few** while nothing is published. Keep #41 small, and spend the effort on the library and the corpus.

## Hand-over notes for whoever implements this

- Start by reading `CLAUDE.md`, this spec and the Phase 0 spec's "Conclusion and decisions". Work only on issues labelled `ready-for-agent`; one issue, one branch, one PR; a human merges.
- Avoid stacked PRs. If one is unavoidable, put the merge order in the first line: the PR opened last is merged first.
- Visual and performance work needs the PM's machine, the local `corpus/` and real Chrome with the GPU: `scripts/compare-*.mjs`, `scripts/measure-*.mjs`. CI renders in software and proves nothing about speed.
- After any scripted edit of a document, compare its headings before and after. Read the exit code of `npm run check`, not a filtered log.
- Device measurements: `npm run lan`, then the "Benchmark this device" panel; results go to #35.
