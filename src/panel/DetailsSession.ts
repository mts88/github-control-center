import { buildBriefPrompt, buildBriefSystemPrompt } from "../brief/briefPrompt";
import type { BriefStore } from "../brief/briefState";
import { toErrorMessage } from "../core/errors";
import { MERGE_METHOD_LABELS, UPDATE_METHOD_LABELS } from "./PrDetailsHtml";
import { formatPrTabTitle, type IPanelMessage } from "./PrDetailsPanel";
import type { IBriefState, IPrDetails, IPrFile, IPrFilePatch, IPullRequest, MergeMethod, UpdateBranchMethod } from "../core/types";

// GitHub reads lag behind writes: one delayed catch-up refresh after each successful mutation
const POST_MUTATION_REFRESH_DELAY_MS = 3_000;

/** the details panel's own subset of PrDetailsPanel, structurally satisfied by the real class */
export interface IDetailsSessionPanel {
  showLoading(title: string): void;
  showMessage(title: string, message: string): void;
  showDetails(details: IPrDetails, brief?: IBriefState): void;
  updateDetails(details: IPrDetails, brief?: IBriefState): void;
  readonly isVisible: boolean;
  reenableActions(): void;
}

export interface IDetailsSessionDeps {
  panel: IDetailsSessionPanel;
  getSession(createIfNone: boolean): PromiseLike<{ accessToken: string } | undefined>;
  fetchPrDetails(token: string, prId: string, headRefName: string): Promise<IPrDetails>;
  loadPrFiles(pr: IPullRequest): Promise<IPrFile[]>;
  ensurePatches(pr: IPullRequest): Promise<Map<string, IPrFilePatch>>;
  /** the single BriefStore instance owned by extension.ts (hydrated from context.globalState) — never construct a second one */
  briefStore: BriefStore;
  persistBriefs(): void;
  aiConfig(): { language: string };
  detectAi(): Promise<boolean>;
  runAiPrompt(systemPrompt: string, prompt: string): Promise<string>;
  addPrComment(token: string, prId: string, body: string): Promise<void>;
  submitPrReview(token: string, prId: string, event: "APPROVE" | "REQUEST_CHANGES", body: string): Promise<void>;
  mergePr(token: string, prId: string, method: MergeMethod): Promise<void>;
  markPrReadyForReview(token: string, prId: string): Promise<void>;
  updatePrBranch(token: string, prId: string, method: UpdateBranchMethod): Promise<void>;
  checkout(repo: string, headRefName: string): Promise<void>;
  refresh(): Promise<void>;
  notify: {
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
  /** wraps a modal confirmation; resolves true only when the user picked `action` */
  promptModal(message: string, action: string): Promise<boolean>;
  log(message: string): void;
}

type IDispatchableMessage = Exclude<IPanelMessage, { command: "composerState" }>;

/**
 * Owns the open PR-details-panel state: which PR is showing, its details/brief pairing, the
 * mutation/confirm-modal/composer guards that gate silent background re-renders, and the AI
 * brief lifecycle. No vscode import (deps are injected, like ReviewController) so the guard
 * logic — previously only exercised by hand in the Extension Development Host — is unit-testable.
 */
export class DetailsSession {
  private currentDetailsPr: IPullRequest | undefined;
  // paired with the PR it belongs to: currentDetailsPr can move (poll re-point) while a fetch is
  // still in flight, so anything combining details with PR data must check the prId matches
  private currentDetails: { prId: string; details: IPrDetails } | undefined;
  // JSON of the brief state last drawn into the panel: silent refreshes redraw when either the
  // details or the brief changed — comparing details alone would strand a finished brief
  private lastRenderedBrief: string | undefined;
  private detailsRequestSequence = 0;
  private mutationInFlight = false;
  // a confirmation modal is open: the webview has already frozen its buttons but mutationInFlight
  // is not set yet — a silent re-render here would unfreeze them under the still-open dialog
  private confirmModalOpen = false;
  // background refreshes are skipped while a draft comment sits in the composer: a full HTML
  // replace would wipe it
  private composerHasText = false;
  private postMutationTimer: ReturnType<typeof setTimeout> | undefined;
  // AI brief state: features hide entirely when the claude CLI is not on this machine
  private aiAvailable = false;
  // detection is lazy: the first PR panel open probes the CLI, so a window that never opens one
  // pays no `claude --version` spawn at startup
  private aiDetectionStarted = false;
  // only the newest detection may write aiAvailable: a slow stale probe must never overwrite the
  // result of a newer config (same pattern as detailsRequestSequence)
  private aiDetectSequence = 0;

  constructor(private readonly deps: IDetailsSessionDeps) {}

