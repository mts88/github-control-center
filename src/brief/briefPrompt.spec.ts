import { describe, expect, it } from "vitest";
import { buildBriefPrompt, buildBriefSystemPrompt, MAX_BODY_CHARS, MAX_FILE_LINES, PATCH_BUDGET_BYTES } from "./briefPrompt";
import type { IPrDetails, IPrFile, IPrFilePatch } from "../core/types";

function buildDetails(overrides: Partial<IPrDetails> = {}): IPrDetails {
  return {
    number: 42,
    title: "A title",
    url: "https://github.com/acme/repo/pull/42",
    repo: "acme/repo",
    author: "jane",
    authorAvatarUrl: "https://avatars.example/jane",
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-07-01T00:00:00Z",
    bodyHtml: "<p>Hello <strong>world</strong></p>",
    baseRefName: "main",
    headRefName: "feature/thing",
    headRepo: "acme/repo",
    isBehindBase: false,
    commitsCount: 3,
    changedFiles: 2,
    additions: 10,
    deletions: 4,
    labels: [],
    mergeable: "MERGEABLE",
    mergeMethods: ["SQUASH"],
    reviewDecision: null,
    viewerDidAuthor: false,
    reviewers: [],
    checks: [],
    checksTotal: 0,
    timeline: [],
    timelineTruncated: false,
    ...overrides,
  };
}

function buildFile(path: string, additions: number, deletions: number, overrides: Partial<IPrFile> = {}): IPrFile {
  return { path, changeType: "MODIFIED", additions, deletions, viewedState: "UNVIEWED", ...overrides };
}

function toPatchMap(patches: IPrFilePatch[]): Map<string, IPrFilePatch> {
  return new Map(patches.map((filePatch) => [filePatch.path, filePatch]));
}

describe("buildBriefSystemPrompt", () => {
  it("should instruct the model to respond in the requested language", () => {
    const systemPrompt = buildBriefSystemPrompt("Italian");

    expect(systemPrompt).toContain("Italian");
  });

  it("should declare the PR content as untrusted data, not instructions", () => {
    const systemPrompt = buildBriefSystemPrompt("English");

    expect(systemPrompt.toLowerCase()).toContain("not instructions");
  });

  it("should require the three reviewer-oriented sections in plain text", () => {
    const systemPrompt = buildBriefSystemPrompt("English");

    expect(systemPrompt).toContain("What changed");
    expect(systemPrompt).toContain("Risk areas");
    expect(systemPrompt).toContain("Suggested reading order");
  });

  it("should fall back to English when the language is blank", () => {
    const systemPrompt = buildBriefSystemPrompt("   ");

    expect(systemPrompt).toContain("Respond in English");
    expect(systemPrompt).not.toContain("Respond in  ");
  });
});

