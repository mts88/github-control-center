# GitHub Control Center

A VSCode extension built by developers, for developers — to keep your GitHub situation under control: the PRs waiting for your review and your own open PRs, with a badge count on the activity bar, toast notifications, a GitHub-like PR page, and one-click actions (review, merge, checkout) — all without leaving the editor.

## Features

- **Two views** in the activity bar container: **To Review** (PRs where your review is requested, including team requests) and **My PRs** (your open PRs), both grouped by repository.
- **Badge count** on the activity bar icon, configurable per list.
- **Toast notifications** when a new PR requests your review — and when one of your own PRs gets approved or receives a changes request — with quick actions (Open, Settings). Anti-spam by design: the first fetch after a reload never fires a storm.
- **PR details panel**: click a PR to open a GitHub-like page — conversation timeline, merge box (review decision, checks, conflicts), reviewers, labels, aggregate diffstat — without leaving VSCode.
- **Act on PRs**: comment, approve, request changes, merge (with the repo-allowed merge methods), mark your own drafts as ready for review, update an out-of-date branch, and check out the PR branch when the repository is open in the workspace. CI check names link straight to their runs.
- **Row shortcuts**: inline icons to check out the PR branch or open it in the browser; right-click to copy the URL or branch name, or mute the repository or its whole organization.
- **Muting with search**: the "Manage Muted Repositories" command opens a picker that live-searches GitHub as you type — mute/unmute repositories or entire organizations in one click.
- **Zero runtime dependencies**: native `fetch`, VSCode's built-in GitHub authentication, GitHub-rendered markdown (`bodyHTML`).

## Authentication

The extension uses VSCode's GitHub authentication provider with the `repo` and `read:org` scopes. `repo` is required to see PRs in private repositories; `read:org` is required to show team review requests. You'll be prompted to sign in the first time.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `githubControlCenter.badge.countToReview` | `true` | Include PRs waiting for your review in the badge count. |
| `githubControlCenter.badge.countMine` | `false` | Include your own open PRs in the badge count. |
| `githubControlCenter.notifications.enabled` | `true` | Show notifications for new review requests and for review outcomes on your own PRs. |
| `githubControlCenter.mutedRepos` | `[]` | Entries hidden from lists, badge, and notifications: `owner/repo` for one repository, `owner` (or `owner/*`) for a whole organization. Best edited via the **Manage Muted Repositories** command (searchable picker). |
| `githubControlCenter.toReview.hideDrafts` | `false` | Hide draft PRs from the To Review list, badge, and notifications. |

## Muting repositories and organizations

Muted entries disappear everywhere at once: both lists, the badge count, and notifications.

Three ways to mute:

- **Searchable picker** — run **GitHub Control Center: Manage Muted Repositories** (command palette, or the `…` menu of either view). It lists your current muted entries (pick one to unmute) and the repositories currently on your radar (pick one to mute). Typing searches GitHub live, and any slash-less text offers a *"Mute everything from …"* item for the whole organization.
- **Right-click a PR row** — *Mute Repository* or *Mute Organization*.
- **Settings** — edit `githubControlCenter.mutedRepos` by hand.

Entry syntax (case-insensitive):

```jsonc
"githubControlCenter.mutedRepos": [
  "acme/noisy-repo",   // mutes one repository
  "some-org",          // mutes the whole organization
  "other-org/*"        // same, alternative spelling
]
```

Unmuting: the picker (entries are listed first, marked as muted), or remove the entry from Settings.

## Install

Grab the `.vsix` from the [latest GitHub Release](https://github.com/mts88/github-control-center/releases/latest) and:

```bash
code --install-extension github-control-center-<version>.vsix
```

Or build it yourself:

```bash
yarn install
yarn dlx @vscode/vsce package --no-dependencies
code --install-extension github-control-center-<version>.vsix
```

See `CONTRIBUTING.md` for development setup.
