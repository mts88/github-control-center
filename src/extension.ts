import * as vscode from "vscode";
import {
  addPrComment,
  fetchFileContent,
  fetchPrDetails,
  fetchPrFilePatches,
  fetchPrFiles,
  fetchPullRequests,
  getSession,
  addReviewThread,
  addReviewThreadReply,
  discardPendingReview,
  markPrReadyForReview,
  mergePr,
  resolveThread,
  searchRepositories,
  setFileViewed,
  submitPendingReview,
  submitPrReview,
  unresolveThread,
  updatePrBranch,
} from "./github";
import { ReviewController, type IPatchKey } from "./ReviewController";
import { detectAi, runAiPrompt } from "./ai";
import { BriefStore, type PersistedBrief } from "./briefState";
import { DetailsSession } from "./DetailsSession";
import { toErrorMessage } from "./errors";
import { toThreadPosition } from "./reviewThreads";
import { applyFilters } from "./filters";
import { NewPrTracker } from "./NewPrTracker";
import { AsyncOidCache } from "./OidCache";
import { PrContentProvider, fromPrUri, toPrUri } from "./PrContentProvider";
import { PrDetailsPanel } from "./PrDetailsPanel";
import { PollScheduler } from "./PollScheduler";
import { PrTreeProvider, type FilesLayout, type IFileNode, type TreeNode } from "./PrTreeProvider";
import { PR_URI_SCHEME } from "./prUri";
import { ReviewDecisionTracker } from "./ReviewDecisionTracker";
import type { IPrFile, IPrFilePatch, IPullRequest } from "./types";

const BRIEF_CACHE_STATE_KEY = "githubControlCenter.briefCache";
// config sections that feed the poll pipeline: an event touching only ai.* keys skips the poll
const NON_AI_SECTIONS = ["badge", "notifications", "mutedRepos", "toReview", "updateBranch", "files"].map(
  (section) => `githubControlCenter.${section}`,
);
// the ai.claude.model enum (mirrors package.json); a value outside it is coerced to the default
const AI_MODELS = new Set(["sonnet", "haiku", "opus", ""]);

// minimal typed surface of the built-in vscode.git extension API
interface IGitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface IGitRepository {
  state: { remotes: IGitRemote[] };
  fetch(remote?: string, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
}

interface IGitExtension {
  getAPI(version: 1): { repositories: IGitRepository[] };
}

function ghccConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("githubControlCenter");
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("GitHub Control Center");
  const fileListCache = new AsyncOidCache<IPrFile[]>();
  const patchCache = new AsyncOidCache<Map<string, IPrFilePatch>>();

  async function requireToken(): Promise<string> {
    const session = await getSession(false);
    if (!session) {
      throw new Error("Sign in to GitHub first");
    }
    return session.accessToken;
  }

  function loadPrFiles(pr: IPullRequest): Promise<IPrFile[]> {
    return fileListCache.load(pr.id, pr.headRefOid, async () => fetchPrFiles(await requireToken(), pr.id));
  }

  function ensurePatches(key: IPatchKey): Promise<Map<string, IPrFilePatch>> {
    return patchCache.load(key.id, key.headRefOid, async () => {
      const patches = await fetchPrFilePatches(await requireToken(), key.repo, key.number);
      return new Map(patches.map((patch) => [patch.path, patch]));
    });
  }

  async function findPatch(key: IPatchKey, path: string): Promise<IPrFilePatch | undefined> {
    const patches = await ensurePatches(key);
    // LEFT-side documents of renamed files carry the pre-rename path
    return patches.get(path) ?? [...patches.values()].find((patch) => patch.previousPath === path);
  }

  const contentProvider = new PrContentProvider(async (ref) => fetchFileContent(await requireToken(), ref.repo, ref.path, ref.sha));

  const pendingStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  function updatePendingStatusBar(pr: IPullRequest | undefined, count: number): void {
    if (!pr || count === 0) {
      pendingStatusBar.hide();
      return;
    }
    pendingStatusBar.text = `$(comment-draft) PR #${pr.number}: ${count} pending`;
    pendingStatusBar.tooltip = `Pending review on ${pr.repo}#${pr.number} — click to submit`;
    pendingStatusBar.command = "githubControlCenter.review.submit";
    pendingStatusBar.show();
  }

