import { describe, expect, it } from "vitest";
import { applyFilters, partitionReviewed } from "./filters";
import type { IPrSnapshot, IPullRequest } from "../core/types";

interface IPrOverrides {
  id?: string;
  repo?: string;
  isDraft?: boolean;
  viewerReviewState?: string | null;
  isViewerApprovalStale?: boolean;
}

function buildPr(overrides: IPrOverrides = {}): IPullRequest {
  return {
    id: overrides.id ?? "PR_1",
    number: 1,
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: overrides.repo ?? "acme/repo",
    author: "jane",
    isDraft: overrides.isDraft ?? false,
    createdAt: "2026-07-01T00:00:00Z",
    ciState: "NONE",
    reviewDecision: null,
    viewerReviewState: overrides.viewerReviewState ?? null,
    isViewerApprovalStale: overrides.isViewerApprovalStale ?? false,
    headRefName: "feature/thing",
    baseRefOid: "base-oid",
    headRefOid: "head-oid",
  };
}

function buildSnapshot(partial: Partial<IPrSnapshot> = {}): IPrSnapshot {
  return { toReview: [], mine: [], reviewed: [], ...partial };
}

const defaultOptions = { mutedRepos: [], hideDrafts: false, hideReviewed: false };

describe("applyFilters", () => {
  it("should pass everything through with default options", () => {
    const snapshot = buildSnapshot({ toReview: [buildPr()], mine: [buildPr({ id: "PR_2" })], reviewed: [buildPr({ id: "PR_3" })] });

    expect(applyFilters(snapshot, defaultOptions)).toEqual(snapshot);
  });

  it("should drop muted repos from all three sections", () => {
    const kept = buildPr({ id: "KEPT", repo: "acme/kept" });
    const snapshot = buildSnapshot({
      toReview: [buildPr({ repo: "acme/muted" }), kept],
      mine: [buildPr({ repo: "acme/muted" })],
      reviewed: [buildPr({ repo: "acme/muted" })],
    });

    const filtered = applyFilters(snapshot, { ...defaultOptions, mutedRepos: ["acme/muted"] });

    expect(filtered).toEqual({ toReview: [kept], mine: [], reviewed: [] });
  });

  it("should drop drafts from toReview and reviewed but never from mine", () => {
    const snapshot = buildSnapshot({
      toReview: [buildPr({ isDraft: true })],
      mine: [buildPr({ id: "PR_2", isDraft: true })],
      reviewed: [buildPr({ id: "PR_3", isDraft: true })],
    });

    const filtered = applyFilters(snapshot, { ...defaultOptions, hideDrafts: true });

    expect(filtered.toReview).toEqual([]);
    expect(filtered.reviewed).toEqual([]);
    expect(filtered.mine).toHaveLength(1);
  });

  it("should empty the reviewed section when hideReviewed is on", () => {
    const snapshot = buildSnapshot({ toReview: [buildPr()], reviewed: [buildPr({ id: "PR_3" })] });

    const filtered = applyFilters(snapshot, { ...defaultOptions, hideReviewed: true });

    expect(filtered.reviewed).toEqual([]);
    expect(filtered.toReview).toHaveLength(1);
  });
});

describe("partitionReviewed", () => {
  it("should route fresh approvals to freshlyApproved", () => {
    const fresh = buildPr({ id: "FRESH", viewerReviewState: "APPROVED" });

    expect(partitionReviewed([fresh])).toEqual({ freshlyApproved: [fresh], needsAttention: [] });
  });

  it.each([
    ["a stale approval", buildPr({ id: "STALE", viewerReviewState: "APPROVED", isViewerApprovalStale: true })],
    ["a comment review", buildPr({ id: "COMMENTED", viewerReviewState: "COMMENTED" })],
    ["a changes request", buildPr({ id: "CHANGES", viewerReviewState: "CHANGES_REQUESTED" })],
    ["a dismissed review", buildPr({ id: "DISMISSED", viewerReviewState: "DISMISSED" })],
    ["a missing review state", buildPr({ id: "NONE", viewerReviewState: null })],
  ])("should route %s to needsAttention", (_label, pr) => {
    expect(partitionReviewed([pr])).toEqual({ freshlyApproved: [], needsAttention: [pr] });
  });

  it("should preserve order inside each partition", () => {
    const firstFresh = buildPr({ id: "F1", viewerReviewState: "APPROVED" });
    const commented = buildPr({ id: "C1", viewerReviewState: "COMMENTED" });
    const secondFresh = buildPr({ id: "F2", viewerReviewState: "APPROVED" });

    const partition = partitionReviewed([firstFresh, commented, secondFresh]);

    expect(partition.freshlyApproved.map((pr) => pr.id)).toEqual(["F1", "F2"]);
    expect(partition.needsAttention.map((pr) => pr.id)).toEqual(["C1"]);
  });
});
