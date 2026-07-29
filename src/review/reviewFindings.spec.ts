import { describe, expect, it } from "vitest";
import { anchorFindings, parseFindings, type IRawFinding } from "./reviewFindings";
import type { IPrFile, IPrFilePatch } from "../core/types";

function buildFile(path: string, overrides: Partial<IPrFile> = {}): IPrFile {
  return { path, changeType: "MODIFIED", additions: 1, deletions: 0, viewedState: "UNVIEWED", ...overrides };
}

function toPatchMap(patches: IPrFilePatch[]): Map<string, IPrFilePatch> {
  return new Map(patches.map((filePatch) => [filePatch.path, filePatch]));
}

function finding(overrides: Partial<IRawFinding> = {}): IRawFinding {
  return { path: "a.ts", side: "RIGHT", snippet: "const x = 1;", line: 2, severity: "issue", comment: "looks wrong", ...overrides };
}

describe("parseFindings", () => {
  it("should parse a plain JSON array", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "warning", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({
      kind: "findings",
      findings: [{ path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "warning", comment: "hm" }],
    });
  });

  it("should strip a ```json code fence before parsing", () => {
    const raw = '```json\n[{"path":"a.ts","side":"RIGHT","snippet":"x","line":1,"severity":"info","comment":"hm"}]\n```';

    const result = parseFindings(raw);

    expect(result.kind).toBe("findings");
  });

  it("should strip a bare ``` code fence before parsing", () => {
    const raw = '```\n[{"path":"a.ts","side":"RIGHT","snippet":"x","line":1,"severity":"info","comment":"hm"}]\n```';

    const result = parseFindings(raw);

    expect(result.kind).toBe("findings");
  });

  it("should fall back to a report with the raw text when JSON parsing fails", () => {
    const raw = "Here is my review:\n- looks fine to me";

    expect(parseFindings(raw)).toEqual({ kind: "report", text: raw });
  });

  it("should fall back to a report when the JSON is not an array", () => {
    const raw = JSON.stringify({ summary: "not an array" });

    expect(parseFindings(raw)).toEqual({ kind: "report", text: raw });
  });

  it("should accept a genuinely empty array as zero findings, not a report", () => {
    expect(parseFindings("[]")).toEqual({ kind: "findings", findings: [] });
  });

  it("should drop items missing a non-empty path", () => {
    const raw = JSON.stringify([{ side: "RIGHT", snippet: "x", line: 1, severity: "info", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({ kind: "findings", findings: [] });
  });

  it("should drop items with an invalid side", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "UP", snippet: "x", line: 1, severity: "info", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({ kind: "findings", findings: [] });
  });

  it("should drop items missing a non-empty snippet", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "RIGHT", snippet: "", line: 1, severity: "info", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({ kind: "findings", findings: [] });
  });

  it("should drop items missing a non-empty comment", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "info", comment: "" }]);

    expect(parseFindings(raw)).toEqual({ kind: "findings", findings: [] });
  });

  it("should default an unknown severity to issue rather than dropping the finding", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "critical", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({
      kind: "findings",
      findings: [{ path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "issue", comment: "hm" }],
    });
  });

  it("should default a missing or non-numeric line to 0 rather than dropping the finding", () => {
    const raw = JSON.stringify([{ path: "a.ts", side: "RIGHT", snippet: "x", severity: "info", comment: "hm" }]);

    expect(parseFindings(raw)).toEqual({
      kind: "findings",
      findings: [{ path: "a.ts", side: "RIGHT", snippet: "x", line: 0, severity: "info", comment: "hm" }],
    });
  });

  it("should keep the valid items in a mixed array and drop only the invalid ones", () => {
    const raw = JSON.stringify([
      { path: "a.ts", side: "RIGHT", snippet: "x", line: 1, severity: "info", comment: "good" },
      { side: "RIGHT", snippet: "x", line: 1, severity: "info", comment: "missing path" },
    ]);

    const result = parseFindings(raw);

    expect(result.kind).toBe("findings");
    expect(result.kind === "findings" && result.findings).toHaveLength(1);
  });
});

describe("anchorFindings", () => {
  const files = [buildFile("a.ts"), buildFile("binary.png")];

  it("should anchor a RIGHT-side finding to an added line by matching its snippet", () => {
    const patches = toPatchMap([{ path: "a.ts", patch: "@@ -1,2 +1,3 @@\n line1\n+const x = 1;\n line2" }]);

    const [anchored] = anchorFindings([finding({ snippet: "const x = 1;" })], files, patches);

    expect(anchored).toEqual({ subjectType: "LINE", path: "a.ts", side: "RIGHT", line: 2, severity: "issue", comment: "looks wrong" });
  });

  it("should anchor a LEFT-side finding to a deleted line by matching its snippet", () => {
    const patches = toPatchMap([{ path: "a.ts", patch: "@@ -1,3 +1,2 @@\n line1\n-const x = 1;\n line3" }]);

    const [anchored] = anchorFindings([finding({ side: "LEFT", snippet: "const x = 1;" })], files, patches);

    expect(anchored).toEqual({ subjectType: "LINE", path: "a.ts", side: "LEFT", line: 2, severity: "issue", comment: "looks wrong" });
  });

  it("should anchor to a context line present on either side", () => {
    const patches = toPatchMap([{ path: "a.ts", patch: "@@ -1,2 +1,2 @@\n const x = 1;\n line2" }]);

    const [anchored] = anchorFindings([finding({ snippet: "const x = 1;" })], files, patches);

    expect(anchored).toMatchObject({ subjectType: "LINE", line: 1 });
  });

  it("should resolve the first occurrence when the snippet appears more than once", () => {
    const patches = toPatchMap([{ path: "a.ts", patch: "@@ -1,3 +1,3 @@\n dup\n ctx\n dup" }]);

    const [anchored] = anchorFindings([finding({ snippet: "dup" })], files, patches);

    expect(anchored).toMatchObject({ subjectType: "LINE", line: 1 });
  });

  it("should degrade to a FILE-level finding when the snippet is not found in the patch", () => {
    const patches = toPatchMap([{ path: "a.ts", patch: "@@ -1,2 +1,2 @@\n line1\n line2" }]);

    const [anchored] = anchorFindings([finding({ snippet: "not present anywhere" })], files, patches);

    expect(anchored).toEqual({ subjectType: "FILE", path: "a.ts", severity: "issue", comment: "looks wrong" });
  });

  it("should degrade to a FILE-level finding when the file has no patch (binary)", () => {
    const [anchored] = anchorFindings([finding({ path: "binary.png" })], files, toPatchMap([{ path: "binary.png" }]));

    expect(anchored).toEqual({ subjectType: "FILE", path: "binary.png", severity: "issue", comment: "looks wrong" });
  });

  it("should mark a finding on an unknown path as unanchorable rather than offering to insert it", () => {
    const [anchored] = anchorFindings([finding({ path: "hallucinated.ts" })], files, toPatchMap([]));

    expect(anchored).toEqual({ subjectType: "UNANCHORABLE", path: "hallucinated.ts", severity: "issue", comment: "looks wrong" });
  });
});
