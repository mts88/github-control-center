import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BriefStore } from "../brief/briefState";
import { DetailsSession } from "./DetailsSession";
import type { IPrDetails, IPullRequest, UpdateBranchMethod } from "../core/types";

/** flushes pending microtasks (promise chains) via a real macrotask tick */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildPr(overrides: Partial<IPullRequest> = {}): IPullRequest {
  return {
    id: "pr1",
    number: 1,
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: "acme/repo",
    author: "octocat",
    isDraft: false,
    createdAt: "2026-01-01T00:00:00Z",
    ciState: "NONE",
    reviewDecision: null,
    viewerReviewState: null,
    headRefName: "feature",
    baseRefOid: "base-oid",
    headRefOid: "head-oid",
    ...overrides,
  };
}

function buildDetails(overrides: Partial<IPrDetails> = {}): IPrDetails {
  return {
    number: 1,
    title: "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: "acme/repo",
    author: "octocat",
    authorAvatarUrl: "",
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-01-01T00:00:00Z",
    bodyHtml: "<p>body</p>",
    baseRefName: "main",
    headRefName: "feature",
    headRepo: "acme/repo",
    isBehindBase: false,
    commitsCount: 1,
    changedFiles: 1,
    additions: 1,
    deletions: 0,
    labels: [],
    mergeable: "MERGEABLE",
    mergeMethods: ["SQUASH", "MERGE", "REBASE"],
    reviewDecision: null,
    viewerDidAuthor: false,
    reviewers: [],
    checks: [],
    checksTotal: 0,
    timeline: [],
    timelineTruncated: false,
    ...overrides,
  };
}

function buildPanel() {
  return {
    showLoading: vi.fn(),
    showMessage: vi.fn(),
    showDetails: vi.fn(),
    updateDetails: vi.fn(),
    isVisible: true,
    reenableActions: vi.fn(),
  };
}

/** every dep defaults to a harmless resolved mock; tests override only what they exercise. AI
 * detection defaults to unavailable so tests that don't care about the brief feature never race
 * the detectAi microtask against their own assertions. */
function buildDeps() {
  return {
    panel: buildPanel(),
    getSession: vi.fn().mockResolvedValue({ accessToken: "token" }),
    fetchPrDetails: vi.fn().mockResolvedValue(buildDetails()),
    loadPrFiles: vi.fn().mockResolvedValue([]),
    ensurePatches: vi.fn().mockResolvedValue(new Map()),
    briefStore: new BriefStore(),
    persistBriefs: vi.fn(),
    aiConfig: vi.fn().mockReturnValue({ language: "English" }),
    detectAi: vi.fn().mockResolvedValue(false),
    runAiPrompt: vi.fn().mockResolvedValue("## What changed\n- did stuff"),
    addPrComment: vi.fn().mockResolvedValue(undefined),
    submitPrReview: vi.fn().mockResolvedValue(undefined),
    mergePr: vi.fn().mockResolvedValue(undefined),
    markPrReadyForReview: vi.fn().mockResolvedValue(undefined),
    updatePrBranch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    notify: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    promptModal: vi.fn().mockResolvedValue(true),
    log: vi.fn(),
  };
}

/** same as buildDeps but with AI detection resolving available, for brief-lifecycle tests */
function buildAiDeps() {
  const deps = buildDeps();
  deps.detectAi = vi.fn().mockResolvedValue(true);
  return deps;
}