  async openPrDetails(pr: IPullRequest): Promise<void> {
    this.currentDetailsPr = pr;
    this.ensureAiDetected(); // first panel open triggers the one-time CLI probe
    this.composerHasText = false; // every user-initiated render starts from an empty composer
    const requestId = ++this.detailsRequestSequence;
    this.deps.panel.showLoading(formatPrTabTitle(pr));
    const session = await this.deps.getSession(false);
    if (requestId !== this.detailsRequestSequence) {
      return;
    }
    if (!session) {
      this.deps.panel.showMessage(formatPrTabTitle(pr), "Sign in to GitHub to load pull request details.");
      return;
    }
    try {
      const details = await this.deps.fetchPrDetails(session.accessToken, pr.id, pr.headRefName);
      if (requestId === this.detailsRequestSequence) {
        this.presentDetails(pr, details, "reveal");
      }
    } catch (error) {
      if (requestId === this.detailsRequestSequence) {
        this.deps.panel.showMessage(formatPrTabTitle(pr), `Failed to load pull request details: ${toErrorMessage(error)}`);
      }
    }
  }

  // background counterpart of openPrDetails, run on every poll cycle via onPollSnapshot: it reads
  // the request sequence without bumping it (a user click mid-fetch always wins), never reveals
  // the panel, and failures stay silent — the last good render must survive
  async refreshOpenDetails(): Promise<void> {
    const pr = this.currentDetailsPr;
    if (!pr || !this.canSilentlyUpdatePanel()) {
      return;
    }
    const requestId = this.detailsRequestSequence;
    const session = await this.deps.getSession(false);
    if (!session || requestId !== this.detailsRequestSequence) {
      return;
    }
    try {
      const details = await this.deps.fetchPrDetails(session.accessToken, pr.id, pr.headRefName);
      if (requestId !== this.detailsRequestSequence || !this.canSilentlyUpdatePanel()) {
        return;
      }
      const detailsUnchanged = JSON.stringify(details) === JSON.stringify(this.currentDetails?.details);
      const briefUnchanged = JSON.stringify(this.currentBriefState(pr)) === this.lastRenderedBrief;
      if (detailsUnchanged && briefUnchanged) {
        return; // unchanged snapshot: skip the re-render, a full HTML replace resets the scroll
      }
      this.presentDetails(pr, details, "silent");
    } catch (error) {
      this.deps.log(`[${new Date().toISOString()}] Details refresh failed: ${toErrorMessage(error)}`);
    }
  }

  // called every poll cycle with the fresh raw (pre-filter) snapshot: re-points the open-panel PR
  // at its fresh entry — without this, headRefOid would freeze at click time and a push would keep
  // serving the stale brief cache key. Only re-points; the caller still calls refreshOpenDetails()
  // itself afterward (unconditionally, even when the poll's own fetch failed and never reaches
  // this method — its own independent fetch is not tied to the poll's success or failure).
  onPollSnapshot(allPrs: IPullRequest[]): void {
    if (this.currentDetailsPr) {
      const openPrId = this.currentDetailsPr.id;
      this.currentDetailsPr = allPrs.find((pr) => pr.id === openPrId) ?? this.currentDetailsPr;
    }
  }

  // single entry point for the webview's messages. composerState is intercepted here,
  // unconditionally, BEFORE the mutation-in-flight guard: typing during a mutation must still
  // update the flag, or a background refresh could wipe an active draft while it looks idle.
  handleMessage(message: IPanelMessage): void {
    if (message.command === "composerState") {
      this.composerHasText = message.hasText;
      return;
    }
    const pr = this.currentDetailsPr;
    if (!pr || this.mutationInFlight) {
      return;
    }
    void this.dispatchMessage(pr, message);
  }

  // config-change listener counterpart of ensureAiDetected: only re-probes if detection has
  // already started at least once — a backend/command change before any panel ever opened must
  // stay lazy, matching ensureAiDetected's own gate
  refreshAiAvailabilityIfStarted(): void {
    if (this.aiDetectionStarted) {
      this.refreshAiAvailability();
    }
  }

  // escape hatch for regenerating briefs: prompt/language changes don't touch the cache key
  clearBriefCache(): void {
    this.deps.briefStore.clearResults();
    this.deps.persistBriefs();
    if (this.currentDetailsPr) {
      this.rerenderBriefFor(this.currentDetailsPr.id);
    }
  }

  dispose(): void {
    clearTimeout(this.postMutationTimer);
  }

  // the single exit point for rendering the panel: it keeps details paired with their PR and
  // records the drawn brief state so silent refreshes can tell when a redraw is actually needed
  private presentDetails(pr: IPullRequest, details: IPrDetails, mode: "reveal" | "silent"): void {
    const brief = this.currentBriefState(pr);
    this.currentDetails = { prId: pr.id, details };
    this.lastRenderedBrief = JSON.stringify(brief);
    if (mode === "reveal") {
      this.deps.panel.showDetails(details, brief);
    } else {
      this.deps.panel.updateDetails(details, brief);
    }
  }

