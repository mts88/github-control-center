import { describe, expect, it } from "vitest";
import { renderPrDetailsHtml } from "./PrDetailsHtml";
import type { IPrDetails } from "./types";

const NONCE = "test-nonce-123";
const NOW = new Date("2026-07-08T12:00:00Z").getTime();

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
    bodyHtml: "<p>Hello</p>",
    baseRefName: "main",
    headRefName: "feature/thing",
    headRepo: "acme/repo",
    isBehindBase: false,
    commitsCount: 3,
    changedFiles: 1,
    additions: 10,
    deletions: 4,
    labels: [{ name: "bug", color: "d73a4a" }],
    mergeable: "MERGEABLE",
    mergeMethods: ["SQUASH", "MERGE"],
    reviewDecision: "REVIEW_REQUIRED",
    viewerDidAuthor: false,
    reviewers: [{ name: "luigi", state: "APPROVED" }],
    checks: [{ name: "build", status: "SUCCESS" }],
    checksTotal: 1,
    timeline: [
      { kind: "comment", author: "mario", avatarUrl: "https://avatars.example/mario", bodyHtml: "<p>Nice</p>", createdAt: "2026-07-02T00:00:00Z" },
      {
        kind: "review",
        author: "luigi",
        avatarUrl: "https://avatars.example/luigi",
        bodyHtml: "<p>LGTM</p>",
        createdAt: "2026-07-03T00:00:00Z",
        reviewState: "APPROVED",
        codeCommentsCount: 2,
      },
    ],
    timelineTruncated: false,
    ...overrides,
  };
}

function render(overrides: Partial<IPrDetails> = {}): string {
  return renderPrDetailsHtml(buildDetails(overrides), NONCE, NOW);
}

