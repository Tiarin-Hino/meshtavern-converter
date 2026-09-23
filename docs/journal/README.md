# Project journal

One entry per piece of work: what was done, why, how, what went wrong and how it was solved, with the measured numbers. The journal is the source for release documentation and for blog posts about how the converter was built, so nobody has to dig through code, PRs and issue threads to tell the story later.

Specs say what the converter must do. ADRs (in the private product repo) say what was decided. The journal says what happened on the way, including the dead ends.

## When to write an entry

- Every PR that changes behaviour, the pipeline, measurements, tooling or a plan gets an entry **in the same PR**. It is part of the definition of done.
- A PR that continues earlier work (figures for a spike, a follow-up fix) may extend the earlier entry instead: add to its sections and add the new PR to `prs`. When the later work changes the conclusion, write a new entry and add a line `Later: see <file>` at the end of the old one. Never rewrite history in an old entry; the wrong turn is part of the story.
- A PR closed without merging that taught something (a spike that lost, an approach that was dropped) goes under "Dead ends" in the entry of the work that replaced it.
- No entry for dependency bumps, CI version bumps, typo fixes and formatting.

## File name and header

`docs/journal/YYYY-MM-DD-short-slug.md`, dated the day the PR is opened (fix the date to the merge day if it differs by more than a few days). One file per entry, so parallel PRs do not conflict.

```markdown
---
title: Unwrap the table level in slabs
date: 2026-09-23
phase: 1
issues: [57]
prs: [61]
topics: [unwrap, performance]
---
```

## Sections

Use these headings in this order. Leave out a section only if it would be empty; "Dead ends" and "Problems" are the most valuable ones for a blog, so think twice before dropping them.

```markdown
## What we did

Two to four plain sentences a player could follow. What changed for someone using the converter.

## Why

The problem, the requirement or the decision behind it. Link the spec section, issue or earlier entry.

## How

The approach and the key technical choices, each with the reason and the alternative it beat.
Name libraries with versions where the choice mattered.

## Problems and how we solved them

- **Problem.** What we saw. **Cause:** what it turned out to be. **Fix:** what we did.

## Dead ends

What we tried and dropped, and what it taught us.

## Numbers

Measured figures, before and after, each with the device it ran on (see "Devices" below) and how it was measured.

## Still open

Limits, things not measured, follow-up issues by number.

## Story angle

One or two lines: why a reader would care, and a possible post title.
```

## Rules

- **Write for a reader who has never seen the code.** Explain a term the first time (LOD, unwrap, bake, KTX2). Link files by path, but the entry must make sense without opening them.
- **Facts, not adjectives.** Every number says what device it came from and how it was measured. "Faster" without numbers is not a finding.
- **Be honest about failures.** Bugs we shipped, wrong estimates and decisions that were overruled belong in the journal. Say who decided what ("the PM chose X over Y because…").
- **Keep it short:** 300 to 800 words. Link the PR and issue for the full detail instead of copying it.
- **Public repo.** Nothing about business, pricing, licensing deals or partners. No names of third-party minis, their creators or their shops: describe a test mini by its kind ("a large dragon with a thin wing membrane", "a 2M-triangle sculpt"). No third-party IP. No screenshots of other people's minis.

## Devices

Numbers name the device, using the names the specs use. The ones so far:

- **Development PC:** desktop, i7-11700F, RTX 3060, 64 GB. An upper bound only.
- **Reference laptop:** Ubuntu laptop with Intel Iris Xe integrated graphics. The reference for "a weak device".
- **Phone:** Pixel 9 (Mali GPU).
- **CI:** GitHub Actions, software rendering. Good for correctness, not for speed.

## Topics

Use these in `topics` so posts can be gathered by grep. Add a new one only when none fits, and add it here.

`stl-import`, `orientation`, `lod`, `look`, `unwrap`, `bake`, `textures`, `compression`, `export`, `worker`, `performance`, `devices`, `testing`, `regression`, `tooling`, `workflow`, `planning`, `ui`

## Phase summaries

At the end of a phase, the phase write-up in `docs/specs/` gets a short "Journal" list linking the entries in reading order. That list is the table of contents for a blog series about the phase.
