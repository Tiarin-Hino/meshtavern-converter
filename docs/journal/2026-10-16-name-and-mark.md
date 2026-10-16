---
title: PolyWash, checked, and the brief for its mark
date: 2026-10-16
phase: 2
issues: [147]
prs: [176]
topics: [ui, planning]
---

## What we did

The page has a product name, PolyWash, in place of the development name "MeshTavern Converter". The PM picked it on 2026-10-14. This work checked it against the trademark registers, the domains and the app stores, and recorded the result in `docs/design/brand/name.md`. Exported GLB files now name PolyWash as the program that wrote them. The brief and round 1's prompts for the mark, the name drawn as a logo, are in `docs/design/brand/mark.md`, ready for the PM to generate candidates.

## Why

The page is published before the table application (spec `docs/specs/look-and-feel.md`, L5), and it cannot go out under the development name. The PM picks the name. The spec's checklist asks that it not be another product's name in the hobby, 3D printing or VTT space, so the name needed checking before it went on the page. The words on the page (#145) already took the name the day it was picked. This work adds the evidence behind it and the first step of the mark.

## How

- **The registers.** The USPTO's search through its own page, and EUIPO's TMview, which covers EUIPO, WIPO, the UK and some 60 national offices. Both searches covered "polywash" and "poly wash". The two live US marks and the other live ones abroad are all cleaners and chemicals (classes 1, 3, 5, 7, 11). There is nothing in software (9), games (41) or online services (42).
- **The domains.** Each registry's RDAP service, the structured successor of `whois`. A "not found" answer was trusted only after the same service had answered for a known registered name. The .com and .net are taken; .app, .io, .dev and .org are free. The PM registers one later, with #47.
- **The stores and namespaces.** The App Store's search API, Google Play's search page, npm, PyPI and GitHub. None has a PolyWash.
- **The GLB.** `asset.generator` in `glb.ts` is now a named constant, `PolyWash`, with a test. glTF viewers show this field as the file's author, so the development name was still visible in every exported file.
- **The mark's brief.** It follows the application's process for its own wordmark, which the PM ran on 2026-10-08. It has the same gates, scores and analysis sheet, and four directions with two images each. The ideas are new: an octagonal "o" for "Poly", a weight split at the W, the y's tail running under "Wash", and a face whose curves are straight segments, the way the converter reduces a sculpt. Each one is asked for in measurable terms, because the application's round 1 showed that the image model drops a vague structural instruction and draws a fine detail as a defect.

## Problems and how we solved them

- **The registers would not answer from the cloud session.** The pick's first sweep, on 2026-10-14, used web search only. **Cause:** the registers' sites are blocked from there. **Fix:** this check ran from the development PC, in the app's browser pane.
- **A results address showed "No results found" for every word, Nike included.** **Cause:** the USPTO's results page runs its search only when the query is typed into its box; an address alone renders an empty page. **Fix:** typing the query once revealed the page's own search call. Later searches went through that call, from the same page.

## Dead ends

None in the check itself. One finding came late. Polymaker, a filament maker, names its products "Poly" + a word in camel case (PolyLite, PolyTerra, PolySmooth, PolyDryer, PolyCast). In 3D printing, "wash" is also the bath after a resin print. So PolyWash in camel case can read as one of Polymaker's products. In the US register the family is mostly unregistered or held by others, so it is not a register clash. The lower-case "Polywash" was put to the PM as a way to lessen the likeness. The PM kept PolyWash on 2026-10-16. The brief now bans water and cleaning motifs, and the look-alike check puts Polymaker first.

## Numbers

- Every exported GLB is 12 bytes smaller: "MeshTavern Converter" is 20 characters, "PolyWash" 8, and the JSON chunk stays padded to four bytes. All 68 file sizes in `src/regression/baseline.json` moved by exactly 12 bytes; nothing else moved (development PC, `npm run baseline:update`).
- The registers: USPTO 3 records for "polywash" and "poly wash" (2 live, both class 3). TMview 16 records for "polywash" and 55 for "poly wash", none in classes 9, 41 or 42 (2026-10-14).

## Still open

- **The mark's rounds.** The PM generates the candidates from `mark.md` section 4, and the agent scores each round. Then the PM picks, the pick is traced into `wordmark.svg`, and the favicon is drawn from its P, replacing the P of Fraunces that #145 shipped.
- **The bar's MeshTavern link:** its words and target are the PM's (spec L2).
- **The domain**, with #47.

## Story angle

Naming a free tool in a crowded hobby: what a clash check covers when it is done with public databases rather than a lawyer, and the near miss that showed up only once the casing was chosen. "Is PolyWash taken?"
