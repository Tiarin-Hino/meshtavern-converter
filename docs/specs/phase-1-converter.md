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

In: the stories below; the release blockers carried over from Phase 0 (#33, #35, #38); a stable way for another application to call the converter.

Out: publishing (#47 leaves this phase and waits for the table); accounts, storage, sharing, the table; painting; exporters for other VTTs (Phase 1.5); export of baked minis (#36, only needed once something outside our own app consumes them); parallel-worker unwrap (#34, unless the weak-device measurement in #35 shows the unwrap is too slow).

## Stories, in proposed order

Order rationale _(proposal)_: first the net that catches regressions, then the structural change everything else builds on, then correctness on real-world files, then the interface.

1. **Regression corpus and tracked numbers (#46).** One script converts every local corpus file and writes triangles, error, texture size and times per level, plus the comparison sheets. A committed baseline for _generated_ meshes runs in CI and fails on unexplained changes. The local corpus grows to 20–30 minis of different kinds: humanoid, large creature, quadruped, flying or on a stand, mounted, swarm, terrain piece, with and without base, Y-up and Z-up.
2. **Baked, compressed minis as the normal path (#42, with #38).**
   - Unwrap, bake and texture compression run by default, in the worker, as timed steps with progress; the page never freezes for more than 100 ms _(proposal)_.
   - Texture size from the size policy; KTX2 with Zstandard; the compressed texture is the only one kept.
   - Per-vertex look as the fallback when a step fails or the device cannot hold the texture.
   - A running conversion can be cancelled.
   - `?bake=` and `?ktx=` remain for development.
3. **Files that are not clean (#43).** Each of these has a test and ends either in a mini or in a message a hobbyist understands, never in a frozen page, an uncaught error or a crashed tab on the reference laptop: large ASCII STL; zero-area and duplicate triangles; non-manifold edges; several disconnected parts; NaN coordinates; truncated file; not an STL; too large for the device. Pre-supported files are detected with a stated confidence, and the user is asked for the unsupported variant _(proposal: warn and continue, do not refuse)_.
4. **Scale and base (#44).** Units guessed from the size (mm, inches, metres), shown, and correctable. An existing base is detected and measured. The user can keep the mini as it is, or scale it to a standard base: 25, 32, 40, 50, 75, 100 mm _(proposal)_. Minis without a base can get a plain round one _(proposal)_. Nothing is rescaled silently.
5. **A converter other code can call (#50).** `src/` splits into a library (pipeline, worker, a small typed API: convert a file with options, progress events, cancel, result with levels, texture and figures) and the page that uses it. The table application will import the library, not copy the page. No behaviour change.
6. **The page (#41).** Empty, converting, done and error states, wireframes in `docs/design/` first; usable on a phone; the done state shows the mini, its size and the downloads (table and far); level switching available but secondary; the spike's tools (stress scene, benchmark, raw figures) behind `?dev`; an end-to-end test proves that no network request carries file data. Visual call: PM.
7. **Look presets (#45).** Four to six starting points on top of the existing controls _(proposal: grey primer, bone, black with drybrush, steel, bronze)_; the choice is stored with the mini. Defaults: PM.
8. **Carried-over blockers.** Own xatlas build (#33); measurements on the weak devices (#35). The Iris Xe laptop and the Pixel 9 cover the low end and the development PC the middle and the high end (PM decision, 2026-09-20: no Steam Deck, no further phone). Still owed on the laptop: a large mini with a 2K texture.

## Exit criteria

- Every file in the 20–30 mini corpus converts to an upright, correctly scaled, baked mini without manual help, or fails with an understandable message; the PM has looked at every comparison sheet.
- On the reference laptop (Intel Iris Xe): an ordinary mini converts, baked and compressed, in 15 s or less; the largest corpus mini in 3 minutes or less _(proposal)_; 100 baked minis run at 30 fps or more.
- The table application can call the converter through the library API.
- #33, #35 and #38 are closed.

## Data and permissions

No server, no storage, no accounts, no analytics. Files are read in the browser and handed to a worker in the same tab. The one new kind of data is a user's choices (units, base size, look preset), kept in the result. Corpus files stay outside the repository; renders of real minis are not committed without the PM's say-so.

## Risks

- **Messy files are open-ended.** Time-box #43 per kind of mess; what cannot be repaired cheaply becomes a clear refusal.
- **Base and support detection are heuristics** and will be wrong sometimes: every guess is shown and overridable, and the corpus decides whether a heuristic is good enough.
- **Unwrap time on weak devices** is unmeasured for large minis. If #35 shows minutes, #34 (parallel unwrap) moves into this phase.
- **Two young dependencies** (`xatlas-wasm`, `ktx2-encoder`) sit in the critical path until #33 and #38 are done.
- **The page is polish for an audience of few** while nothing is published. Keep #41 small, and spend the effort on the library and the corpus.

## Hand-over notes for whoever implements this

- Start by reading `CLAUDE.md`, this spec and the Phase 0 spec's "Conclusion and decisions". Work only on issues labelled `ready-for-agent`; one issue, one branch, one PR; a human merges.
- Avoid stacked PRs. If one is unavoidable, put the merge order in the first line: the PR opened last is merged first.
- Visual and performance work needs the PM's machine, the local `corpus/` and real Chrome with the GPU: `scripts/compare-*.mjs`, `scripts/measure-*.mjs`. CI renders in software and proves nothing about speed.
- After any scripted edit of a document, compare its headings before and after. Read the exit code of `npm run check`, not a filtered log.
- Device measurements: `npm run lan`, then the "Benchmark this device" panel; results go to #35.
