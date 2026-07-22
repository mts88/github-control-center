import { describe, expect, it } from "vitest";
import { ReviewStore } from "./reviewState";
import type { IAnchoredFinding } from "./reviewFindings";

const PR = "PR_1";
const OID_A = "aaa111";
const OID_B = "bbb222";

function buildFindings(count: number): IAnchoredFinding[] {
  return Array.from({ length: count }, (_, index) => ({
    subjectType: "FILE",
    path: `file-${index}.ts`,
    severity: "issue",
    comment: `finding ${index}`,
  }));
}

describe("ReviewStore", () => {
  describe("getState", () => {
    it("should report idle for a PR it has never seen", () => {
      const store = new ReviewStore();

      expect(store.getState(PR, OID_A)).toEqual({ status: "idle" });
    });

    it("should report pending after begin", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);

      expect(store.getState(PR, OID_A)).toEqual({ status: "pending" });
    });

    it("should report pending even for a different head oid so one PR never runs two reviews at once", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);

      expect(store.getState(PR, OID_B)).toEqual({ status: "pending" });
    });

    it("should report done with findings for the head oid it was generated on", () => {
      const store = new ReviewStore();
      const findings = buildFindings(2);
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, findings);

      expect(store.getState(PR, OID_A)).toEqual({ status: "done", findings, promotedIndices: [] });
    });

    it("should report done with a report text when the model output could not be parsed as JSON", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.completeReport(PR, OID_A, "free text review");

      expect(store.getState(PR, OID_A)).toEqual({ status: "done", reportText: "free text review" });
    });

    it("should report a superseded result as stale rather than hiding it", () => {
      const store = new ReviewStore();
      const findings = buildFindings(1);
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, findings);

      expect(store.getState(PR, OID_B)).toEqual({ status: "done", findings, promotedIndices: [], stale: true });
    });

    it("should report the error for the head oid it failed on", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.fail(PR, OID_A, "CLI timed out");

      expect(store.getState(PR, OID_A)).toEqual({ status: "error", text: "CLI timed out" });
    });

    it("should reset a failure to idle after a push instead of blaming the new commits", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.fail(PR, OID_A, "CLI timed out");

      expect(store.getState(PR, OID_B)).toEqual({ status: "idle" });
    });
  });

  describe("isPending", () => {
    it("should expose isPending regardless of the head oid", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);

      expect(store.isPending(PR)).toBe(true);
      const idle = new ReviewStore();
      expect(idle.isPending(PR)).toBe(false);
    });
  });

  describe("markPromoted", () => {
    it("should mark a finding index as promoted and reflect it in getState", () => {
      const store = new ReviewStore();
      const findings = buildFindings(3);
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, findings);

      const promoted = store.markPromoted(PR, OID_A, 1);

      expect(promoted).toBe(true);
      expect(store.getState(PR, OID_A)).toEqual({ status: "done", findings, promotedIndices: [1] });
    });

    it("should be idempotent: promoting the same index twice keeps it once", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, buildFindings(2));

      store.markPromoted(PR, OID_A, 0);
      const secondCall = store.markPromoted(PR, OID_A, 0);

      expect(secondCall).toBe(false);
      expect(store.getState(PR, OID_A).promotedIndices).toEqual([0]);
    });

    it("should refuse an out-of-bounds index", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, buildFindings(1));

      expect(store.markPromoted(PR, OID_A, 5)).toBe(false);
      expect(store.markPromoted(PR, OID_A, -1)).toBe(false);
    });

    it("should refuse a promote against a stale oid", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.completeFindings(PR, OID_A, buildFindings(1));

      expect(store.markPromoted(PR, OID_B, 0)).toBe(false);
    });

    it("should refuse a promote when the done result has no findings (report fallback)", () => {
      const store = new ReviewStore();
      store.begin(PR, OID_A);
      store.completeReport(PR, OID_A, "free text");

      expect(store.markPromoted(PR, OID_A, 0)).toBe(false);
    });

    it("should refuse a promote for a PR with no result at all", () => {
      const store = new ReviewStore();

      expect(store.markPromoted(PR, OID_A, 0)).toBe(false);
    });
  });

  describe("clearResults", () => {
    it("should wipe results and errors but keep in-flight runs pending", () => {
      const store = new ReviewStore();
      store.begin("PR_done", OID_A);
      store.completeFindings("PR_done", OID_A, buildFindings(1));
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
