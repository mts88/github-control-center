import { describe, expect, it } from "vitest";
import { threadLabel, toThreadAnchor, toThreadPosition } from "./reviewThreads";
import type { IReviewThread } from "./types";

function buildThread(overrides: Partial<IReviewThread> = {}): IReviewThread {
  return {
    id: overrides.id ?? "RT_1",
    path: overrides.path ?? "src/app.ts",
    line: overrides.line !== undefined ? overrides.line : 10,
    startLine: overrides.startLine !== undefined ? overrides.startLine : null,
    side: overrides.side ?? "RIGHT",
    startSide: overrides.startSide !== undefined ? overrides.startSide : null,
    isResolved: overrides.isResolved ?? false,
    isOutdated: overrides.isOutdated ?? false,
    subjectType: overrides.subjectType ?? "LINE",
    comments: overrides.comments ?? [],
  };
}

describe("toThreadAnchor", () => {
  it("should anchor a single-line RIGHT thread at the zero-based line", () => {
    const anchor = toThreadAnchor(buildThread({ line: 10 }));

    expect(anchor).toEqual({ path: "src/app.ts", side: "RIGHT", startLine0: 9, endLine0: 9, isFileLevel: false });
  });

  it("should anchor a LEFT-side thread", () => {
    const anchor = toThreadAnchor(buildThread({ side: "LEFT", line: 3 }));

    expect(anchor).toEqual({ path: "src/app.ts", side: "LEFT", startLine0: 2, endLine0: 2, isFileLevel: false });
  });

  it("should anchor a multi-line thread from startLine to line", () => {
    const anchor = toThreadAnchor(buildThread({ startLine: 4, line: 7 }));

    expect(anchor).toEqual({ path: "src/app.ts", side: "RIGHT", startLine0: 3, endLine0: 6, isFileLevel: false });
  });

  it("should anchor a FILE-level thread as file-level", () => {
    const anchor = toThreadAnchor(buildThread({ subjectType: "FILE", line: null }));

    expect(anchor).toEqual({ path: "src/app.ts", side: "RIGHT", startLine0: 0, endLine0: 0, isFileLevel: true });
  });

  it("should return null for an outdated thread with a null line", () => {
    expect(toThreadAnchor(buildThread({ line: null, isOutdated: true }))).toBeNull();
  });
});

describe("toThreadPosition", () => {
  it("should map a single-line selection to a one-based line with side", () => {
    expect(toThreadPosition("RIGHT", 9, 9, false)).toEqual({ line: 10, side: "RIGHT", subjectType: "LINE" });
  });

  it("should map a multi-line selection to startLine and line with startSide", () => {
    expect(toThreadPosition("LEFT", 3, 6, false)).toEqual({
      startLine: 4,
      line: 7,
      side: "LEFT",
      startSide: "LEFT",
      subjectType: "LINE",
    });
  });

  it("should map a file-level comment to subjectType FILE without lines", () => {
    expect(toThreadPosition("RIGHT", 0, 0, true)).toEqual({ subjectType: "FILE" });
  });
});

describe("threadLabel", () => {
  it("should label outdated threads", () => {
    expect(threadLabel(buildThread({ isOutdated: true, isResolved: true }))).toBe("Outdated");
  });

  it("should label resolved threads", () => {
    expect(threadLabel(buildThread({ isResolved: true }))).toBe("Resolved");
  });

  it("should return an empty label otherwise", () => {
    expect(threadLabel(buildThread())).toBe("");
  });
});
