import * as vscode from "vscode";
import type { CiState, IPullRequest } from "./types";

interface IRepoNode {
  kind: "repo";
  label: string;
  prs: IPullRequest[];
}

interface IPrNode {
  kind: "pr";
  pr: IPullRequest;
}

export type TreeNode = IRepoNode | IPrNode;

const REVIEW_GLYPHS: Record<string, string> = {
  APPROVED: "✓",
  CHANGES_REQUESTED: "✗",
  REVIEW_REQUIRED: "●",
};

const CI_ICONS: Record<CiState, vscode.ThemeIcon> = {
  SUCCESS: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  FAILURE: new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed")),
  PENDING: new vscode.ThemeIcon("sync~spin"),
  NONE: new vscode.ThemeIcon("circle-outline"),
};

export class PrTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private prs: IPullRequest[] = [];

  setPrs(prs: IPullRequest[]): void {
    this.prs = prs;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.setPrs([]);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return groupByRepo(this.prs);
    }
    if (element.kind === "repo") {
      return element.prs.map(toPrNode);
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("repo");
      return item;
    }
    return toPrTreeItem(node.pr);
  }
}

function toPrNode(pr: IPullRequest): IPrNode {
  return { kind: "pr", pr };
}

function groupByRepo(prs: IPullRequest[]): IRepoNode[] {
  const prsByRepo = new Map<string, IPullRequest[]>();
  for (const pr of prs) {
    const repoPrs = prsByRepo.get(pr.repo) ?? [];
    repoPrs.push(pr);
    prsByRepo.set(pr.repo, repoPrs);
  }
  return [...prsByRepo.entries()]
    .sort(([firstRepo], [secondRepo]) => firstRepo.localeCompare(secondRepo))
    .map(([repo, repoPrs]) => ({ kind: "repo" as const, label: repo, prs: repoPrs }));
}

function toPrTreeItem(pr: IPullRequest): vscode.TreeItem {
  const reviewGlyph = pr.reviewDecision ? REVIEW_GLYPHS[pr.reviewDecision] : undefined;
  const label = reviewGlyph ? `${reviewGlyph} ${pr.title}` : pr.title;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = `${pr.author} · ${formatAge(pr.createdAt)}`;
  item.iconPath = pr.isDraft ? new vscode.ThemeIcon("git-pull-request-draft") : CI_ICONS[pr.ciState];
  item.tooltip = `${pr.repo}\n${pr.title}\nby ${pr.author}${pr.isDraft ? " · draft" : ""}\nCI: ${pr.ciState}${pr.reviewDecision ? `\nReview: ${pr.reviewDecision}` : ""}`;
  item.contextValue = "pr";
  item.command = {
    command: "githubControlCenter.openPrDetails",
    title: "Open Pull Request Details",
    arguments: [pr],
  };
  return item;
}

function formatAge(createdAt: string): string {
  const ageInDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (ageInDays <= 0) {
    return "opened today";
  }
  if (ageInDays === 1) {
    return "opened yesterday";
  }
  return `opened ${ageInDays} days ago`;
}
