---
title: A thumbnail and a character-or-prop guess per mini
date: 2026-10-06
phase: 2
issues: [99]
prs: [117]
topics: [sizing, measurement, corpus, export]
---

## What we did

The converter now says whether a mini looks like a **character** (something standing on a base) or a **prop** (something that is its own base), and the library can draw a small picture of each converted mini: a 512 px PNG with a transparent background, from the same angle and in the same light as the viewer. The table application needs both to list a person's minis without loading every mesh, and to pre-set the character/prop switch when a mini is imported. On the corpus the guess is right for 4 of 4 props and 24 of 28 characters.

## Why

Issue #99, for the table's import step and its list of minis (its spec 04). The work started with a design pass on Fable 5.1 (`docs/design/thumbnail-and-kind.md`, PR #117) and was built on Opus 5.5 in the same PR.

## How

- **The guess reads the base's top** (`src/lib/pipeline/kind.ts`). A separate base file, or no flat underside at all, means a character. Otherwise the converter adds up the faces that point up (within 30°) and sit within 10 mm of the floor, and compares their area with the base's outline: half or more bare top is a disc with something on it, a character; less is a prop. It runs inside the size step on the sized mesh, so millimetres are millimetres; one pass over the triangles took 14 ms on a 1.25-million-triangle humanoid (development PC). The `kind` option overrides it, and `result.choices` keeps the override.
- **Why the top and not the material or the outline** (design note §3.2): resin bases are often hollow, so slicing for material near the floor finds almost nothing; and a sprawling creature's tail and wings span the whole base, so the outline of what stands on it says nothing either. A bare top is there whether the base is solid or hollow, dense or twelve triangles.
- **The thumbnail is the consumer's** (`src/lib/three/thumbnail.ts`, `renderThumbnail`). A picture needs a GPU, and the pipeline must run in a worker and in Node. The consumer already has a WebGL renderer with the mini on screen, so the call borrows it and draws into an off-screen render target: no second WebGL context (browsers cap them, and each costs memory on a weak device). Without a renderer it makes a private one and releases it.
- **The corpus run checks it.** Terrain entries in `scripts/corpus-index.json` say `kind: "prop"`; every other mini is expected to be a character. The guess is the fourth check of "right without correction" (#101) and a failure prints the measured share. Every mini's thumbnail is saved to `out/corpus/thumbs/` and heads its comparison sheet.

## Problems and how we solved them

- **The picture filled only 72 % of the frame.** **Cause:** the design framed the mesh's bounding box, and the box's corners are empty for a round base or a pointed top. **Fix:** frame the mesh's own vertices (the same closed-form distance per point), then re-aim three times so the picture sits in the middle; the demo pyramid and the corpus minis now fill the frame less the 6 % margin.
- **Colours read back from the GPU are linear.** three.js 0.186 draws into a render target in its linear working colour space; only the canvas gets sRGB. The read-back is therefore un-premultiplied (edge pixels were blended against transparent black), flipped (WebGL rows come bottom-up) and converted to sRGB, each a small tested function. Measured on a generated figure on a 25 mm base (development PC, RTX 3060): mean colour of the mini 131/135/141 in the thumbnail, 134/141/153 in the viewer, whose edges blend into its blue-grey background; 9 of 1,141 edge pixels are dark.
- **The first corpus run stopped at the first mini.** The run reopens every exported GLB to prove it loads, which leaves the page showing a file without a conversion result, and the thumbnail hook refuses such a file. **Fix:** take the thumbnail before the exports.

## Numbers

Corpus run of 2026-10-06, baked, questions confirmed as detected, development PC (i7-11700F, RTX 3060, Chrome 154):

- **Character or prop: 28 of 32 right (88 %).** Props 4 of 4 (shares 0.04 to 0.24, threshold 0.5). Characters 24 of 28: 15 by their base file, 5 without a flat underside, 4 by the bare top (shares 0.56 to 0.74). The four misses, all read as props: `humanoid/MINI-014` 0.48 (a robe and candles cover the small base), `flying/flying-03` 0.39 (a 15 mm base), `quadruped/B-001` 0.37 and `large-creature/M-100` 0.35 (a rock or scenery on a busy base whose leaves and roots tilt more than 30°).
- **Right without correction: 18 of 29 (62 %)**, from 21 of 29 (72 %): the three minis that now fail, fail only on the guess.
- The tree on a 50 mm disc the design expected to miss reads as a prop: only 0.11 of its base reads as bare top.
- The size step's pass: 14 ms on 1.25 M triangles, 17 ms on 0.88 M (development PC). The largest corpus file (6.1 M triangles) comes with a base file, so the pass does not run for it.

## Still open

- The characters' rate is below the design note's stop line (24 of 27); the PM decides whether the rule, the threshold or the corpus changes (asked on PR #117). The constants were not tuned to the corpus.
- `kind` is not written into the GLB (design note §3.5).
- A tree on a bare disc would read as a character; the table's switch covers it.

## Story angle

A first guess that is wrong one time in eight still saves most people a click. "Is it a hero or a barrel? Reading the base of a 3D-printed mini."
