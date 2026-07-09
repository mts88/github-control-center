import { describe, expect, it } from "vitest";
import { commentableRanges, parseHunks } from "./diffPatch";

describe("parseHunks", () => {
  it("should parse a single hunk header into old and new start and counts", () => {
    expect(parseHunks("@@ -1,3 +2,4 @@\n line")).toEqual([{ oldStart: 1, oldLines: 3, newStart: 2, newLines: 4 }]);
  });

  it("should parse multiple hunks", () => {
    const patch = "@@ -1,2 +1,2 @@\n a\n@@ -10,5 +11,6 @@\n b";

    expect(parseHunks(patch)).toEqual([
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 },
      { oldStart: 10, oldLines: 5, newStart: 11, newLines: 6 },
    ]);
  });

  it("should default an omitted count to 1", () => {
    expect(parseHunks("@@ -5 +7 @@\n line")).toEqual([{ oldStart: 5, oldLines: 1, newStart: 7, newLines: 1 }]);
  });

  it("should ignore the section heading after the second @@", () => {
    expect(parseHunks("@@ -1,2 +1,2 @@ function foo() {\n line")).toEqual([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 }]);
  });

  it("should return an empty array for an empty patch", () => {
    expect(parseHunks("")).toEqual([]);
  });
});

describe("commentableRanges", () => {
  const modifiedPatch = "@@ -1,3 +1,4 @@\n line1\n+added\n line2\n line3";

  it("should return RIGHT ranges covering context and added lines", () => {
    expect(commentableRanges(modifiedPatch, "RIGHT")).toEqual([{ start: 1, end: 4 }]);
  });

  it("should return LEFT ranges covering context and deleted lines", () => {
    const patch = "@@ -1,3 +1,2 @@\n line1\n-removed\n line3";

    expect(commentableRanges(patch, "LEFT")).toEqual([{ start: 1, end: 3 }]);
  });

  it("should exclude added lines from LEFT and deleted lines from RIGHT", () => {
    const patch = "@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n ctx2";

    expect(commentableRanges(patch, "LEFT")).toEqual([{ start: 1, end: 3 }]);
    expect(commentableRanges(patch, "RIGHT")).toEqual([{ start: 1, end: 3 }]);
  });

  it("should split ranges across non-adjacent hunks", () => {
    const patch = "@@ -1,2 +1,2 @@\n a\n+b\n@@ -10,2 +11,2 @@\n c\n+d";

    expect(commentableRanges(patch, "RIGHT")).toEqual([
      { start: 1, end: 2 },
      { start: 11, end: 12 },
    ]);
  });

  it("should return no LEFT ranges for a new-file patch", () => {
    const patch = "@@ -0,0 +1,3 @@\n+a\n+b\n+c";

    expect(commentableRanges(patch, "LEFT")).toEqual([]);
    expect(commentableRanges(patch, "RIGHT")).toEqual([{ start: 1, end: 3 }]);
  });

  it("should return no RIGHT ranges for a deleted-file patch", () => {
    const patch = "@@ -1,2 +0,0 @@\n-a\n-b";

    expect(commentableRanges(patch, "RIGHT")).toEqual([]);
    expect(commentableRanges(patch, "LEFT")).toEqual([{ start: 1, end: 2 }]);
  });

  it("should ignore the no-newline-at-end-of-file marker line", () => {
    const patch = "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file";

    expect(commentableRanges(patch, "RIGHT")).toEqual([{ start: 1, end: 2 }]);
    expect(commentableRanges(patch, "LEFT")).toEqual([{ start: 1, end: 2 }]);
  });

  it("should return empty ranges for an undefined patch", () => {
    expect(commentableRanges(undefined, "RIGHT")).toEqual([]);
  });
});
