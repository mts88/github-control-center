import type { IPrDetails, IPrTimelineItem, MergeMethod } from "./types";

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  SQUASH: "Squash and merge",
  MERGE: "Create a merge commit",
  REBASE: "Rebase and merge",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "review was dismissed",
  PENDING: "started a review",
};

const REVIEW_DECISION_LABELS: Record<string, string> = {
  APPROVED: "✓ Changes approved",
  CHANGES_REQUESTED: "✗ Changes requested",
  REVIEW_REQUIRED: "● Review required",
};

const MERGEABLE_LABELS: Record<IPrDetails["mergeable"], string> = {
  MERGEABLE: "✓ No conflicts with the base branch",
  CONFLICTING: "✗ This branch has conflicts with the base branch",
  UNKNOWN: "● Checking mergeability…",
};

const BASE_STYLE = `
  :root {
    --gr-green: var(--vscode-charts-green, #2ea043);
    --gr-red: var(--vscode-charts-red, #f85149);
    --gr-purple: var(--vscode-charts-purple, #8957e5);
    --gr-muted: var(--vscode-descriptionForeground);
    --gr-border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    --gr-box-bg: var(--vscode-editorWidget-background, transparent);
    --gr-mono: var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    line-height: 1.5;
    padding: 20px 24px 40px;
    max-width: 1100px;
    margin: 0 auto;
  }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible, button:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .pr-header { border-bottom: 1px solid var(--gr-border); padding-bottom: 12px; margin-bottom: 20px; }
  .pr-header h1 { font-size: 1.5em; font-weight: 500; margin: 0 0 6px; }
  .pr-number { color: var(--gr-muted); font-weight: 300; }
  .state-pill {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 2em;
    color: #fff;
    font-weight: 600;
    font-size: 0.95em;
    margin-right: 8px;
    vertical-align: 2px;
  }
  .state-pill.open { background: var(--gr-green); }
  .state-pill.draft { background: var(--gr-muted); }
  .state-pill.merged { background: var(--gr-purple); }
  .state-pill.closed { background: var(--gr-red); }
  .merge-sentence { color: var(--gr-muted); }
  .branch {
    font-family: var(--gr-mono);
    font-size: 0.92em;
    background: var(--vscode-textCodeBlock-background);
    color: var(--vscode-textLink-foreground);
    padding: 1px 6px;
    border-radius: 6px;
  }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 28px; align-items: start; }
  @media (max-width: 720px) { .layout { grid-template-columns: minmax(0, 1fr); } }

  .timeline { position: relative; }
  .timeline::before {
    content: "";
    position: absolute;
    top: 8px; bottom: 8px; left: 15px;
    width: 2px;
    background: var(--gr-border);
  }
  .box {
    position: relative;
    background: var(--gr-box-bg);
    border: 1px solid var(--gr-border);
    border-radius: 6px;
    margin: 0 0 16px 40px;
  }
  .box-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--gr-border);
    color: var(--gr-muted);
  }
  .box.no-body .box-header { border-bottom: none; }
  .box-header .author { color: var(--vscode-foreground); font-weight: 600; }
  .avatar {
    width: 28px; height: 28px;
    border-radius: 50%;
    position: absolute;
    left: -40px; top: 6px;
    background: var(--gr-border);
  }
  .box-body { padding: 12px; overflow-x: auto; }
  .box-body img { max-width: 100%; }
  .box-body pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; overflow-x: auto; }
  .box-body code { background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
  .review-APPROVED { border-left: 3px solid var(--gr-green); }
  .review-CHANGES_REQUESTED { border-left: 3px solid var(--gr-red); }
  .code-comments { padding: 0 12px 10px; }
  .older-link { margin: 0 0 16px 40px; display: block; }

  .merge-box { border: 1px solid var(--gr-border); border-radius: 6px; margin-left: 40px; background: var(--gr-box-bg); }
  .merge-box .row { padding: 10px 14px; border-bottom: 1px solid var(--gr-border); }
  .merge-box .row:last-child { border-bottom: none; }
  .merge-box .ok { color: var(--gr-green); }
  .merge-box .ko { color: var(--gr-red); }
  .merge-box .neutral { color: var(--gr-muted); }
  .merge-box ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 180px; overflow-y: auto; }
  .merge-box li { padding: 2px 0; color: var(--gr-muted); }
  .check-SUCCESS::before { content: "✓ "; color: var(--gr-green); }
  .check-FAILURE::before, .check-ERROR::before { content: "✗ "; color: var(--gr-red); }
  .check-PENDING::before, .check-EXPECTED::before { content: "● "; color: var(--vscode-charts-yellow, #d29922); }
  .check-NEUTRAL::before, .check-SKIPPED::before, .check-CANCELLED::before { content: "○ "; color: var(--gr-muted); }
  .merge-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  button, select {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
  }
  button {
    border: none;
    padding: 6px 16px;
    background: var(--vscode-button-secondaryBackground, var(--gr-box-bg));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .btn-merge, .btn-approve { background: var(--gr-green); color: #fff; }
  .btn-danger { background: var(--gr-red); color: #fff; }
  select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--gr-border));
    padding: 5px 8px;
  }

  .composer { margin: 16px 0 0 40px; }
  .composer textarea {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--gr-border));
    border-radius: 6px;
    padding: 8px;
  }
  .composer .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  .sidebar section { border-bottom: 1px solid var(--gr-border); padding: 0 0 14px; margin-bottom: 14px; }
  .sidebar section:last-child { border-bottom: none; }
  .sidebar h2 { font-size: 0.92em; color: var(--gr-muted); font-weight: 600; margin: 0 0 8px; }
  .sidebar ul { list-style: none; margin: 0; padding: 0; }
  .sidebar li { padding: 2px 0; display: flex; justify-content: space-between; gap: 8px; }
  .reviewer-state { color: var(--gr-muted); white-space: nowrap; }
  .reviewer-state.APPROVED { color: var(--gr-green); }
  .reviewer-state.CHANGES_REQUESTED { color: var(--gr-red); }
  .label-pill {
    display: inline-block;
    padding: 1px 10px;
    border-radius: 2em;
    font-size: 0.92em;
    margin: 0 4px 4px 0;
  }
  .diffstat { white-space: nowrap; font-family: var(--gr-mono); font-size: 0.92em; }
  .diffstat .add { color: var(--gr-green); }
  .diffstat .del { color: var(--gr-red); }
  .stats-line { color: var(--gr-muted); margin-bottom: 8px; }
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlDocument(nonce: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>${BASE_STYLE}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

export function renderMessageHtml(message: string, nonce: string): string {
  return htmlDocument(nonce, `<p>${escapeHtml(message)}</p>`);
}

export function formatRelativeDate(isoDate: string, now: number): string {
  const ageInDays = Math.floor((now - new Date(isoDate).getTime()) / 86_400_000);
  if (ageInDays <= 0) {
    return "today";
  }
  if (ageInDays === 1) {
    return "yesterday";
  }
  return `${ageInDays} days ago`;
}

function renderAvatar(avatarUrl: string, author: string): string {
  if (!avatarUrl) {
    return `<span class="avatar" role="img" aria-label="${escapeHtml(author)}"></span>`;
  }
  return `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}">`;
}

