---
title: Messy files - no support detection, and what "too large" means
date: 2026-09-21
phase: 1
issues: [43, 54]
prs: [55]
topics: [planning, stl-import]
---

## What we did

Before anyone built story 3, "Files that are not clean", the PM narrowed it. The converter will not try to recognise files that come with print supports: whoever converts a file with supports gets a mini with supports. And "too large for the device" got a definition a test can check: estimate first, refuse politely, and catch an out-of-memory crash as a safety net. This changed the spec and issue #43 only; no code.

## Why

Story 3 ([spec](../specs/phase-1-converter.md), #43) promises that any file a slicer or sculpting tool produces either converts or ends in a message a hobbyist understands, never in a frozen page, an uncaught error or a crashed tab on the reference laptop. Phase 0 had only seen five clean minis. Two items in the accepted spec needed the PM's call before building:

- "Pre-supported files are detected with a stated confidence, and the user is asked for the unsupported variant _(proposal: warn and continue, do not refuse)_." This was the agent's proposal, not yet a decision.
- "Too large for the device" was in the list of cases, with no rule for when a file counts as too large or what happens then.

The PR does not record the PM's reasons for dropping support detection; only the decision and where the idea went.

## How

The PM decided on 2026-09-21:

- **Pre-supported files are not detected.** Removing supports is kept as an idea for after the release (#54). Story 3 now says so explicitly under "out of scope" in #43.
- **Too large for the device** means three things: before converting, the memory a file needs is estimated from its size and compared with what the device reports; a file that will not fit is refused with a message that says so and what to do (a smaller or reduced file, a stronger device); and a conversion that runs out of memory anyway is caught and ends in the same message, not in a crashed tab.
- **An empty file** joins the list of cases, each with its own test: large ASCII STL; zero-area and duplicate triangles; non-manifold edges; several disconnected parts; NaN coordinates; a truncated file; an empty file; a file that is not an STL; a file too large for the device. The empty file came from #53, where an empty STL was found to get a blank baked texture instead of a refusal.
- The risk list in the spec was narrowed to match: "Base detection is a heuristic" instead of "Base and support detection are heuristics".

The spec's headings were compared before and after the edit, so links from issues into its sections kept working.

## Dead ends

Support detection itself. The original spec proposed detecting supports with a stated confidence and warning the user. It was dropped before any code was written. What remains of the idea is #54, removing supports, which is a different feature: it would change the mini instead of warning about it.

## Numbers

None; this was a scope change. The memory figures a "too large" estimate can build on were already in #35 and #53: peak pipeline buffers of 253 MB for an ordinary 1.25M-triangle mini, and about 1.1 GB for the largest corpus file (5.6M triangles, 281 MB STL), both on the **development PC**.

## Still open

- #43 itself: not built at the time of writing.
- #54, removing supports, after the release.
- The narrowed risk line did not survive: a later merge of `main` into the branch of #56 brought back the old wording "Base and support detection are heuristics", and the spec carried it. **Fixed 2026-09-23 (#63):** the risk line reads "Base detection is a heuristic" again.

## Story angle

Scope cuts are decisions too: dropping a feature before its first line of code, and turning "too large" into something a test can check. Title idea: "Your supports are your business".
