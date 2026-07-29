export type CiState = "SUCCESS" | "FAILURE" | "PENDING" | "NONE";

export interface IPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  isDraft: boolean;
  createdAt: string;
  ciState: CiState;
  reviewDecision: string | null;
  /** the viewer's latest review state (APPROVED, DISMISSED, …) — null when never reviewed */
  viewerReviewState: string | null;
  /** the viewer's APPROVED review predates the current head — poll-time copy of the details staleness rule */
  isViewerApprovalStale?: boolean;
  /** set only on `IPrSnapshot.reviewed` entries: already reviewed, no active re-request */
  isReviewedByMe?: boolean;
  headRefName: string;
  baseRefOid: string;
  headRefOid: string;
}

export type FileChangeType = "ADDED" | "MODIFIED" | "DELETED" | "RENAMED" | "COPIED" | "CHANGED";
export type FileViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";
export type DiffSide = "LEFT" | "RIGHT";

export interface IPrFile {
  path: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  viewedState: FileViewedState;
}

export interface IPrFilePatch {
  path: string;
  /** old path for renames — the LEFT side of the diff */
  previousPath?: string;
  /** unified diff hunks; absent for binaries and very large files */
  patch?: string;
}

export interface IReviewThreadComment {
  id: string;
  author: string;
  bodyMarkdown: string;
  createdAt: string;
  isPending: boolean;
}

export interface IReviewThread {
  id: string;
  path: string;
  /** null when the thread is outdated and no longer anchorable */
  line: number | null;
  startLine: number | null;
  side: DiffSide;
  startSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  subjectType: "LINE" | "FILE";
  comments: IReviewThreadComment[];
}

export interface IReviewThreadsSnapshot {
  threads: IReviewThread[];
  /** the viewer's PENDING review, if any — one per user per PR */
  pendingReviewId: string | null;
  pendingCommentCount: number;
}

export interface IPrSnapshot {
  toReview: IPullRequest[];
  mine: IPullRequest[];
  /** open PRs the viewer already reviewed and that carry no active re-request */
  reviewed: IPullRequest[];
}

export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";
export type UpdateBranchMethod = "MERGE" | "REBASE";
export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface IPrReviewer {
  name: string;
  state: string;
  /** APPROVED review produced on an older commit than the current head */
  isStale?: boolean;
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
  kind: "comment" | "review" | "commit";
  author: string;
  avatarUrl: string;
  bodyHtml: string;
  createdAt: string;
  reviewState?: string;
  codeCommentsCount?: number;
  /** plain text, never HTML — commits render through escapeHtml, not the bodyHtml path */
  commitMessage?: string;
  commitSha?: string;
  commitUrl?: string;
}

export interface IBriefState {
  status: "unavailable" | "idle" | "pending" | "done" | "error";
  /** summary text when done, error message when error */
  text?: string;
  /** done summary produced on an earlier head commit — kept visible but flagged outdated */
  stale?: boolean;
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
  /** false when the viewer's latest review is still a current APPROVED (same commit, no fresh re-request) */
  canApprove: boolean;
  reviewers: IPrReviewer[];
  checks: IPrCheck[];
  checksTotal: number;
  timeline: IPrTimelineItem[];
  timelineTruncated: boolean;
}
