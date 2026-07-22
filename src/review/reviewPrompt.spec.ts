import { describe, expect, it } from "vitest";
import { buildReviewPrompt, buildReviewSystemPrompt } from "./reviewPrompt";
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

describe("buildReviewSystemPrompt", () => {
  it("should declare the PR content as untrusted data, not instructions", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt.toLowerCase()).toContain("not instructions");
  });

  it("should demand a JSON array with no surrounding prose", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt).toContain("JSON array");
  });

  it("should require path, side, snippet, line, severity, and comment fields", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    for (const field of ["path", "side", "snippet", "line", "severity", "comment"]) {
      expect(systemPrompt).toContain(`"${field}"`);
    }
  });

  it("should instruct the snippet to be a verbatim, unparaphrased line of code", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt.toLowerCase()).toContain("verbatim");
  });

  it("should instruct comments to be written in the requested language", () => {
    const systemPrompt = buildReviewSystemPrompt("Italian");

    expect(systemPrompt).toContain("Italian");
  });

  it("should fall back to English when the language is blank", () => {
    const systemPrompt = buildReviewSystemPrompt("   ");

    expect(systemPrompt).toContain("English");
  });

  it("should instruct returning an empty array rather than inventing findings", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt).toContain("[]");
  });

  it("should instruct a friendly, non-judgmental tone", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt.toLowerCase()).toContain("friendly");
    expect(systemPrompt.toLowerCase()).toContain("non-judgmental");
  });

  it("should instruct comments to stay short, without long prose", () => {
    const systemPrompt = buildReviewSystemPrompt("English");

    expect(systemPrompt.toLowerCase()).toContain("1-2 sentences");
  });
});

describe("buildReviewPrompt", () => {
  it("should label title and description as author-provided and potentially inaccurate", () => {
    const prompt = buildReviewPrompt(buildDetails(), [buildFile("a.ts", 1, 1)], toPatchMap([]));

    expect(prompt).toContain("author-provided, may be inaccurate");
    expect(prompt).toContain("A title");
  });

  it("should list every changed file with diffstat and change type", () => {
    const files = [buildFile("src/a.ts", 5, 2)];
    const prompt = buildReviewPrompt(buildDetails(), files, toPatchMap([]));

    expect(prompt).toContain("src/a.ts (+5/-2, MODIFIED)");
  });

  it("should include patches ordered by churn, largest first", () => {
    const files = [buildFile("small.ts", 1, 0), buildFile("big.ts", 100, 50)];
    const patches = toPatchMap([
      { path: "small.ts", patch: "@@ small hunk @@" },
      { path: "big.ts", patch: "@@ big hunk @@" },
    ]);
    const prompt = buildReviewPrompt(buildDetails(), files, patches);

    expect(prompt.indexOf("@@ big hunk @@")).toBeLessThan(prompt.indexOf("@@ small hunk @@"));
  });

  it("should put the untrusted-data marker before any PR content", () => {
    const prompt = buildReviewPrompt(buildDetails({ title: "MARKER_TITLE" }), [buildFile("a.ts", 1, 1)], toPatchMap([]));

    const markerIndex = prompt.toLowerCase().indexOf("untrusted");
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeLessThan(prompt.indexOf("MARKER_TITLE"));
  });

  it("should skip the patch section for files without a patch (binaries)", () => {
    const files = [buildFile("logo.png", 0, 0)];
    const prompt = buildReviewPrompt(buildDetails(), files, toPatchMap([{ path: "logo.png" }]));

    expect(prompt).not.toContain("=== logo.png ===");
    expect(prompt).toContain("logo.png (+0/-0, MODIFIED)");
  });
});
