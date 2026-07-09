import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as vscode from "vscode";
import { PrTreeProvider, type TreeNode } from "./PrTreeProvider";
import type { CiState, IPrFile, IPullRequest } from "./types";

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
    number: 1,
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: overrides.repo ?? "acme/repo",
    author: "jane",
    isDraft: overrides.isDraft ?? false,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00Z",
    ciState: overrides.ciState ?? "NONE",
    reviewDecision: overrides.reviewDecision ?? null,
    headRefName: "feature/thing",
    baseRefOid: "base-oid",
    headRefOid: "head-oid",
  };
}

function buildFile(overrides: Partial<IPrFile> = {}): IPrFile {
  return {
    path: overrides.path ?? "src/app.ts",
    changeType: overrides.changeType ?? "MODIFIED",
    additions: overrides.additions ?? 10,
    deletions: overrides.deletions ?? 2,
    viewedState: overrides.viewedState ?? "UNVIEWED",
  };
}

describe("PrTreeProvider", () => {
  let provider: PrTreeProvider;
  let loadFiles: Mock<(pr: IPullRequest) => Promise<IPrFile[]>>;
  let layout: "flat" | "tree";

  function getSyncChildren(element?: TreeNode): TreeNode[] {
    return provider.getChildren(element) as TreeNode[];
  }

  beforeEach(() => {
    layout = "flat";
    loadFiles = vi.fn(async () => [buildFile()]);
    provider = new PrTreeProvider(loadFiles, () => layout);
  });

  describe("root children", () => {
    it("should return no nodes before any PRs are set, so the welcome view shows", () => {
      expect(getSyncChildren()).toEqual([]);
    });

    it("should return no nodes after clear, so the welcome view shows", () => {
      provider.setPrs([buildPr()]);
      provider.clear();

      expect(getSyncChildren()).toEqual([]);
    });

    it("should group PRs by repo, sorted alphabetically", () => {
      provider.setPrs([buildPr({ id: "1", repo: "acme/zeta" }), buildPr({ id: "2", repo: "acme/alpha" }), buildPr({ id: "3", repo: "acme/zeta" })]);

      const repoNodes = getSyncChildren();

      expect(repoNodes.map((node) => (node as { label: string }).label)).toEqual(["acme/alpha", "acme/zeta"]);
      expect(getSyncChildren(repoNodes[1])).toHaveLength(2);
    });
  });

  describe("tree items", () => {
    function getPrTreeItem(pr: IPullRequest): vscode.TreeItem {
      provider.setPrs([pr]);
      const [repoNode] = getSyncChildren();
      const [prNode] = getSyncChildren(repoNode);
      return provider.getTreeItem(prNode);
    }

    it("should render repo nodes expanded with the repo icon", () => {
      provider.setPrs([buildPr()]);
      const [repoNode] = getSyncChildren();

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

  describe("pr nodes as expandable file containers", () => {
    function getPrNode(pr: IPullRequest): TreeNode {
      provider.setPrs([pr]);
      const [repoNode] = provider.getChildren() as TreeNode[];
      const [prNode] = getSyncChildren(repoNode) as TreeNode[];
      return prNode;
    }

    it("should render PR items collapsed with a stable id", () => {
      const pullRequest = buildPr({ id: "PR_9" });

      const item = provider.getTreeItem(getPrNode(pullRequest));

      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(item.id).toBe("PR_9");
    });

    it("should render repo items with a stable id", () => {
      provider.setPrs([buildPr()]);
      const [repoNode] = provider.getChildren() as TreeNode[];

      const item = provider.getTreeItem(repoNode);

      expect(item.id).toBe("repo:acme/repo");
    });

    it("should load file children through the injected loader", async () => {
      const pullRequest = buildPr();

      const children = (await provider.getChildren(getPrNode(pullRequest))) as TreeNode[];

      expect(loadFiles).toHaveBeenCalledWith(pullRequest);
      expect(children).toEqual([{ kind: "file", pr: pullRequest, file: buildFile() }]);
    });

    it("should render a message node when the loader rejects", async () => {
      loadFiles.mockRejectedValueOnce(new Error("boom"));

      const children = (await provider.getChildren(getPrNode(buildPr()))) as TreeNode[];

      expect(children).toEqual([{ kind: "message", text: "Failed to load files: boom" }]);
    });
  });

  describe("file items", () => {
    async function getFileTreeItem(file: IPrFile): Promise<vscode.TreeItem> {
      loadFiles.mockResolvedValueOnce([file]);
      provider.setPrs([buildPr()]);
      const [repoNode] = provider.getChildren() as TreeNode[];
      const [prNode] = getSyncChildren(repoNode) as TreeNode[];
      const [fileNode] = (await provider.getChildren(prNode)) as TreeNode[];
      return provider.getTreeItem(fileNode);
    }

    it("should render the basename as label and the directory as description", async () => {
      const item = await getFileTreeItem(buildFile({ path: "src/nested/app.ts" }));

      expect(item.label).toBe("app.ts");
      expect(item.description).toBe("src/nested");
    });

    it("should leave the description empty for root files", async () => {
      const item = await getFileTreeItem(buildFile({ path: "README.md" }));

      expect(item.description).toBe("");
    });

    it("should show the full path and diffstat in the tooltip", async () => {
      const item = await getFileTreeItem(buildFile({ path: "src/app.ts", additions: 3, deletions: 1, changeType: "MODIFIED" }));

      expect(item.tooltip).toBe("src/app.ts\n+3 −1 · MODIFIED");
    });

    it.each([
      ["ADDED", "diff-added"],
      ["MODIFIED", "diff-modified"],
      ["CHANGED", "diff-modified"],
      ["DELETED", "diff-removed"],
      ["RENAMED", "diff-renamed"],
      ["COPIED", "diff-renamed"],
    ])("should use the %s change icon %s", async (changeType, expectedIconId) => {
      const item = await getFileTreeItem(buildFile({ changeType: changeType as IPrFile["changeType"] }));

      expect((item.iconPath as vscode.ThemeIcon).id).toBe(expectedIconId);
    });

    it("should give file items a stable id scoped to the pull request", async () => {
      const item = await getFileTreeItem(buildFile({ path: "src/app.ts" }));

      expect(item.id).toBe("PR_1:src/app.ts");
    });

    it("should mark file items with the prFile context value", async () => {
      const item = await getFileTreeItem(buildFile());

      expect(item.contextValue).toBe("prFile");
    });

    it("should check the checkbox for viewed files only", async () => {
      const viewed = await getFileTreeItem(buildFile({ viewedState: "VIEWED" }));
      const unviewed = await getFileTreeItem(buildFile({ viewedState: "UNVIEWED" }));

      expect(viewed.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
      expect(unviewed.checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    });

    it("should wire the openFileDiff command with the file node", async () => {
      loadFiles.mockResolvedValueOnce([buildFile()]);
      provider.setPrs([buildPr()]);
      const [repoNode] = provider.getChildren() as TreeNode[];
      const [prNode] = getSyncChildren(repoNode) as TreeNode[];
      const [fileNode] = (await provider.getChildren(prNode)) as TreeNode[];

      const item = provider.getTreeItem(fileNode);

      expect(item.command).toEqual({
        command: "githubControlCenter.openFileDiff",
        title: "Open File Diff",
        arguments: [fileNode],
      });
    });

    it("should render message items as plain leaves", () => {
      const item = provider.getTreeItem({ kind: "message", text: "Failed to load files: boom" });

      expect(item.label).toBe("Failed to load files: boom");
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(item.command).toBeUndefined();
    });
  });

  describe("tree layout", () => {
    async function getPrChildren(files: IPrFile[]): Promise<TreeNode[]> {
      layout = "tree";
      loadFiles.mockResolvedValueOnce(files);
      provider.setPrs([buildPr()]);
      const [repoNode] = getSyncChildren();
      const [prNode] = getSyncChildren(repoNode);
      return (await provider.getChildren(prNode)) as TreeNode[];
    }

    it("should render folder nodes expanded with a stable id", async () => {
      const [folderNode] = await getPrChildren([buildFile({ path: "src/app.ts" })]);

      const item = provider.getTreeItem(folderNode);

      expect(item.label).toBe("src");
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(item.id).toBe("PR_1:dir:src");
      expect((item.iconPath as vscode.ThemeIcon).id).toBe("folder");
      expect(item.command).toBeUndefined();
      expect(item.checkboxState).toBeUndefined();
    });

    it("should list a folder's subfolders and files as its children", async () => {
      const appFile = buildFile({ path: "src/app.ts" });
      const clientFile = buildFile({ path: "src/api/client.ts" });
      const [srcNode] = await getPrChildren([appFile, clientFile]);

      const children = getSyncChildren(srcNode);

      expect(children).toHaveLength(2);
      expect(children[0].kind).toBe("folder");
      expect(children[1]).toMatchObject({ kind: "file", file: appFile });
    });

    it("should keep root files beside top-level folders", async () => {
      const children = await getPrChildren([buildFile({ path: "README.md" }), buildFile({ path: "src/app.ts" })]);

      expect(children.map((node) => node.kind)).toEqual(["folder", "file"]);
    });

    it("should leave the file description empty in tree layout", async () => {
      const [srcNode] = await getPrChildren([buildFile({ path: "src/app.ts" })]);
      const [fileNode] = getSyncChildren(srcNode);

      const item = provider.getTreeItem(fileNode);

      expect(item.label).toBe("app.ts");
      expect(item.description).toBe("");
    });

    it("should keep the openFileDiff command and the viewed checkbox on files", async () => {
      const [srcNode] = await getPrChildren([buildFile({ path: "src/app.ts", viewedState: "VIEWED" })]);
      const [fileNode] = getSyncChildren(srcNode);

      const item = provider.getTreeItem(fileNode);

      expect(item.command?.command).toBe("githubControlCenter.openFileDiff");
      expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
      expect(item.id).toBe("PR_1:src/app.ts");
    });

    it("should render the flat list when the layout is flat", async () => {
      const children = (await (async () => {
        loadFiles.mockResolvedValueOnce([buildFile({ path: "src/app.ts" })]);
        provider.setPrs([buildPr()]);
        const [repoNode] = getSyncChildren();
        const [prNode] = getSyncChildren(repoNode);
        return provider.getChildren(prNode);
      })()) as TreeNode[];

      expect(children).toHaveLength(1);
      expect(children[0].kind).toBe("file");
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
