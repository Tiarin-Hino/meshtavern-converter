---
title: A spec for the page's look and feel before it is published
date: 2026-10-13
phase: 1
issues: []
prs: []
topics: [spec, page, planning]
---

## What we did

Wrote `docs/specs/look-and-feel.md`: five stories and six work items that make the page ready for the public in MeshTavern's style. L1 adopts the table application's design system (its token and component stylesheets, fonts and icons, copied here and kept byte-equal by a test in the application, with the colour-literal check in `npm run check`); L2 rebuilds the page's five states, the question view and the painting panel on those components, on a desktop and a phone, in both themes; L3 writes the page's words, credits and README for a person who found the page; L4 brings the application's quality bar (an accessibility scan, a keyboard pass, reference screenshots); L5 asks for a proper product name and a mark, since "MeshTavern Converter" is the development name, by the same process the application used for its wordmark.

## Why

On 2026-10-13 the PM decided to publish the page before the table application exists (`docs/journal/2026-10-13-published-before-the-table.md`). The page was built for the team: the spike's dark scheme as ten custom properties, the system font, browser-default controls, 30 colour literals over three stylesheets, the development name in the top bar. A public page in the same style as MeshTavern needs the application's design system, not a second one, and a name of its own.

## How

The spec follows the application's look-and-feel spec in shape (what the page looks like today, stories with checkable criteria, decisions, proposals that stand on merge, work items with a design pass first) and takes from it the budgets (120 KB of fonts, 40 KB of CSS), the quality bar and the wordmark process. The open design choice is where the theme files live: a copy here guarded by a test in the application (proposed), or this library as their source; the design pass states the trade and the PM decides.

## Dead ends

None.

## Still open

The theme's home, whether the page follows the system theme or stays dark, the words of the empty state and the link to MeshTavern, and the name, all the PM's. The issues are created after the spec is merged.