function renderHeader(details: IPrDetails): string {
  const pill = details.state === "OPEN" && details.isDraft ? { css: "draft", label: "Draft" } : PILLS[details.state];
  return `
  <header class="pr-header">
    <h1>${escapeHtml(details.title)} <span class="pr-number">#${details.number}</span></h1>
    <div>
      <span class="state-pill ${pill.css}">${pill.label}</span>
      <span class="merge-sentence">
        <strong>${escapeHtml(details.author)}</strong> wants to merge ${details.commitsCount} ${details.commitsCount === 1 ? "commit" : "commits"}
        into <span class="branch">${escapeHtml(details.baseRefName)}</span>
        from <span class="branch">${escapeHtml(details.headRefName)}</span>
        · <a href="${escapeHtml(details.url)}">Open on GitHub</a>
      </span>
    </div>
  </header>`;
}

const PILLS: Record<IPrDetails["state"], { css: string; label: string }> = {
  OPEN: { css: "open", label: "Open" },
  MERGED: { css: "merged", label: "Merged" },
  CLOSED: { css: "closed", label: "Closed" },
};

function renderDescription(details: IPrDetails, now: number): string {
  return `
  <div class="box">
    ${renderAvatar(details.authorAvatarUrl, details.author)}
    <div class="box-header">
      <span><span class="author">${escapeHtml(details.author)}</span> opened ${formatRelativeDate(details.createdAt, now)}</span>
    </div>
    <div class="box-body">${details.bodyHtml || `<em>No description provided.</em>`}</div>
  </div>`;
}

