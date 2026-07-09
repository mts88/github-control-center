import { describe, expect, it } from "vitest";
import { OidCache } from "./OidCache";

describe("OidCache", () => {
  it("should return the stored value for a matching oid", () => {
    const cache = new OidCache<string[]>();

    cache.set("PR_1", "oid-a", ["file.ts"]);

    expect(cache.get("PR_1", "oid-a")).toEqual(["file.ts"]);
  });

  it("should return undefined when the oid changed", () => {
    const cache = new OidCache<string[]>();

    cache.set("PR_1", "oid-a", ["file.ts"]);

    expect(cache.get("PR_1", "oid-b")).toBeUndefined();
  });

  it("should return undefined for an unknown pull request", () => {
    const cache = new OidCache<string[]>();

    expect(cache.get("PR_404", "oid-a")).toBeUndefined();
  });

  it("should let peek read the value regardless of the oid", () => {
    const cache = new OidCache<string[]>();

    cache.set("PR_1", "oid-a", ["file.ts"]);

    expect(cache.peek("PR_1")).toEqual(["file.ts"]);
  });

  it("should return undefined from peek for an unknown pull request", () => {
    const cache = new OidCache<string[]>();

    expect(cache.peek("PR_404")).toBeUndefined();
  });

  it("should forget the entry after delete", () => {
    const cache = new OidCache<string[]>();

    cache.set("PR_1", "oid-a", ["file.ts"]);
    cache.delete("PR_1");

    expect(cache.get("PR_1", "oid-a")).toBeUndefined();
  });
});
