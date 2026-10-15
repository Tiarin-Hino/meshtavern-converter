---
title: The page on MeshTavern's components
date: 2026-10-14
phase: 1
issues: [144]
prs: [154]
topics: [ui, testing]
---

## What we did

Every state of the page now looks like the table application: the bar is its app bar with the theme switch, a link to MeshTavern and Credits; the drop, converting and error screens are its centred card; the finished mini's panel is its panel frame, with a Close button, Downloads, and Adjust split into four sections that open and close. On a phone the panel is a bottom sheet with a handle that makes it taller, and the bar's extras move into a More menu.

## Why

The page is published before the table (#140) and must read as the same product as MeshTavern (spec `docs/specs/look-and-feel.md`, L2). The theme came into the repo with #143; this is K3 of the epic #148, built to the mockups and the design note of #142 (`docs/design/look-and-feel.md` §4, §6, §9).

## How

- **One panel element, two frames.** The card and the panel were already one element (`#panel`) that moved between the middle and the right edge. It stays one: `render()` gives it the components' class `card` or `panel`, and in the card its header, body, sections and footer take `display: contents`, so their children stand in the card's single column. The alternative, two elements with copies of the heading, the status line and Cancel, would have doubled every id the tests and scripts address.
- **Every control carries its component class** (`btn`, `btn-primary`, `segmented`, `btn-group`, `input`, `field`, `check`, `chip`, `badge`, `menu`, `dialog`, `progress`), and the page's generic control rule is gone. `style.css` keeps the layout and two parts the components have only under the application's page frames: the disclosure and the callout.
- **Adjust as four disclosures** (`details.disclosure`: Up and turn, Size, Look, Base and parts), each with a hint of what it holds ("+Z, from the base", "Medium, mm", "Grey primer", "one file") from four new tested functions in `page-state.ts`. Up and turn opens on a desktop, nothing on a phone, and a size warning opens Size.
- **Confirm beside Cancel.** The question view's Confirm lived at the end of its controls, while Cancel is the page's. The view now takes an optional `footer` element (`QuestionsOptions.footer`) and moves its two Confirm buttons there, shown with their question; the application can do the same in its dialog. Without it, nothing changes.
- **The More menu and the Credits dialog** are two small modules (`menu.ts`, `dialog.ts`), because the application's own are private to its repo. The menu's theme items press the bar's switch instead of carrying the switch's attribute: `theme.js` sets `aria-pressed` on every element with that attribute, and `aria-pressed` is not allowed on a menu item. Credits holds the fonts' and icons' licences and the one line that the page collects nothing; its full text is #145's.
- **Tests** check the classes and roles per state, the disclosures and their hints, the chips' titles, Close back to the drop card, the menu with the keyboard, the dialog with Escape and its focus return, and the phone at 390 × 844 and 375 × 812 with a touch screen.

## Problems and how we solved them

- **The page did not start.** **Cause:** the question view moved its Confirm buttons into the footer before it looked them up inside its own controls, so the lookup found nothing. **Fix:** move them after the lookups.
- **The dev server crashed when a mini was baked.** **Cause:** the worktree had no `node_modules` of its own; imports resolved from the main checkout, but the KTX2 transcoder is served from a path relative to the worktree. **Fix:** `npm ci` in the worktree.
- **A test's `/^Close/` found two buttons.** The level chip "Close" and the panel's new Close share the start of a name. **Fix:** the test looks for the chip inside the level group. Both keep their names; the group says which is a detail level.
- **The full e2e run timed out in twelve tests** with eight workers on the development PC, the dev server and a browser running beside them. Every failure was a timeout, as the #41 and #70 entries saw before; CI runs one worker. The next run, with one worker, reused the preview server of the stopped run, which then went away: every test after the first was refused a connection. The third run started its own server.
- **Five tests used controls that now sit in closed sections.** The plain base, the look's controls and presets, and the Base section's lines are inside Size, Look and Base and parts, which start closed. **Fix:** each test opens the section by its summary, as a person would. The phone question's check that the viewport keeps half the screen became the sheet's bound: at most 44 % of the screen, the viewport the rest (420.6 of 844 px there).
- **One test failed with a Playwright protocol error** ("Failed to find browser context") and passed unchanged on the rerun.

## Numbers

- CSS after gzip (Node zlib, level 9): page 5,125 bytes (4,156 before), questions 2,101, tokens 4,068, components 5,251, painting 491: 17,036 of the 40,000 budget.
- At 375 × 812 with a touch screen (the in-app browser on the development PC): the sheet's first screen is 357 px, the far download ends at 743 px of 812, the handle is 44 px, nothing scrolls sideways.
- Unit tests: 672 pass in `npm run check`. e2e: 79 tests with one worker on the development PC, 15.2 min; 73 passed in the full run, the six others after the fixes above.

## Still open

- **The MeshTavern link's words and target are the PM's.** Until named, it points at this repository (`MESHTAVERN_URL`).
- **Paint in the panel** waits for the painter on the page; the `?dev` Paint tool keeps its place.
- **Pull apart** at the parts' question still changes its words when pressed rather than being a pressed button; the question view's look beyond the footer was K2's.
- The level chips' tooltip is the browser's `title`, as the design note proposed.
- **[human]** The PM's judgement on the development PC, the laptop and a phone, in both themes.

## Story angle

Restyling a working tool without breaking its tests: one element in two frames, every id kept, and a dialog's button that moves into its host's footer.