describe("renderPrDetailsHtml", () => {
  it("should escape HTML in interpolated fields so injected markup stays inert", () => {
    const html = render({ title: '<script>alert("boom")</script>' });

    expect(html).toContain("&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("boom")</script>');
  });

  it("should inject GitHub-rendered bodies as raw HTML", () => {
    const html = render({ bodyHtml: "<p>Hello <strong>world</strong></p>" });

    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<p>Nice</p>");
  });

  it("should put the nonce in both the CSP meta tag and the script tag", () => {
    const html = render();

    expect(html).toContain(`script-src 'nonce-${NONCE}'`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
  });

  describe("state pill", () => {
    it.each([
      [{ state: "OPEN" as const }, ">Open<"],
      [{ state: "OPEN" as const, isDraft: true }, ">Draft<"],
      [{ state: "MERGED" as const }, ">Merged<"],
      [{ state: "CLOSED" as const }, ">Closed<"],
    ])("should render %o as pill %s", (overrides, expectedPill) => {
      expect(render(overrides)).toContain(expectedPill);
    });
  });

  describe("timeline", () => {
    it("should render authors, avatars and relative dates", () => {
      const html = render();

      expect(html).toContain("mario");
      expect(html).toContain('src="https://avatars.example/mario"');
      expect(html).toContain("commented 6 days ago");
      expect(html).toContain("approved these changes 5 days ago");
    });

    it("should link review code comments to the files tab", () => {
      const html = render();

      expect(html).toContain('href="https://github.com/acme/repo/pull/42/files">2 comments on files</a>');
    });

    it("should show the older-conversation link only when truncated", () => {
      expect(render({ timelineTruncated: true })).toContain("View older conversation on GitHub");
      expect(render()).not.toContain("View older conversation on GitHub");
    });
  });

  describe("merge box", () => {
    it("should offer only the repo-allowed merge methods", () => {
      const html = render();

      expect(html).toContain('<option value="SQUASH">Squash and merge</option>');
      expect(html).toContain('<option value="MERGE">Create a merge commit</option>');
      expect(html).not.toContain('value="REBASE"');
    });

    it.each([
      ["draft", { isDraft: true }],
      ["merged", { state: "MERGED" as const }],
      ["closed", { state: "CLOSED" as const }],
      ["no allowed method", { mergeMethods: [] as IPrDetails["mergeMethods"] }],
    ])("should hide the merge button when %s", (_label, overrides) => {
      expect(render(overrides)).not.toContain('id="merge"');
    });

    it("should link check names to their run when a URL is present", () => {
      const html = render({
        checks: [
          { name: "build", status: "FAILURE", url: "https://ci.example/run/1" },
          { name: "no-link", status: "SUCCESS" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain('<a href="https://ci.example/run/1">build</a>');
      expect(html).toContain(">no-link<");
      expect(html).not.toContain(">no-link</a>");
    });

    it("should show Ready for review only on the viewer's own open drafts", () => {
      const ownDraft = render({ isDraft: true, viewerDidAuthor: true });
      const colleagueDraft = render({ isDraft: true, viewerDidAuthor: false });
      const ownNonDraft = render({ viewerDidAuthor: true });
      const mergedDraft = render({ isDraft: true, viewerDidAuthor: true, state: "MERGED" });

      expect(ownDraft).toContain('id="ready"');
      expect(ownDraft).not.toContain('id="merge"');
      expect(colleagueDraft).not.toContain('id="ready"');
      expect(ownNonDraft).not.toContain('id="ready"');
      expect(mergedDraft).not.toContain('id="ready"');
    });

    it("should offer Update branch only when the PR is open and behind base", () => {
      expect(render({ isBehindBase: true })).toContain('id="update-branch"');
      expect(render()).not.toContain('id="update-branch"');
      expect(render({ isBehindBase: true, state: "MERGED" })).not.toContain('id="update-branch"');
    });

    it("should offer Checkout branch on open PRs only", () => {
      expect(render()).toContain('id="checkout"');
      expect(render({ isDraft: true, viewerDidAuthor: true })).toContain('id="checkout"');
      expect(render({ state: "MERGED" })).not.toContain('id="checkout"');
      expect(render({ state: "CLOSED" })).not.toContain('id="checkout"');
    });

    it("should summarize failing checks", () => {
      const html = render({
        checks: [
          { name: "build", status: "SUCCESS" },
          { name: "lint", status: "FAILURE" },
        ],
        checksTotal: 5,
      });

      expect(html).toContain("1 failing check");
      expect(html).toContain("+3 more on GitHub");
    });
  });

  describe("composer", () => {
    it("should hide review buttons on the viewer's own PRs but keep the comment button", () => {
      const html = render({ viewerDidAuthor: true });

      expect(html).not.toContain('id="approve"');
      expect(html).not.toContain('id="request-changes"');
      expect(html).toContain('id="comment"');
    });

    it("should hide review buttons on non-open PRs", () => {
      expect(render({ state: "MERGED" })).not.toContain('id="approve"');
    });

    it("should show Approve and Request changes on a colleague's open PR", () => {
      const html = render();

      expect(html).toContain('id="approve"');
      expect(html).toContain('id="request-changes"');
    });
  });

  describe("sidebar", () => {
    it("should show the aggregate diffstat linking to the files tab", () => {
      const html = render();

      expect(html).toContain('href="https://github.com/acme/repo/pull/42/files">1 file</a>');
      expect(html).toContain(">+10</span>");
      expect(html).toContain(">−4</span>");
      expect(html).not.toContain("src/index.ts");
    });

    it("should color label pills with the GitHub label color", () => {
      const html = render();

      expect(html).toContain("#d73a4a");
      expect(html).toContain(">bug</span>");
    });

    it("should fall back to a neutral color for invalid label colors", () => {
      const html = render({ labels: [{ name: "odd", color: "not-a-color" }] });

      expect(html).not.toContain("#not-a-color");
      expect(html).toContain(">odd</span>");
    });
  });
});
