import { describe, expect, it } from "vitest";
import { syncThreads } from "./threadSync";
import type { IReviewThread } from "../core/types";

function buildThread(id: string): IReviewThread {
  return {
    id,
    path: "src/app.ts",
    line: 10,
    startLine: null,
    side: "RIGHT",
    startSide: null,
    isResolved: false,
    isOutdated: false,
    subjectType: "LINE",
    comments: [],
  };
}

describe("syncThreads", () => {
  it("should create all threads when none exist", () => {
    const incoming = [buildThread("RT_1"), buildThread("RT_2")];

    const plan = syncThreads([], incoming);

    expect(plan).toEqual({ create: incoming, update: [], removeIds: [] });
  });

  it("should update threads whose id already exists", () => {
    const incoming = [buildThread("RT_1")];

    const plan = syncThreads(["RT_1"], incoming);

    expect(plan).toEqual({ create: [], update: incoming, removeIds: [] });
  });

  it("should remove threads that disappeared from the server", () => {
    const plan = syncThreads(["RT_1", "RT_2"], []);

    expect(plan).toEqual({ create: [], update: [], removeIds: ["RT_1", "RT_2"] });
  });

  it("should split a mixed snapshot into create, update and remove", () => {
    const kept = buildThread("RT_1");
    const added = buildThread("RT_3");

    const plan = syncThreads(["RT_1", "RT_2"], [kept, added]);

    expect(plan).toEqual({ create: [added], update: [kept], removeIds: ["RT_2"] });
  });
});
