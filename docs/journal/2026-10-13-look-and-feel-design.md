---
title: Mockups of the page on MeshTavern's components
date: 2026-10-13
phase: 1
issues: [142]
prs: [149]
topics: [ui, planning]
---

## What we did

Drew what the page will look like once it uses the table application's design system: the page's five states (empty, converting, asking, done, error), the drag overlay, the question view and the painting panel as the application would mount them, each on a desktop and a phone, in the light and the dark theme. Nothing on the page changed yet; the mockups are the PM's to approve before the build starts. A design note, `docs/design/look-and-feel.md`, records what they decide, so the four build items (K2 to K5, #143 to #146) do not decide it again.

## Why

The PM decided to publish the page before the table exists (#140), and the spec `docs/specs/look-and-feel.md` (#141) asks for it to look like the same product as MeshTavern. Its L1 and L2 ask for a design pass first, with mockups the PM approves, because "the same product" is judged by eye.

## How

- **Static HTML on the application's own stylesheets.** The mockups are plain pages under `docs/design/look-and-feel/` that link a byte-for-byte copy of the application's `tokens.css`, `components.css`, `pages.css`, `theme.js` and fonts (its `main` at `c515120`), plus `mock.css` for the page's layout and nothing a component already says. A drawing tool would have needed the components redrawn by hand; this way every button, field and panel is the real component, and the build copies measurements, not impressions.
- **Rendered by a script.** `npm run shots:look-and-feel` (`scripts/look-and-feel-shots.mjs`) opens each mockup in headless Chromium (Playwright 1.63, on the development PC) at 1440 × 900 and 375 × 812 and switches the theme through the emulated system setting: 26 PNGs in `shots/`, remade after any change.
- **Icons as CSS masks** for the mockups only: the 38 Lucide icons they use, generated from `lucide-static` 1.53.0 into `icons.css`. The build bundles them inline as the application does.
- **The 3D viewport is a drawn stand-in** (a grid and a standee blob), so the mockups need no WebGL; the real mini against the new chrome is K3's `verify-3d` step.
- **The scene stays dark in both themes**: the mini's look was tuned on a dark backdrop and the thumbnails are transparent, so the light theme is a light frame around a dark stage, through the application's `--scene-*` roles. A light stage is a two-line override if the PM prefers it.
- **The done panel is 22 rem**, wider than the application's 19 rem dock, for the Adjust rows; Adjust is four disclosures (Up and turn open on a desktop, all closed on a phone, a size warning opens Size).
- **Where the theme files live** is left to the PM with the trade in the note's section 2.1: a copy here guarded by a test in the application (recommended), or this library as the source.

## Problems and how we solved them

- **The size warning wrapped badly.** The spec proposed the application's banner for it; the first render showed the sentence and its Scale to fit button wrapping inside a one-line pill. **Cause:** the banner is made for a short transient line ("Reconnecting…"). **Fix:** the application's callout (a tinted block with a bar and an icon), with the button under the sentence; the drag overlay keeps the banner.
- **The level chips vanished under the phone sheet, then the viewport vanished.** The chips were positioned against the stage, whose bottom is under the sheet. **Cause:** the chips must sit in the viewport's grid row, not the stage's bottom; and once the chips and the sheet had explicit grid rows, the auto-placed viewport was pushed into a third, empty row. **Fix:** the chips and the viewport are both placed in row 1 explicitly, the sheet in row 2; K3 keeps the explicit rows.

## Dead ends

- **A footer for the credits** (the spec's proposal on a desktop): it costs a row of the viewport on every screen for a line read once. Credits became a button in the bar that opens the application's dialog.
- **The application's tooltip for the level chips' triangle counts:** its behaviour lives in a private module of the application, so the page uses the browser's `title` instead.
- **The application's menu on a phone:** also private; the page builds a small menu of its own for the bar's overflow.

## Still open

The PM's approval of the mockups (spec L1, L2), the theme's home (section 2.1) and both themes with the dark stage (2.2) are decided on this PR. The words on the mockups are placeholders for K4 (#145), and the wordmark slot shows the development name until K6 (#147) names the page. K2 (#143) moves the theme copy to `public/theme/` and adds the colour check; K3 (#144) rebuilds the page from the mockups; K5 (#146) brings the accessibility scan, the keyboard pass and the reference screenshots.

## Story angle

Mockups that are made of the real components, rendered by a script: a design pass whose output a build can measure against. "Designing in the browser, on someone else's design system."
