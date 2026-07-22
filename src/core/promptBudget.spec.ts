import { describe, expect, it } from "vitest";
import { churnOf, formatFileLine, listFileLines, renderPatchSection, sortByChurnDescending, truncatePatchToBudget } from "./promptBudget";
import type { IPrFile, IPrFilePatch } from "./types";

function buildFile(path: string, additions: number, deletions: number, overrides: Partial<IPrFile> = {}): IPrFile {
  return { path, changeType: "MODIFIED", additions, deletions, viewedState: "UNVIEWED", ...overrides };
}

function toPatchMap(patches: IPrFilePatch[]): Map<string, IPrFilePatch> {
  return new Map(patches.map((filePatch) => [filePatch.path, filePatch]));
}

describe("churnOf", () => {
  it("should sum additions and deletions", () => {
    expect(churnOf(buildFile("a.ts", 5, 2))).toBe(7);
  });
});

describe("sortByChurnDescending", () => {
  it("should order files by additions+deletions, largest first", () => {
    const files = [buildFile("small.ts", 1, 0), buildFile("big.ts", 50, 50)];

    expect(sortByChurnDescending(files).map((file) => file.path)).toEqual(["big.ts", "small.ts"]);
  });

  it("should not mutate the input array", () => {
    const files = [buildFile("small.ts", 1, 0), buildFile("big.ts", 50, 50)];

    sortByChurnDescending(files);

    expect(files.map((file) => file.path)).toEqual(["small.ts", "big.ts"]);
  });
});

describe("formatFileLine", () => {
  it("should render path, diffstat, and change type", () => {
    expect(formatFileLine(buildFile("src/a.ts", 5, 2))).toBe("- src/a.ts (+5/-2, MODIFIED)");
  });
});

describe("listFileLines", () => {
  it("should list every file when under the cap", () => {
    const files = [buildFile("a.ts", 1, 0), buildFile("b.ts", 2, 0)];

    expect(listFileLines(files, 5)).toEqual(["- a.ts (+1/-0, MODIFIED)", "- b.ts (+2/-0, MODIFIED)"]);
  });

  it("should cap the list and note the omitted count", () => {
    const files = Array.from({ length: 8 }, (_, index) => buildFile(`file-${index}.ts`, 8 - index, 0));

    const lines = listFileLines(files, 5);

    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("- … 3 more files not shown");
  });
});

describe("truncatePatchToBudget", () => {
  it("should return the patch unchanged when under budget", () => {
    expect(truncatePatchToBudget("@@ hunk @@", 100)).toBe("@@ hunk @@");
  });

  it("should truncate at the last hunk boundary that fits", () => {
    const patch = `@@ hunk one @@\n${"a".repeat(20)}\n@@ hunk two @@\n${"b".repeat(20)}`;

    const truncated = truncatePatchToBudget(patch, 30);

    expect(truncated).toContain("@@ hunk one @@");
    expect(truncated).not.toContain("@@ hunk two @@");
    expect(truncated).toContain("patch truncated (over size budget)");
  });
});

describe("renderPatchSection", () => {
  it("should render patches largest-churn-first, skipping files without a patch", () => {
    const files = [buildFile("small.ts", 1, 0), buildFile("big.ts", 100, 50), buildFile("binary.png", 0, 0)];
    const patches = toPatchMap([
      { path: "small.ts", patch: "@@ small hunk @@" },
      { path: "big.ts", patch: "@@ big hunk @@" },
    ]);

    const section = renderPatchSection(sortByChurnDescending(files), patches, 1000);

    expect(section.indexOf("@@ big hunk @@")).toBeLessThan(section.indexOf("@@ small hunk @@"));
    expect(section).not.toContain("binary.png");
  });

  it("should stop once the byte budget is exhausted", () => {
    const files = [buildFile("huge.ts", 900, 0), buildFile("tiny.ts", 1, 0)];
    const patches = toPatchMap([
      { path: "huge.ts", patch: "x".repeat(50) },
      { path: "tiny.ts", patch: "@@ tiny hunk @@" },
    ]);

    const section = renderPatchSection(sortByChurnDescending(files), patches, 50);

    expect(section).toContain("x".repeat(50));
    expect(section).not.toContain("@@ tiny hunk @@");
  });
});
