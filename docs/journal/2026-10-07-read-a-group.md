---
title: Reading a group of files with the run's own memory estimate
date: 2026-10-07
phase: 2
issues: [122]
prs: [123]
topics: [stl-import, tooling]
---

## What we did

The library gained `readStlFiles(files, budget)`: it reads the files of one conversion (a figure and its base, or a figure in up to six parts) the way `readStlFile` reads one. Every file's first bytes are sniffed, the memory the whole conversion is expected to need is held against the device's budget, and only then is any file read in full. `MAX_STROKES`, the most strokes a patch keeps, is exported beside it.

## Why

The table application's import (meshtavern #174, spec 05 there) now converts a group of files in one `convert` call, and its spec says a group that does not fit the device is refused with the converter's sentence before any file is read in full. The run already checks the right estimate for a group (`estimatePairBytes` for two files, `estimateAssemblyBytes` for more), but only after the files are in memory, and those two functions were internal. The table's design note (`docs/design/minis-in-several-files.md` there, section 10) asked for the two estimates to be exported. A function that does the whole check was smaller to use and keeps the branching (which estimate for how many files) in one place: if the run's rule changes, the consumer's check changes with it. `MAX_STROKES` lets the table size the cap of its marks record against the converter's own limit in a test.

## How

- `readStlFiles` sniffs each file from `file.slice(0, SNIFF_BYTES)`, then picks the estimate as `run.ts` does: one file `checkFits`, two `estimatePairBytes`, more `estimateAssemblyBytes`, each through `checkNeeded`, which throws `ConversionProblem('too-large')` with the page's sentence. Only then `arrayBuffer()` on every file.
- `readStlFile` is now the one-file case of it, so the page's drop handler is unchanged.
- The count is left to `convert` (`too-many-files`), which refuses it on the buffers anyway.

## Numbers

None: no pipeline step changed. The unit tests count full reads on `Blob`s whose `arrayBuffer` is wrapped: a pair and three parts refused one byte under their estimate read nothing in full.

## Story angle

A small seam for the table: the converter decides how much memory a group needs, and the app asks before it opens the files.
