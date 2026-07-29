import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalOverlay } from "./ApprovalOverlay";
import type { IPrSnapshot, IPullRequest } from "../core/types";

interface IPrOverrides {
  id?: string;
  headRefOid?: string;
  viewerReviewState?: string | null;
  isViewerApprovalStale?: boolean;
  isReviewedByMe?: boolean;
}

function buildPr(overrides: IPrOverrides = {}): IPullRequest {
  return {
    id: overrides.id ?? "PR_1",
    number: 1,
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: "acme/repo",
    author: "jane",
    isDraft: false,
    createdAt: "2026-07-01T00:00:00Z",
    ciState: "NONE",
    reviewDecision: null,
    viewerReviewState: overrides.viewerReviewState ?? null,
    isViewerApprovalStale: overrides.isViewerApprovalStale ?? false,
    isReviewedByMe: overrides.isReviewedByMe,
    headRefName: "feature/thing",
    baseRefOid: "base-oid",
    headRefOid: overrides.headRefOid ?? "head-oid",
  };
}

function buildSnapshot(partial: Partial<IPrSnapshot> = {}): IPrSnapshot {
  return { toReview: [], mine: [], reviewed: [], ...partial };
}

describe("ApprovalOverlay", () => {
  let overlay: ApprovalOverlay;

  beforeEach(() => {
    overlay = new ApprovalOverlay();
  });

  it("should leave the snapshot untouched when nothing was recorded", () => {
    const snapshot = buildSnapshot({ toReview: [buildPr()] });

    expect(overlay.apply(snapshot)).toEqual(snapshot);
  });

  it("should move a lagging toReview PR into reviewed as a fresh approval", () => {
    overlay.record("PR_1", "head-oid");
    const snapshot = buildSnapshot({ toReview: [buildPr(), buildPr({ id: "PR_2" })] });

    const applied = overlay.apply(snapshot);

    expect(applied.toReview.map((pr) => pr.id)).toEqual(["PR_2"]);
    expect(applied.reviewed).toEqual([
      { ...buildPr(), isReviewedByMe: true, viewerReviewState: "APPROVED", isViewerApprovalStale: false },
    ]);
  });

  it("should override a reviewed PR whose node data lags behind the approval", () => {
    overlay.record("PR_1", "head-oid");
    const snapshot = buildSnapshot({ reviewed: [buildPr({ viewerReviewState: "COMMENTED", isReviewedByMe: true })] });

    const applied = overlay.apply(snapshot);

    expect(applied.reviewed).toHaveLength(1);
    expect(applied.reviewed[0]).toMatchObject({ viewerReviewState: "APPROVED", isViewerApprovalStale: false });
  });

  it("should drop the entry when the head moved since the approve", () => {
    overlay.record("PR_1", "old-head-oid");
    const snapshot = buildSnapshot({ toReview: [buildPr({ headRefOid: "new-head-oid" })] });

    const applied = overlay.apply(snapshot);

    expect(applied.toReview).toHaveLength(1);
    expect(applied.reviewed).toEqual([]);
  });

  it("should drop the entry once the server confirms the approval", () => {
    overlay.record("PR_1", "head-oid");
    const confirmed = buildPr({ viewerReviewState: "APPROVED", isReviewedByMe: true });

    const applied = overlay.apply(buildSnapshot({ reviewed: [confirmed] }));

    expect(applied.reviewed).toEqual([confirmed]);
    // a later stale poll must no longer move the PR: the entry is gone
    const laterStalePoll = buildSnapshot({ toReview: [buildPr()] });
    expect(overlay.apply(laterStalePoll)).toEqual(laterStalePoll);
  });

  it("should keep the entry while the PR is missing from both searches", () => {
    overlay.record("PR_1", "head-oid");

    expect(overlay.apply(buildSnapshot())).toEqual(buildSnapshot());

    const laterPoll = buildSnapshot({ toReview: [buildPr()] });
    expect(overlay.apply(laterPoll).reviewed).toHaveLength(1);
  });

  it("should never touch the mine section", () => {
    overlay.record("PR_1", "head-oid");
    const snapshot = buildSnapshot({ mine: [buildPr()] });

    expect(overlay.apply(snapshot)).toEqual(snapshot);
  });
});
