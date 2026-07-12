import { isRepoMuted } from "./muting";
import type { IPrSnapshot, IPullRequest } from "../core/types";

export interface IFilterOptions {
  mutedRepos: string[];
  hideDrafts: boolean;
  hideReviewed: boolean;
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
