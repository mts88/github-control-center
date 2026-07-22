import type { IAnchoredFinding } from "./reviewFindings";

export interface IReviewState {
  status: "idle" | "pending" | "done" | "error";
  /** anchored findings when the model produced parseable JSON */
  findings?: IAnchoredFinding[];
  /** indices into `findings` already promoted to a real GitHub pending comment */
  promotedIndices?: number[];
  /** raw fallback text when the model's output could not be parsed as JSON */
  reportText?: string;
  /** error message when status is "error" */
  text?: string;
  /** a done result produced on an earlier head commit — kept visible but flagged outdated */
  stale?: boolean;
}

interface IReviewEntry {
  oid: string;
  state: IReviewState;
}

/**
 * Single source of truth for AI review state, one entry per PR (pure, no vscode imports) —
 * the review counterpart of brief/briefState.ts's BriefStore. Unlike a brief, a review is
 * deliberately re-runnable after it completes (model-override reruns), so unlike BriefStore
 * there is no "already has a fresh result" guard — only isPending blocks a second concurrent
 * run. No persistence in v1: promoted findings already live on GitHub as pending comments,
 * the in-panel list is a working session artifact.
 */
export class ReviewStore {
  private readonly entries = new Map<string, IReviewEntry>();

  getState(prId: string, oid: string): IReviewState {
    const entry = this.entries.get(prId);
    if (!entry) {
      return { status: "idle" };
    }
    if (entry.state.status === "pending") {
      return entry.state;
    }
    if (entry.oid !== oid) {
      // a completed result survives a push as a flagged-stale read instead of vanishing;
      // a stale error still resets to idle — never blame new commits for an old failure
      if (entry.state.status === "done") {
        return { ...entry.state, stale: true };
      }
      return { status: "idle" };
    }
    return entry.state;
  }

  isPending(prId: string): boolean {
    return this.entries.get(prId)?.state.status === "pending";
  }

  begin(prId: string, oid: string): void {
    this.entries.set(prId, { oid, state: { status: "pending" } });
  }

  completeFindings(prId: string, oid: string, findings: IAnchoredFinding[]): void {
    this.entries.set(prId, { oid, state: { status: "done", findings, promotedIndices: [] } });
  }

  completeReport(prId: string, oid: string, text: string): void {
    this.entries.set(prId, { oid, state: { status: "done", reportText: text } });
  }

  fail(prId: string, oid: string, message: string): void {
    this.entries.set(prId, { oid, state: { status: "error", text: message } });
  }

  /**
   * Marks a finding index as promoted. Encapsulates every guard so callers (DetailsSession)
   * never trust an index blindly: the oid must match the current result (no promoting into a
   * stale/superseded run), the result must actually carry findings (not a report fallback),
   * the index must be in bounds, and promoting twice is a no-op — returns whether this call
   * newly promoted the finding.
   */
  markPromoted(prId: string, oid: string, index: number): boolean {
    const entry = this.entries.get(prId);
    if (!entry || entry.oid !== oid || entry.state.status !== "done" || !entry.state.findings) {
      return false;
    }
    if (index < 0 || index >= entry.state.findings.length) {
      return false;
    }
    const promoted = entry.state.promotedIndices ?? [];
    if (promoted.includes(index)) {
      return false;
    }
    entry.state = { ...entry.state, promotedIndices: [...promoted, index] };
    return true;
  }

  /** wipes results but not in-flight runs: a running CLI must stay guarded against re-entry */
  clearResults(): void {
    for (const [prId, entry] of this.entries) {
      if (entry.state.status !== "pending") {
        this.entries.delete(prId);
      }
    }
  }
}
