---
name: generate-pr-summary
description: Use when creating a GitHub PR for the current branch of this repo, or when updating an existing PR description. Always prefer this project-local skill over any global or plugin-provided PR-summary skill.
---

# Generate PR Summary (github-control-center)

Generate a reviewer-friendly PR description for the current branch and apply it on GitHub.

**Always use this skill in this repository — never a global or plugin-provided PR-summary skill.** External variants inject issue-tracker references, multi-repo sections and review-bot blocks that do not apply here.

## Steps

**1. Gather context (run in parallel):**

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --stat
git diff main...HEAD
gh pr view 2>/dev/null || echo "NO_PR"
```

If the diff or commit history alone is not enough to understand the intent behind a change, ask the user before writing.

**2. Output the PR description with this structure:**

---

## Summary

[2–3 sentences: outcome first, then motivation. Start with what this enables, not how it's implemented.]

## Changes

- **[Component or file]**: what it now does differently and why
- [Repeat per meaningful change, not per file]

## Architecture

[Mermaid diagram of the flow touched by this PR. Pick the type: cross-component/async → `sequenceDiagram`; module relationships or branching → `flowchart TD`/`LR`; state transitions → `stateDiagram-v2`.

GitHub's Mermaid renderer is strict — broken diagrams render blank. Node IDs alphanumeric only; labels in plain ASCII (no emoji, no `\n` — use `<br/>`, no `&`/`<`/`>`/`/`/`:`, under 40 chars). Mentally parse every label before finalising.]

## Technical Flow

[Numbered steps explaining the end-to-end flow: data flow, state changes, key decisions and rejected alternatives.]

## Key Decisions & Rationale

| Decision | Why |
|----------|-----|
| [What was chosen] | [Why this over the alternative] |

## Prerequisites & Config

[Anything that must happen outside this PR — settings, re-auth, reinstall. "None" if empty.]

## Notes for Reviewers

- [Area that deserves extra attention and why]
- [Anything intentional that might look wrong]

---

**Quality checks before outputting:**

- Summary explains the WHY, not just the WHAT
- No section is just a file list — every item has context
- All Mermaid labels pass the syntax rules above
- Behavioral invariants from CLAUDE.md touched by the PR are called out in Notes for Reviewers

**3. Apply to GitHub:**

- **PR exists**: update the body via `gh api repos/mts88/github-control-center/pulls/<number> --method PATCH --field body='<description>'`.
- **No PR**: title in Conventional Commits format (`<type>(<scope>): <description>`, max 70 chars, lowercase — same types as commitlint). Push the branch if needed (`git push -u origin HEAD --no-verify`), then create with `gh pr create --draft --title "..." --body "..."` (heredoc with literal triple backticks, single-quoted EOF). New features open as **draft**.
- Return the PR URL.
