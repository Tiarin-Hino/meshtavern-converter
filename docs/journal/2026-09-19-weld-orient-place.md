---
title: Weld, index, orient and place meshes read from STL
date: 2026-09-19
phase: 0
issues: [7]
prs: [17]
topics: [stl-import, orientation, performance]
---

## What we did

We wrote the first real steps of the pipeline: read an STL file, merge the duplicate corners it is full of, turn the mini upright, stand it on the table and centre it, and report its size in millimetres. None of this was visible in the app yet; it was the groundwork every later step (reduction, look, baking, export) builds on.

## Why

An STL file is a "triangle soup": every triangle lists its three corners in full, so a corner shared by six triangles is stored six times, and nothing says which triangles are neighbours. Print files are also usually Z-up (the slicer convention), while our scene is Y-up with the mini standing on y = 0. Mesh reduction, shading and unwrapping all need an _indexed_ mesh, where each corner (vertex) is stored once and triangles point at it. Issue #7 asked for exactly that, as a pure function with tests and a timing on a 2-million-triangle input, the size the Phase 0 spec (`docs/specs/phase-0-spike.md`) set as the upper end.

## How

Four pure functions in `src/pipeline/`, working on typed arrays so they run in a Web Worker and in Node:

- `readStlTriangles` reads binary or ASCII STL into a triangle soup.
- `weldVertices` merges duplicate vertices through a **hash grid**: positions are snapped to cells of a named tolerance, `WELD_TOLERANCE_MM` = 0.0001 mm, and vertices in the same cell become one. Triangles that collapse (two corners merged into one) are dropped and counted. A hash grid is a single linear pass, which is what 2 million triangles need.
- `orientAndPlace` turns Z-up into Y-up **by rotation, not mirroring**, so the triangle winding (which side is "outside") stays correct. It then stands the mesh on y = 0, centres it and reports width, height and depth in mm. Units are never changed silently.
- `generateBumpySheet` makes synthetic test geometry, because real minis never enter the public repo. `npm run bench` uses it to build a 2,000,000-triangle mesh, the size of a 100 MB binary STL.

16 new unit tests (21 in total), including a degenerate-triangle case.

## Problems and how we solved them

- **Welding is not repair.** Because vertices are compared by grid cell, two vertices closer than the tolerance but on opposite sides of a cell border stay separate. **Cause:** the price of the fast grid. **Fix:** accepted and written down as a known limit. It removes the exact duplicates an STL export produces, which is its job; broken files are a separate topic for Phase 1.

## Numbers

Node 20.19 on the development PC, generated 2,000,000-triangle mesh, mean of 5 runs:

| Step             | Mean   |
| ---------------- | ------ |
| read             | 107 ms |
| weld             | 620 ms |
| orient and place | 30 ms  |

The in-browser numbers and a check on three of the PM's own minis followed with the worker (see `2026-09-19-pipeline-in-a-worker.md`): all three came out upright, centred and at the expected 28 to 32 mm, and welding roughly halved the vertex count, as expected for closed sculpts.

## Still open

- The orientation step assumed every file is Z-up. That assumption broke a day later on minis stored Y-up; see `2026-09-20-up-axis-from-the-base.md`.
- No numbers on a weak device yet.

## Story angle

Why a 3D-print file cannot be drawn as a game asset as it is, and what the first 750 ms of the pipeline do about it. Possible title: "From triangle soup to a mini that stands up".
