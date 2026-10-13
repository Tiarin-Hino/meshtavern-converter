# MeshTavern's theme, as the table application serves it

These files are MeshTavern's design system, copied byte for byte from the table application's
`web/public/theme/` (`Tiarin-Hino/meshtavern`, its `main` at `791425e` on 2026-10-13; unchanged
since `c515120`, the commit the mockups of #142 were drawn on). Vite copies `public/` into
`dist/`, so the page serves them under `/theme/` as the application does (#143, design note
`docs/design/look-and-feel.md` §2.1):

- `tokens.css`: the fonts' `@font-face`, the base values, the roles, both themes
- `components.css`: every component and its states
- `theme.js`: the theme switch (light, dark, system; `mt-theme` in `localStorage`, never sent)
- `fonts/`: Inter and Fraunces, Latin subsets of the variable fonts, with their licences (SIL OFL
  1.1, `OFL-Inter.txt`, `OFL-Fraunces.txt`)
- `LICENSE-Lucide.txt`: the icons' licence (ISC); the icons themselves are inline SVG in
  `src/lib/questions/icons.ts` and `src/page/icons.ts`, written by `npm run icons`

Nothing here is edited by hand. A change is made in the application, which keeps its own copy
equal to this one by a test once it installs this library, and is brought here by copying the
files again and naming the new commit above. A role this page needs is added to the
application's `tokens.css` first. Not copied: `pages.css` (the page takes the measurements it
needs into `src/page/style.css`), the favicon and the app icon (the page gets its own, #147) and
`NOTICE.txt` (the page writes its own, #145).
