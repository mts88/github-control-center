import { beforeEach, describe, expect, it } from "vitest";
import { ReviewDecisionTracker } from "./ReviewDecisionTracker";
import type { IPullRequest } from "./types";

function buildPr(id: string, reviewDecision: string | null): IPullRequest {
  return { id, title: `PR ${id}`, reviewDecision } as IPullRequest;
}

describe("ReviewDecisionTracker", () => {
  let tracker: ReviewDecisionTracker;

  beforeEach(() => {
    tracker = new ReviewDecisionTracker();
  });

  it("should seed silently on the first call, even with notifiable decisions", () => {
    const result = tracker.track([buildPr("a", "APPROVED"), buildPr("b", "CHANGES_REQUESTED")]);

    expect(result).toEqual([]);
  });

  it.each(["APPROVED", "CHANGES_REQUESTED"])("should notify when a PR transitions to %s", (decision) => {
    tracker.track([buildPr("a", "REVIEW_REQUIRED")]);

    const result = tracker.track([buildPr("a", decision)]);

    expect(result.map((pr) => pr.id)).toEqual(["a"]);
  });

  it("should not notify when the decision is unchanged", () => {
    tracker.track([buildPr("a", "APPROVED")]);

    const result = tracker.track([buildPr("a", "APPROVED")]);

    expect(result).toEqual([]);
  });

  it("should not re-notify on the poll after a notified change", () => {
    tracker.track([buildPr("a", null)]);
    tracker.track([buildPr("a", "APPROVED")]);

    const result = tracker.track([buildPr("a", "APPROVED")]);

    expect(result).toEqual([]);
  });

  it("should not notify transitions to non-notifiable decisions", () => {
    tracker.track([buildPr("a", "APPROVED")]);

    const result = tracker.track([buildPr("a", "REVIEW_REQUIRED")]);

    expect(result).toEqual([]);
  });

  it("should not notify for PRs never seen before, whatever their decision", () => {
    tracker.track([buildPr("a", null)]);

    const result = tracker.track([buildPr("a", null), buildPr("new", "APPROVED")]);

    expect(result).toEqual([]);
  });

  it("should forget PRs that left the list and re-seed them silently when they return", () => {
    tracker.track([buildPr("a", "REVIEW_REQUIRED")]);
    tracker.track([]);

    const result = tracker.track([buildPr("a", "APPROVED")]);

    expect(result).toEqual([]);
  });
});
