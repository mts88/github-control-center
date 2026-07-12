import { describe, expect, it, vi } from "vitest";
import { AsyncOidCache, OidCache } from "./OidCache";

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

  it("should forget the entry after delete", () => {
    const cache = new OidCache<string[]>();

    cache.set("PR_1", "oid-a", ["file.ts"]);
    cache.delete("PR_1");

    expect(cache.get("PR_1", "oid-a")).toBeUndefined();
  });
});

describe("AsyncOidCache", () => {
  it("should share one in-flight load between concurrent callers", async () => {
    const cache = new AsyncOidCache<string[]>();
    let resolveLoad!: (files: string[]) => void;
    const create = vi.fn(() => new Promise<string[]>((resolve) => (resolveLoad = resolve)));

    const first = cache.load("PR_1", "oid-a", create);
    const second = cache.load("PR_1", "oid-a", create);
    resolveLoad(["file.ts"]);

    await expect(first).resolves.toEqual(["file.ts"]);
    await expect(second).resolves.toEqual(["file.ts"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("should return the cached result without reloading once resolved", async () => {
    const cache = new AsyncOidCache<string[]>();
    const create = vi.fn(() => Promise.resolve(["file.ts"]));

    await cache.load("PR_1", "oid-a", create);

    await expect(cache.load("PR_1", "oid-a", create)).resolves.toEqual(["file.ts"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("should retry after a failed load instead of caching the rejection", async () => {
    const cache = new AsyncOidCache<string[]>();
    const create = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(["file.ts"]);

    await expect(cache.load("PR_1", "oid-a", create)).rejects.toThrow("boom");

    await expect(cache.load("PR_1", "oid-a", create)).resolves.toEqual(["file.ts"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("should keep the newer oid entry when a superseded load fails late", async () => {
    const cache = new AsyncOidCache<string[]>();
    let rejectStaleLoad!: (error: Error) => void;
    const staleCreate = vi.fn(() => new Promise<string[]>((_resolve, reject) => (rejectStaleLoad = reject)));
    const freshCreate = vi.fn(() => Promise.resolve(["fresh.ts"]));

    const staleLoad = cache.load("PR_1", "oid-a", staleCreate);
    await cache.load("PR_1", "oid-b", freshCreate);
    rejectStaleLoad(new Error("boom"));
    await expect(staleLoad).rejects.toThrow("boom");

    await expect(cache.load("PR_1", "oid-b", freshCreate)).resolves.toEqual(["fresh.ts"]);
    expect(freshCreate).toHaveBeenCalledTimes(1);
  });

  it("should reload when the oid changes and cache the new result", async () => {
    const cache = new AsyncOidCache<string[]>();
    const create = vi.fn(() => Promise.resolve(["file.ts"]));

    await cache.load("PR_1", "oid-a", create);
    await cache.load("PR_1", "oid-b", create);
    await cache.load("PR_1", "oid-b", create);

    expect(create).toHaveBeenCalledTimes(2);
  });
});
