export type CiState = "SUCCESS" | "FAILURE" | "PENDING" | "NONE";

export interface IPullRequest {
  id: string;
  title: string;
  url: string;
  repo: string;
  author: string;
  isDraft: boolean;
  createdAt: string;
  ciState: CiState;
  reviewDecision: string | null;
  headRefName: string;
}

export interface IPrSnapshot {
  toReview: IPullRequest[];
  mine: IPullRequest[];
}

export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";
export type UpdateBranchMethod = "MERGE" | "REBASE";
export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface IPrReviewer {
  name: string;
  state: string;
}

export interface IPrCheck {
  name: string;
  status: string;
  url?: string;
}

export interface IPrLabel {
  name: string;
  color: string;
}

export interface IPrTimelineItem {
  kind: "comment" | "review";
  author: string;
  avatarUrl: string;
  bodyHtml: string;
  createdAt: string;
  reviewState?: string;
  codeCommentsCount?: number;
}

export interface IPrDetails {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  authorAvatarUrl: string;
  state: PrState;
  isDraft: boolean;
  createdAt: string;
  bodyHtml: string;
  baseRefName: string;
  headRefName: string;
  headRepo: string;
  isBehindBase: boolean;
  commitsCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  labels: IPrLabel[];
  mergeable: MergeableState;
  mergeMethods: MergeMethod[];
  reviewDecision: string | null;
  viewerDidAuthor: boolean;
  reviewers: IPrReviewer[];
  checks: IPrCheck[];
  checksTotal: number;
  timeline: IPrTimelineItem[];
  timelineTruncated: boolean;
}
