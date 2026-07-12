import { describe, expect, it } from "vitest";
import { formatPrTabTitle } from "./PrDetailsPanel";

describe("formatPrTabTitle", () => {
  it("should compose repo, title and number", () => {
    expect(formatPrTabTitle({ repo: "acme/repo", title: "A title", number: 42 })).toBe("acme/repo · A title #42");
  });
});