function renderTimelineItem(item: IPrTimelineItem, prUrl: string, now: number): string {
  const action = item.kind === "review" ? (REVIEW_STATE_LABELS[item.reviewState ?? ""] ?? "reviewed") : "commented";
  const reviewClass = item.kind === "review" ? ` review-${escapeHtml(item.reviewState ?? "")}` : "";
  const hasBody = item.bodyHtml !== "";
  const codeComments =
    item.codeCommentsCount && item.codeCommentsCount > 0
      ? `<div class="code-comments"><a href="${escapeHtml(prUrl)}/files">${item.codeCommentsCount} ${item.codeCommentsCount === 1 ? "comment" : "comments"} on files</a></div>`
      : "";
  return `
  <div class="box${reviewClass}${hasBody ? "" : " no-body"}">
    ${renderAvatar(item.avatarUrl, item.author)}
    <div class="box-header">
      <span><span class="author">${escapeHtml(item.author)}</span> ${action} ${formatRelativeDate(item.createdAt, now)}</span>
    </div>
    ${hasBody ? `<div class="box-body">${item.bodyHtml}</div>` : ""}
    ${codeComments}
  </div>`;
}

function renderMergeBox(details: IPrDetails): string {
  const decision = details.reviewDecision ? (REVIEW_DECISION_LABELS[details.reviewDecision] ?? details.reviewDecision) : "● No review required";
  const decisionClass = details.reviewDecision === "APPROVED" ? "ok" : details.reviewDecision === "CHANGES_REQUESTED" ? "ko" : "neutral";

  const truncatedChecksCount = details.checksTotal - details.checks.length;
  const failedChecksCount = details.checks.filter((check) => check.status === "FAILURE" || check.status === "ERROR").length;
  const checksSummary = details.checks.length === 0 ? "● No checks" : failedChecksCount > 0 ? `✗ ${failedChecksCount} failing ${failedChecksCount === 1 ? "check" : "checks"}` : "✓ All checks passed";
  const checksClass = details.checks.length === 0 ? "neutral" : failedChecksCount > 0 ? "ko" : "ok";
  const checksList = details.checks
    .map((check) => {
      const name = check.url ? `<a href="${escapeHtml(check.url)}">${escapeHtml(check.name)}</a>` : escapeHtml(check.name);
      return `<li class="check-${escapeHtml(check.status)}">${name}</li>`;
    })
    .join("");
  const moreChecks = truncatedChecksCount > 0 ? `<li>+${truncatedChecksCount} more on GitHub</li>` : "";

  const mergeableClass = details.mergeable === "MERGEABLE" ? "ok" : details.mergeable === "CONFLICTING" ? "ko" : "neutral";

  const isOpen = details.state === "OPEN";
  const canMerge = isOpen && !details.isDraft && details.mergeMethods.length > 0;
  const canMarkReady = isOpen && details.isDraft && details.viewerDidAuthor;
  const methodOptions = details.mergeMethods
    .map((method) => `<option value="${method}">${MERGE_METHOD_LABELS[method]}</option>`)
    .join("");

  const updateBranchRow =
    isOpen && details.isBehindBase
      ? `<div class="row merge-actions"><span class="neutral">This branch is out-of-date with the base branch</span><button id="update-branch">Update branch</button></div>`
      : "";

  const actionButtons: string[] = [];
  if (isOpen) {
    actionButtons.push(`<button id="checkout">Checkout branch</button>`);
  }
  if (canMarkReady) {
    actionButtons.push(`<button id="ready" class="btn-approve">Ready for review</button>`);
  }
  if (canMerge) {
    actionButtons.push(`<button id="merge" class="btn-merge">Merge pull request</button><select id="merge-method" aria-label="Merge method">${methodOptions}</select>`);
  }
  const mergeActions = actionButtons.length > 0 ? `<div class="row merge-actions">${actionButtons.join("")}</div>` : "";

  return `
  <div class="merge-box">
    <div class="row ${decisionClass}">${decision}</div>
    <div class="row ${checksClass}">${checksSummary}${checksList ? `<ul>${checksList}${moreChecks}</ul>` : ""}</div>
    <div class="row ${mergeableClass}">${MERGEABLE_LABELS[details.mergeable]}</div>
    ${updateBranchRow}
    ${mergeActions}
  </div>`;
}

