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
- **Unwrap time** is the largest part of a conversion and the reason large minis take a minute or more even on the development PC. #34 (story 9) is the answer; it may not find one, and then the 15 s target holds for ordinary minis only.
- **Two young dependencies** (`xatlas-wasm`, `ktx2-encoder`) sit in the critical path until #33 and #38 are done.
- **The page is polish for an audience of few** while nothing is published. Keep #41 small, and spend the effort on the library and the corpus.

## Hand-over notes for whoever implements this

- Start by reading `CLAUDE.md`, this spec and the Phase 0 spec's "Conclusion and decisions". Work only on issues labelled `ready-for-agent`; one issue, one branch, one PR; a human merges.
- Avoid stacked PRs. If one is unavoidable, put the merge order in the first line: the PR opened last is merged first.
- Visual and performance work needs the PM's machine, the local `corpus/` and real Chrome with the GPU: `scripts/compare-*.mjs`, `scripts/measure-*.mjs`. CI renders in software and proves nothing about speed.
- After any scripted edit of a document, compare its headings before and after. Read the exit code of `npm run check`, not a filtered log.
- Device measurements: `npm run lan`, then the "Benchmark this device" panel; results go to #35.
