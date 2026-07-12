import { beforeEach, describe, expect, it } from "vitest";
import { PollScheduler } from "./PollScheduler";

describe("PollScheduler", () => {
  let scheduler: PollScheduler;

  beforeEach(() => {
    scheduler = new PollScheduler();
  });

  it("should use the base interval with no failures yet", () => {
    expect(scheduler.nextDelay()).toBe(150_000);
  });

  it("should double the delay on each consecutive failure", () => {
    scheduler.recordFailure();
    expect(scheduler.nextDelay()).toBe(300_000);

    scheduler.recordFailure();
    expect(scheduler.nextDelay()).toBe(600_000);
  });

  it("should cap the delay instead of growing unbounded", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      scheduler.recordFailure();
    }

    expect(scheduler.nextDelay()).toBe(1_200_000);
  });

  it("should reset to the base interval on success after failures", () => {
    scheduler.recordFailure();
    scheduler.recordFailure();

    scheduler.recordSuccess();

    expect(scheduler.nextDelay()).toBe(150_000);
  });
});