describe("buildBriefPrompt", () => {
  it("should label title and description as author-provided and potentially inaccurate", () => {
    const prompt = buildBriefPrompt(buildDetails(), [buildFile("a.ts", 1, 1)], toPatchMap([]));

    expect(prompt).toContain("author-provided, may be inaccurate");
    expect(prompt).toContain("A title");
  });

  it("should strip HTML tags from the body", () => {
    const prompt = buildBriefPrompt(buildDetails(), [buildFile("a.ts", 1, 1)], toPatchMap([]));

    expect(prompt).toContain("Hello world");
    expect(prompt).not.toContain("<p>");
    expect(prompt).not.toContain("<strong>");
  });

  it("should decode numeric and named HTML entities in the body, not just the common literals", () => {
    const details = buildDetails({ bodyHtml: "<p>it&#x27;s &#8212; a &quot;fix&quot; &amp; more</p>" });
    const prompt = buildBriefPrompt(details, [buildFile("a.ts", 1, 1)], toPatchMap([]));

    expect(prompt).toContain(`it's — a "fix" & more`);
  });

  it("should list every changed file with diffstat and change type, even without a patch", () => {
    const files = [buildFile("src/a.ts", 5, 2), buildFile("assets/logo.png", 0, 0, { changeType: "ADDED" })];
    const prompt = buildBriefPrompt(buildDetails(), files, toPatchMap([]));

    expect(prompt).toContain("src/a.ts (+5/-2, MODIFIED)");
    expect(prompt).toContain("assets/logo.png (+0/-0, ADDED)");
  });

  it("should include patches ordered by churn, largest first", () => {
    const files = [buildFile("small.ts", 1, 0), buildFile("big.ts", 100, 50)];
    const patches = toPatchMap([
      { path: "small.ts", patch: "@@ small hunk @@" },
      { path: "big.ts", patch: "@@ big hunk @@" },
    ]);
    const prompt = buildBriefPrompt(buildDetails(), files, patches);

    expect(prompt.indexOf("@@ big hunk @@")).toBeLessThan(prompt.indexOf("@@ small hunk @@"));
  });

  it("should stop including patches once the byte budget is exhausted", () => {
    const hugePatch = "x".repeat(PATCH_BUDGET_BYTES);
    const files = [buildFile("huge.ts", 900, 0), buildFile("tiny.ts", 1, 0)];
    const patches = toPatchMap([
      { path: "huge.ts", patch: hugePatch },
      { path: "tiny.ts", patch: "@@ tiny hunk @@" },
    ]);
    const prompt = buildBriefPrompt(buildDetails(), files, patches);

    expect(prompt).toContain(hugePatch);
    expect(prompt).not.toContain("@@ tiny hunk @@");
    expect(prompt).toContain("tiny.ts (+1/-0, MODIFIED)");
  });

  it("should skip the patch section entry for files without a patch (binaries)", () => {
    const files = [buildFile("logo.png", 0, 0)];
    const prompt = buildBriefPrompt(buildDetails(), files, toPatchMap([{ path: "logo.png" }]));

    expect(prompt).not.toContain("=== logo.png ===");
    expect(prompt).toContain("logo.png (+0/-0, MODIFIED)");
  });

  it("should truncate the highest-churn patch to fit the budget instead of dropping it", () => {
    const oversizedPatch = `@@ hunk one @@\n${"a".repeat(PATCH_BUDGET_BYTES)}\n@@ hunk two @@\n${"b".repeat(1_000)}`;
    const files = [buildFile("core.ts", 900, 0), buildFile("tiny.ts", 1, 0)];
    const patches = toPatchMap([
      { path: "core.ts", patch: oversizedPatch },
      { path: "tiny.ts", patch: "@@ tiny hunk @@" },
    ]);
    const prompt = buildBriefPrompt(buildDetails(), files, patches);

    expect(prompt).toContain("=== core.ts ===");
    expect(prompt).toContain("patch truncated (over size budget)");
    expect(prompt).not.toContain("@@ hunk two @@");
  });

  it("should cap the file list by churn and note the omitted count", () => {
    const files = Array.from({ length: MAX_FILE_LINES + 5 }, (_, index) => buildFile(`file-${index}.ts`, index, 0));
    const prompt = buildBriefPrompt(buildDetails(), files, toPatchMap([]));

    expect(prompt).toContain("5 more files not shown");
    // the highest-churn file survives the cap, a zero-churn one is dropped
    expect(prompt).toContain(`file-${MAX_FILE_LINES + 4}.ts`);
    expect(prompt).not.toContain("- file-0.ts ");
  });

  it("should truncate an oversized PR description", () => {
    const details = buildDetails({ bodyHtml: `<p>${"word ".repeat(MAX_BODY_CHARS)}</p>` });
    const prompt = buildBriefPrompt(details, [buildFile("a.ts", 1, 1)], toPatchMap([]));

    expect(prompt).toContain("…(truncated)");
  });

  it("should put the untrusted-data marker before any PR content", () => {
    const prompt = buildBriefPrompt(buildDetails({ title: "MARKER_TITLE" }), [buildFile("a.ts", 1, 1)], toPatchMap([]));

    const markerIndex = prompt.toLowerCase().indexOf("untrusted");
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeLessThan(prompt.indexOf("MARKER_TITLE"));
  });
});
