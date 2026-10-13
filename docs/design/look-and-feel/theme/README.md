# The application's theme, copied for the mockups

These files are MeshTavern's design system as the table application serves them under `/theme/`
(`web/public/theme/` in `Tiarin-Hino/meshtavern`), copied byte for byte from its `main` at
`c515120` on 2026-10-13 for the mockups of `docs/design/look-and-feel.md` (#142):

- `tokens.css`: the fonts' `@font-face`, the base values, the roles, both themes
- `components.css`: every component and its states
- `pages.css`: the frames of the application's pages outside the table (the mockups take the app
  bar's and the centred card's measurements from it; the page does not link it)
- `theme.js`: the theme switch (light, dark, system; `mt-theme` in `localStorage`, never sent)
- `fonts/`: Inter and Fraunces, Latin subsets of the variable fonts, with their licences (SIL OFL
  1.1, `OFL-Inter.txt`, `OFL-Fraunces.txt`)
- `LICENSE-Lucide.txt`: the icons' licence (ISC; `../icons.css` holds the ones the mockups use)

Nothing here is edited by hand: a change is made in the application and copied again. K2 (#143)
moves the copy to `public/theme/`, where the page serves it, and the application's test keeps the
two byte-equal (or the application takes them from here: the note's section 3 states the trade).
