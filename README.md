# GitHub Control Center

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center)
[![Visual Studio Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center)
[![Visual Studio Marketplace Rating](https://vsmarketplacebadges.dev/rating-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center&ssr=false#review-details)
[![Open VSX Version](https://img.shields.io/open-vsx/v/mts88/github-control-center?label=Open%20VSX&logo=vscodium)](https://open-vsx.org/extension/mts88/github-control-center)

A VSCode extension built by developers, for developers — to keep your GitHub situation under control: the PRs waiting for your review and your own open PRs, with a badge count on the activity bar, toast notifications, a GitHub-like PR page, full in-editor code review (diffs, line comments, pending reviews — no checkout needed), and one-click actions (review, merge, checkout) — all without leaving the editor.

## Features

- **Two views** in the activity bar container: **To Review** (PRs where your review is requested, including team requests) and **My PRs** (your open PRs), both grouped by repository. PRs you already reviewed stay in To Review after requested ones — labeled with your review state (approved, stale, changes requested, commented) — until they close or your review is re-requested.
- **Badge count** on the activity bar icon, configurable per list.
- **Toast notifications** when a new PR requests your review — and when one of your own PRs gets approved or receives a changes request — with quick actions (Open, Settings). Anti-spam by design: the first fetch after a reload never fires a storm.
- **PR details panel**: click a PR to open a GitHub-like page — conversation timeline with rendered mermaid diagrams, merge box (review decision, checks, conflicts, out-of-date branch), reviewers, labels, aggregate diffstat — without leaving VSCode.
- **Act on PRs**: comment, approve, request changes, merge (with the repo-allowed merge methods), mark your own drafts as ready for review, update an out-of-date branch (rebase or merge commit, GitHub-style selector), and check out the PR branch when the repository is open in the workspace. CI check names link straight to their runs.
- **Code review in the editor**: expand a PR row to browse its changed files (directory tree or flat list), open real diffs pinned to the PR's commits — no checkout needed, fork PRs included — and review like on GitHub: comments on a line, a selection, or the whole file, batched into a pending review you submit as Comment / Approve / Request changes. Existing review threads show inline with reply and resolve; per-file viewed checkboxes sync with GitHub.
- **Row shortcuts**: inline icons to check out the PR branch or open it in the browser; right-click to copy the URL or branch name, or mute the repository or its whole organization.
- **Muting with search**: the "Manage Muted Repositories" command opens a picker that live-searches GitHub as you type — mute/unmute repositories or entire organizations in one click.
- **AI brief** (optional, requires the [Claude Code](https://claude.com/product/claude-code) or [Codex](https://developers.openai.com/codex) CLI): a **✨ Brief me** button in the PR details panel produces a reviewer-oriented summary grounded in the diff — what changed, risk areas, suggested reading order. See [AI features](#ai-features).
- **Zero runtime dependencies**: native `fetch`, VSCode's built-in GitHub authentication, GitHub-rendered markdown (`bodyHTML`). Mermaid diagrams are rendered by a locally bundled copy of mermaid — no CDN, nothing leaves your machine.

## Authentication

The extension uses VSCode's GitHub authentication provider with the `repo` and `read:org` scopes. `repo` is required to see PRs in private repositories; `read:org` is required to show team review requests. You'll be prompted to sign in the first time.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `githubControlCenter.badge.countToReview` | `true` | Include PRs waiting for your review in the badge count. |
| `githubControlCenter.badge.countMine` | `false` | Include your own open PRs in the badge count. |
| `githubControlCenter.badge.countReviewed` | `false` | Include PRs you already reviewed (no active re-request) in the badge count. Has no effect while `toReview.hideReviewed` is on. |
| `githubControlCenter.notifications.enabled` | `true` | Show notifications for new review requests and for review outcomes on your own PRs. |
| `githubControlCenter.mutedRepos` | `[]` | Entries hidden from lists, badge, and notifications: `owner/repo` for one repository, `owner` (or `owner/*`) for a whole organization. Best edited via the **Manage Muted Repositories** command (searchable picker). |
| `githubControlCenter.toReview.hideDrafts` | `false` | Hide draft PRs from the To Review list, badge, and notifications. |
| `githubControlCenter.toReview.hideReviewed` | `false` | Hide open PRs you already reviewed from the To Review list while they wait for a re-request. |
| `githubControlCenter.updateBranch.defaultMethod` | `REBASE` | Method preselected for the Update branch action (`REBASE` or `MERGE`). |
| `githubControlCenter.files.layout` | `tree` | How a PR's changed files are laid out under its row: `tree` (directory hierarchy, compacted single-child folders) or `flat` (plain list). Also toggled from the `…` menu of either view. |
| `githubControlCenter.ai.backend` | `claude-code` | Which local AI backend powers the AI features: `claude-code` or `codex`. |
| `githubControlCenter.ai.language` | `English` | Language AI-generated content is written in, regardless of the AI backend. |
| `githubControlCenter.ai.claude.command` | `claude` | Path to the Claude Code CLI (machine-scoped: workspaces cannot override it). Claude Code backend only. |
| `githubControlCenter.ai.claude.model` | `sonnet` | Model passed to `claude --model`: Sonnet, Haiku, Opus, or the CLI's configured default. Claude Code backend only. |
| `githubControlCenter.ai.codex.command` | `codex` | Path to the OpenAI Codex CLI (machine-scoped: workspaces cannot override it). Codex backend only. |

## AI features

The **✨ Brief me** button in the PR details panel generates a reviewer-oriented summary of the PR: what actually changed, where the risk is, and in what order to read the files — grounded in the diff, since titles and descriptions are often stale. Two backends are available, set with `githubControlCenter.ai.backend`; both run headlessly on your machine with no API key, using an existing subscription. When the configured backend's binary is missing, the AI features simply don't appear.

- **Claude Code** (default) — requires the [Claude Code CLI](https://claude.com/product/claude-code) (`claude` on the PATH, or set `githubControlCenter.ai.claude.command`), using your existing Claude subscription. The CLI runs with all tools disabled and isolated settings: PR content can never execute anything or read your Claude configuration.
- **Codex** — requires the [OpenAI Codex CLI](https://developers.openai.com/codex), signed in (`codex login`), on your machine (`codex` on the PATH, or set `githubControlCenter.ai.codex.command`), using your existing ChatGPT subscription. The extension applies the strongest lockdown the Codex CLI documents (read-only sandbox, disabled shell/web-search/image tools, isolated config) — but Codex, unlike Claude Code, has no single flag guaranteed to disable all tool execution. ⚠️ A maliciously-crafted PR could, in principle, still make the model read local files and include them in the brief. **Use the Codex backend only for PRs whose authors you trust.**
- **Privacy**: the PR's title, description, file list, and patches are sent to the selected backend's provider (Anthropic or OpenAI) through your own CLI — the same channel your existing usage of that CLI already goes through. Nothing is sent unless you click the button.
- Both backends generate the summary from untrusted PR content — treat it as an aid, not a verdict.
- Summaries are per head commit and survive VSCode restarts (stored locally, never synced): once generated, the button stays disabled until the author pushes new commits — then it re-enables and produces a fresh brief. To force regeneration (e.g. after changing the language setting), run **GitHub Control Center: Clear AI Brief Cache** from the command palette.

## Reviewing pull requests

A full code review without leaving the editor — and without checking out the branch.

### Changed files

Expand a PR row in either view to load its changed files, laid out as a **directory tree** (single-child folders compacted, like the explorer) or a **flat list** — switch with *View Files as List / Tree* in the `…` menu of the view, or via `githubControlCenter.files.layout`. Each file shows its change type (added / modified / deleted / renamed) and a diffstat tooltip; the checkbox marks it **viewed** on GitHub, exactly like the web UI.

### Diffs

Click a file to open a native VSCode diff between the PR's base and head commits. Contents come from the GitHub API pinned to the PR's SHAs, so:

- no local checkout is needed, and your working tree is never touched;
- fork PRs work out of the box;
- what you see is exactly the PR's diff, regardless of local state.

### Comments

Commenting is only offered on lines that are part of the diff — the same rule GitHub enforces:

- **Single line**: click the `+` in the gutter next to a changed or context line.
- **Multi-line**: select the lines, then click the `+` on the selection. The selection must stay within one diff hunk.
- **Whole file**: click the comment icon in the diff editor's title bar (also *GitHub Control Center: Comment on File* in the command palette). This is also the way to comment binaries and files too large for a text diff.

Each comment widget offers two actions: **Add Review Comment** batches the comment into your pending review; **Add Single Comment** posts it immediately (refused while a pending review exists — submit or discard it first).

### Pending review

Your first review comment starts a GitHub **pending review**: draft comments are visible only to you until submitted, and the status bar shows `PR #N: k pending` while one is open. When you're done:

- **Submit Review…** (status bar click, or command palette) — choose Comment, Approve, or Request changes; a summary body is required to request changes.
- **Discard Pending Review** — deletes the draft and all its comments after a confirmation.

### Existing threads

Review threads already on the PR appear inline at their anchored lines (both diff sides), with the full conversation: reply from the thread, and resolve or unresolve it from the thread header. Pending comments are labeled, resolved threads start collapsed, and outdated threads (whose anchor line no longer exists in the diff) are skipped — read those on GitHub.

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
