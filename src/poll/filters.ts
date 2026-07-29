import { isRepoMuted } from "./muting";
import type { IPrSnapshot, IPullRequest } from "../core/types";

export interface IFilterOptions {
  mutedRepos: string[];
  hideDrafts: boolean;
  hideReviewed: boolean;
}

export interface IReviewedPartition {
  /** APPROVED and still current — the "Reviewed" view */
  freshlyApproved: IPullRequest[];
  /** commented, changes requested, dismissed or stale approvals — stay in "To Review" */
  needsAttention: IPullRequest[];
}

/** Splits the reviewed section between the "Reviewed" view and the tail of "To Review". */
export function partitionReviewed(reviewed: IPullRequest[]): IReviewedPartition {
  const isFreshApproval = (pr: IPullRequest): boolean => pr.viewerReviewState === "APPROVED" && !pr.isViewerApprovalStale;
  return {
    freshlyApproved: reviewed.filter(isFreshApproval),
    needsAttention: reviewed.filter((pr) => !isFreshApproval(pr)),
  };
}

/** Runs before providers, badge and trackers: lists, badge and toasts must always agree. */
export function applyFilters(snapshot: IPrSnapshot, options: IFilterOptions): IPrSnapshot {
  const isUnmuted = (pr: IPullRequest): boolean => !isRepoMuted(pr.repo, options.mutedRepos);
  const isVisibleReviewRow = (pr: IPullRequest): boolean => isUnmuted(pr) && !(options.hideDrafts && pr.isDraft);
  return {
    toReview: snapshot.toReview.filter(isVisibleReviewRow),
    mine: snapshot.mine.filter(isUnmuted),
    reviewed: options.hideReviewed ? [] : snapshot.reviewed.filter(isVisibleReviewRow),
  };
}
