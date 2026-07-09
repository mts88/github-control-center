# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GitHub Control Center** (package `github-control-center`, folder `git-radar`) is a personal VSCode extension acting as a control center for daily GitHub activity: PRs waiting for review, own PRs, badge count, toast notifications, and a GitHub-like PR page with actions. Internal identifiers (commands, views, settings) keep the `githubControlCenter.*` namespace — renaming them would break saved user settings for zero gain.

## Commands

```bash
yarn install      # Yarn 4 via .yarnrc.yml yarnPath — no corepack needed, binary lives in .yarn/releases/
yarn build        # Bundle src/extension.ts → dist/extension.js with esbuild
yarn watch        # esbuild watch mode
yarn typecheck    # tsc --noEmit (esbuild does not type-check)
yarn lint         # ESLint flat config (eslint.config.mjs), typescript-eslint
yarn test         # Vitest, single run
yarn test:watch   # Vitest watch mode
```

Run a single test file: `yarn vitest run src/github.spec.ts`.

Package + install locally:

```bash
yarn dlx @vscode/vsce package --no-dependencies
code --install-extension github-control-center-<version>.vsix
```

`--no-dependencies` is required: vsce's dependency scan uses Yarn 1 commands that Yarn 4 does not support, and the bundle has no runtime deps anyway.

## Commits & Releases

- Conventional Commits enforced by commitlint via the committed `.githooks/commit-msg` hook (`core.hooksPath` is set by the `postinstall` script — no husky).
- semantic-release runs on every push to `main` (`.github/workflows/release.yml`, config in `.releaserc.json`): commit-analyzer/notes (preset `conventionalcommits`) → changelog → npm bump (`npmPublish: false`) → vsce package via exec → git commit `chore(release): x.y.z [skip ci]` → GitHub Release with the vsix attached → the **same** vsix published to the VS Marketplace (`vsce publish --packagePath`) and Open VSX (`ovsx publish`).
- Marketplace tokens are env-only: the `VSCE_PAT` / `OVSX_PAT` repo secrets are read natively by the CLIs — never pass them as command-line arguments (they would leak into public Actions logs on failure). Both are validated up front by `verify-pat` exec `verifyConditionsCmd`s, so a missing/expired token fails the release before any tag, commit, or GitHub Release exists.
- Registry publish failure recovery: the GitHub Release (created first, by plugin order) always has the vsix — republish it manually with `yarn vsce publish --no-dependencies --packagePath <vsix>` / `yarn ovsx publish <vsix>`. Azure PATs expire (max ~1 year); renewal is the usual culprit. Unpublishing from either registry is destructive and cached downstream — never improvise it.
- The release workflow runs no lint/typecheck/test: quality gates run in PR CI (`ci.yml`), enforced by the `main` ruleset's required status check (`check`) with the strict up-to-date-branch policy — the tested tree is exactly the squash result. Don't re-add the steps to `release.yml`; if the gate needs changing, change the ruleset.
- The release commit is pushed over SSH with the `RELEASE_DEPLOY_KEY` deploy key (checkout `ssh-key` + `repositoryUrl` in `.releaserc.json`): the branch ruleset on `main` blocks direct `GITHUB_TOKEN` pushes, and GitHub Actions cannot be a ruleset bypass actor on personal repos — deploy keys can. GitHub API calls (the Release itself) still use `GITHUB_TOKEN`.
- **`version` in package.json and `CHANGELOG.md` are semantic-release-owned — never edit by hand.** Versions come from git tags, not from package.json.
- Plugin order in `.releaserc.json` is load-bearing: the npm bump must precede the vsce packaging, which must precede the git commit; the registry-publish exec instances come **after** `@semantic-release/github` so the durable artifact (GitHub Release + vsix) exists before any marketplace is touched.
- `fix:` → patch, `feat:` → minor, breaking → major; other types release nothing.

## Testing

Vitest with specs co-located in `src/*.spec.ts`. The `vscode` module does not exist outside the extension host: `vitest.config.mts` aliases it to the minimal stub in `tests/vscode-mock.ts` (TreeItem, ThemeIcon, EventEmitter, …) — extend the stub when a test needs more of the API. The config file must keep the `.mts` extension (a `.ts` config is loaded as CJS and crashes on ESM-only deps). `fetch` is stubbed per-test with `vi.stubGlobal`.

Notification anti-spam logic lives in `NewPrTracker` (pure, no vscode imports) precisely so it stays testable — don't inline it back into `extension.ts`.

