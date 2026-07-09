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

const MERMAID_URI = "vscode-resource://ext/dist/mermaid.min.js";

// real shape produced by GitHub's bodyHTML for a ```mermaid fence:
// the diagram source inside data-json is HTML-encoded TWICE (&amp;gt; → &gt; → >)
const MERMAID_SECTION =
  '<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid" data-host="https://viewscreen.githubusercontent.com">' +
  '<div class="js-render-enrichment-target" data-json="{&quot;data&quot;:&quot;flowchart TD\\n  A--&amp;gt;B&quot;}"></div>' +
  "<span>Loading</span></section>";

function renderWithMermaid(overrides: Partial<IPrDetails> = {}): string {
  return renderPrDetailsHtml(buildDetails(overrides), NONCE, NOW, MERMAID_URI);
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

  describe("mermaid rendering", () => {
    it("should load the local mermaid bundle with the nonce when the description contains a diagram", () => {
      const html = renderWithMermaid({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain(`<script nonce="${NONCE}" src="${MERMAID_URI}"></script>`);
      expect(html).toContain("mermaid.initialize");
    });

    it("should load the mermaid bundle when only a timeline body contains a diagram", () => {
      const html = renderWithMermaid({
        bodyHtml: "<p>plain</p>",
        timeline: [{ kind: "comment", author: "mario", avatarUrl: "", bodyHtml: MERMAID_SECTION, createdAt: "2026-07-02T00:00:00Z" }],
      });

      expect(html).toContain(`src="${MERMAID_URI}"`);
    });

    it("should not load the mermaid bundle when no body contains a diagram", () => {
      const html = renderWithMermaid();

      expect(html).not.toContain(MERMAID_URI);
      expect(html).not.toContain("mermaid.initialize");
    });

    it("should not load the mermaid bundle when no script uri is available", () => {
      const html = render({ bodyHtml: MERMAID_SECTION });

      expect(html).not.toContain("mermaid.initialize");
    });

    it("should replace GitHub's mermaid section with the fully decoded source", () => {
      const html = renderWithMermaid({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain('<div class="gcc-mermaid"><pre>flowchart TD\n  A--&gt;B</pre></div>');
      expect(html).not.toContain("js-render-enrichment-target");
      expect(html).not.toContain("A--&amp;gt;B");
    });

    it("should keep the decoded source visible even without the mermaid bundle", () => {
      const html = render({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain('<div class="gcc-mermaid"><pre>flowchart TD\n  A--&gt;B</pre></div>');
    });

    it("should leave a section with malformed data-json untouched", () => {
      const brokenSection = '<section data-type="mermaid"><div class="js-render-enrichment-target" data-json="not json"></div></section>';

      const html = renderWithMermaid({ bodyHtml: brokenSection });

      expect(html).toContain(brokenSection);
    });
  });

  describe("header", () => {
    it("should link the repository name and Open on GitHub above the title", () => {
      const html = render();
      expect(html).toContain('<a href="https://github.com/acme/repo">acme/repo</a>');
      expect(html).toContain('<a href="https://github.com/acme/repo/pull/42">Open on GitHub</a>');
    });
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

    it("should offer both update methods with rebase as the default", () => {
      const html = render({ isBehindBase: true });

      const rebaseIndex = html.indexOf('<option value="REBASE">Update with rebase</option>');
      const mergeIndex = html.indexOf('<option value="MERGE">Update with merge commit</option>');
      expect(rebaseIndex).toBeGreaterThan(-1);
      expect(mergeIndex).toBeGreaterThan(-1);
      expect(rebaseIndex).toBeLessThan(mergeIndex);
    });

    it("should put the configured default update method first", () => {
      const html = renderPrDetailsHtml(buildDetails({ isBehindBase: true }), NONCE, NOW, undefined, "MERGE");

      const rebaseIndex = html.indexOf('<option value="REBASE">');
      const mergeIndex = html.indexOf('<option value="MERGE">');
      expect(mergeIndex).toBeGreaterThan(-1);
      expect(mergeIndex).toBeLessThan(rebaseIndex);
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

    it("should summarize in-progress checks instead of reporting them as passed", () => {
      const html = render({
        checks: [
          { name: "build", status: "PENDING" },
          { name: "lint", status: "SUCCESS" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("1 check in progress");
      expect(html).toContain('class="row pending"');
      expect(html).not.toContain("All checks passed");
    });

    it("should count EXPECTED and ACTION_REQUIRED checks as in progress", () => {
      const html = render({
        checks: [
          { name: "deploy", status: "EXPECTED" },
          { name: "approval", status: "ACTION_REQUIRED" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("2 checks in progress");
    });

    it("should prioritize failing checks over in-progress ones", () => {
      const html = render({
        checks: [
          { name: "build", status: "FAILURE" },
          { name: "lint", status: "PENDING" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("1 failing check");
      expect(html).not.toContain("in progress");
    });

    it("should count TIMED_OUT and STARTUP_FAILURE checks as failing", () => {
      const html = render({
        checks: [
          { name: "build", status: "TIMED_OUT" },
          { name: "lint", status: "STARTUP_FAILURE" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("2 failing checks");
    });

    it("should keep the all-passed summary when every check succeeded", () => {
      const html = render({ checks: [{ name: "build", status: "SUCCESS" }], checksTotal: 1 });

      expect(html).toContain("All checks passed");
    });

    it("should show a neutral summary when there are no checks", () => {
      const html = render({ checks: [], checksTotal: 0 });

      expect(html).toContain("No checks");
      expect(html).not.toContain("All checks passed");
    });
  });

  describe("webview script", () => {
    it("should post composer empty/non-empty transitions to the extension", () => {
      const html = render();

      expect(html).toContain('command: "composerState"');
    });

    it("should persist and restore the scroll position keyed by PR", () => {
      const html = render();

      expect(html).toContain('"acme/repo#42"');
      expect(html).toContain("vscodeApi.setState({ prKey, scrollY: window.scrollY })");
      expect(html).toContain("vscodeApi.getState()");
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
