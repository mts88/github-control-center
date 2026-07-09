import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { PrTreeProvider } from "./PrTreeProvider";
import type { CiState, IPullRequest } from "./types";

interface IPrOverrides {
  id?: string;
  repo?: string;
  isDraft?: boolean;
  ciState?: CiState;
  createdAt?: string;
  reviewDecision?: string | null;
}

function buildPr(overrides: IPrOverrides = {}): IPullRequest {
  return {
    id: overrides.id ?? "PR_1",
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: overrides.repo ?? "acme/repo",
    author: "jane",
    isDraft: overrides.isDraft ?? false,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00Z",
    ciState: overrides.ciState ?? "NONE",
    reviewDecision: overrides.reviewDecision ?? null,
    headRefName: "feature/thing",
  };
}

describe("PrTreeProvider", () => {
  let provider: PrTreeProvider;

  beforeEach(() => {
    provider = new PrTreeProvider();
  });

  describe("root children", () => {
    it("should return no nodes before any PRs are set, so the welcome view shows", () => {
      expect(provider.getChildren()).toEqual([]);
    });

    it("should return no nodes after clear, so the welcome view shows", () => {
      provider.setPrs([buildPr()]);
      provider.clear();

      expect(provider.getChildren()).toEqual([]);
    });

    it("should group PRs by repo, sorted alphabetically", () => {
      provider.setPrs([buildPr({ id: "1", repo: "acme/zeta" }), buildPr({ id: "2", repo: "acme/alpha" }), buildPr({ id: "3", repo: "acme/zeta" })]);

      const repoNodes = provider.getChildren();

      expect(repoNodes.map((node) => (node as { label: string }).label)).toEqual(["acme/alpha", "acme/zeta"]);
      expect(provider.getChildren(repoNodes[1])).toHaveLength(2);
    });
  });

  describe("tree items", () => {
    function getPrTreeItem(pr: IPullRequest): vscode.TreeItem {
      provider.setPrs([pr]);
      const [repoNode] = provider.getChildren();
      const [prNode] = provider.getChildren(repoNode);
      return provider.getTreeItem(prNode);
    }

    it("should render repo nodes expanded with the repo icon", () => {
      provider.setPrs([buildPr()]);
      const [repoNode] = provider.getChildren();

      const item = provider.getTreeItem(repoNode);

      expect(item.label).toBe("acme/repo");
      expect((item.iconPath as vscode.ThemeIcon).id).toBe("repo");
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    });

    it("should open the PR details through the githubControlCenter.openPrDetails command", () => {
      const pullRequest = buildPr();

      const item = getPrTreeItem(pullRequest);

      expect(item.command).toEqual({
        command: "githubControlCenter.openPrDetails",
        title: "Open Pull Request Details",
        arguments: [pullRequest],
      });
    });

    it("should mark PR items with the 'pr' context value for the inline menu", () => {
      const item = getPrTreeItem(buildPr());

      expect(item.contextValue).toBe("pr");
    });

    it("should use the draft icon for draft PRs regardless of CI state", () => {
      const item = getPrTreeItem(buildPr({ isDraft: true, ciState: "FAILURE" }));

      expect((item.iconPath as vscode.ThemeIcon).id).toBe("git-pull-request-draft");
    });

    it.each([
      ["SUCCESS", "pass"],
      ["FAILURE", "error"],
      ["PENDING", "sync~spin"],
      ["NONE", "circle-outline"],
    ])("should use the %s CI icon %s", (ciState, expectedIconId) => {
      const item = getPrTreeItem(buildPr({ ciState: ciState as CiState }));

      expect((item.iconPath as vscode.ThemeIcon).id).toBe(expectedIconId);
    });

    it.each([
      ["APPROVED", "✓ A title"],
      ["CHANGES_REQUESTED", "✗ A title"],
      ["REVIEW_REQUIRED", "● A title"],
    ])("should prefix the label with the %s review glyph", (reviewDecision, expectedLabel) => {
      const item = getPrTreeItem(buildPr({ reviewDecision }));

      expect(item.label).toBe(expectedLabel);
      expect(item.tooltip).toContain(`Review: ${reviewDecision}`);
    });

    it("should render a plain label without a review line when there is no review decision", () => {
      const item = getPrTreeItem(buildPr({ reviewDecision: null }));

      expect(item.label).toBe("A title");
      expect(item.tooltip).not.toContain("Review:");
    });

    describe("age in the description", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        ["2026-07-08T09:00:00Z", "jane · opened today"],
        ["2026-07-07T09:00:00Z", "jane · opened yesterday"],
        ["2026-07-01T00:00:00Z", "jane · opened 7 days ago"],
      ])("should describe a PR created at %s as '%s'", (createdAt, expectedDescription) => {
        const item = getPrTreeItem(buildPr({ createdAt }));

        expect(item.description).toBe(expectedDescription);
      });
    });
  });

  describe("onDidChangeTreeData", () => {
    it("should fire when PRs are set", () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.setPrs([buildPr()]);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