  // one shared guard for every silent re-render: never a hidden panel, never during a mutation,
  // never over a composer draft (a full HTML replace would wipe it)
  private canSilentlyUpdatePanel(): boolean {
    return this.deps.panel.isVisible && !this.mutationInFlight && !this.confirmModalOpen && !this.composerHasText;
  }

  // a modal confirmation freezes the webview buttons; hold the silent-render guard for its whole
  // lifetime so a brief completing mid-dialog cannot re-render and unfreeze them
  private async confirmAction(message: string, action: string): Promise<boolean> {
    this.confirmModalOpen = true;
    try {
      return await this.deps.promptModal(message, action);
    } finally {
      this.confirmModalOpen = false;
    }
  }

  private currentBriefState(pr: IPullRequest): IBriefState | undefined {
    if (!this.aiAvailable) {
      return undefined;
    }
    return this.deps.briefStore.getState(pr.id, pr.headRefOid);
  }

  // re-render carrying the current brief state, under the same guards as refreshOpenDetails:
  // never another PR's panel, never over a composer draft, never during a mutation
  private rerenderBriefFor(prId: string): void {
    const pr = this.currentDetailsPr;
    if (!pr || pr.id !== prId || !this.currentDetails || this.currentDetails.prId !== pr.id) {
      return;
    }
    if (!this.canSilentlyUpdatePanel()) {
      // the summary waits in the cache. Never unfreeze while a mutation runs or a confirmation
      // modal is open: the webview would accept a second merge click on buttons it froze
      if (!this.mutationInFlight && !this.confirmModalOpen) {
        this.deps.panel.reenableActions();
      }
      return;
    }
    if (JSON.stringify(this.currentBriefState(pr)) === this.lastRenderedBrief) {
      return; // nothing new to draw: an identical full re-render would only reset the scroll
    }
    this.presentDetails(pr, this.currentDetails.details, "silent");
  }

  private async handleBriefRequest(pr: IPullRequest): Promise<void> {
    const details = this.currentDetails;
    // details must belong to the requesting PR: a brief click racing a PR switch would otherwise
    // mix one PR's description with another's patches and cache the result
    if (!this.aiAvailable || !details || details.prId !== pr.id || this.deps.briefStore.isPending(pr.id)) {
      return;
    }
    if (this.deps.briefStore.hasSummary(pr.id, pr.headRefOid)) {
      this.rerenderBriefFor(pr.id); // cache hit: instant, no CLI run, no quota burned
      return;
    }
    this.deps.briefStore.begin(pr.id, pr.headRefOid);
    this.rerenderBriefFor(pr.id); // shows "Summarizing…"
    try {
      const [files, patches] = await Promise.all([this.deps.loadPrFiles(pr), this.deps.ensurePatches(pr)]);
      const config = this.deps.aiConfig();
      const prompt = buildBriefPrompt(details.details, files, patches);
      const summary = await this.deps.runAiPrompt(buildBriefSystemPrompt(config.language), prompt);
      this.deps.briefStore.complete(pr.id, pr.headRefOid, summary);
      this.deps.persistBriefs();
    } catch (error) {
      this.deps.briefStore.fail(pr.id, pr.headRefOid, toErrorMessage(error));
      this.deps.log(`[${new Date().toISOString()}] Brief failed: ${toErrorMessage(error)}`);
    } finally {
      this.rerenderBriefFor(pr.id);
    }
  }

  private async runPrMutation(pr: IPullRequest, actionLabel: string, successMessage: string, mutate: (token: string) => Promise<void>): Promise<void> {
    const session = await this.deps.getSession(false);
    if (!session) {
      this.composerHasText = false; // this render drops the composer too
      this.deps.panel.showMessage(formatPrTabTitle(pr), "Sign in to GitHub to act on pull requests.");
      return;
    }
    this.mutationInFlight = true;
    try {
      await mutate(session.accessToken);
      this.deps.notify.info(successMessage);
      void this.deps.refresh();
      void this.openPrDetails(pr);
      // GitHub reads lag behind writes (search index, review decision): the immediate refreshes
      // above often return stale data, so schedule one delayed catch-up pass
      clearTimeout(this.postMutationTimer);
      this.postMutationTimer = setTimeout(() => void this.deps.refresh(), POST_MUTATION_REFRESH_DELAY_MS);
    } catch (error) {
      this.deps.notify.error(`${actionLabel} failed: ${toErrorMessage(error)}`);
      this.deps.panel.reenableActions();
    } finally {
      this.mutationInFlight = false;
    }
  }

