# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues for `babyluoye/desk-tool`. Use the `gh` CLI for all operations, and specify this repository explicitly (`-R babyluoye/desk-tool`) because this checkout also has a Gitea remote.

## Conventions

- **Create an issue**: `gh issue create -R babyluoye/desk-tool --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R babyluoye/desk-tool --json number,title,body,labels,comments`.
- **List issues**: `gh issue list -R babyluoye/desk-tool --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: use GitHub's sub-issue commands when available; otherwise put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> -R babyluoye/desk-tool --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R babyluoye/desk-tool --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R babyluoye/desk-tool --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents. This repository does not currently treat PRs as requests.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `babyluoye/desk-tool`.

## When a skill says "fetch the relevant ticket"

Read it from GitHub Issues in `babyluoye/desk-tool`.
