import type { DiffSide, IReviewThread } from "./types";

export interface IThreadAnchor {
  path: string;
  side: DiffSide;
  startLine0: number;
  endLine0: number;
  isFileLevel: boolean;
}

export interface IReviewThreadPosition {
  line?: number;
  startLine?: number;
  side?: DiffSide;
  startSide?: DiffSide;
  subjectType: "LINE" | "FILE";
}

/**
 * Maps a GitHub thread (1-based diff lines) to an editor anchor (0-based).
 * Returns null for outdated threads that lost their anchor — not rendered in v1;
 * upgrade path: anchor at originalLine against the original commit's document.
 */
export function toThreadAnchor(thread: IReviewThread): IThreadAnchor | null {
  if (thread.subjectType === "FILE") {
    return { path: thread.path, side: thread.side, startLine0: 0, endLine0: 0, isFileLevel: true };
  }
  if (thread.line === null) {
    return null;
  }
  return {
    path: thread.path,
    side: thread.side,
    startLine0: (thread.startLine ?? thread.line) - 1,
    endLine0: thread.line - 1,
    isFileLevel: false,
  };
}

/** Maps a 0-based editor selection to the GitHub review-thread input coordinates. */
export function toThreadPosition(side: DiffSide, startLine0: number, endLine0: number, isFileLevel: boolean): IReviewThreadPosition {
  if (isFileLevel) {
    return { subjectType: "FILE" };
  }
  if (startLine0 === endLine0) {
    return { line: endLine0 + 1, side, subjectType: "LINE" };
  }
  return { startLine: startLine0 + 1, line: endLine0 + 1, side, startSide: side, subjectType: "LINE" };
}

export function threadLabel(thread: IReviewThread): string {
  if (thread.isOutdated) {
    return "Outdated";
  }
  if (thread.isResolved) {
    return "Resolved";
  }
  return "";
}