  private async dispatchMessage(pr: IPullRequest, message: IDispatchableMessage): Promise<void> {
    switch (message.command) {
      case "comment": {
        const commentText = message.text.trim();
        if (!commentText) {
          this.deps.panel.reenableActions();
          return;
        }
        await this.runPrMutation(pr, "Comment", `Comment posted on: ${pr.title}`, (token) => this.deps.addPrComment(token, pr.id, commentText));
        return;
      }
      case "review": {
        const isRequestingChanges = message.event === "REQUEST_CHANGES";
        const reviewText = message.text.trim();
        if (isRequestingChanges && !reviewText) {
          this.deps.notify.warning("Request changes needs a comment explaining what to change.");
          this.deps.panel.reenableActions();
          return;
        }
        const actionLabel = isRequestingChanges ? "Request changes" : "Approve";
        const successMessage = isRequestingChanges ? `Changes requested on: ${pr.title}` : `Approved: ${pr.title}`;
        const confirmed = await this.confirmAction(`${actionLabel}: "${pr.title}"?`, actionLabel);
        if (!confirmed) {
          this.deps.panel.reenableActions();
          return;
        }
        await this.runPrMutation(pr, actionLabel, successMessage, (token) => this.deps.submitPrReview(token, pr.id, message.event, reviewText));
        return;
      }
      case "merge": {
        // never trust the webview: the method must be one the repo actually allows, and the
        // details it is validated against must belong to this PR (not a mid-switch leftover)
        const openDetails = this.currentDetails?.prId === pr.id ? this.currentDetails.details : undefined;
        const isAllowedMethod = openDetails?.mergeMethods.includes(message.method) ?? false;
        if (!openDetails || !isAllowedMethod) {
          this.deps.panel.reenableActions();
          return;
        }
        const methodLabel = MERGE_METHOD_LABELS[message.method];
        const confirmed = await this.confirmAction(`${methodLabel}: "${pr.title}" into ${openDetails.baseRefName}?`, "Merge");
        if (!confirmed) {
          this.deps.panel.reenableActions();
          return;
        }
        await this.runPrMutation(pr, "Merge", `Merged: ${pr.title}`, (token) => this.deps.mergePr(token, pr.id, message.method));
        return;
      }
      case "readyForReview": {
        await this.runPrMutation(pr, "Ready for review", `Marked as ready for review: ${pr.title}`, (token) => this.deps.markPrReadyForReview(token, pr.id));
        return;
      }
      case "updateBranch": {
        // never trust the webview: only the two known update methods are accepted
        const isKnownMethod = message.method === "REBASE" || message.method === "MERGE";
        if (!isKnownMethod) {
          this.deps.panel.reenableActions();
          return;
        }
        const methodLabel = UPDATE_METHOD_LABELS[message.method];
        await this.runPrMutation(pr, methodLabel, `Branch updated (${message.method.toLowerCase()}): ${pr.title}`, (token) => this.deps.updatePrBranch(token, pr.id, message.method));
        return;
      }
      case "brief": {
        await this.handleBriefRequest(pr);
        return;
      }
      case "checkout": {
        await this.checkoutPrBranch();
        return;
      }
      default: {
        // exhaustiveness guard: a new IPanelMessage variant must be handled above, or this fails to compile
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  }

  private async checkoutPrBranch(): Promise<void> {
    const details = this.currentDetails?.details;
    if (!details) {
      this.deps.panel.reenableActions();
      return;
    }
    if (details.headRepo !== details.repo) {
      // ponytail: cross-fork checkout needs pull/N/head refspecs — use GitHub until it hurts
      this.deps.notify.error("Checkout of cross-fork PRs is not supported. Open the PR on GitHub instead.");
      this.deps.panel.reenableActions();
      return;
    }
    await this.deps.checkout(details.repo, details.headRefName);
    this.deps.panel.reenableActions();
  }

  // probe the CLI once, lazily, on the first panel that could show the brief button
  private ensureAiDetected(): void {
    if (!this.aiDetectionStarted) {
      this.refreshAiAvailability();
    }
  }

  private refreshAiAvailability(): void {
    this.aiDetectionStarted = true;
    const requestId = ++this.aiDetectSequence;
    // backend selection and its own availability (binary found, unknown backend, ...) are
    // extension.ts's concern now — this class only tracks whether *some* backend is ready
    void this.deps.detectAi().then((available) => {
      if (requestId !== this.aiDetectSequence) {
        return; // a newer detection (or a backend switch) owns the flag now
      }
      this.aiAvailable = available;
      if (this.currentDetailsPr) {
        this.rerenderBriefFor(this.currentDetailsPr.id); // the open panel reflects the new availability
      }
    });
  }
}
