import type { IReviewThread } from "./types";

export interface IThreadSyncPlan {
  create: IReviewThread[];
  update: IReviewThread[];
  removeIds: string[];
}

/**
 * Diffs the rendered thread set against a fresh server snapshot so the caller
 * can update comment threads in place: disposing everything and recreating
 * would destroy any reply box the user is typing into.
 */
export function syncThreads(existingIds: string[], incoming: IReviewThread[]): IThreadSyncPlan {
  const incomingIds = new Set(incoming.map((thread) => thread.id));
  const existing = new Set(existingIds);
  return {
    create: incoming.filter((thread) => !existing.has(thread.id)),
    update: incoming.filter((thread) => existing.has(thread.id)),
    removeIds: existingIds.filter((threadId) => !incomingIds.has(threadId)),
  };
}
