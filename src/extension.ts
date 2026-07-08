import * as vscode from "vscode";
import { addPrComment, fetchPrDetails, fetchPullRequests, getSession, markPrReadyForReview, mergePr, searchRepositories, submitPrReview, updatePrBranch } from "./github";
import { isRepoMuted } from "./muting";
import { NewPrTracker } from "./NewPrTracker";
import { MERGE_METHOD_LABELS } from "./PrDetailsHtml";
import { PrDetailsPanel, type IPanelMessage } from "./PrDetailsPanel";
import { PrTreeProvider, type TreeNode } from "./PrTreeProvider";
import { ReviewDecisionTracker } from "./ReviewDecisionTracker";
import type { IPrDetails, IPrSnapshot, IPullRequest } from "./types";

const POLL_INTERVAL_MS = 150_000;

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
  const toReviewProvider = new PrTreeProvider();
  const mineProvider = new PrTreeProvider();
  const toReviewView = vscode.window.createTreeView("githubControlCenter.toReview", { treeDataProvider: toReviewProvider });
  const mineView = vscode.window.createTreeView("githubControlCenter.mine", { treeDataProvider: mineProvider });
  const newPrTracker = new NewPrTracker();
  const reviewDecisionTracker = new ReviewDecisionTracker();
  const detailsPanel = new PrDetailsPanel();
  let currentDetailsPr: IPullRequest | undefined;
  let currentDetails: IPrDetails | undefined;
  let detailsRequestSequence = 0;
  let mutationInFlight = false;
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
    const requestId = ++detailsRequestSequence;
    detailsPanel.showLoading(pr.title);
    const session = await getSession(false);
    if (requestId !== detailsRequestSequence) {
      return;
    }
    if (!session) {
      detailsPanel.showMessage(pr.title, "Sign in to GitHub to load pull request details.");
      return;
    }
    try {
      const details = await fetchPrDetails(session.accessToken, pr.id);
      if (requestId === detailsRequestSequence) {
        currentDetails = details;
        detailsPanel.showDetails(details);
      }
    } catch (error) {
      if (requestId === detailsRequestSequence) {
        detailsPanel.showMessage(pr.title, `Failed to load pull request details: ${toErrorMessage(error)}`);
      }
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
      detailsPanel.showMessage(pr.title, "Sign in to GitHub to act on pull requests.");
      return;
    }
    mutationInFlight = true;
    try {
      await mutate(session.accessToken);
      void vscode.window.showInformationMessage(successMessage);
      void refresh();
      void openPrDetails(pr);
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
      await runPrMutation(pr, "Update branch", `Branch updated: ${pr.title}`, (token) => updatePrBranch(token, pr.id));
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
      knownRepos = new Set([...snapshot.toReview, ...snapshot.mine].map((pr) => pr.repo));
      const config = vscode.workspace.getConfiguration("githubControlCenter");
      // filters run before providers, badge and trackers: lists, badge and toasts must always agree
      const visibleSnapshot = applyFilters(snapshot, config.get("mutedRepos", []), config.get("toReview.hideDrafts", false));
      toReviewProvider.setPrs(visibleSnapshot.toReview);
      mineProvider.setPrs(visibleSnapshot.mine);
      const badgeCount =
        (config.get("badge.countToReview", true) ? visibleSnapshot.toReview.length : 0) +
        (config.get("badge.countMine", false) ? visibleSnapshot.mine.length : 0);
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
  }

  const pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

  context.subscriptions.push(
    toReviewView,
    mineView,
    output,
    { dispose: () => clearInterval(pollTimer) },
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
    { dispose: () => detailsPanel.dispose() },
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === "github") {
        void refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("githubControlCenter")) {
        void refresh();
      }
    }),
  );

  void refresh();
}

function applyFilters(snapshot: IPrSnapshot, mutedRepos: string[], hideDrafts: boolean): IPrSnapshot {
  const isUnmuted = (pr: IPullRequest): boolean => !isRepoMuted(pr.repo, mutedRepos);
  return {
    toReview: snapshot.toReview.filter((pr) => isUnmuted(pr) && !(hideDrafts && pr.isDraft)),
    mine: snapshot.mine.filter(isUnmuted),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void {}
