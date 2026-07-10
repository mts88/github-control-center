import * as vscode from "vscode";
import { renderMessageHtml, renderPrDetailsHtml } from "./PrDetailsHtml";
import type { IBriefState, IPrDetails, MergeMethod, UpdateBranchMethod } from "./types";

export type IPanelMessage =
  | { command: "comment"; text: string }
  | { command: "review"; event: "APPROVE" | "REQUEST_CHANGES"; text: string }
  | { command: "merge"; method: MergeMethod }
  | { command: "readyForReview" }
  | { command: "updateBranch"; method: UpdateBranchMethod }
  | { command: "checkout" }
  | { command: "brief" }
  | { command: "composerState"; hasText: boolean };

export function formatPrTabTitle(pr: { repo: string; title: string; number: number }): string {
  return `${pr.repo} · ${pr.title} #${pr.number}`;
}

export class PrDetailsPanel {
  private panel: vscode.WebviewPanel | undefined;
  private messageHandler: ((message: IPanelMessage) => void) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  onMessage(handler: (message: IPanelMessage) => void): void {
    this.messageHandler = handler;
  }

  showLoading(title: string): void {
    this.render(title, renderMessageHtml("Loading pull request details…", crypto.randomUUID()));
  }

  showMessage(title: string, message: string): void {
    this.render(title, renderMessageHtml(message, crypto.randomUUID()));
  }

  showDetails(details: IPrDetails, brief?: IBriefState): void {
    const panel = this.ensurePanel(formatPrTabTitle(details));
    this.renderDetails(panel, details, brief);
  }

  // background variant of showDetails: never creates the panel, never reveals it
  updateDetails(details: IPrDetails, brief?: IBriefState): void {
    if (this.panel) {
      this.renderDetails(this.panel, details, brief);
    }
  }

  get isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  reenableActions(): void {
    void this.panel?.webview.postMessage({ command: "reenable" });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private renderDetails(panel: vscode.WebviewPanel, details: IPrDetails, brief?: IBriefState): void {
    const mermaidScriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "mermaid.min.js")).toString();
    const defaultUpdateMethod = vscode.workspace
      .getConfiguration("githubControlCenter")
      .get<UpdateBranchMethod>("updateBranch.defaultMethod", "REBASE");
    panel.title = formatPrTabTitle(details);
    panel.webview.html = renderPrDetailsHtml(details, crypto.randomUUID(), Date.now(), mermaidScriptUri, defaultUpdateMethod, brief);
  }

  private render(title: string, html: string): void {
    const panel = this.ensurePanel(title);
    panel.title = title;
    panel.webview.html = html;
  }

  private ensurePanel(title: string): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return this.panel;
    }
    this.panel = vscode.window.createWebviewPanel("githubControlCenter.prDetails", title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: IPanelMessage) => this.messageHandler?.(message));
    return this.panel;
  }
}
