const BASE_INTERVAL_MS = 150_000;
// ponytail: hard cap at ~20min backoff — plenty for a personal rate-limit hiccup, no need for jitter
const MAX_INTERVAL_MS = 1_200_000;

/**
 * Pure poll cadence tracker (no vscode import, mirrors NewPrTracker): counts consecutive
 * failures and derives the next delay via exponential backoff. Owns no timer itself —
 * extension.ts reads nextDelay() to reschedule its setTimeout.
 */
export class PollScheduler {
  private consecutiveFailures = 0;

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
  }

  nextDelay(): number {
    const delay = BASE_INTERVAL_MS * 2 ** this.consecutiveFailures;
    return Math.min(delay, MAX_INTERVAL_MS);
  }
}
