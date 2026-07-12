import * as vscode from "vscode";
import { toErrorMessage } from "../core/errors";
import { buildFileTree, type IFileTreeFolder } from "./fileTree";
import type { CiState, FileChangeType, IPrFile, IPullRequest } from "../core/types";

export type FilesLayout = "flat" | "tree";

interface IRepoNode {
  kind: "repo";
  label: string;
  prs: IPullRequest[];
}

interface IPrNode {
  kind: "pr";
  pr: IPullRequest;
}

export interface IFileNode {
  kind: "file";
  pr: IPullRequest;
  file: IPrFile;
}

interface IFolderNode {
  kind: "folder";
  pr: IPullRequest;
  folder: IFileTreeFolder;
}

interface IMessageNode {
  kind: "message";
  text: string;
}

export type TreeNode = IRepoNode | IPrNode | IFileNode | IFolderNode | IMessageNode;

const REVIEW_GLYPHS: Record<string, string> = {
  APPROVED: "✓",
  CHANGES_REQUESTED: "✗",
  REVIEW_REQUIRED: "●",
};

const VIEWER_REVIEW_LABELS: Record<string, string> = {
  APPROVED: "you approved",
  DISMISSED: "review stale",
  CHANGES_REQUESTED: "you requested changes",
  COMMENTED: "you commented",
};

function toViewerReviewLabel(viewerReviewState: string | null): string {
  // total mapping: unknown states (e.g. PENDING) and null fall back to a generic label
  return (viewerReviewState && VIEWER_REVIEW_LABELS[viewerReviewState]) || "reviewed";
}

const CI_ICONS: Record<CiState, vscode.ThemeIcon> = {
  SUCCESS: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  FAILURE: new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed")),
  PENDING: new vscode.ThemeIcon("sync~spin"),
  NONE: new vscode.ThemeIcon("circle-outline"),
};

const FILE_CHANGE_ICONS: Record<FileChangeType, vscode.ThemeIcon> = {
  ADDED: new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground")),
  MODIFIED: new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")),
  CHANGED: new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")),
  DELETED: new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground")),
  RENAMED: new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground")),
  COPIED: new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground")),
};

export class PrTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private prs: IPullRequest[] = [];

  constructor(
    private readonly loadFiles: (pr: IPullRequest) => Promise<IPrFile[]>,
    private readonly getLayout: () => FilesLayout,
  ) {}

  setPrs(prs: IPullRequest[]): void {
    this.prs = prs;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.setPrs([]);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    if (!element) {
      return groupByRepo(this.prs);
    }
    if (element.kind === "repo") {
      return element.prs.map(toPrNode);
    }
    if (element.kind === "pr") {
      // expansion is user-initiated: unlike the silent poll, failures render in the tree
      return this.loadFiles(element.pr).then(
        (files) => this.toFileChildren(element.pr, files),
        (error: unknown) => [{ kind: "message" as const, text: `Failed to load files: ${toErrorMessage(error)}` }],
      );
    }
    if (element.kind === "folder") {
      return folderChildren(element.pr, element.folder);
    }
    return [];
  }

  private toFileChildren(pr: IPullRequest, files: IPrFile[]): TreeNode[] {
    if (this.getLayout() === "tree") {
      return folderChildren(pr, buildFileTree(files));
    }
    return files.map((file) => ({ kind: "file" as const, pr, file }));
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("repo");
      item.id = `repo:${node.label}`;
      return item;
    }
    if (node.kind === "file") {
      return toFileTreeItem(node, this.getLayout());
    }
    if (node.kind === "folder") {
      return toFolderTreeItem(node);
    }
    if (node.kind === "message") {
      return new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    }
    return toPrTreeItem(node.pr);
  }
}

function folderChildren(pr: IPullRequest, folder: IFileTreeFolder): TreeNode[] {
  return [
    ...folder.folders.map((childFolder) => ({ kind: "folder" as const, pr, folder: childFolder })),
    ...folder.files.map((file) => ({ kind: "file" as const, pr, file })),
  ];
}

function toFolderTreeItem(node: IFolderNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.folder.name, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `${node.pr.id}:dir:${node.folder.path}`;
  item.iconPath = new vscode.ThemeIcon("folder");
  return item;
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
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  // stable id: keeps the node's expansion state across the poll's full-tree refresh
  item.id = pr.id;
  const viewerReviewLabel = pr.isReviewedByMe ? toViewerReviewLabel(pr.viewerReviewState) : undefined;
  item.description = `${pr.author} · ${formatAge(pr.createdAt)}${viewerReviewLabel ? ` · ${viewerReviewLabel}` : ""}`;
  item.iconPath = pr.isDraft ? new vscode.ThemeIcon("git-pull-request-draft") : CI_ICONS[pr.ciState];
  item.tooltip = `${pr.repo}\n${pr.title}\nby ${pr.author}${pr.isDraft ? " · draft" : ""}\nCI: ${pr.ciState}${pr.reviewDecision ? `\nReview: ${pr.reviewDecision}` : ""}${viewerReviewLabel ? `\nYour review: ${viewerReviewLabel}` : ""}`;
  item.contextValue = "pr";
  item.command = {
    command: "githubControlCenter.openPrDetails",
    title: "Open Pull Request Details",
    arguments: [pr],
  };
  return item;
}

function toFileTreeItem(node: IFileNode, layout: FilesLayout): vscode.TreeItem {
  const { pr, file } = node;
  const separatorIndex = file.path.lastIndexOf("/");
  const item = new vscode.TreeItem(file.path.slice(separatorIndex + 1), vscode.TreeItemCollapsibleState.None);
  item.id = `${pr.id}:${file.path}`;
  // in the tree layout the directory is implicit in the hierarchy
  item.description = layout === "tree" || separatorIndex === -1 ? "" : file.path.slice(0, separatorIndex);
  item.iconPath = FILE_CHANGE_ICONS[file.changeType];
  item.tooltip = `${file.path}\n+${file.additions} −${file.deletions} · ${file.changeType}`;
  item.contextValue = "prFile";
  item.checkboxState = file.viewedState === "VIEWED" ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
  item.command = {
    command: "githubControlCenter.openFileDiff",
    title: "Open File Diff",
    arguments: [node],
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
