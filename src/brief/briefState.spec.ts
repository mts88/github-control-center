import { describe, expect, it } from "vitest";
import { BriefStore, type PersistedBrief } from "./briefState";

const PR = "PR_1";
const OID_A = "aaa111";
const OID_B = "bbb222";

describe("BriefStore", () => {
  describe("getState", () => {
    it("should report idle for a PR it has never seen", () => {
      const store = new BriefStore();

      expect(store.getState(PR, OID_A)).toEqual({ status: "idle" });
    });

    it("should report pending after begin", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);

      expect(store.getState(PR, OID_A)).toEqual({ status: "pending" });
    });

    it("should report pending even for a different head oid so one PR never runs two briefs at once", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);

      expect(store.getState(PR, OID_B)).toEqual({ status: "pending" });
    });

    it("should report done with the summary for the head oid it was generated on", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.complete(PR, OID_A, "summary");

      expect(store.getState(PR, OID_A)).toEqual({ status: "done", text: "summary" });
    });

    it("should report idle for a summary generated on a superseded head oid", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.complete(PR, OID_A, "summary");

      expect(store.getState(PR, OID_B)).toEqual({ status: "idle" });
    });

    it("should report the error for the head oid it failed on", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.fail(PR, OID_A, "CLI timed out");

      expect(store.getState(PR, OID_A)).toEqual({ status: "error", text: "CLI timed out" });
    });

    it("should reset a failure to idle after a push instead of blaming the new commits", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.fail(PR, OID_A, "CLI timed out");

      expect(store.getState(PR, OID_B)).toEqual({ status: "idle" });
    });

    it("should replace an error with pending when a retry begins", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.fail(PR, OID_A, "CLI timed out");
      store.begin(PR, OID_A);

      expect(store.getState(PR, OID_A)).toEqual({ status: "pending" });
    });
  });

  describe("guards", () => {
    it("should expose isPending regardless of the head oid", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);

      expect(store.isPending(PR)).toBe(true);
      const idle = new BriefStore();
      expect(idle.isPending(PR)).toBe(false);
    });

    it("should expose hasSummary only for the matching head oid", () => {
      const store = new BriefStore();
      store.begin(PR, OID_A);
      store.complete(PR, OID_A, "summary");

      expect(store.hasSummary(PR, OID_A)).toBe(true);
      expect(store.hasSummary(PR, OID_B)).toBe(false);
    });
  });

  describe("persistence", () => {
    it("should serialize only completed summaries", () => {
      const store = new BriefStore();
      store.begin("PR_done", OID_A);
      store.complete("PR_done", OID_A, "summary");
      store.begin("PR_pending", OID_A);
      store.begin("PR_failed", OID_A);
      store.fail("PR_failed", OID_A, "boom");

      expect(store.serialize()).toEqual([["PR_done", OID_A, "summary"]]);
    });

    it("should ignore malformed persisted entries from older storage formats", () => {
      const legacyPair = ["PR_1:oid", "summary"] as unknown as PersistedBrief;
      const store = new BriefStore([legacyPair]);

      expect(store.serialize()).toEqual([]);
    });

    it("should restore serialized summaries on construction", () => {
      const original = new BriefStore();
      original.begin(PR, OID_A);
      original.complete(PR, OID_A, "summary");

      const restored = new BriefStore(original.serialize());

      expect(restored.getState(PR, OID_A)).toEqual({ status: "done", text: "summary" });
    });

    it("should evict the oldest summary beyond the cap", () => {
      const store = new BriefStore([], 2);
      store.complete("PR_1", OID_A, "one");
      store.complete("PR_2", OID_A, "two");
      store.complete("PR_3", OID_A, "three");

      expect(store.getState("PR_1", OID_A)).toEqual({ status: "idle" });
      expect(store.getState("PR_2", OID_A)).toEqual({ status: "done", text: "two" });
      expect(store.getState("PR_3", OID_A)).toEqual({ status: "done", text: "three" });
    });

    it("should treat a regenerated summary as newest, evicting a genuinely older one first", () => {
      const store = new BriefStore([], 2);
      store.complete("PR_old", OID_A, "old");
      store.complete("PR_mid", OID_A, "mid");
      store.complete("PR_old", OID_B, "old regenerated"); // re-completion moves PR_old to newest
      store.complete("PR_new", OID_A, "new"); // pushes the cap over: the true oldest (PR_mid) goes

      expect(store.getState("PR_mid", OID_A)).toEqual({ status: "idle" });
      expect(store.getState("PR_old", OID_B)).toEqual({ status: "done", text: "old regenerated" });
      expect(store.getState("PR_new", OID_A)).toEqual({ status: "done", text: "new" });
    });

    it("should not count pending or failed entries against the summary cap", () => {
      const store = new BriefStore([], 2);
      store.begin("PR_pending", OID_A);
      store.begin("PR_failed", OID_A);
      store.fail("PR_failed", OID_A, "boom");
      store.complete("PR_1", OID_A, "one");
      store.complete("PR_2", OID_A, "two");

      expect(store.getState("PR_1", OID_A)).toEqual({ status: "done", text: "one" });
      expect(store.getState("PR_2", OID_A)).toEqual({ status: "done", text: "two" });
      expect(store.isPending("PR_pending")).toBe(true);
    });
  });

  describe("clearResults", () => {
    it("should wipe summaries and errors but keep in-flight runs pending", () => {
      const store = new BriefStore();
      store.complete("PR_done", OID_A, "summary");
      store.begin("PR_failed", OID_A);
      store.fail("PR_failed", OID_A, "boom");
      store.begin("PR_pending", OID_A);

      store.clearResults();

      expect(store.getState("PR_done", OID_A)).toEqual({ status: "idle" });
      expect(store.getState("PR_failed", OID_A)).toEqual({ status: "idle" });
      expect(store.getState("PR_pending", OID_A)).toEqual({ status: "pending" });
    });
  });
});
