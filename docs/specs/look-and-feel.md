# Spec: Look and feel of the page

Status: draft for PM review · Date: 2026-10-13 · Owner: PM
Rests on: `docs/specs/phase-1-converter.md` (story 6, the page, and the decision of 2026-10-13: the page is published before the table application, with the painter), `docs/design/product-page.md` (the four states, the layout, the wording, the promise and its test), `docs/design/questions-view.md` (#119, the question view as a library entry), `docs/design/painting-engine.md` (#126 to #128, the engine; its panel becomes a library entry too), and the table application's design system, which this page adopts.

**Why this spec exists.** The page was built for the team: the dark scheme of the spike moved into custom properties, `system-ui`, no icons, the development name "MeshTavern Converter" in the top bar, the team's tools behind `?dev`. On 2026-10-13 the PM decided to publish the page before the table application, as a free tool for anyone with an STL, and asked that it be made ready for the public in the same style and colour palette as MeshTavern, with a proper name of its own. What is marked "PM" is decided; every other number and behaviour is a proposal (P).

## What the page looks like today (`main` at `a535366`)

One page in five states on `body[data-state]`: the drop card, converting with the step in words, the converter's question (the question view, its own stylesheet `src/lib/questions.css`), the done panel along the right edge (file name, the size line, two downloads, Adjust with Up and turn, Size and Look, the level chips in the viewport's corner), the error card; a bottom sheet on a phone. Colours are ten custom properties on `:root` in `src/page/style.css` with the spike's values (`--bg #1b1d22`, `--accent #7aa2f7` and so on), the question view and the painting view each with a few of their own; 30 colour literals over the three stylesheets. Type is `system-ui`. Buttons, selects, sliders and the `<details>` are the browser's defaults, restyled lightly. Nothing is fetched from another origin, which `e2e/promise.spec.ts` proves after a file is picked.

MeshTavern's design system, in the table application's repo: one token stylesheet (`tokens.css`: base scales, then the roles components read, both themes through `light-dark()` and `data-theme`, a seam for per-system themes), one component stylesheet (`components.css`: buttons, inputs, fields, the focus ring, panels, rows, chips, badges, tabs, dialogs, menus, tooltips, toasts, banners, the empty state, skeletons, progress, cards, the toolbar), `pages.css` (the frames of the pages outside the table: the centred card, the app bar over a column), the two fonts (Inter for text and controls, Fraunces for headings; SIL OFL 1.1, Latin subsets, 115 KB), the Lucide icons (ISC), a colour-literal check and a WCAG 2.2 AA contrast check in its `npm run check`, a style guide with the decisions behind it (a modern tool with a warm brass accent, not a fantasy skin; genre-neutral so themes can restyle it through tokens alone).

## Goal

A person who finds the page sees a finished product: the same calm, confident look as MeshTavern, with a name of its own, that works on a phone and a desktop, reads well in both themes, and says in one sentence what it does and that the file never leaves the device. The 3D viewport and the mini are the colourful part; the chrome stays out of their way.

## Users

Anyone with an STL and a browser, no account: hobbyists converting and painting their own minis. The table application, which mounts the question view and the painting panel from this library, and must see one style when it does.

## Scope

In: everything a person sees on the page in its five states, on a desktop and a phone, in both themes; the question view and the painting panel (the two library entries other code mounts); the page's words for the public, the credits of what the page ships, and the README's first screen; the quality bar of the table application (an accessibility scan, a keyboard pass, reference screenshots); a product name and a mark.

