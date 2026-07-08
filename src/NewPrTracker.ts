import type { IPullRequest } from "./types";

export class NewPrTracker {
  private readonly seenPrIds = new Set<string>();
  private hasSeeded = false;

  // first call only seeds the set: a window reload must never fire a toast storm
  track(toReview: IPullRequest[]): IPullRequest[] {
    if (!this.hasSeeded) {
      toReview.forEach((pr) => this.seenPrIds.add(pr.id));
      this.hasSeeded = true;
      return [];
    }
    const unseenPrs = toReview.filter((pr) => !this.seenPrIds.has(pr.id));
    unseenPrs.forEach((pr) => this.seenPrIds.add(pr.id));
    return unseenPrs;
  }
}
