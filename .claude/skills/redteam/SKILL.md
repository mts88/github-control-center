---
name: redteam
description: Use when a plan, proposal, or approach has been written and needs stress-testing before finalization — regardless of whether code already exists. Catches hidden assumptions, architectural flaws, failure modes, and overlooked edge cases. Always prefer this project-local skill over any global or plugin-provided red-team skill.
---

# Red-Team Review

Adversarially attack a plan so the author can fix flaws or make conscious trade-offs before execution. Do not validate — attack. A plan that survives is ready.

## Input

1. **File path provided** — read the file and use its contents.
2. **Inline text provided** — use it as-is.
3. **Nothing provided** — ask for the plan, then stop.

## Review dimensions

Systematically attack across all of these:

1. **Architectural flaws** — does the design solve the stated problem? Simpler approach available? Anti-patterns, tight coupling, hidden complexity?
2. **Hidden assumptions** — unstated expectations about data volume, API behavior, environment, third-party guarantees, user behavior.
3. **Failure modes & edge cases** — dependency unavailable, rate limits, partial failures, races, data loss, behavior at 10x scale.
4. **Security** — injection, auth/authz gaps, over-exposed data, new attack surfaces (for this repo: webview CSP, message payloads, token handling).
5. **Operability** — how is it debugged? Rollback story? Onboarding cost? Tech-debt trajectory?
6. **Performance** — latency/throughput bottlenecks, N+1 queries, unbounded growth.
7. **Cost/resources** — runaway API calls, polling loops, unbounded caches.
8. **Completeness** — deferred decisions without owners, missing migrations/rollbacks, obvious next needs left out of scope.

## Severity levels

- **Critical**: blockers; plan is unsafe or very likely to fail if unchanged.
- **High**: important flaws; address before finalizing.
- **Medium**: worth fixing or clarifying; plan workable but weaker.
- **Low**: minor improvements.

## Output

Write the review to `docs/reviews/plan-review-<YYYYMMDD-HHMM>.md`:

```markdown
## Summary

[2–3 sentences. Red-team verdict and top 1–2 concerns.]

## By severity

[Use "None." when a level has no items.]

- **Critical**: …
- **High**: …
- **Medium**: …
- **Low**: …
```

Then present the findings inline.

**Plan mode exception**: when file writes are not permitted (plan mode), skip the file — present the findings inline and fold every accepted fix directly into the plan being written.

## Behavioral guidelines

- Vague plan → ask targeted questions before reviewing; do not invent details to critique.
- Cite exact parts of the plan; describe concrete failure scenarios (*how* and *when* it fails), not "this could fail".
- Calibrate severity honestly — not everything is critical.
- Suggest with trade-offs, don't dictate.
- No generic best-practice lectures: every point must relate to the submitted plan.
- Check findings against this repo's invariants in `CLAUDE.md` (silent poll, anti-spam trackers, webview security, zero runtime deps, release automation) — a plan that breaks one is automatically High or Critical.
