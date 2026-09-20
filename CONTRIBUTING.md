# Contributing

This project is built by a small team together with the Claude Code agent. Humans and the agent follow the same workflow.

## Filing work

- Use the issue forms: **Epic**, **User story**, **Task**, **Bug**.
- A user story needs acceptance criteria that can be checked (numbers, visible behaviour). "Looks good" is not a criterion; "100 minis at ≥30 fps on the reference laptop" is.
- Labels: `type:*`, `area:*`, `priority:*`.
  - `ready-for-agent` — the PM has reviewed the issue; the agent (or a human) may pick it up.
  - `needs-human` — blocked on a decision or on something the agent cannot judge (usually visuals).

## Doing work

1. Branch from `main`: `feat/<issue>-<short-name>`.
2. Commit with Conventional Commits.
3. Open a PR with `Closes #<issue>` and fill in the checklist.
4. CI must be green. A human reviews and squash-merges. Nobody pushes to `main`.

## Reviewing an agent PR

1. Read the acceptance criteria in the issue, then the PR description.
2. Open the Playwright report artifact on the CI run and look at the screenshots.
3. For visual or interaction changes, check out the branch and try it (`npm run dev`).
4. Request changes in plain language; mention `@claude` once the GitHub app is installed.

## Test minis

STLs are licensed files. Never commit them and never attach them to issues.

- Keep your corpus in a folder outside the repo (or in `corpus/`, which is git-ignored).
- Sort it into folders by kind: `humanoid`, `large-creature`, `quadruped`, `flying` (also minis on a stand), `mounted`, `swarm`, `terrain`. `npm run corpus` reports which kinds are still missing, how many files came Y-up and Z-up, and how many have a base.
- After a pipeline change, run `npm run corpus` and read `out/corpus/results.md`: it lists every figure that moved since the last run. The sheets and results stay on your machine.
- Record in the issue only the file name, triangle count and file size.
- For shared test files the team uses the project Google Drive folder.