function renderComposer(details: IPrDetails): string {
  const canReview = !details.viewerDidAuthor && details.state === "OPEN";
  const reviewButtons = canReview
    ? `<button id="request-changes" class="btn-danger">Request changes</button>
       <button id="approve" class="btn-approve">Approve</button>`
    : "";
  return `
  <div class="composer">
    <textarea id="composer-text" placeholder="Leave a comment"></textarea>
    <div class="buttons">
      ${reviewButtons}
      <button id="comment">Comment</button>
    </div>
  </div>`;
}

function renderSidebar(details: IPrDetails): string {
  const reviewers = details.reviewers
    .map(
      (reviewer) =>
        `<li><span>${escapeHtml(reviewer.name)}</span><span class="reviewer-state ${escapeHtml(reviewer.state)}">${escapeHtml(reviewer.state.toLowerCase().replaceAll("_", " "))}</span></li>`,
    )
    .join("");

  const labels = details.labels
    .map((label) => {
      const isValidColor = /^[0-9a-fA-F]{6}$/.test(label.color);
      const color = isValidColor ? `#${label.color}` : "var(--gr-muted)";
      const style = `background: color-mix(in srgb, ${color} 22%, transparent); color: ${color}; border: 1px solid color-mix(in srgb, ${color} 45%, transparent);`;
      return `<span class="label-pill" style="${style}">${escapeHtml(label.name)}</span>`;
    })
    .join("");

  return `
  <aside class="sidebar">
    <section>
      <h2>Reviewers</h2>
      ${reviewers ? `<ul>${reviewers}</ul>` : `<span class="neutral">No reviewers yet</span>`}
    </section>
    <section>
      <h2>Labels</h2>
      ${labels || `<span class="neutral">None</span>`}
    </section>
    <section>
      <h2>Files changed</h2>
      <div class="stats-line">
        <a href="${escapeHtml(details.url)}/files">${details.changedFiles} ${details.changedFiles === 1 ? "file" : "files"}</a> ·
        <span class="diffstat"><span class="add">+${details.additions}</span> <span class="del">−${details.deletions}</span></span>
      </div>
    </section>
  </aside>`;
}

export function renderPrDetailsHtml(details: IPrDetails, nonce: string, now: number): string {
  const timelineItems = details.timeline.map((item) => renderTimelineItem(item, details.url, now)).join("");
  const olderLink = details.timelineTruncated ? `<a class="older-link" href="${escapeHtml(details.url)}">View older conversation on GitHub</a>` : "";

  const body = `
  ${renderHeader(details)}
  <div class="layout">
    <main>
      <div class="timeline">
        ${renderDescription(details, now)}
        ${timelineItems}
      </div>
      ${olderLink}
      ${renderMergeBox(details)}
      ${renderComposer(details)}
    </main>
    ${renderSidebar(details)}
  </div>`;

  // the script only forwards user-typed text and the chosen merge method — never ids or urls
  const script = `
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const composerText = document.getElementById("composer-text");
    const allButtons = Array.from(document.querySelectorAll("button"));

    function send(message) {
      allButtons.forEach((button) => { button.disabled = true; });
      vscodeApi.postMessage(message);
    }

    function wire(id, buildMessage) {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener("click", () => send(buildMessage()));
      }
      return button;
    }

    const commentButton = wire("comment", () => ({ command: "comment", text: composerText.value }));
    const requestChangesButton = wire("request-changes", () => ({ command: "review", event: "REQUEST_CHANGES", text: composerText.value }));
    wire("approve", () => ({ command: "review", event: "APPROVE", text: composerText.value }));
    wire("merge", () => ({ command: "merge", method: document.getElementById("merge-method").value }));
    wire("ready", () => ({ command: "readyForReview" }));
    wire("update-branch", () => ({ command: "updateBranch" }));
    wire("checkout", () => ({ command: "checkout" }));

    function syncComposerButtons() {
      const hasText = composerText.value.trim().length > 0;
      commentButton.disabled = !hasText;
      if (requestChangesButton) {
        requestChangesButton.disabled = !hasText;
      }
    }
    composerText.addEventListener("input", syncComposerButtons);
    syncComposerButtons();

    // the extension re-enables the buttons when a confirmation is cancelled or a mutation fails,
    // so the typed comment survives instead of being wiped by a full re-render
    window.addEventListener("message", (event) => {
      if (event.data && event.data.command === "reenable") {
        allButtons.forEach((button) => { button.disabled = false; });
        syncComposerButtons();
      }
    });
  </script>`;

  return htmlDocument(nonce, body, script);
}
