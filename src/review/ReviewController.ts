import * as vscode from "vscode";
import { commentableRanges } from "./diffPatch";
import { fetchReviewThreads } from "../github/github";
import { fromPrUri, toPrUri } from "./PrContentProvider";
import { PR_URI_SCHEME } from "./prUri";
import { threadLabel, toThreadAnchor } from "./reviewThreads";
import { syncThreads } from "./threadSync";
import type { IPrFilePatch, IPullRequest, IReviewThread, IReviewThreadsSnapshot } from "../core/types";

/** The subset of IPullRequest the patch cache needs — buildable from a ghcc-pr uri alone. */
export interface IPatchKey {
  id: string;
  repo: string;
  number: number;
  headRefOid: string;
}

export interface IReviewControllerDeps {
  getToken(): Promise<string>;
  /** looks a file up by its head path OR its pre-rename path */
  getPatch(key: IPatchKey, path: string): Promise<IPrFilePatch | undefined>;
  onPendingChanged(pr: IPullRequest | undefined, count: number): void;
}

interface IPrThreadsState {
  snapshot: IReviewThreadsSnapshot;
  vsThreads: Map<string, vscode.CommentThread>;
}

interface IThreadRef {
  prId: string;
  threadId: string;
}

export class ReviewController implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly prRegistry = new Map<string, IPullRequest>();
  private readonly statesByPr = new Map<string, IPrThreadsState>();
  private readonly threadRefs = new Map<vscode.CommentThread, IThreadRef>();
  // ponytail: one review at a time — the last PR whose diff was opened; QuickPick over PRs if it ever hurts
  private activeReviewPr: IPullRequest | undefined;

  constructor(private readonly deps: IReviewControllerDeps) {
    this.controller = vscode.comments.createCommentController("githubControlCenter", "GitHub Control Center");
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: async (document) => {
        if (document.uri.scheme !== PR_URI_SCHEME) {
          return null;
        }
        const ref = fromPrUri(document.uri);
        if (ref.isEmpty) {
          return null;
        }
        // the uri alone carries the patch key: ranges survive a window reload with an empty registry
        const patch = await this.deps.getPatch({ id: ref.prId, repo: ref.repo, number: ref.prNumber, headRefOid: ref.headOid }, ref.path);
        const ranges = commentableRanges(patch?.patch, ref.side).map((range) => new vscode.Range(range.start - 1, 0, range.end - 1, 0));
        return { ranges, enableFileComments: true };
      },
    };
  }

  getPr(prId: string): IPullRequest | undefined {
    return this.prRegistry.get(prId);
  }

  getActivePr(): IPullRequest | undefined {
    return this.activeReviewPr;
  }

  getPendingReviewId(prId: string): string | null {
    return this.statesByPr.get(prId)?.snapshot.pendingReviewId ?? null;
  }

  registerPr(pr: IPullRequest): void {
    this.prRegistry.set(pr.id, pr);
    this.activeReviewPr = pr;
  }

  threadRef(thread: vscode.CommentThread): IThreadRef | undefined {
    return this.threadRefs.get(thread);
  }

  async ensureThreadsForPr(pr: IPullRequest): Promise<void> {
    if (this.statesByPr.has(pr.id)) {
      this.publishPendingState(pr);
      return;
    }
    await this.reload(pr);
  }

  async reload(pr: IPullRequest): Promise<void> {
    const token = await this.deps.getToken();
    const snapshot = await fetchReviewThreads(token, pr.id);
    const state = this.statesByPr.get(pr.id) ?? { snapshot, vsThreads: new Map<string, vscode.CommentThread>() };
    const plan = syncThreads([...state.vsThreads.keys()], snapshot.threads);

    for (const threadId of plan.removeIds) {
      const vsThread = state.vsThreads.get(threadId);
      if (vsThread) {
        this.threadRefs.delete(vsThread);
        vsThread.dispose();
        state.vsThreads.delete(threadId);
      }
    }
    for (const thread of plan.create) {
      const vsThread = await this.materializeThread(pr, thread);
      if (vsThread) {
        state.vsThreads.set(thread.id, vsThread);
        this.threadRefs.set(vsThread, { prId: pr.id, threadId: thread.id });
      }
    }
    for (const thread of plan.update) {
      const vsThread = state.vsThreads.get(thread.id);
      if (vsThread) {
        this.applyThreadState(vsThread, thread);
      }
    }

    state.snapshot = snapshot;
    this.statesByPr.set(pr.id, state);
    this.publishPendingState(pr);
  }

  private publishPendingState(pr: IPullRequest): void {
    const snapshot = this.statesByPr.get(pr.id)?.snapshot;
    const count = snapshot?.pendingReviewId ? snapshot.pendingCommentCount : 0;
    this.deps.onPendingChanged(count > 0 || snapshot?.pendingReviewId ? pr : undefined, count);
  }

  private async materializeThread(pr: IPullRequest, thread: IReviewThread): Promise<vscode.CommentThread | undefined> {
    const anchor = toThreadAnchor(thread);
    if (!anchor) {
      return undefined;
    }
    // LEFT-side threads on renamed files live at the old path in the diff editor
    const patch = anchor.side === "LEFT" ? await this.deps.getPatch(pr, thread.path) : undefined;
    const uri = toPrUri({
      prId: pr.id,
      repo: pr.repo,
      prNumber: pr.number,
      path: anchor.side === "LEFT" ? (patch?.previousPath ?? thread.path) : thread.path,
      sha: anchor.side === "LEFT" ? pr.baseRefOid : pr.headRefOid,
      headOid: pr.headRefOid,
      side: anchor.side,
      isEmpty: false,
    });
    const range = anchor.isFileLevel ? undefined : new vscode.Range(anchor.startLine0, 0, anchor.endLine0, 0);
    const vsThread = this.controller.createCommentThread(uri, range as vscode.Range, []);
    this.applyThreadState(vsThread, thread);
    return vsThread;
  }

  private applyThreadState(vsThread: vscode.CommentThread, thread: IReviewThread): void {
    vsThread.comments = thread.comments.map((comment) => ({
      body: new vscode.MarkdownString(comment.bodyMarkdown),
      mode: vscode.CommentMode.Preview,
      author: { name: comment.author },
      label: comment.isPending ? "Pending" : undefined,
      timestamp: new Date(comment.createdAt),
    }));
    vsThread.label = threadLabel(thread);
    vsThread.state = thread.isResolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    vsThread.contextValue = thread.comments.some((comment) => comment.isPending) ? "pending" : thread.isResolved ? "canUnresolve" : "canResolve";
    vsThread.collapsibleState = thread.isResolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
    vsThread.canReply = true;
  }

  dispose(): void {
    for (const state of this.statesByPr.values()) {
      for (const vsThread of state.vsThreads.values()) {
        vsThread.dispose();
      }
    }
    this.controller.dispose();
  }
}
