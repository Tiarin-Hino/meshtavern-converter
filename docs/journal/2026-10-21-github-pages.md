---
title: The page on GitHub Pages, at a test address
date: 2026-10-21
phase: 2
issues: [47]
prs: []
topics: [workflow, tooling]
---

## What we did

The page is published on GitHub Pages, at <https://tiarin-hino.github.io/meshtavern-converter/>, so the team can try it without running it on their own computer. Every merge to `main` builds the page and deploys it; the address always shows what `main` holds. The address is the repository's own until PolyWash has its domain (the PM is about to register polywash.app), and then the same workflow serves it there with one setting changed.

## Why

#47 holds the publishing task: GitHub Pages as the host, a deploy from CI on every merge to `main`, no secrets in the repository, and a page that collects nothing. The PM decided on 2026-10-13 (#140) that the page is published before the table application, with the painter on it (#167, merged 2026-10-21) and in MeshTavern's style (#148). On 2026-10-21 the PM asked for the current version at a test address, for the PM and a teammate to test before the domain is registered. This PR is that test address; #47 stays open for the domain and for the release blockers.

## How

- **A second workflow, `pages.yml`, beside CI.** It builds `dist/` with `npm run build` (the typecheck and the bundle) and deploys it with GitHub's own Pages actions, which authenticate with the job's OIDC token: nothing to store. CI runs the checks on the same push, and `main` takes nothing that CI has not passed, so the deploy builds alone instead of repeating the checks. `workflow_dispatch` redeploys by hand. The alternative, deploying from a `gh-pages` branch, keeps built files in the repository; the artifact deploy keeps the repository source only.
- **The path the page is served under.** GitHub Pages serves a project at `/<repository>/`, so `vite.config.ts` reads `BASE_PATH` from the environment as Vite's `base`, `/` when unset: the dev server, the e2e runs and the domain later are untouched. Vite rewrites the bundle, the two workers, the Basis transcoder path (`import.meta.env.BASE_URL` since #30) and index.html's `<link>` and `<script>` paths with it. It does not rewrite an `<a href>`, so the four links of the Credits dialog (NOTICE.txt and the three licence texts) are relative now, and the e2e test that reads the first one expects the relative path.
- **The README names the address** as the test one until the domain.

## Problems and how we solved them

- **The build flag turned into a Windows path.** `vite build --base /meshtavern-converter/` on the development PC produced links under `/Program Files/Git/meshtavern-converter/`. **Cause:** Git Bash on Windows converts an argument that starts with `/` into a Windows path before the program sees it. **Fix:** the path is an environment variable read in `vite.config.ts`, which the workflow sets; nothing is passed on a command line.

## Still open

- The domain: `BASE_PATH` becomes `/` in `pages.yml` and the CNAME goes into the repository's Pages settings once polywash.app is registered (#47).
- The release blockers (`release-blocker`) and #47's own checklist stay as they are; this is a test address, not the release.

## Story angle

Publishing a static page that must not collect anything: one workflow, no secrets, and the one path the bundler does not rewrite.