End-to-end verification stays manual: press `F5` in VSCode → Extension Development Host → check the "GitHub Control Center" activity bar icon (see `.vscode/launch.json`, which runs `npm: build` as preLaunchTask).

## Architecture

**Zero runtime dependencies** — keep it that way. HTTP uses the native `fetch`; auth uses VSCode's built-in GitHub authentication provider. Only devDeps: typescript, esbuild, @types/*, mermaid. One deliberate exception to "no vendored code": `mermaid` is a devDep whose prebuilt bundle is copied to `dist/mermaid.min.js` by `esbuild.js` and loaded **only inside the webview**, lazily, when a PR body contains a diagram — never a CDN (CSP stays nonce-only, PR content never leaves the machine).

Data flow, one cycle every 150s (`POLL_INTERVAL_MS` in `extension.ts`) plus manual refresh:

1. `github.ts` — `getSession()` wraps `vscode.authentication.getSession("github", ["repo", "read:org"], ...)`. The `repo` scope is mandatory: without it, PRs in private repositories are silently missing (the query succeeds and returns only public PRs). `read:org` is required by `Team.name` in the details query — without it the whole details fetch fails with a scope error.
2. `github.ts` — `fetchPullRequests()` sends **one** GraphQL request with two aliased searches: `toReview` (`review-requested:@me`, which GitHub already expands to include team review requests) and `mine` (`author:@me`). Capped at 100 results per section, no pagination.
3. `PrTreeProvider.ts` — one provider instance per view ("To Review" → `githubControlCenter.toReview`, "My PRs" → `githubControlCenter.mine`, two separate collapsible views in the container), each rendering its PR list grouped by repo. Returns `[]` when signed out or when its list is empty so the per-view `viewsWelcome` entries in `package.json` show instead (sign-in prompt / empty state, switched by the `githubControlCenter.signedIn` context key).
4. `extension.ts` — owns the poll timer, the badge (`toReviewView.badge`, counts only `toReview`), and the toasts. New-review-request detection is delegated to `NewPrTracker.ts`; approved/changes-requested detection on own PRs to `ReviewDecisionTracker.ts` (decision-level: `reviewDecision` is fetched in the poll's `PR_FIELDS`, no reviewer name). The fetched snapshot passes through `applyFilters` (`githubControlCenter.mutedRepos`, `githubControlCenter.toReview.hideDrafts`) before providers, badge, and trackers.
5. `PrDetailsPanel.ts` + `PrDetailsHtml.ts` — clicking a PR runs `githubControlCenter.openPrDetails`: details are fetched on demand (`fetchPrDetails`, `node(id:)` GraphQL query) and rendered in a **single reused webview panel** (recreated if closed) with a GitHub-like page: header with state pill, conversation timeline (issue comments + review summaries, chronological), merge box (review decision, checks, mergeable, merge button with repo-allowed methods), composer (Comment / Approve / Request changes), sidebar (reviewers, labels with GitHub colors, aggregate diffstat linking to the files tab — no per-file list by design). All bodies use GitHub's `bodyHTML` — pre-rendered and sanitized server-side, which is how the zero-deps rule survives without a markdown parser. `PrDetailsHtml.ts` is pure (no vscode import) so the whole rendering is unit-testable; the panel class is just the webview wrapper. Inline code review threads are deliberately NOT rendered (the heavy part of the GitHub PR extension) — reviews link "N comments on files" to GitHub instead.
6. Mutations (`github.ts`): `addPrComment` (`addComment`), `submitPrReview` (`addPullRequestReview` APPROVE / REQUEST_CHANGES — request changes requires a body, GitHub rule), `mergePr` (`mergePullRequest`, method validated against repo-allowed set), `markPrReadyForReview` (own open drafts only, no confirmation modal — it is reversible), `updatePrBranch` (`updatePullRequestBranch` with `updateMethod` REBASE or MERGE — the preselected one comes from `githubControlCenter.updateBranch.defaultMethod`, REBASE out of the box, offered when the PR branch is behind base — detected via `baseRef.compare(headRef).behindBy`, NOT `mergeStateStatus`: that field only reports `BEHIND` under strict branch protection and shows `BLOCKED` otherwise).
7. Tree row context menu (`view/item/context`): Copy PR URL, Copy Branch Name (`headRefName` is fetched in `PR_FIELDS`), Mute Repository / Mute Organization (append to `githubControlCenter.mutedRepos` at Global target; the config listener does the refresh). Inline icons on rows: checkout (`githubControlCenter.checkoutPr`, `$(git-branch)`) and open in browser. The row checkout cannot detect fork PRs (no `headRepository` in the poll) — it just fails with the git error toast.
9. Muting (`muting.ts`, pure): `mutedRepos` entries are `owner/repo` (one repo) or `owner` / `owner/*` (whole organization), case-insensitive — `isRepoMuted` is the single matcher. `githubControlCenter.manageMutedRepos` (command palette + view overflow menu) opens a QuickPick that lists muted entries (pick to unmute) and known repos from the last raw pre-filter snapshot (pick to mute), live-searches GitHub repositories while typing (250ms debounce, ≥3 chars, silent failures), and offers a "mute everything from X" org item for slash-less input.
8. Checkout (`extension.ts`, webview `checkout` message): uses the built-in `vscode.git` extension API (minimal `IGitExtension` interface, no dependency) — finds the workspace repository whose remote URL contains the PR repo, `fetch` + `checkout(headRefName)` (git DWIM creates the tracking branch). Cross-fork PRs are rejected with an error toast by design. All go through modal confirmations (except plain comments) and an in-flight guard in `extension.ts`; success → toast + list refresh + panel re-fetch, failure → error toast + webview buttons re-enabled via the `reenable` message (keeps the typed comment alive).

## Behavioral invariants (do not break)

- **Toast anti-spam seeding**: the first successful fetch only seeds `NewPrTracker` without notifying — a window reload must never fire a toast storm. Toasts start from the second poll.
- **Silent poll failures**: fetch errors go to the "GitHub Control Center" OutputChannel and the last good data stays on screen. Never surface an error toast from the poll loop.
- **Badge count follows the `githubControlCenter.badge.*` settings** — `countToReview` (default on) and `countMine` (default off) each add their list's length; the default keeps the original behavior (own PRs don't count). Badge is set to `undefined` (not `{value: 0}`) when the configured count is 0.
- **Both trackers (`NewPrTracker`, `ReviewDecisionTracker`) run every poll even with `githubControlCenter.notifications.enabled` off** — only the toasts are gated. Skipping a tracker would replay the whole backlog as a toast storm when notifications are re-enabled.
- **Filters run before everything**: `applyFilters` (muted repos, hide drafts) is applied to the snapshot before providers, badge, and trackers — lists, badge, and toasts must always agree. The badge counts the FILTERED lists.
- The displayed age is the PR's `createdAt` (age of the PR), not the review-request timestamp — fetching the real request time would require GitHub timeline events and was deliberately deferred.
- `statusCheckRollup` is `null` for repos without CI → mapped to `ciState: "NONE"`, never treated as an error.
- `activationEvents: ["onStartupFinished"]` is load-bearing: without it, badge and polling only start when the user opens the view.
- **Details-fetch errors are NOT silent** (unlike the poll loop): they are user-initiated, so they render inside the panel. The poll loop's silence invariant is untouched.
- **Webview security**: CSP allows scripts only via a per-render nonce — `bodyHtml` values are the only raw-injected content and cannot execute. GitHub's mermaid sections (`section[data-type="mermaid"]` with the source in `data-json`) are rendered locally by the bundled mermaid (nonce'd script from `localResourceRoots`, `securityLevel: "strict"`); render failure falls back to the plain source, never a broken page. Webview messages may carry **user-typed text and the chosen merge method only** — never ids or URLs; the extension resolves the current PR itself and validates the merge method against the repo-allowed set.
- **Stale-response guard**: `openPrDetails` uses a request sequence counter — only the latest click may render into the reused panel.

## Conventions

- Interfaces are `I`-prefixed (`IPullRequest`); no `any`; named function declarations.
- Everything is in English, UI strings included.
- **PR descriptions: ALWAYS use the project-local `generate-pr-summary` skill (`.claude/skills/generate-pr-summary/`)** — never a global or plugin-provided PR-summary skill: external variants inject issue-tracker and multi-repo process that does not exist in this repository.
- This repository is personal and public: never reference employers, internal company tooling, or internal ticket systems in code, docs, commits, or PRs.
- **Plan stress-testing: ALWAYS use the project-local `redteam` skill (`.claude/skills/redteam/`)** — never a global or plugin-provided red-team skill. Reviews land in `docs/reviews/` (inline-only when in plan mode).
- `packageManager` field in package.json exists but corepack is not used — `.yarnrc.yml` `yarnPath` drives the Yarn version.
