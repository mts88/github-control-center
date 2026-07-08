import { beforeEach, describe, expect, it } from "vitest";
import { NewPrTracker } from "./NewPrTracker";
import type { IPullRequest } from "./types";

function buildPr(id: string): IPullRequest {
  return { id, title: `PR ${id}` } as IPullRequest;
}

describe("NewPrTracker", () => {
  let tracker: NewPrTracker;

  beforeEach(() => {
    tracker = new NewPrTracker();
  });

  describe("first fetch after activation", () => {
    it("should return no PRs to notify, even when PRs are present", () => {
      const result = tracker.track([buildPr("a"), buildPr("b")]);

      expect(result).toEqual([]);
    });

    it("should seed even when the first fetch is empty", () => {
      tracker.track([]);

      const result = tracker.track([buildPr("a")]);

      expect(result.map((pr) => pr.id)).toEqual(["a"]);
    });
  });

  describe("subsequent fetches", () => {
    beforeEach(() => {
      tracker.track([buildPr("a")]);
    });

    it("should return only the PRs unseen so far", () => {
      const result = tracker.track([buildPr("a"), buildPr("b")]);

      expect(result.map((pr) => pr.id)).toEqual(["b"]);
    });

    it("should NOT notify the same PR twice", () => {
      tracker.track([buildPr("a"), buildPr("b")]);

      const result = tracker.track([buildPr("a"), buildPr("b")]);

      expect(result).toEqual([]);
    });

    it("should stay silent when a previously seen PR reappears after leaving the list", () => {
      tracker.track([]);

      const result = tracker.track([buildPr("a")]);

      expect(result).toEqual([]);
    });
  });
});
