import type { IBriefState } from "./types";

/** persisted shape: only completed summaries survive a window reload */
export type PersistedBrief = [prId: string, oid: string, text: string];

interface IBriefEntry {
  oid: string;
  state: IBriefState;
}

const DEFAULT_MAX_SUMMARIES = 20;

/**
 * Single source of truth for AI brief state, one entry per PR (pure, no vscode imports).
 * Results (done/error) are pinned to the head oid they were produced on — a push changes
 * the oid and they naturally reset to idle. A pending run blocks the whole PR regardless
 * of oid: one CLI run per PR, even across a push mid-generation.
 */
export class BriefStore {
  private readonly entries = new Map<string, IBriefEntry>();

  constructor(
    persisted: PersistedBrief[] = [],
    private readonly maxSummaries = DEFAULT_MAX_SUMMARIES,
  ) {
    for (const [prId, oid, text] of persisted) {
      if (typeof text !== "string") {
        continue; // entry from an older storage format: drop it rather than resurrect garbage
      }
      this.entries.set(prId, { oid, state: { status: "done", text } });
    }
  }

  getState(prId: string, oid: string): IBriefState {
    const entry = this.entries.get(prId);
    if (!entry) {
      return { status: "idle" };
    }
    if (entry.state.status === "pending") {
      return entry.state;
    }
    if (entry.oid !== oid) {
      return { status: "idle" };
    }
    return entry.state;
  }

  isPending(prId: string): boolean {
    return this.entries.get(prId)?.state.status === "pending";
  }

  hasSummary(prId: string, oid: string): boolean {
    return this.getState(prId, oid).status === "done";
  }

  begin(prId: string, oid: string): void {
    this.entries.set(prId, { oid, state: { status: "pending" } });
  }

  complete(prId: string, oid: string, text: string): void {
    this.entries.set(prId, { oid, state: { status: "done", text } });
    this.evictOldestSummaries();
  }

  fail(prId: string, oid: string, message: string): void {
    this.entries.set(prId, { oid, state: { status: "error", text: message } });
  }

  /** wipes results but not in-flight runs: a running CLI must stay guarded against re-entry */
  clearResults(): void {
    for (const [prId, entry] of this.entries) {
      if (entry.state.status !== "pending") {
        this.entries.delete(prId);
      }
    }
  }

  serialize(): PersistedBrief[] {
    const persisted: PersistedBrief[] = [];
    for (const [prId, entry] of this.entries) {
      if (entry.state.status === "done") {
        persisted.push([prId, entry.oid, entry.state.text ?? ""]);
      }
    }
    return persisted;
  }

  private evictOldestSummaries(): void {
    let summaryCount = this.serialize().length;
    for (const [prId, entry] of this.entries) {
      if (summaryCount <= this.maxSummaries) {
        return;
      }
      if (entry.state.status === "done") {
        this.entries.delete(prId);
        summaryCount -= 1;
      }
    }
  }
}
