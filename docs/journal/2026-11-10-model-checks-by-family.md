---
title: The model check goes by the family, not the version
date: 2026-11-10
phase: 2
issues: []
prs: []
topics: [workflow, planning]
---

## What we did

Reworded the model check at the start of three commands (`/implement`, `/continue-pr`, `/review-pr`) so that it asks "is this a Fable model" and never "is this Fable 5.1". `CLAUDE.md` says the same rule in one sentence.

## Why

The commands named "Fable 5.1" and "Opus 5.5" literally. A session on Fable 5.2 built a whole task without the one-line question that keeps Fable for design and reviews, and the wording turned out to be the reason.

## How it failed

Read literally on Fable 5.2:

- `/continue-pr` said "If you are running as Fable 5.1, say so in one line and ask". The condition was false, so the build went ahead unasked.
- `/implement`, on an issue that needs a design pass, had one branch for "you are not Fable 5.1" (stop) and one for "you are Fable 5.1" (write the design note and hand over). Neither says what 5.2 is.
- `/review-pr` said "If you are not running as Fable 5.1, say so and wait", which would stop a Fable session and ask for Fable.

`/implement` on clear building work continues on any model without a reminder. That is by design and unchanged.

## What stays versioned

The sentence in `CLAUDE.md` about the automatic PR review keeps the exact model names, as do the workflows. They state which model a job is configured to run and change with that configuration.
