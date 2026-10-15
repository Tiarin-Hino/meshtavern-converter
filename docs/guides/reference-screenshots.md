# Reference screenshots

`e2e/reference-screens.spec.ts` (#146, spec `docs/specs/look-and-feel.md` L4) takes a picture of the page's five states (empty, converting, asking, done, error) on a desktop (1440 × 900) and two phones (375 × 812 and 390 × 844, with a touch screen), each in the light and the dark theme: 30 pictures. It compares each one with the file in `e2e/reference-screens.spec.ts-snapshots/`. They keep the look from slipping by accident: a change to a stylesheet, the theme files or the markup that moves a pixel fails the e2e run.

What they do not show:

- **The 3D canvas.** `e2e/reference-screens.css` hides every `<canvas>`, and the scenes' animation frames are held while a picture is taken (`freezeFrames` in `e2e/states.ts`). CI draws WebGL in software, differently per machine. The mini's look is judged by eye and by the corpus's sheets.
- **The converting step and its bar.** They move on while the picture is taken, so they are covered by a magenta box (`mask`). The card, its heading and Cancel are still compared.
- Motion: the pictures are taken with reduced motion and with CSS animations stopped.

## One set per platform

Fonts are drawn slightly differently on Linux, Windows and macOS, so Playwright names each file after the platform (`desktop-done-dark-chromium-linux.png`, `…-chromium-win32.png`). CI runs on Linux; the Linux set is committed.

**The first run on another platform** (the development PC) finds no pictures for it: it writes them, and that one test fails with "A snapshot doesn't exist … writing actual". Look at the new files, then commit them; the next run compares against them.

## When a test fails

The failure names the picture, for example `phone-375-done-dark.png`. Open the HTML report (`npx playwright show-report`; on CI the `playwright-report` artifact of the run): for each failed picture it has the expected, the actual and a diff with the changed pixels in red, and a slider between the first two.

- **The change was not meant.** It is a regression: fix the CSS or the markup, not the picture.
- **The change was meant** (a restyle, new words, a new control): rewrite the pictures and commit them with the change, so the PR shows the before and after.

## Rewriting the pictures after a deliberate change

```bash
npx playwright test e2e/reference-screens.spec.ts --update-snapshots
git add e2e/reference-screens.spec.ts-snapshots
```

This rewrites only the set of the platform you run it on. When the Linux set must change and you are not on Linux, take the `actual` pictures from the CI run's report (named `<picture>-actual.png`), rename them to the snapshot names and commit them, or run the command in a Linux session (a Claude Code cloud session can: the task needs no GPU).

In the PR, say which pictures changed and why; the diff of a PNG on GitHub shows both side by side.

## The other two quality checks

The same spec item has two more tests, which need no pictures:

- `e2e/accessibility.spec.ts`: axe-core over every state, the drag overlay, the credits dialog, the More menu, the questions and the `?dev` Paint tool, in both themes. A serious or critical violation fails; the rest are attached to the report as text.
- `e2e/keyboard.spec.ts`: Tab reaches every visible control in every state with the theme's focus ring (`--focus-ring`), and each kind of control works with keys alone.

There is no contrast check here: this repository adds no colour. The pairs of text and background come from the theme's roles, and the table application's contrast check measures every pair over the same `tokens.css`. A colour this page needs that no role names is added in the application's `tokens.css` first, with its contrast row, and copied here.
