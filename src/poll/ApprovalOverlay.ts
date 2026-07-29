import type { IPrSnapshot, IPullRequest } from "../core/types";

/**
 * Bridges the gap between a successful APPROVE mutation and GitHub's lagging search index:
 * an approved PR keeps rendering as a fresh approval until the server data confirms it.
 */
export class ApprovalOverlay {
  private readonly approvedHeadByPrId = new Map<string, string>();

  record(prId: string, headRefOid: string): void {
    this.approvedHeadByPrId.set(prId, headRefOid);
  }

  /** Rewrites the raw snapshot so every recorded approval renders as fresh; runs before filters. */
  apply(snapshot: IPrSnapshot): IPrSnapshot {
    let { toReview, reviewed } = snapshot;
    for (const [prId, approvedHeadOid] of this.approvedHeadByPrId) {
      const pr = [...toReview, ...reviewed].find((candidate) => candidate.id === prId);
      if (!pr) {
        // ponytail: index lag can drop the PR from both searches for a cycle — the row briefly
        // disappears and self-heals; upgrade path: cache the full PR at record time and inject it.
        // Merged PRs leave one dead map entry until window reload — bounded, harmless.
        continue;
      }
      if (pr.headRefOid !== approvedHeadOid) {
        // pushed since the approve: genuinely stale, the server data wins
        this.approvedHeadByPrId.delete(prId);
        continue;
      }
      if (pr.isReviewedByMe && pr.viewerReviewState === "APPROVED" && !pr.isViewerApprovalStale) {
        // server confirmed the approval — the overlay entry is done
        this.approvedHeadByPrId.delete(prId);
        continue;
      }
      const approvedPr: IPullRequest = { ...pr, isReviewedByMe: true, viewerReviewState: "APPROVED", isViewerApprovalStale: false };
      toReview = toReview.filter((candidate) => candidate.id !== prId);
      reviewed = reviewed.some((candidate) => candidate.id === prId)
        ? reviewed.map((candidate) => (candidate.id === prId ? approvedPr : candidate))
        : [...reviewed, approvedPr];
    }
    return { toReview, mine: snapshot.mine, reviewed };
  }
}
