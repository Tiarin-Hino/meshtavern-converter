---
name: open-pr
description: Turn the current branch into a pull request the PM can review without reading code - criteria ticked with evidence, limits stated. Use when work on a branch is finished and needs a PR, or when asked to open, prepare or update a PR.
argument-hint: [issue number]
---

# Open a PR for the current branch

1. **Pre-flight.** Not on `main`. Working tree clean or changes committed (Conventional Commits). Branch is up to date with its base. `npm run check` and `npm run e2e` pass; if they do not, fix that first or say so in the PR, never hide it.
   Two hand-over cases change the steps below. **A design-pass draft** (the branch holds only a design note in `docs/design/`, from `/implement` on Fable): no journal entry yet, the build writes it; the body is the brief, not the finished template (step 3); the PR is created as a draft (step 4). **An existing PR** (from `/continue-pr`, or any branch that already has one): the body is rewritten, not a second PR created (step 4).
   The branch has its journal entry in `docs/journal/` (or extends an earlier one), unless the change is a dependency bump, a typo or formatting. If it is missing, write it now from the branch's commits, the issue and what happened in the session. Its "Numbers" and "Still open" must agree with the PR description.
2. **Scan the diff** (`git diff <base>...HEAD`) for things that must not ship: STL files, converted output or renders of real minis, secrets, `.env` files, user data, names of third-party minis, creators or shops, leftover debug code, network calls with user data. This repo is public: nothing about business, pricing, licensing deals or partners.
3. **Fill `.github/pull_request_template.md`:**
   - `Closes #N` on the first line. For a stacked PR, target the parent branch and say so at the top.
   - **Second opinion.** If the change is complex or risky, add one line under `Closes #N`: `Suggest the astra-review label: <reason in one line>`. Complex or risky means a new pipeline stage, data shape or structure; a changed spec decision; a moved regression baseline; anything near "the user's STL never leaves the browser"; a large diff across several areas; or work that needed planning, not just building. Never add the label yourself: the PM decides, and GPT Astra is a paid review worth it where a second model family may see what Claude does not.
   - **What changed**: three to six plain-language sentences. What a user or the PM will notice, then the technical gist.
   - **Acceptance criteria**: copied from the issue. Tick only what is proven, and put the evidence next to each tick (test name, measured number with its device, screenshot).
   - **Needs a human look**: every visual or taste judgement, with before/after screenshots.
   - **Limits**: what was not verified, not measured, or deliberately left out, with follow-up issue numbers.
   - **Journal**: the path of the entry, or why there is none.
   - Tick the checklist honestly; an unticked box with a reason beats a false tick.
4. **Push the branch and create the PR** with `gh pr create`. A design-pass draft: `gh pr create --draft`, the body carries the brief for Opus (what to read in which order, the build order, the acceptance criteria unticked, the journal entry to write, then the template's remaining sections), and `Closes #N` stays on the first line. A branch that already has a PR: `gh pr edit <n> --body-file`, keeping the brief and ticking the criteria with the evidence. Never push to `main`, never force-push, never merge.
5. **Watch CI and the reviews** (`gh pr checks`). Fix failures that belong to this change; report ones that do not.
6. Give the PM the PR link and a two-line summary of what to look at first.
