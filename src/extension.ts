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
import { toThreadPosition } from "./reviewThreads";
import { applyFilters } from "./filters";
import { NewPrTracker } from "./NewPrTracker";
import { AsyncOidCache } from "./OidCache";
import { PrContentProvider, fromPrUri, toPrUri } from "./PrContentProvider";
import { MERGE_METHOD_LABELS, UPDATE_METHOD_LABELS } from "./PrDetailsHtml";
import { formatPrTabTitle, PrDetailsPanel, type IPanelMessage } from "./PrDetailsPanel";
import { PrTreeProvider, type FilesLayout, type IFileNode, type TreeNode } from "./PrTreeProvider";
import { PR_URI_SCHEME } from "./prUri";
import { ReviewDecisionTracker } from "./ReviewDecisionTracker";
import type { IPrDetails, IPrFile, IPrFilePatch, IPullRequest } from "./types";

const POLL_INTERVAL_MS = 150_000;
// GitHub reads lag behind writes: one delayed catch-up refresh after each successful mutation
const POST_MUTATION_REFRESH_DELAY_MS = 3_000;

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
    return vscode.workspace.getConfiguration("githubControlCenter").get<FilesLayout>("files.layout", "tree");
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
  let currentDetailsPr: IPullRequest | undefined;
  let currentDetails: IPrDetails | undefined;
  let detailsRequestSequence = 0;
  let mutationInFlight = false;
  // background refreshes are skipped while a draft comment sits in the composer:
  // a full HTML re-render would wipe it
  let composerHasText = false;
  let postMutationTimer: ReturnType<typeof setTimeout> | undefined;
  // repos seen in the last raw snapshot (pre-filter, so muted ones stay unmutable from the picker)
  let knownRepos = new Set<string>();

  function openPr(target: string | TreeNode): void {
    // string from the webview flow, TreeNode when invoked from the inline tree icon
    const url = typeof target === "string" ? target : target.kind === "pr" ? target.pr.url : undefined;
    if (url) {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async function openPrDetails(pr: IPullRequest): Promise<void> {
    currentDetailsPr = pr;
    composerHasText = false; // every user-initiated render starts from an empty composer
    const requestId = ++detailsRequestSequence;
    detailsPanel.showLoading(formatPrTabTitle(pr));
    const session = await getSession(false);
    if (requestId !== detailsRequestSequence) {
      return;
    }
    if (!session) {
      detailsPanel.showMessage(formatPrTabTitle(pr), "Sign in to GitHub to load pull request details.");
      return;
    }
    try {
      const details = await fetchPrDetails(session.accessToken, pr.id, pr.headRefName);
      if (requestId === detailsRequestSequence) {
        currentDetails = details;
        detailsPanel.showDetails(details);
      }
    } catch (error) {
      if (requestId === detailsRequestSequence) {
        detailsPanel.showMessage(formatPrTabTitle(pr), `Failed to load pull request details: ${toErrorMessage(error)}`);
      }
    }
  }

  // background counterpart of openPrDetails, run on every poll cycle: it reads the request
  // sequence without bumping it (a user click mid-fetch always wins), never reveals the panel,
  // and failures stay silent — the last good render must survive (same philosophy as the poll)
  async function refreshOpenDetails(): Promise<void> {
    const pr = currentDetailsPr;
    if (!pr || !detailsPanel.isVisible || mutationInFlight || composerHasText) {
      return;
    }
    const requestId = detailsRequestSequence;
    const session = await getSession(false);
    if (!session || requestId !== detailsRequestSequence) {
      return;
    }
    try {
      const details = await fetchPrDetails(session.accessToken, pr.id, pr.headRefName);
      if (requestId !== detailsRequestSequence || mutationInFlight || composerHasText) {
        return;
      }
      if (JSON.stringify(details) === JSON.stringify(currentDetails)) {
        return; // unchanged snapshot: skip the re-render, a full HTML replace resets the scroll
      }
      currentDetails = details;
      detailsPanel.updateDetails(details);
    } catch (error) {
      output.appendLine(`[${new Date().toISOString()}] Details refresh failed: ${toErrorMessage(error)}`);
    }
  }

  async function runPrMutation(
    pr: IPullRequest,
    actionLabel: string,
    successMessage: string,
    mutate: (token: string) => Promise<void>,
  ): Promise<void> {
    const session = await getSession(false);
    if (!session) {
      composerHasText = false; // this render drops the composer too
      detailsPanel.showMessage(formatPrTabTitle(pr), "Sign in to GitHub to act on pull requests.");
      return;
    }
    mutationInFlight = true;
    try {
      await mutate(session.accessToken);
      void vscode.window.showInformationMessage(successMessage);
      void refresh();
      void openPrDetails(pr);
      // GitHub reads lag behind writes (search index, review decision): the immediate
      // refreshes above often return stale data, so schedule one delayed catch-up pass
      clearTimeout(postMutationTimer);
      postMutationTimer = setTimeout(() => void refresh(), POST_MUTATION_REFRESH_DELAY_MS);
    } catch (error) {
      void vscode.window.showErrorMessage(`${actionLabel} failed: ${toErrorMessage(error)}`);
      detailsPanel.reenableActions();
    } finally {
      mutationInFlight = false;
    }
  }

  async function handlePanelMessage(pr: IPullRequest, message: IPanelMessage): Promise<void> {
    if (message.command === "comment") {
      const commentText = message.text.trim();
      if (!commentText) {
        detailsPanel.reenableActions();
        return;
      }
      await runPrMutation(pr, "Comment", `Comment posted on: ${pr.title}`, (token) => addPrComment(token, pr.id, commentText));
      return;
    }

    if (message.command === "review") {
      const isRequestingChanges = message.event === "REQUEST_CHANGES";
      const reviewText = message.text.trim();
      if (isRequestingChanges && !reviewText) {
        void vscode.window.showWarningMessage("Request changes needs a comment explaining what to change.");
        detailsPanel.reenableActions();
        return;
      }
      const actionLabel = isRequestingChanges ? "Request changes" : "Approve";
      const successMessage = isRequestingChanges ? `Changes requested on: ${pr.title}` : `Approved: ${pr.title}`;
      const confirmation = await vscode.window.showWarningMessage(`${actionLabel}: "${pr.title}"?`, { modal: true }, actionLabel);
      if (confirmation !== actionLabel) {
        detailsPanel.reenableActions();
        return;
      }
      await runPrMutation(pr, actionLabel, successMessage, (token) => submitPrReview(token, pr.id, message.event, reviewText));
      return;
    }

    if (message.command === "merge") {
      // never trust the webview: the method must be one the repo actually allows
      const isAllowedMethod = currentDetails?.mergeMethods.includes(message.method) ?? false;
      if (!isAllowedMethod) {
        detailsPanel.reenableActions();
        return;
      }
      const methodLabel = MERGE_METHOD_LABELS[message.method];
      const confirmation = await vscode.window.showWarningMessage(`${methodLabel}: "${pr.title}" into ${currentDetails?.baseRefName}?`, { modal: true }, "Merge");
      if (confirmation !== "Merge") {
        detailsPanel.reenableActions();
        return;
      }
      await runPrMutation(pr, "Merge", `Merged: ${pr.title}`, (token) => mergePr(token, pr.id, message.method));
      return;
    }

    if (message.command === "readyForReview") {
      await runPrMutation(pr, "Ready for review", `Marked as ready for review: ${pr.title}`, (token) => markPrReadyForReview(token, pr.id));
      return;
    }

    if (message.command === "updateBranch") {
      // never trust the webview: only the two known update methods are accepted
      const isKnownMethod = message.method === "REBASE" || message.method === "MERGE";
      if (!isKnownMethod) {
        detailsPanel.reenableActions();
        return;
      }
      const methodLabel = UPDATE_METHOD_LABELS[message.method];
      await runPrMutation(pr, methodLabel, `Branch updated (${message.method.toLowerCase()}): ${pr.title}`, (token) => updatePrBranch(token, pr.id, message.method));
      return;
    }

    if (message.command === "checkout") {
      await checkoutPrBranch();
    }
  }

  async function checkoutPrBranch(): Promise<void> {
    if (!currentDetails) {
      detailsPanel.reenableActions();
      return;
    }
    if (currentDetails.headRepo !== currentDetails.repo) {
      // ponytail: cross-fork checkout needs pull/N/head refspecs — use GitHub until it hurts
      void vscode.window.showErrorMessage("Checkout of cross-fork PRs is not supported. Open the PR on GitHub instead.");
      detailsPanel.reenableActions();
      return;
    }
    await checkoutBranch(currentDetails.repo, currentDetails.headRefName);
    detailsPanel.reenableActions();
  }

  async function addMutedEntry(entry: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("githubControlCenter");
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
      const mutedEntries = vscode.workspace.getConfiguration("githubControlCenter").get<string[]>("mutedRepos", []);
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
      const config = vscode.workspace.getConfiguration("githubControlCenter");
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

  detailsPanel.onMessage((message) => {
    // tracked before the in-flight guard: typing during a mutation must still update the flag
    if (message.command === "composerState") {
      composerHasText = message.hasText;
      return;
    }
    if (!currentDetailsPr || mutationInFlight) {
      return;
    }
    void handlePanelMessage(currentDetailsPr, message);
  });

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
      knownRepos = new Set([...snapshot.toReview, ...snapshot.mine, ...snapshot.reviewed].map((pr) => pr.repo));
      const config = vscode.workspace.getConfiguration("githubControlCenter");
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
    } catch (error) {
      // poll failures stay silent: keep the last good data, no error toast every 2.5 minutes
      output.appendLine(`[${new Date().toISOString()}] Poll failed: ${toErrorMessage(error)}`);
    }
    void refreshOpenDetails();
  }

  const pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

  context.subscriptions.push(
    toReviewView,
    mineView,
    output,
    { dispose: () => clearInterval(pollTimer) },
    { dispose: () => clearTimeout(postMutationTimer) },
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
    vscode.commands.registerCommand("githubControlCenter.openPrDetails", (pr: IPullRequest) => void openPrDetails(pr)),
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
      void vscode.workspace.getConfiguration("githubControlCenter").update("files.layout", "flat", vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("githubControlCenter.viewFilesAsTree", () => {
      void vscode.workspace.getConfiguration("githubControlCenter").update("files.layout", "tree", vscode.ConfigurationTarget.Global);
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
      if (event.affectsConfiguration("githubControlCenter")) {
        publishFilesLayoutContext();
        void refresh();
      }
    }),
  );

  publishFilesLayoutContext();

  void refresh();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void {}