  const REVIEW_EVENT_LABELS: Record<string, "COMMENT" | "APPROVE" | "REQUEST_CHANGES"> = {
    Comment: "COMMENT",
    Approve: "APPROVE",
    "Request changes": "REQUEST_CHANGES",
  };

  async function submitActiveReview(): Promise<void> {
    const pr = reviewController.getActivePr();
    if (!pr || reviewController.getPendingReviewId(pr.id) === null) {
      void vscode.window.showInformationMessage("No pending review to submit.");
      return;
    }
    const pickedLabel = await vscode.window.showQuickPick(Object.keys(REVIEW_EVENT_LABELS), {
      placeHolder: `Submit your review of ${pr.repo}#${pr.number}`,
    });
    if (!pickedLabel) {
      return;
    }
    const event = REVIEW_EVENT_LABELS[pickedLabel];
    const body = await vscode.window.showInputBox({
      prompt: event === "REQUEST_CHANGES" ? "Review summary (required to request changes)" : "Review summary (optional)",
      placeHolder: "Leave a summary comment…",
    });
    if (body === undefined) {
      return;
    }
    // GitHub rule: a changes request must carry a body (same gate as the details panel composer)
    if (event === "REQUEST_CHANGES" && !body.trim()) {
      void vscode.window.showWarningMessage("Request changes requires a summary comment.");
      return;
    }
    try {
      await submitPendingReview(await requireToken(), pr.id, event, body.trim());
      void vscode.window.showInformationMessage(`Review submitted on ${pr.repo}#${pr.number}`);
      await reviewController.reload(pr);
      void refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`Submitting the review failed: ${toErrorMessage(error)}`);
    }
  }

  async function discardActiveReview(): Promise<void> {
    const pr = reviewController.getActivePr();
    const pendingReviewId = pr ? reviewController.getPendingReviewId(pr.id) : null;
    if (!pr || pendingReviewId === null) {
      void vscode.window.showInformationMessage("No pending review to discard.");
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Discard your pending review on ${pr.repo}#${pr.number}? All draft comments will be lost.`,
      { modal: true },
      "Discard",
    );
    if (confirmed !== "Discard") {
      return;
    }
    try {
      await discardPendingReview(await requireToken(), pendingReviewId);
      await reviewController.reload(pr);
    } catch (error) {
      void vscode.window.showErrorMessage(`Discarding the review failed: ${toErrorMessage(error)}`);
    }
  }

  const reviewController = new ReviewController({
    getToken: requireToken,
    getPatch: findPatch,
    onPendingChanged: (pr, count) => {
      void vscode.commands.executeCommand("setContext", "githubControlCenter.hasPendingReview", Boolean(pr));
      updatePendingStatusBar(pr, count);
    },
  });

  async function handleAddComment(reply: vscode.CommentReply, postImmediately: boolean): Promise<void> {
    const commentText = reply.text.trim();
    if (!commentText) {
      return;
    }
    const thread = reply.thread;
    const existingRef = reviewController.threadRef(thread);
    try {
      const token = await requireToken();
      if (existingRef) {
        // GitHub semantics: a reply joins the viewer's pending review when one exists
        const pr = reviewController.getPr(existingRef.prId);
        await addReviewThreadReply(token, existingRef.threadId, commentText);
        if (pr) {
          await reviewController.reload(pr);
        }
        return;
      }
      const fileRef = fromPrUri(thread.uri);
      const pr = reviewController.getPr(fileRef.prId);
      if (!pr) {
        return;
      }
      const hasPendingReview = reviewController.getPendingReviewId(pr.id) !== null;
      if (postImmediately && hasPendingReview) {
        void vscode.window.showWarningMessage("You have a pending review on this PR — submit or discard it before posting single comments.");
        return;
      }
      // renamed LEFT documents carry the old path; GitHub threads always address the head path
      const patch = await findPatch(pr, fileRef.path);
      const headPath = patch?.path ?? fileRef.path;
      const position = toThreadPosition(fileRef.side, thread.range?.start.line ?? 0, thread.range?.end.line ?? 0, thread.range === undefined);
      await addReviewThread(token, { prId: pr.id, body: commentText, path: headPath, ...position });
      if (postImmediately) {
        await submitPendingReview(token, pr.id, "COMMENT", "");
      }
      // drop the gutter placeholder: the server truth rematerializes on reload
      thread.dispose();
      await reviewController.reload(pr);
    } catch (error) {
      void vscode.window.showErrorMessage(`Adding the comment failed: ${toErrorMessage(error)}`);
    }
  }

  async function runThreadMutation(thread: vscode.CommentThread, actionLabel: string, mutate: (token: string, threadId: string) => Promise<void>): Promise<void> {
    const ref = reviewController.threadRef(thread);
    const pr = ref && reviewController.getPr(ref.prId);
    if (!ref || !pr) {
      return;
    }
    try {
      await mutate(await requireToken(), ref.threadId);
      await reviewController.reload(pr);
    } catch (error) {
      void vscode.window.showErrorMessage(`${actionLabel} failed: ${toErrorMessage(error)}`);
    }
  }

  async function openFileDiff(node: IFileNode): Promise<void> {
    const { pr, file } = node;
    try {
      reviewController.registerPr(pr);
      // fire-and-forget: threads appear shortly after the diff opens; failures land in the output channel
      reviewController.ensureThreadsForPr(pr).catch((error: unknown) => {
        output.appendLine(`[${new Date().toISOString()}] Review threads load failed: ${toErrorMessage(error)}`);
      });
      // patches must arrive before the URIs: renames need previous_filename for the LEFT path
      const patches = await ensurePatches(pr);
      const previousPath = patches.get(file.path)?.previousPath;
      const shared = { prId: pr.id, repo: pr.repo, prNumber: pr.number, headOid: pr.headRefOid };
      const leftUri = toPrUri({
        ...shared,
        path: previousPath ?? file.path,
        sha: pr.baseRefOid,
        side: "LEFT",
        isEmpty: file.changeType === "ADDED",
      });
      const rightUri = toPrUri({
        ...shared,
        path: file.path,
        sha: pr.headRefOid,
        side: "RIGHT",
        isEmpty: file.changeType === "DELETED",
      });
      const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
      await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, `${basename} (PR #${pr.number})`, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open the diff: ${toErrorMessage(error)}`);
    }
  }

  function getFilesLayout(): FilesLayout {
    return ghccConfig().get<FilesLayout>("files.layout", "tree");
  }

  function publishFilesLayoutContext(): void {
    void vscode.commands.executeCommand("setContext", "githubControlCenter.filesLayout", getFilesLayout());
  }

  const toReviewProvider = new PrTreeProvider(loadPrFiles, getFilesLayout);
  const mineProvider = new PrTreeProvider(loadPrFiles, getFilesLayout);
  const toReviewView = vscode.window.createTreeView("githubControlCenter.toReview", { treeDataProvider: toReviewProvider });
  const mineView = vscode.window.createTreeView("githubControlCenter.mine", { treeDataProvider: mineProvider });

  function handleCheckboxChange(event: vscode.TreeCheckboxChangeEvent<TreeNode>): void {
    for (const [node, checkboxState] of event.items) {
      if (node.kind !== "file") {
        continue;
      }
      const viewed = checkboxState === vscode.TreeItemCheckboxState.Checked;
      const previousState = node.file.viewedState;
      // optimistic: node.file is the same object held by the oid cache, so the state survives tree refreshes
      node.file.viewedState = viewed ? "VIEWED" : "UNVIEWED";
      void (async () => {
        try {
          await setFileViewed(await requireToken(), node.pr.id, node.file.path, viewed);
        } catch (error) {
          node.file.viewedState = previousState;
          toReviewProvider.refresh();
          mineProvider.refresh();
          void vscode.window.showErrorMessage(`Updating the viewed state failed: ${toErrorMessage(error)}`);
        }
      })();
    }
  }
  const newPrTracker = new NewPrTracker();
  const reviewDecisionTracker = new ReviewDecisionTracker();
  const detailsPanel = new PrDetailsPanel(context.extensionUri);
  // repos seen in the last raw snapshot (pre-filter, so muted ones stay unmutable from the picker)
  let knownRepos = new Set<string>();
  // results are pinned to the head oid — a push invalidates naturally. Hydrated from globalState
  // so a window reload keeps the briefs — local only (never setKeysForSync: PR content)
  const briefStore = new BriefStore(context.globalState.get<PersistedBrief[]>(BRIEF_CACHE_STATE_KEY, []));

  function persistBriefs(): void {
    void context.globalState.update(BRIEF_CACHE_STATE_KEY, briefStore.serialize());
  }

  function aiConfig(): { backend: string; command: string; model: string; language: string } {
    const config = ghccConfig();
    // model reaches `claude --model` on the (win32, shell:true) command line; keep it inside the
    // known enum so a stray value can never carry shell metacharacters into the spawn
    const rawModel = config.get<string>("ai.claude.model", "sonnet");
    const model = AI_MODELS.has(rawModel) ? rawModel : "sonnet";
    return {
      backend: config.get<string>("ai.backend", "claude-code"),
      command: config.get<string>("ai.claude.command", "claude"),
      model,
      language: config.get<string>("ai.language", "English"),
    };
  }

  function openPr(target: string | TreeNode): void {
    // string from the webview flow, TreeNode when invoked from the inline tree icon
    const url = typeof target === "string" ? target : target.kind === "pr" ? target.pr.url : undefined;
    if (url) {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async function addMutedEntry(entry: string): Promise<void> {
    const config = ghccConfig();
    const mutedEntries = config.get<string[]>("mutedRepos", []);
    const isAlreadyMuted = mutedEntries.some((existing) => existing.trim().toLowerCase() === entry.toLowerCase());
    if (!isAlreadyMuted) {
      // the config-change listener refreshes lists, badge and trackers
      await config.update("mutedRepos", [...mutedEntries, entry], vscode.ConfigurationTarget.Global);
    }
  }

  interface IMuteQuickPickItem extends vscode.QuickPickItem {
    entry: string;
    action: "mute" | "unmute";
  }

  function manageMutedRepos(): void {
    const quickPick = vscode.window.createQuickPick<IMuteQuickPickItem>();
    quickPick.placeholder = "Type to search GitHub repositories — pick an item to mute or unmute";
    let searchResults: string[] = [];
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    function buildItems(typedText: string): IMuteQuickPickItem[] {
      const mutedEntries = ghccConfig().get<string[]>("mutedRepos", []);
      const listedEntries = new Set(mutedEntries.map((entry) => entry.trim().toLowerCase()));
      const items: IMuteQuickPickItem[] = mutedEntries.map((entry) => ({
        label: `$(mute) ${entry}`,
        description: "muted — pick to unmute",
        entry,
        action: "unmute",
      }));
      for (const repo of [...knownRepos, ...searchResults]) {
        if (!listedEntries.has(repo.toLowerCase())) {
          listedEntries.add(repo.toLowerCase());
          items.push({ label: `$(repo) ${repo}`, description: "pick to mute", entry: repo, action: "mute" });
        }
      }
      const trimmedText = typedText.trim();
      const looksLikeOwner = trimmedText.length > 0 && !trimmedText.includes("/");
      if (looksLikeOwner) {
        items.push({
          label: `$(organization) Mute everything from "${trimmedText}"`,
          description: "mutes the whole organization",
          entry: trimmedText,
          action: "mute",
          alwaysShow: true,
        });
      }
      return items;
    }

    quickPick.items = buildItems("");
    quickPick.onDidChangeValue((typedText) => {
      if (searchTimer) {
        clearTimeout(searchTimer);
      }
      quickPick.items = buildItems(typedText);
      if (typedText.trim().length < 3) {
        return;
      }
      searchTimer = setTimeout(async () => {
        const session = await getSession(false);
        if (!session) {
          return;
        }
        try {
          searchResults = await searchRepositories(session.accessToken, typedText.trim());
          quickPick.items = buildItems(quickPick.value);
        } catch {
          // search failures stay silent inside the picker: the org item and known repos still work
        }
      }, 250);
    });
    quickPick.onDidAccept(async () => {
      const [selected] = quickPick.selectedItems;
      if (!selected) {
        return;
      }
      quickPick.hide();
      if (selected.action === "mute") {
        await addMutedEntry(selected.entry);
        void vscode.window.showInformationMessage(`Muted ${selected.entry}`);
        return;
      }
      const config = ghccConfig();
      const remainingEntries = config
        .get<string[]>("mutedRepos", [])
        .filter((entry) => entry.trim().toLowerCase() !== selected.entry.trim().toLowerCase());
      await config.update("mutedRepos", remainingEntries, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`Unmuted ${selected.entry}`);
    });
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }

  async function checkoutBranch(repo: string, headRefName: string): Promise<void> {
    const repoNameLowercase = repo.toLowerCase();
    const matchesRepo = (remote: IGitRemote): boolean => (remote.fetchUrl ?? remote.pushUrl ?? "").toLowerCase().includes(repoNameLowercase);
    const gitApi = vscode.extensions.getExtension<IGitExtension>("vscode.git")?.exports.getAPI(1);
    const repository = gitApi?.repositories.find((candidate) => candidate.state.remotes.some(matchesRepo));
    if (!repository) {
      void vscode.window.showErrorMessage(`No open workspace folder has a remote for ${repo}. Open the repository first.`);
      return;
    }
    try {
      const remoteName = repository.state.remotes.find(matchesRepo)?.name;
      await repository.fetch(remoteName);
      await repository.checkout(headRefName);
      void vscode.window.showInformationMessage(`Checked out ${headRefName}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Checkout failed: ${toErrorMessage(error)}`);
    }
  }

  const detailsSession = new DetailsSession({
    panel: detailsPanel,
    getSession,
    fetchPrDetails,
    loadPrFiles,
    ensurePatches,
    briefStore,
    persistBriefs,
    aiConfig,
    detectAi,
    runAiPrompt,
    addPrComment,
    submitPrReview,
    mergePr,
    markPrReadyForReview,
    updatePrBranch,
    checkout: checkoutBranch,
    refresh,
    notify: {
      info: (message) => void vscode.window.showInformationMessage(message),
      warning: (message) => void vscode.window.showWarningMessage(message),
      error: (message) => void vscode.window.showErrorMessage(message),
    },
    promptModal: async (message, action) => {
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
      return choice === action;
    },
    log: (message) => output.appendLine(message),
  });

  detailsPanel.onMessage((message) => detailsSession.handleMessage(message));

  function showPrToast(message: string, pr: IPullRequest): void {
    void vscode.window.showInformationMessage(message, "Open", "Settings").then((action) => {
      if (action === "Open") {
        openPr(pr.url);
      }
      if (action === "Settings") {
        void vscode.commands.executeCommand("githubControlCenter.openSettings");
      }
    });
  }

  // both trackers always track, even when notifications are off:
  // re-enabling must not replay the backlog as a toast storm
  function notifyNewPrs(toReview: IPullRequest[], notificationsEnabled: boolean): void {
    const newPrs = newPrTracker.track(toReview);
    if (!notificationsEnabled) {
      return;
    }
    for (const pr of newPrs) {
      showPrToast(`New PR to review in ${pr.repo}: "${pr.title}" by ${pr.author}`, pr);
    }
  }

  function notifyReviewDecisions(mine: IPullRequest[], notificationsEnabled: boolean): void {
    const changedPrs = reviewDecisionTracker.track(mine);
    if (!notificationsEnabled) {
      return;
    }
    for (const pr of changedPrs) {
      const message =
        pr.reviewDecision === "APPROVED"
          ? `Your PR was approved: "${pr.title}" (${pr.repo})`
          : `Changes requested on: "${pr.title}" (${pr.repo})`;
      showPrToast(message, pr);
    }
  }

  async function refresh(): Promise<void> {
    const session = await getSession(false);
    await vscode.commands.executeCommand("setContext", "githubControlCenter.signedIn", Boolean(session));
    if (!session) {
      toReviewProvider.clear();
      mineProvider.clear();
      toReviewView.badge = undefined;
      return;
    }
    try {
      const snapshot = await fetchPullRequests(session.accessToken);
      const allPrs = [...snapshot.toReview, ...snapshot.mine, ...snapshot.reviewed];
      knownRepos = new Set(allPrs.map((pr) => pr.repo));
      // re-points the open-panel PR at the fresh snapshot entry (raw, pre-filter) before silently
      // refreshing it: without this, headRefOid freezes at click time and a push would keep
      // serving the stale brief cache key
      detailsSession.onPollSnapshot(allPrs);
      const config = ghccConfig();
      // filters run before providers, badge and trackers: lists, badge and toasts must always agree
      const visibleSnapshot = applyFilters(snapshot, {
        mutedRepos: config.get("mutedRepos", []),
        hideDrafts: config.get("toReview.hideDrafts", false),
        hideReviewed: config.get("toReview.hideReviewed", false),
      });
      // requested rows first, already-reviewed rows after — within each repo group too
      toReviewProvider.setPrs([...visibleSnapshot.toReview, ...visibleSnapshot.reviewed]);
      mineProvider.setPrs(visibleSnapshot.mine);
      const badgeCount =
        (config.get("badge.countToReview", true) ? visibleSnapshot.toReview.length : 0) +
        (config.get("badge.countMine", false) ? visibleSnapshot.mine.length : 0) +
        (config.get("badge.countReviewed", false) ? visibleSnapshot.reviewed.length : 0);
      toReviewView.badge = badgeCount
        ? { value: badgeCount, tooltip: `${badgeCount} pull requests` }
        : undefined;
      const notificationsEnabled = config.get("notifications.enabled", true);
      notifyNewPrs(visibleSnapshot.toReview, notificationsEnabled);
      notifyReviewDecisions(visibleSnapshot.mine, notificationsEnabled);
      pollScheduler.recordSuccess();
    } catch (error) {
      // poll failures stay silent: keep the last good data, no error toast every 2.5 minutes
      output.appendLine(`[${new Date().toISOString()}] Poll failed: ${toErrorMessage(error)}`);
      pollScheduler.recordFailure(); // next cycle backs off (e.g. GitHub secondary rate limit)
    }
    // independent of the poll's own success/failure: refreshOpenDetails runs its own fetch
    void detailsSession.refreshOpenDetails();
  }

  // cadence is dynamic (backoff + focus pause), so a self-rescheduling setTimeout replaces a fixed setInterval
  const pollScheduler = new PollScheduler();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  // the window starts unfocused on some platforms/session-restore paths; the initial poll below
  // always runs once regardless, this only gates the recurring cadence
  let pollPaused = !vscode.window.state.focused;

  function scheduleNextPoll(): void {
    if (pollPaused) {
      return;
    }
    pollTimer = setTimeout(() => void pollCycle(), pollScheduler.nextDelay());
  }

  async function pollCycle(): Promise<void> {
    await refresh();
    scheduleNextPoll();
  }

  context.subscriptions.push(
    toReviewView,
    mineView,
    output,
    { dispose: () => clearTimeout(pollTimer) },
    { dispose: () => detailsSession.dispose() },
    vscode.window.onDidChangeWindowState((windowState) => {
      pollPaused = !windowState.focused;
      clearTimeout(pollTimer);
      if (windowState.focused) {
        void pollCycle(); // immediate catch-up refresh, then resumes the normal cadence
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.refresh", () => void refresh()),
    vscode.commands.registerCommand("githubControlCenter.signIn", async () => {
      await getSession(true);
      await refresh();
    }),
    vscode.commands.registerCommand("githubControlCenter.openPr", openPr),
    vscode.commands.registerCommand("githubControlCenter.openSettings", () => void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:mts88.github-control-center")),
    vscode.commands.registerCommand("githubControlCenter.copyPrUrl", (node: TreeNode) => {
      if (node.kind === "pr") {
        void vscode.env.clipboard.writeText(node.pr.url);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.copyBranchName", (node: TreeNode) => {
      if (node.kind === "pr") {
        void vscode.env.clipboard.writeText(node.pr.headRefName);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.checkoutPr", (node: TreeNode) => {
      if (node.kind === "pr") {
        // fork PRs are not detectable from the tree row: the checkout simply fails with a clear git error
        void checkoutBranch(node.pr.repo, node.pr.headRefName);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.muteRepo", async (node: TreeNode) => {
      if (node.kind !== "pr") {
        return;
      }
      await addMutedEntry(node.pr.repo);
      void vscode.window.showInformationMessage(`Muted ${node.pr.repo}`);
    }),
    vscode.commands.registerCommand("githubControlCenter.muteOrg", async (node: TreeNode) => {
      if (node.kind !== "pr") {
        return;
      }
      const organization = node.pr.repo.split("/")[0];
      await addMutedEntry(organization);
      void vscode.window.showInformationMessage(`Muted everything from ${organization}`);
    }),
    vscode.commands.registerCommand("githubControlCenter.manageMutedRepos", manageMutedRepos),
    vscode.commands.registerCommand("githubControlCenter.clearBriefCache", () => {
      detailsSession.clearBriefCache();
      void vscode.window.showInformationMessage("AI brief cache cleared.");
    }),
    vscode.commands.registerCommand("githubControlCenter.openPrDetails", (pr: IPullRequest) => void detailsSession.openPrDetails(pr)),
    vscode.workspace.registerTextDocumentContentProvider(PR_URI_SCHEME, contentProvider),
    vscode.commands.registerCommand("githubControlCenter.openFileDiff", (node: IFileNode) => void openFileDiff(node)),
    vscode.commands.registerCommand("githubControlCenter.review.resolveThread", (thread: vscode.CommentThread) => void runThreadMutation(thread, "Resolve conversation", resolveThread)),
    vscode.commands.registerCommand("githubControlCenter.review.unresolveThread", (thread: vscode.CommentThread) => void runThreadMutation(thread, "Unresolve conversation", unresolveThread)),
    vscode.commands.registerCommand("githubControlCenter.review.addComment", (reply: vscode.CommentReply) => void handleAddComment(reply, false)),
    vscode.commands.registerCommand("githubControlCenter.review.addSingleComment", (reply: vscode.CommentReply) => void handleAddComment(reply, true)),
    vscode.commands.registerCommand("githubControlCenter.review.submit", () => void submitActiveReview()),
    vscode.commands.registerCommand("githubControlCenter.review.discard", () => void discardActiveReview()),
    // VSCode ships no default entry point for file-level comments (enableFileComments only enables the capability)
    vscode.commands.registerCommand("githubControlCenter.review.addFileComment", () => {
      void vscode.commands.executeCommand("workbench.action.addComment", { fileComment: true });
    }),
    vscode.commands.registerCommand("githubControlCenter.viewFilesAsList", () => {
      void ghccConfig().update("files.layout", "flat", vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("githubControlCenter.viewFilesAsTree", () => {
      void ghccConfig().update("files.layout", "tree", vscode.ConfigurationTarget.Global);
    }),
    reviewController,
    pendingStatusBar,
    toReviewView.onDidChangeCheckboxState(handleCheckboxChange),
    mineView.onDidChangeCheckboxState(handleCheckboxChange),
    { dispose: () => detailsPanel.dispose() },
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === "github") {
        void refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("githubControlCenter")) {
        return;
      }
      if (event.affectsConfiguration("githubControlCenter.ai")) {
        // only backend and the CLI path change availability; language/model never do, so they
        // must not trigger a wasted `claude --version` probe on every keystroke
        const affectsAvailability =
          event.affectsConfiguration("githubControlCenter.ai.backend") ||
          event.affectsConfiguration("githubControlCenter.ai.claude.command");
        if (affectsAvailability) {
          detailsSession.refreshAiAvailabilityIfStarted();
        }
        // ai keys cannot affect PR data: skip the GitHub poll unless the same event
        // also touched settings the poll pipeline actually reads
        const touchesPollSettings = NON_AI_SECTIONS.some((section) => event.affectsConfiguration(section));
        if (!touchesPollSettings) {
          return;
        }
      }
      publishFilesLayoutContext();
      void refresh();
    }),
  );

  publishFilesLayoutContext();
  // AI detection is lazy (first PR panel open): no CLI spawn in a window that never opens one

  // the initial poll always runs once (even in an unfocused window) so lists/badge populate on
  // startup; pollCycle's own reschedule then honors pollPaused for every cycle after this one
  void pollCycle();
}

export function deactivate(): void {}
