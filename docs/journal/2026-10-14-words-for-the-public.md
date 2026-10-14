---
title: The words and the frame for the public
date: 2026-10-14
phase: 2
issues: [145]
prs: [155]
topics: [ui, docs]
---

## What we did

The page now has its name, PolyWash, in the bar, in the browser tab and in the README. The empty card says in two sentences what the page does ("An STL of a miniature in, a game-ready mini out. Everything runs in this tab."), then what comes out ("You get three detail levels, a look and two downloads."), then the promise, unchanged. Credits, in the bar on a desktop and under More on a phone, lists every part the page ships with its licence, and ends with the line that the page collects nothing and stores only your own choices on your device. The tab has a favicon, the letter P. The README opens for a person who found the page: the name, the sentence, a screenshot that follows GitHub's light or dark theme, what it does, and where the link will go once the page is published.

## Why

The page goes public on GitHub Pages before the table application exists (#47), and it should read as a product, not as the team's tool (spec `docs/specs/look-and-feel.md`, L3; design note `docs/design/look-and-feel.md` §10, K4). A page that ships fonts, icons and four libraries has to credit them; the Basis Universal licence (Apache 2.0, §4(d)) asks for its notice in a readable form, and the MIT licences ask for their texts with every copy.

The name came from #147 on the same day: the PM picked **PolyWash**, chose that casing and the favicon's short form "P", after a check against the trademark registers, the domains and the stores (the record is on #147's branch, `docs/design/brand/name.md`). The issue said the development name goes out "once K6 has a name, the placeholder until then"; K6 had its name, so this PR uses it and #147 keeps the mark.

## How

- **One place for the name.** `COPY.title` in `src/page/page-state.ts` reads a `NAME` constant, and the tab's title (`documentTitle`) and the description tag (`description`) are built from it and from the one sentence. The `<title>` and `<meta name="description">` are written into `index.html` as text, not set at start-up as the design note proposed: a link preview and a search engine read the HTML without running the script. A unit test (`page-state.test.ts`) keeps the two equal to `COPY`, so the name still changes in one line and the test points at the HTML.
- **`NOTICE.txt` beside the theme files.** `public/theme/NOTICE.txt` is written in the application's format (a part, what it does, copyright, licence), then three.js, meshoptimizer, xatlas, the Basis Universal encoder, the SRD 5.1 attribution and the favicon, then the full licence texts, copied from the licence files the repo and `node_modules` already hold. three.js's KTX2 loader brings two parts of its own that the page ships: the Basis Universal transcoder (served under `/basis/`) and zstddec, a build of Zstandard; both are named under three.js. It is the one file in `public/theme/` that is the page's own, not the application's; the theme's README says so and `theme-files.test.ts` lists it.
- **The dialog names what the NOTICE names.** The Credits dialog (#144's shell) holds a definition list, one `<dt>` per part. `src/page/credits.test.ts` reads both files and fails when a part is in one and not the other, when a licence file's text is missing from the NOTICE, when the versions of three, meshoptimizer or lucide-static in `node_modules` differ from the ones credited, and when the SRD attribution differs from the README's. The dialog is 36 rem wide instead of the application's 26 rem, so a part and its licence fit in one or two lines, and it scrolls on a short screen. Its links open a tab of their own: leaving the page would lose the converted mini.
- **The favicon.** `public/favicon.svg`: the P of Fraunces at weight 700 and optical size 9 (the sturdiest cut for 16 px), traced into outlines with fontTools from the WOFF2 the page already serves, in brass-400 on a grey-950 rounded square, the token values written out because a favicon cannot read the page's CSS. It sits outside `public/theme/` (which is the application's) and outside the colour check's roots, like the application's own favicon. `e2e/promise.spec.ts` allows `/favicon.svg` after a file is picked, because a browser may ask for it late.
- **The README's screenshots** are of the real page (`docs/design/look-and-feel/shots/readme-light.png`, `readme-dark.png`, beside the mockups' shots that K5 rewrites), a generated stand-in figure from the regression net converted in Playwright's Chromium at 1440 × 900, not the mockups of #142, which still show the development name. A `<picture>` with a `prefers-color-scheme: dark` source shows the one that matches the reader's GitHub theme.

## Problems and how we solved them

- **A favicon set in a web font does not render.** A favicon is drawn on its own, without the page's fonts, so `<text font-family="Fraunces">` would fall back to a system serif. **Fix:** the glyph's outline, taken from the font file with fontTools' instancer and SVG pen, as a path.
- **The demo mini was a poor screenshot.** `window.__mt.loadDemo()` converts a six-triangle pyramid. **Fix:** the regression net's `generateFigure(true)` (a bumpy figure on a round base) written to an STL and dropped into the page; no real mini, no third-party shape.

## Dead ends

- Writing the title and description from `COPY` at start-up (the design note's item 3). Dropped for the reason above; the test keeps the single source instead.

## Still open

- The words are proposals; the PM changes them on the PR. The third line leaves out "a paint" from the spec's proposal, because the page does not offer painting yet; it goes in when the painter is on the page.
- The MeshTavern link's words and target (`MESHTAVERN_URL`) are still the placeholder of #144; the PM's "by MeshTavern" byline is open on #147.
- The README's link to the page, once #47 publishes it.
- The package and repository keep the name `meshtavern-converter` (import paths, `package.json`, the GLB's `generator`); a person reading the page does not see it. Renaming them is a separate decision.
- K5 (#146) replaces the screenshots with its reference shots if the PM prefers.
