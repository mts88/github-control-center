import { describe, expect, it } from "vitest";
import { isRepoMuted } from "./muting";

describe("isRepoMuted", () => {
  it("should match an exact owner/repo entry, case-insensitively", () => {
    expect(isRepoMuted("Acme/Repo", ["acme/repo"])).toBe(true);
    expect(isRepoMuted("acme/repo", ["acme/other"])).toBe(false);
  });

  it("should mute the whole organization with a bare owner entry", () => {
    expect(isRepoMuted("acme/repo", ["acme"])).toBe(true);
    expect(isRepoMuted("other/repo", ["acme"])).toBe(false);
  });

  it("should mute the whole organization with an owner/* entry", () => {
    expect(isRepoMuted("acme/repo", ["Acme/*"])).toBe(true);
  });

  it("should ignore surrounding whitespace in entries", () => {
    expect(isRepoMuted("acme/repo", ["  acme/repo  "])).toBe(true);
  });

  it("should not treat a repo entry as an owner prefix", () => {
    expect(isRepoMuted("acme/repo-extended", ["acme/repo"])).toBe(false);
  });
});
