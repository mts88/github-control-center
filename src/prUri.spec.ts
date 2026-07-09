import { describe, expect, it } from "vitest";
import { decodePrUriParts, encodePrUriParts, PR_URI_SCHEME, type IPrFileRef } from "./prUri";

function buildRef(overrides: Partial<IPrFileRef> = {}): IPrFileRef {
  return {
    prId: overrides.prId ?? "PR_42",
    repo: overrides.repo ?? "acme/repo",
    prNumber: overrides.prNumber ?? 42,
    path: overrides.path ?? "src/app.ts",
    sha: overrides.sha ?? "abc123",
    headOid: overrides.headOid ?? "head456",
    side: overrides.side ?? "RIGHT",
    isEmpty: overrides.isEmpty ?? false,
  };
}

describe("prUri", () => {
  it("should expose the custom scheme", () => {
    expect(PR_URI_SCHEME).toBe("ghcc-pr");
  });

  it("should round-trip a file reference through encode and decode", () => {
    const ref = buildRef();

    const { path, query } = encodePrUriParts(ref);

    expect(decodePrUriParts(path, query)).toEqual(ref);
  });

  it("should keep the file path as the uri path for tab titles and language detection", () => {
    const { path } = encodePrUriParts(buildRef({ path: "src/nested/app.ts" }));

    expect(path).toBe("/src/nested/app.ts");
  });

  it("should escape and restore a path containing spaces and hash characters", () => {
    const ref = buildRef({ path: "docs/my file #1.md" });

    const { path, query } = encodePrUriParts(ref);

    expect(decodePrUriParts(path, query)).toEqual(ref);
  });

  it("should round-trip the empty-side flag", () => {
    const ref = buildRef({ isEmpty: true, side: "LEFT" });

    const { path, query } = encodePrUriParts(ref);

    expect(decodePrUriParts(path, query)).toEqual(ref);
  });

  it("should round-trip the head oid separately from the pinned sha", () => {
    const ref = buildRef({ sha: "base-sha", headOid: "head-sha", side: "LEFT" });

    const { path, query } = encodePrUriParts(ref);

    expect(decodePrUriParts(path, query).headOid).toBe("head-sha");
  });

  it("should throw when the query is missing required fields", () => {
    expect(() => decodePrUriParts("/src/app.ts", "prId=PR_42")).toThrow();
  });
});