Out: the team's tools behind `?dev` beyond keeping them working on the new tokens (they are not restyled); a landing site or documentation pages beyond the one page; the painter's tools themselves (the spec in the private repo and #126 to #128 here); the 3D lighting and the mini's look; a phone layout beyond what the page has (the bottom sheet); per-system themes.

## Stories and acceptance criteria

**[human]** marks criteria a person must judge.

### L1. One design system with MeshTavern (PM, 2026-10-13)

- The page, the question view and the painting panel read the roles of MeshTavern's token stylesheet and are built on its component stylesheet; the page's own stylesheet holds its layout and nothing a token or a component already says. (P) The stylesheets, the two fonts with their licence files and the icons the page uses are copied into this repo under `public/theme/` as the application serves them, and a test in the application's repo (which installs this library at a pinned commit) keeps the copies byte-equal, so a change is made in the application's files and brought here by the pin bump; this repo never edits them by hand. The PM may instead decide that the application takes them from this library; the design pass (K1) states the trade.
- No colour literal outside the token stylesheet: a check like the application's `scripts/check-colours.mjs` runs in `npm run check` over `src/` and `public/theme/` and fails on a hex, a colour function, a named colour or a three.js colour number outside `tokens.css`, the tests and the figures' tooling. The 30 literals of today are gone.
- Both themes: (P) the page follows the system's theme and has the application's switch (light, dark, system; the choice in `localStorage` only), as the application's pages outside the table do; the viewport's backdrop and grid read the `--scene-*` roles. The PM may decide the page stays dark, as the table does.
- Nothing fetched from another origin, as today: the fonts and icons come from this origin, and `e2e/promise.spec.ts` keeps proving it after a file is picked. (P) The theme costs at most what the application budgets: 120 KB of fonts and 40 KB of CSS after gzip.
- The question view and the painting panel, mounted by the application into its own dialogs, look the same there as on the page: the words differ (each takes its `copy`), the style does not. A screenshot of each in this repo's e2e is the reference the application's own screenshots are compared against by eye at the design pass's review.

### L2. The page on the components

- The top bar is the application's app bar: the name (L5) at the left, the promise's short form, the file button, the theme switch (L1) and one link to MeshTavern (its words and target are the PM's). On a phone the bar keeps the name and the file button.
- The drop card, the converting card and the error card are the application's centred card on `--surface-page`; converting shows the step in words over the application's progress component with the shimmer while a step reports nothing, off under `prefers-reduced-motion`; the error card's heading and the one-sentence reason from `problems.ts` read as today.
- The done panel is the application's panel frame: a header with the file name and Close (which returns to the drop card, as "Choose another file" does), the body in sections (the size line and the status; Downloads with two primary buttons; Adjust with Up and turn, Size and Look as sections, each a disclosure; Paint, when the painter is on the page), a footer where the page has batch actions, none today. Every select, slider, checkbox and button is the application's component with its default, hover, focus, pressed and disabled states; the six-way select and the 15° buttons are a segmented control and a button group (P). The level chips in the viewport's corner are the application's chips with the triangle count in a tooltip.
- The drag overlay, the dev badge and the size warning use the application's banner and badge; the warning keeps opening Adjust.
- A phone: the panel is a bottom sheet with a grab handle at the application's tap size (44 px), the card takes the width minus the gutters, nothing scrolls sideways, as today; (P) the sheet's first screen still fits the size line and the two downloads without scrolling at 375 px wide.
- The team's tools behind `?dev` (figures, stress, perf, bench, opening a GLB, the compressed download) keep working and read the tokens so they do not break the layout; they are not restyled.
- **[human]**: the PM opens the page on the development PC and the laptop in both themes and on a phone and judges that it is the same product as MeshTavern.

### L3. Words and the frame for the public

- The empty state says in two sentences what the page does (an STL in, a game-ready mini out, in the browser) and keeps the promise sentence as it is: a plain sentence, no "100 % private", no lock icon. (P) A third line names what comes out: three detail levels, a look, a paint, two downloads. The words are the PM's on the PR.
- A footer or a "Credits" dialog (P: a link in the app bar's overflow on a phone, in the footer on a desktop) lists what the page ships: the fonts and their licence, the icons, three.js, xatlas, meshoptimizer and the Basis Universal build, each with its licence, from a `NOTICE.txt` beside the theme files; a line that says the page collects nothing and stores nothing but the person's own choices on their device.
- The README's first screen is written for a person who found the page, not for the team: the name, the sentence, a screenshot in both themes, the link to the page once it is published, then "Run it" and "Develop" as today. The development name goes out of the README, the page's `COPY.title` and the tests when L5 has a name; until then they read the placeholder the PM picks.
- The page's `<title>` and its description tag read the name and the sentence; a favicon of the mark (L5) or, until then, the placeholder's letter.

### L4. The quality bar, kept

- An accessibility scan (axe-core through Playwright, as the application's `accessibility.spec.ts`) runs on every state of the page, the question view and the painting panel, in both themes, and fails on a serious or critical violation.
- A keyboard pass: every control is reached by Tab, every kind of control is driven with keys alone (the file button, the disclosures, the segmented control, the sliders, the chips, the sheet's handle), and the focus ring is the application's.
- Reference screenshots of the five states on a desktop and the two phone frames, in both themes, with the 3D canvas hidden (software rendering draws it differently per machine), one set per platform, compared in the e2e; a deliberate change of the look rewrites them with `--update-snapshots` and commits the files.
- The contrast of every text and icon pair is the application's check, run there over the same token file; this repo adds no colour, so it needs no check of its own (a new role that this page alone needs is added in the application's file first).

### L5. A name and a mark (PM, 2026-10-13)

- **The page needs a proper product name, not the development name "MeshTavern Converter".** The PM picks it. (P) It should say what the thing does or belong to MeshTavern by sound, read well as a tool's name on its own, be spellable after hearing it once, and not be another product's or brand's name in the hobby, 3D printing or VTT space; the PM checks the last point before it is used.
- Until the name exists, the page shows the placeholder the PM names in the display face, in the wordmark slot of the app bar, and `COPY.title` is the one place the name lives, so the change is one line and the tests follow.
- The mark follows the application's process for its wordmark (its spec 07, decision 8): the PM generates candidates with an image model, an agent scores each round against a checklist (exact spelling, legible at 16, 32 and 128 px, one colour on dark and on light, flat traceable shapes, no genre motifs, no look-alike of another brand's mark, a short form for the favicon), the PM picks, the agent traces the pick into an SVG and derives the favicon. An AI-generated mark gets weak or no copyright protection, which is acceptable for a placeholder and a reason to commission a designer later. The mark is this repo's own file under `docs/design/brand/`; MeshTavern's wordmark stays in the application's repo and is not reused here.

## Data and permissions

None. The page stores nothing but the person's own choices on their device (the theme, the palette, an unsaved painting when the private repo's spec says so); it still collects nothing and sends nothing.

## Risks

- **Two copies of the theme drift.** A copy in this repo and the application's original can differ for a day after a change in the application. The equality test in the application fails until the pin is bumped, which is the signal; the design pass states whether the other direction (the library as the source) is better, and the PM decides.
- **A 3D viewport in reference screenshots.** CI draws WebGL in software and differently per machine; the application hides the canvas with a stylesheet in its reference run, and this page does the same. The mini's look is judged by eye and by the corpus's comparison sheets, not by these screenshots.
- **The fonts add 115 KB to a page that loaded none.** Within the application's budget and from this origin, so the promise test still passes; a person on a slow connection sees the system face for a moment (`font-display: swap`).
- **The painting panel is being designed at the same time** (the private repo's spec, this repo's next items). Its design pass runs on the application's components from the start, so it is not restyled twice; its build follows K2.
- **The name is on the critical path to publishing** and is the PM's alone (#47 cannot publish a page called by the development name). The placeholder keeps every other item moving.

## Decisions (PM, 2026-10-13)

1. The page is published for the public, so it is made ready for the public: one coherent look, a name of its own, the quality bar of the application.
2. The same style and colour palette as MeshTavern: one design system, the application's tokens and components, not a second one.
3. A proper name and a mark before the page is public; the PM picks the name, the development name "MeshTavern Converter" is not it.

## Proposals that stand on merge

- The theme files copied into this repo and kept byte-equal by a test in the application; the page follows the system's theme with the switch; the credits in a footer or dialog from a `NOTICE.txt`; the `?dev` tools kept, not restyled; the fonts and CSS within the application's budgets; the name's checklist and the mark's process of L5; every number and wording marked (P).

## Work items

An epic, **Look and feel of the page** (#148; K1 to K6 are #142 to #147), in this repo. D = design pass first (Fable), B = straight to build (Opus), H = the PM.

| # | Title | Labels | Section | Depends on | Pass |
|---|---|---|---|---|---|
| K1 | Design: the page's five states, the question view and the painting panel on MeshTavern's components, desktop and phone, both themes, as mockups; the map from today's custom properties to the roles; where the theme files live and the equality test; what the `?dev` tools need | task, ui, high, cloud-ok | L1, L2 | — | D |
| K2 | The theme in this repo: tokens, components, fonts, icons and licences under `public/theme/`, the colour-literal check in `npm run check`, the promise test over the theme; the question view's and the painting view's stylesheets on the roles | story, ui, high, cloud-ok | L1 | K1 | B |
| K3 | The page on the components: app bar, cards, the done panel, chips, the sheet, the theme switch, the drag overlay and the warning; the `?dev` tools on the tokens | story, ui, high, cloud-ok | L2 | K2 | B |
| K4 | Words and the frame for the public: the empty state's sentences, the credits from `NOTICE.txt`, the title and description, the README's first screen with screenshots | story, docs, medium, cloud-ok | L3 | K2 | B |
| K5 | The quality bar: the accessibility scan, the keyboard pass and the reference screenshots in the e2e | task, ui, medium, cloud-ok | L4 | K3, K4 | B |
| K6 | The name and the mark: a proper product name picked by the PM (not the development name), the placeholder until then, the mark by the application's wordmark process, the favicon | task, ui, high, needs-human | L5 | — | H |

K1 blocks K2 to K5; K2 blocks K3 and K4; K5 runs after K3 and K4. K6 blocks nothing but the publication (#47), which waits for K3 to K6. The painting panel's design pass (the private repo's spec, "C6") may run beside K1; its build follows K2.
