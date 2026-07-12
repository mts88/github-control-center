import type { IBriefState, IPrDetails, IPrTimelineItem, MergeMethod, UpdateBranchMethod } from "./types";

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  SQUASH: "Squash and merge",
  MERGE: "Create a merge commit",
  REBASE: "Rebase and merge",
};

export const UPDATE_METHOD_LABELS: Record<UpdateBranchMethod, string> = {
  REBASE: "Update with rebase",
  MERGE: "Update with merge commit",
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
  .repo-line { color: var(--gr-muted); font-size: 0.92em; margin-bottom: 6px; }
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
  .gcc-mermaid { overflow-x: auto; margin: 8px 0; }
  .gcc-mermaid pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; }
  .mermaid-diagram svg { max-width: 100%; height: auto; }
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
  .merge-box .pending { color: var(--vscode-charts-yellow, #d29922); }
  .merge-box ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 180px; overflow-y: auto; }
  .merge-box li { padding: 2px 0; color: var(--gr-muted); }
  .check-SUCCESS::before { content: "✓ "; color: var(--gr-green); }
  .check-FAILURE::before, .check-ERROR::before, .check-TIMED_OUT::before, .check-STARTUP_FAILURE::before, .check-CANCELLED::before, .check-ACTION_REQUIRED::before { content: "✗ "; color: var(--gr-red); }
  .check-PENDING::before, .check-EXPECTED::before, .check-STALE::before { content: "● "; color: var(--vscode-charts-yellow, #d29922); }
  .check-NEUTRAL::before, .check-SKIPPED::before { content: "○ "; color: var(--gr-muted); }
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
  .brief-body { font-size: 0.95em; }
  .brief-body p { margin: 4px 0; }
  .brief-body ul { margin: 4px 0 10px; padding-left: 18px; }
  .brief-body li { margin: 2px 0; }
  .brief-heading { font-weight: 600; margin: 10px 0 4px; }
  .brief-heading:first-child { margin-top: 0; }
  .brief-error { color: var(--gr-red); white-space: pre-wrap; }
  .header-actions { margin-top: 10px; display: flex; gap: 8px; }
  .brief-section summary { cursor: pointer; font-weight: 600; color: var(--gr-muted); padding: 8px 12px; }
  .brief-section[open] summary { border-bottom: 1px solid var(--gr-border); }
  .brief-avatar { display: flex; align-items: center; justify-content: center; }
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

function renderBriefButton(brief?: IBriefState): string {
  if (!brief || brief.status === "unavailable") {
    return "";
  }
  // done is disabled by design: the brief is a snapshot of the head commit — a new push
  // changes the cache key and re-enables the button; error stays enabled for retries
  const disabled = brief.status === "pending" || brief.status === "done" ? " disabled" : "";
  const title = brief.status === "done" ? ' title="Already summarized — new commits re-enable it"' : "";
  return `<button id="brief"${disabled}${title}>✨ Brief me</button>`;
}

// dedicated row under the state pill — future action buttons land here too
function renderHeaderActions(brief?: IBriefState): string {
  const briefButton = renderBriefButton(brief);
  if (!briefButton) {
    return "";
  }
  return `
    <div class="header-actions">${briefButton}</div>`;
}

// escape first, then style paired backticks and ** bold **: the wrapped content is
// already-escaped text, so a hostile payload inside the markers stays inert. Bold is the most
// common slip past the "backticks only" prompt contract — absorb it rather than fight the model.
function formatBriefInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// the system prompt constrains the model to '## ' title lines and '- ' bullets, but models
// reliably slip into '1.' numbered lists for ordering and backticks around identifiers —
// the walker accepts both list kinds and renders backtick spans as inline code;
// everything is escaped, model output stays inert
function renderBriefText(text: string): string {
  const parts: string[] = [];
  let listItems: string[] = [];
  let listTag: "ul" | "ol" = "ul";
  function flushList(): void {
    if (listItems.length > 0) {
      parts.push(`<${listTag}>${listItems.join("")}</${listTag}>`);
      listItems = [];
    }
  }
  function pushListItem(tag: "ul" | "ol", item: string): void {
    if (listTag !== tag) {
      flushList();
      listTag = tag;
    }
    listItems.push(`<li>${formatBriefInline(item)}</li>`);
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      parts.push(`<div class="brief-heading">${formatBriefInline(trimmed.slice(3))}</div>`);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      pushListItem("ul", trimmed.slice(2));
      continue;
    }
    const numberedItem = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numberedItem) {
      pushListItem("ol", numberedItem[1]);
      continue;
    }
    flushList();
    parts.push(`<p>${formatBriefInline(trimmed)}</p>`);
  }
  flushList();
  return parts.join("");
}

function renderBriefSection(brief?: IBriefState): string {
  if (!brief || brief.status === "idle" || brief.status === "unavailable") {
    return "";
  }
  let content: string;
  if (brief.status === "pending") {
    content = "Summarizing…";
  } else if (brief.status === "error") {
    content = `<span class="brief-error">${escapeHtml(brief.text ?? "")}</span>`;
  } else {
    content = renderBriefText(brief.text ?? "");
  }
  // stylized starburst evoking the Claude mark (not the trademarked asset), inline SVG:
  // part of the document, so the nonce-only CSP is untouched. Lives inside <summary>
  // because everything else in a closed <details> is hidden with it
  const providerAvatar =
    '<span class="avatar brief-avatar" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="16" height="16"><g stroke="#D97757" stroke-width="3" stroke-linecap="round">' +
    '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="19.8" y1="7.5" x2="4.2" y2="16.5"/>' +
    "</g></svg></span>";
  return `
  <details open class="box brief-section">
    <summary>${providerAvatar}Summary</summary>
    <div class="box-body brief-body">${content}</div>
  </details>`;
}

function renderHeader(details: IPrDetails, brief?: IBriefState): string {
  const pill = details.state === "OPEN" && details.isDraft ? { css: "draft", label: "Draft" } : PILLS[details.state];
  const repoUrl = details.url.replace(/\/pull\/\d+$/, "");
  return `
  <header class="pr-header">
    <div class="repo-line">
      <a href="${escapeHtml(repoUrl)}">${escapeHtml(details.repo)}</a>
      · <a href="${escapeHtml(details.url)}">Open on GitHub</a>
    </div>
    <h1>${escapeHtml(details.title)} <span class="pr-number">#${details.number}</span></h1>
    <div>
      <span class="state-pill ${pill.css}">${pill.label}</span>
      <span class="merge-sentence">
        <strong>${escapeHtml(details.author)}</strong> wants to merge ${details.commitsCount} ${details.commitsCount === 1 ? "commit" : "commits"}
        into <span class="branch">${escapeHtml(details.baseRefName)}</span>
        from <span class="branch">${escapeHtml(details.headRefName)}</span>
      </span>
    </div>${renderHeaderActions(brief)}
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

// buckets mirror GitHub's own statusCheckRollup semantics (the same rollup the sidebar consumes):
// cancelled/action-required block a merge as "not successful", stale awaits re-evaluation.
// Green is NOT the default bucket — states outside both Sets render as in progress, so an
// unknown/future GitHub state can never silently report "All checks passed".
const FAILING_CHECK_STATES = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "CANCELLED", "ACTION_REQUIRED"]);
const PASSED_CHECK_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

function renderMergeBox(details: IPrDetails, defaultUpdateMethod: UpdateBranchMethod): string {
  const decision = details.reviewDecision ? (REVIEW_DECISION_LABELS[details.reviewDecision] ?? details.reviewDecision) : "● No review required";
  const decisionClass = details.reviewDecision === "APPROVED" ? "ok" : details.reviewDecision === "CHANGES_REQUESTED" ? "ko" : "neutral";

  const truncatedChecksCount = details.checksTotal - details.checks.length;
  const failedChecksCount = details.checks.filter((check) => FAILING_CHECK_STATES.has(check.status)).length;
  const inProgressChecksCount = details.checks.filter((check) => !FAILING_CHECK_STATES.has(check.status) && !PASSED_CHECK_STATES.has(check.status)).length;
  let checksSummary: string;
  let checksClass: string;
  if (details.checks.length === 0) {
    checksSummary = "● No checks";
    checksClass = "neutral";
  } else if (failedChecksCount > 0) {
    checksSummary = `✗ ${failedChecksCount} failing ${failedChecksCount === 1 ? "check" : "checks"}`;
    checksClass = "ko";
  } else if (inProgressChecksCount > 0) {
    checksSummary = `● ${inProgressChecksCount} ${inProgressChecksCount === 1 ? "check" : "checks"} in progress`;
    checksClass = "pending";
  } else {
    checksSummary = "✓ All checks passed";
    checksClass = "ok";
  }
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

  const updateMethodsInOrder: UpdateBranchMethod[] = defaultUpdateMethod === "MERGE" ? ["MERGE", "REBASE"] : ["REBASE", "MERGE"];
  const updateMethodOptions = updateMethodsInOrder
    .map((method) => `<option value="${method}">${UPDATE_METHOD_LABELS[method]}</option>`)
    .join("");
  const updateBranchRow =
    isOpen && details.isBehindBase
      ? `<div class="row merge-actions">
          <span class="neutral">This branch is out-of-date with the base branch</span>
          <button id="update-branch">Update branch</button>
          <select id="update-method" aria-label="Update method">${updateMethodOptions}</select>
        </div>`
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

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// GitHub ships each ```mermaid fence as a <section> rendered by its own site JS (dead in a webview).
// The diagram source in data-json is HTML-encoded TWICE: once for the attribute, once inside the payload.
// We swap the section for a plain <pre> with the fully decoded source — always readable, even unrendered —
// and the webview bootstrap upgrades it to an inline SVG.
function replaceMermaidSections(html: string): string {
  return html.replace(/<section[^>]*data-type="mermaid"[\s\S]*?<\/section>/g, (section) => {
    const jsonAttribute = section.match(/data-json="([^"]*)"/);
    if (!jsonAttribute) {
      return section;
    }
    try {
      const payload = JSON.parse(decodeHtmlEntities(jsonAttribute[1])) as { data?: string };
      const source = decodeHtmlEntities(payload.data ?? "");
      if (!source) {
        return section;
      }
      return `<div class="gcc-mermaid"><pre>${escapeHtml(source)}</pre></div>`;
    } catch {
      return section;
    }
  });
}

function renderMermaidSupport(details: IPrDetails, nonce: string, mermaidScriptUri: string | undefined): { scriptTag: string; bootstrap: string } {
  const bodies = [details.bodyHtml, ...details.timeline.map((item) => item.bodyHtml)];
  const hasMermaid = bodies.some((html) => html.includes('class="gcc-mermaid"'));
  if (!hasMermaid || !mermaidScriptUri) {
    return { scriptTag: "", bootstrap: "" };
  }
  // bundled mermaid, loaded lazily from the extension (no CDN: CSP stays nonce-only, PR content stays local)
  const bootstrap = `
    const isDarkTheme = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDarkTheme ? "dark" : "default" });
    document.querySelectorAll(".gcc-mermaid").forEach(async (container, index) => {
      const sourceElement = container.querySelector("pre");
      if (!sourceElement) {
        return;
      }
      const renderId = "gccMermaid" + index;
      try {
        const rendered = await mermaid.render(renderId, sourceElement.textContent);
        container.innerHTML = rendered.svg;
        container.classList.add("mermaid-diagram");
      } catch {
        // mermaid leaves its error artwork in the document on failure: remove it, keep the readable source
        for (const strayId of [renderId, "d" + renderId]) {
          const strayElement = document.getElementById(strayId);
          if (strayElement) {
            strayElement.remove();
          }
        }
      }
    });`;
  return { scriptTag: `<script nonce="${nonce}" src="${escapeHtml(mermaidScriptUri)}"></script>`, bootstrap };
}

export function renderPrDetailsHtml(
  details: IPrDetails,
  nonce: string,
  now: number,
  mermaidScriptUri?: string,
  defaultUpdateMethod: UpdateBranchMethod = "REBASE",
  brief?: IBriefState,
): string {
  const processedDetails: IPrDetails = {
    ...details,
    bodyHtml: replaceMermaidSections(details.bodyHtml),
    timeline: details.timeline.map((item) => ({ ...item, bodyHtml: replaceMermaidSections(item.bodyHtml) })),
  };
  const timelineItems = processedDetails.timeline.map((item) => renderTimelineItem(item, processedDetails.url, now)).join("");
  const olderLink = processedDetails.timelineTruncated ? `<a class="older-link" href="${escapeHtml(processedDetails.url)}">View older conversation on GitHub</a>` : "";
  const mermaidSupport = renderMermaidSupport(processedDetails, nonce, mermaidScriptUri);

  const body = `
  ${renderHeader(processedDetails, brief)}
  <div class="layout">
    <main>
      ${renderBriefSection(brief)}
      <div class="timeline">
        ${renderDescription(processedDetails, now)}
        ${timelineItems}
      </div>
      ${olderLink}
      ${renderMergeBox(processedDetails, defaultUpdateMethod)}
      ${renderComposer(processedDetails)}
    </main>
    ${renderSidebar(processedDetails)}
  </div>`;

  // the script only forwards user-typed text, the chosen merge method and a composer-has-text
  // boolean — never ids or urls; the prKey below stays inside the webview (setState only)
  const script = `
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const prKey = ${JSON.stringify(`${processedDetails.repo}#${processedDetails.number}`)};
    const composerText = document.getElementById("composer-text");
    const allButtons = Array.from(document.querySelectorAll("button"));

    // reenable must restore exactly what send froze: buttons rendered disabled by design
    // (brief pending/done) stay disabled when a confirmation is cancelled or a mutation fails
    let frozenButtons = [];
    function send(message) {
      frozenButtons = allButtons.filter((button) => !button.disabled);
      frozenButtons.forEach((button) => { button.disabled = true; });
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
    wire("update-branch", () => ({ command: "updateBranch", method: document.getElementById("update-method").value }));
    wire("checkout", () => ({ command: "checkout" }));

    // brief is read-only and re-renders on its own: wired outside send() so a click
    // does not freeze the composer and the other action buttons. Its self-disable is not part
    // of frozenButtons, so a reenable (no silent render possible) must restore it separately.
    let briefClickPending = false;
    const briefButton = document.getElementById("brief");
    if (briefButton) {
      briefButton.addEventListener("click", () => {
        briefButton.disabled = true;
        briefClickPending = true;
        vscodeApi.postMessage({ command: "brief" });
      });
    }

    function syncComposerButtons() {
      const hasText = composerText.value.trim().length > 0;
      commentButton.disabled = !hasText;
      if (requestChangesButton) {
        requestChangesButton.disabled = !hasText;
      }
      return hasText;
    }
    // the extension skips background panel refreshes while the composer holds text,
    // so a poll re-render never wipes a draft comment
    let composerHadText = false;
    composerText.addEventListener("input", () => {
      const hasText = syncComposerButtons();
      if (hasText !== composerHadText) {
        composerHadText = hasText;
        vscodeApi.postMessage({ command: "composerState", hasText });
      }
    });
    syncComposerButtons();

    // full HTML replaces (background refresh, post-mutation re-render) reset the scroll and
    // re-open the brief <details>: restore both when the same PR renders again
    const savedState = vscodeApi.getState();
    const sameSavedPr = savedState && savedState.prKey === prKey;
    if (sameSavedPr && typeof savedState.scrollY === "number") {
      window.scrollTo(0, savedState.scrollY);
    }
    const briefDetails = document.querySelector(".brief-section");
    if (briefDetails && sameSavedPr && savedState.briefCollapsed) {
      briefDetails.open = false;
    }
    function saveViewState() {
      vscodeApi.setState({ prKey, scrollY: window.scrollY, briefCollapsed: briefDetails ? !briefDetails.open : false });
    }
    if (briefDetails) {
      briefDetails.addEventListener("toggle", saveViewState);
    }
    let scrollSaveTimer;
    window.addEventListener("scroll", () => {
      if (scrollSaveTimer) {
        return;
      }
      scrollSaveTimer = setTimeout(() => {
        scrollSaveTimer = undefined;
        saveViewState();
      }, 200);
    });

    // the extension re-enables the buttons when a confirmation is cancelled or a mutation fails,
    // so the typed comment survives instead of being wiped by a full re-render
    window.addEventListener("message", (event) => {
      if (event.data && event.data.command === "reenable") {
        frozenButtons.forEach((button) => { button.disabled = false; });
        frozenButtons = [];
        // restore the brief button only when a click is what disabled it (never a done/pending render)
        if (briefClickPending && briefButton) {
          briefButton.disabled = false;
        }
        briefClickPending = false;
        syncComposerButtons();
      }
    });
${mermaidSupport.bootstrap}
  </script>`;

  return htmlDocument(nonce, body, mermaidSupport.scriptTag + script);
}
