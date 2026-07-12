# Contributing

## Prerequisites

- Node 22 — `nvm install` picks it up from `.nvmrc`.
- Yarn 4 is bundled via `.yarnrc.yml` (`yarnPath`), no corepack needed.

## Setup

```bash
nvm install
yarn install
```

## Everyday commands

```bash
yarn build        # bundle src/extension.ts → dist/extension.js with esbuild
yarn watch        # esbuild watch mode
yarn typecheck    # tsc --noEmit (esbuild does not type-check)
yarn lint         # ESLint (flat config, typescript-eslint)
yarn test         # Vitest, single run
yarn test:watch   # Vitest watch mode
```

Run a single test file: `yarn vitest run src/github/github.spec.ts`.

## Manual verification

Press `F5` in VSCode to launch the Extension Development Host (the `npm: build` preLaunchTask rebuilds first). Check the "GitHub Control Center" activity bar icon.

## Testing

Specs are co-located in `src/**/*.spec.ts`, one folder per domain (`github/`, `tree/`, `panel/`, `review/`, `brief/`, `poll/`, `core/`) — `extension.ts` is the only file that stays at `src/`. The `vscode` module does not exist outside the extension host: `vitest.config.mts` aliases it to the stub in `tests/vscode-mock.ts` — extend the stub when a test needs more of the API. `fetch` is stubbed per-test with `vi.stubGlobal`.

Pure modules are pure on purpose: `panel/PrDetailsHtml.ts` (rendering) and `poll/NewPrTracker.ts` (notification anti-spam) have no `vscode` import so they stay unit-testable. Keep them that way.

## Architecture and invariants

Read `CLAUDE.md` before touching the poll loop, the badge, the notifications, or the webview: it documents the data flow and the behavioral invariants (silent poll failures, anti-spam seeding, webview security rules). Breaking one of those is a bug even if the tests stay green.

Ground rules:

- **Zero runtime dependencies.** Native `fetch`, built-in GitHub auth, GitHub's `bodyHTML` for markdown. If a feature seems to need a dependency, rethink the feature.
- Interfaces are `I`-prefixed, no `any`, named function declarations, everything in English.

## Commits and PRs

Commit messages MUST follow [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. This is enforced by a commitlint `commit-msg` hook, installed automatically by `yarn install` (via `core.hooksPath`). A rejected commit means the message needs fixing, not the hook.

The commit type drives the release: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` footer or `!` → major. Other types never trigger a release — use them honestly.

Before opening a PR: `yarn lint && yarn typecheck && yarn test && yarn build` must pass (CI runs the same checks). New features open as draft PRs.

PR rules, enforced by the PR Validation workflow: the **title must be a Conventional Commit** (it becomes the squash commit that drives the release — a bot comment explains any violation and disappears once fixed), and the **author is auto-assigned** when no assignee is set.

## Releases

Releases are fully automated by semantic-release on every push to `main`: version bump, `CHANGELOG.md`, git tag, GitHub Release with the packaged `.vsix` attached.

**Never bump `version` in package.json or edit `CHANGELOG.md` by hand** — both are owned by the release pipeline.

## Packaging (local build)

```bash
yarn dlx @vscode/vsce package --no-dependencies
code --install-extension github-control-center-<version>.vsix
```

`--no-dependencies` is required: vsce's dependency scan uses Yarn 1 commands that Yarn 4 does not support, and the bundle has no runtime deps anyway. For normal use, prefer the `.vsix` attached to the latest GitHub Release.
