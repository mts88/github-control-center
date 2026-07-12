import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./errors";

describe("toErrorMessage", () => {
  it("should return the message for an Error instance", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("should stringify a non-Error value", () => {
    expect(toErrorMessage("boom")).toBe("boom");
    expect(toErrorMessage(42)).toBe("42");
  });
});