describe("DetailsSession", () => {
  describe("openPrDetails — stale-response guard", () => {
    it("keeps only the latest click's details, dropping a slower earlier fetch", async () => {
      const prA = buildPr({ id: "A" });
      const prB = buildPr({ id: "B" });
      const detailsB = buildDetails({ title: "B details" });
      let resolveA: (details: IPrDetails) => void = () => {};
      const deps = buildDeps();
      deps.fetchPrDetails = vi
        .fn()
        .mockImplementationOnce(() => new Promise<IPrDetails>((resolve) => { resolveA = resolve; }))
        .mockResolvedValueOnce(detailsB);
      const session = new DetailsSession(deps);

      const openA = session.openPrDetails(prA);
      await flush(); // let A's chain reach (and hang inside) fetchPrDetails while it's still request id 1
      await session.openPrDetails(prB); // request id becomes 2, resolves immediately
      resolveA(buildDetails({ title: "A details" })); // late arrival for the now-stale request id 1
      await openA;

      expect(deps.panel.showDetails).toHaveBeenCalledTimes(1);
      expect(deps.panel.showDetails.mock.calls[0][0]).toBe(detailsB);
    });
  });

  describe("refreshOpenDetails — canSilentlyUpdatePanel guards", () => {
    it("does nothing when no PR is open", async () => {
      const deps = buildDeps();
      const session = new DetailsSession(deps);

      await session.refreshOpenDetails();

      expect(deps.fetchPrDetails).not.toHaveBeenCalled();
    });

    it("skips when the panel is hidden", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = false;

      await session.refreshOpenDetails();

      expect(deps.fetchPrDetails).toHaveBeenCalledTimes(1); // only the initial open, none for refresh
    });

    it("skips while a mutation is in flight", async () => {
      const pr = buildPr();
      let resolveMutation: () => void = () => {};
      const deps = buildDeps();
      deps.addPrComment = vi.fn(() => new Promise<void>((resolve) => { resolveMutation = resolve; }));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;

      session.handleMessage({ command: "comment", text: "hello" });
      await flush(); // runPrMutation reaches its pending mutate() await; mutationInFlight is now true

      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).not.toHaveBeenCalled();

      resolveMutation();
      await flush();
    });

    it("skips while a confirmation modal is open", async () => {
      const pr = buildPr();
      let resolveModal: (choice: boolean) => void = () => {};
      const deps = buildDeps();
      deps.promptModal = vi.fn(() => new Promise<boolean>((resolve) => { resolveModal = resolve; }));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;

      session.handleMessage({ command: "review", event: "APPROVE", text: "" });
      await flush(); // confirmAction is awaiting the pending modal; confirmModalOpen is now true

      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).not.toHaveBeenCalled();

      resolveModal(false);
      await flush();
    });

    it("skips while the composer holds a draft", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;
      session.handleMessage({ command: "composerState", hasText: true });

      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).not.toHaveBeenCalled();
    });

    it("renders when the fetched details changed", async () => {
      const pr = buildPr();
      const updated = buildDetails({ title: "New" });
      const deps = buildDeps();
      deps.fetchPrDetails = vi.fn().mockResolvedValueOnce(buildDetails()).mockResolvedValueOnce(updated);
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;

      await session.refreshOpenDetails();

      expect(deps.panel.updateDetails).toHaveBeenCalledWith(updated, undefined);
    });

    it("skips the re-render when the fetched snapshot is unchanged", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      deps.fetchPrDetails = vi.fn().mockResolvedValueOnce(buildDetails()).mockResolvedValueOnce(buildDetails());
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;

      await session.refreshOpenDetails();

      expect(deps.panel.updateDetails).not.toHaveBeenCalled();
    });
  });

  describe("handleMessage — composerState bypass (redteam High-1)", () => {
    it("still tracks composerState while a mutation is in flight, unblocking once it fails", async () => {
      const pr = buildPr();
      let rejectMutation: (error: Error) => void = () => {};
      const deps = buildDeps();
      deps.addPrComment = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectMutation = reject; }));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;

      session.handleMessage({ command: "comment", text: "hello" });
      await flush(); // mutationInFlight is now true, addPrComment is pending

      // typing arrives mid-mutation — must still be tracked despite the mutationInFlight guard
      session.handleMessage({ command: "composerState", hasText: true });

      rejectMutation(new Error("network error"));
      await flush(); // failure path: no auto re-open, so composerHasText isn't reset by anything else

      // composerHasText is now the ONLY guard that could block a refresh; if composerState had
      // been dropped by the mutationInFlight gate, it would still be false and this would proceed
      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).not.toHaveBeenCalled();
    });
  });

  describe("handleMessage — merge/update method allowlist (redteam High-2)", () => {
    it("rejects a merge method the repo doesn't allow", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      deps.fetchPrDetails = vi.fn().mockResolvedValue(buildDetails({ mergeMethods: ["SQUASH"] }));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);

      session.handleMessage({ command: "merge", method: "REBASE" });
      await flush();

      expect(deps.mergePr).not.toHaveBeenCalled();
      expect(deps.panel.reenableActions).toHaveBeenCalled();
    });

    it("rejects an update-branch method outside the known set", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);

      // an out-of-enum value, mirroring an untrusted/buggy webview payload
      session.handleMessage({ command: "updateBranch", method: "SQUASH" as unknown as UpdateBranchMethod });
      await flush();

      expect(deps.updatePrBranch).not.toHaveBeenCalled();
      expect(deps.panel.reenableActions).toHaveBeenCalled();
    });
  });

  describe("AI brief lifecycle", () => {
    it("does nothing when AI is unavailable", async () => {
      const pr = buildPr();
      const deps = buildDeps(); // detectAi defaults to unavailable
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);

      session.handleMessage({ command: "brief" });
      await flush();

      expect(deps.runAiPrompt).not.toHaveBeenCalled();
    });

    it("refuses a brief click racing a PR switch", async () => {
      const prA = buildPr({ id: "A" });
      const prB = buildPr({ id: "B" });
      let resolveB: (details: IPrDetails) => void = () => {};
      const deps = buildAiDeps();
      deps.fetchPrDetails = vi
        .fn()
        .mockResolvedValueOnce(buildDetails())
        .mockImplementationOnce(() => new Promise<IPrDetails>((resolve) => { resolveB = resolve; }));
      const session = new DetailsSession(deps);

      await session.openPrDetails(prA); // currentDetails now paired with "A"
      await flush(); // aiAvailable settles true

      void session.openPrDetails(prB); // currentDetailsPr moves to "B"; its fetch is still pending
      await flush();

      session.handleMessage({ command: "brief" }); // resolves pr internally to "B"
      await flush();

      expect(deps.runAiPrompt).not.toHaveBeenCalled();

      resolveB(buildDetails());
      await flush();
    });

    it("does not start a second brief run while one is pending", async () => {
      const pr = buildPr();
      let resolveRun: (text: string) => void = () => {};
      const deps = buildAiDeps();
      deps.runAiPrompt = vi.fn(() => new Promise<string>((resolve) => { resolveRun = resolve; }));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush();

      session.handleMessage({ command: "brief" });
      await flush();
      session.handleMessage({ command: "brief" }); // second click while pending
      await flush();

      expect(deps.runAiPrompt).toHaveBeenCalledTimes(1);

      resolveRun("## What changed\n- x");
      await flush();
    });

    it("reuses an existing summary for the same head oid without calling the CLI again", async () => {
      const pr = buildPr();
      const deps = buildAiDeps();
      deps.briefStore.complete(pr.id, pr.headRefOid, "cached summary");
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush();

      session.handleMessage({ command: "brief" });
      await flush();

      expect(deps.runAiPrompt).not.toHaveBeenCalled();
    });

    it("persists the brief only after it completes, not after it fails", async () => {
      const pr = buildPr();
      const deps = buildAiDeps();
      deps.runAiPrompt = vi.fn().mockRejectedValue(new Error("cli failed"));
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush();

      session.handleMessage({ command: "brief" });
      await flush();

      expect(deps.persistBriefs).not.toHaveBeenCalled();
      expect(deps.briefStore.getState(pr.id, pr.headRefOid).status).toBe("error");
    });

    it("persists the brief after a successful run", async () => {
      const pr = buildPr();
      const deps = buildAiDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush();

      session.handleMessage({ command: "brief" });
      await flush();

      expect(deps.persistBriefs).toHaveBeenCalledTimes(1);
      expect(deps.briefStore.getState(pr.id, pr.headRefOid)).toEqual({ status: "done", text: "## What changed\n- did stuff" });
    });
  });

  describe("openPrDetails / runPrMutation — composer flag resets (redteam Medium-1/3)", () => {
    it("drops a leftover composer flag from a previous PR when a new PR opens", async () => {
      const prA = buildPr({ id: "A" });
      const prB = buildPr({ id: "B" });
      const deps = buildDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(prA);
      deps.panel.isVisible = true;
      session.handleMessage({ command: "composerState", hasText: true });

      await session.openPrDetails(prB);
      deps.panel.isVisible = true;

      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).toHaveBeenCalled(); // proves composerHasText was reset, not leaked from A
    });

    it("resets the composer flag when a mutation is attempted while signed out", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      deps.getSession = vi
        .fn()
        .mockResolvedValueOnce({ accessToken: "token" }) // for openPrDetails
        .mockResolvedValueOnce(undefined) // for the mutation attempt: signed out
        .mockResolvedValue({ accessToken: "token" }); // back to normal for the verification refresh
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      deps.panel.isVisible = true;
      session.handleMessage({ command: "composerState", hasText: true });

      session.handleMessage({ command: "comment", text: "hello" });
      await flush();

      expect(deps.panel.showMessage).toHaveBeenCalledWith(expect.any(String), "Sign in to GitHub to act on pull requests.");

      deps.fetchPrDetails.mockClear();
      await session.refreshOpenDetails();
      expect(deps.fetchPrDetails).toHaveBeenCalled(); // composer flag was reset, not left stuck true
    });
  });

  describe("onPollSnapshot — re-point ordering (redteam R2)", () => {
    it("re-points the open PR before refreshing, so the brief lookup uses the fresh head oid", async () => {
      const pr = buildPr({ id: "A", headRefOid: "old-oid" });
      const freshPr = buildPr({ id: "A", headRefOid: "new-oid" });
      const deps = buildAiDeps();
      deps.briefStore.complete("A", "new-oid", "fresh summary");
      const differentDetails = buildDetails({ title: "changed" });
      deps.fetchPrDetails = vi.fn().mockResolvedValueOnce(buildDetails()).mockResolvedValueOnce(differentDetails);
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush(); // aiAvailable settles true
      deps.panel.isVisible = true;

      session.onPollSnapshot([freshPr]);
      await session.refreshOpenDetails();

      expect(deps.panel.updateDetails).toHaveBeenCalledWith(differentDetails, { status: "done", text: "fresh summary" });
    });
  });

  describe("clearBriefCache", () => {
    it("wipes the cached summary and re-renders the open panel", async () => {
      const pr = buildPr();
      const deps = buildAiDeps();
      deps.briefStore.complete(pr.id, pr.headRefOid, "cached summary");
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);
      await flush(); // aiAvailable settles true
      deps.panel.isVisible = true;
      deps.panel.updateDetails.mockClear();

      session.clearBriefCache();

      expect(deps.briefStore.getState(pr.id, pr.headRefOid)).toEqual({ status: "idle" });
      expect(deps.persistBriefs).toHaveBeenCalled();
      expect(deps.panel.updateDetails).toHaveBeenCalledWith(expect.anything(), { status: "idle" });
    });
  });

  describe("dispose", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("cancels the pending post-mutation catch-up refresh", async () => {
      const pr = buildPr();
      const deps = buildDeps();
      const session = new DetailsSession(deps);
      await session.openPrDetails(pr);

      session.handleMessage({ command: "readyForReview" });
      await vi.advanceTimersByTimeAsync(0); // let the mutation's own awaits settle
      const callsBeforeDispose = deps.refresh.mock.calls.length;

      session.dispose();
      await vi.advanceTimersByTimeAsync(5_000); // past the 3s catch-up delay

      expect(deps.refresh.mock.calls.length).toBe(callsBeforeDispose);
    });
  });
});
