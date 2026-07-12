import type { IPullRequest } from "../core/types";

const NOTIFIABLE_DECISIONS = new Set(["APPROVED", "CHANGES_REQUESTED"]);

export class ReviewDecisionTracker {
  private readonly lastDecisions = new Map<string, string | null>();
  private hasSeeded = false;

  // first call only seeds the map: a window reload must never fire a toast storm
  track(mine: IPullRequest[]): IPullRequest[] {
    if (!this.hasSeeded) {
      mine.forEach((pr) => this.lastDecisions.set(pr.id, pr.reviewDecision));
      this.hasSeeded = true;
      return [];
    }

    const changedPrs = mine.filter((pr) => {
      const isKnownPr = this.lastDecisions.has(pr.id);
      const previousDecision = this.lastDecisions.get(pr.id);
      return isKnownPr && previousDecision !== pr.reviewDecision && NOTIFIABLE_DECISIONS.has(pr.reviewDecision ?? "");
    });

    this.lastDecisions.clear();
    mine.forEach((pr) => this.lastDecisions.set(pr.id, pr.reviewDecision));
    return changedPrs;
  }
}
