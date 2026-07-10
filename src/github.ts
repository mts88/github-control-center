import * as vscode from "vscode";
import type {
  CiState,
  DiffSide,
  FileChangeType,
  FileViewedState,
  IPrCheck,
  IPrDetails,
  IPrFile,
  IPrFilePatch,
  IPrReviewer,
  IPrSnapshot,
  IPrTimelineItem,
  IPullRequest,
  IReviewThreadsSnapshot,
  MergeMethod,
  MergeableState,
  PrState,
  UpdateBranchMethod,
} from "./types";

const GITHUB_AUTH_PROVIDER = "github";
// "repo" is required, otherwise PRs in private repositories are silently missing;
// "read:org" is required by Team.name in the details query (team review requests)
const GITHUB_SCOPES = ["repo", "read:org"];
const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
// ponytail: hard cap at 100 PRs per section, no pagination — plenty for personal use
const SEARCH_PAGE_SIZE = 100;

const PR_FIELDS = `
  ... on PullRequest {
    id
    number
    title
    url
    isDraft
    createdAt
    reviewDecision
    headRefName
    baseRefOid
    headRefOid
    author { login }
    repository { nameWithOwner }
    viewerLatestReview { state }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
`;

const SEARCH_QUERY = `
  query {
    toReview: search(query: "is:pr is:open archived:false review-requested:@me", type: ISSUE, first: ${SEARCH_PAGE_SIZE}) {
      nodes { ${PR_FIELDS} }
    }
    mine: search(query: "is:pr is:open archived:false author:@me", type: ISSUE, first: ${SEARCH_PAGE_SIZE}) {
      nodes { ${PR_FIELDS} }
    }
    reviewed: search(query: "is:pr is:open archived:false reviewed-by:@me -author:@me", type: ISSUE, first: ${SEARCH_PAGE_SIZE}) {
      nodes { ${PR_FIELDS} }
    }
  }
`;

interface IGraphQlPrNode {
  id?: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  headRefName: string;
  baseRefOid: string;
  headRefOid: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  viewerLatestReview: { state: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
}

const DETAILS_QUERY = `
  query ($id: ID!, $headRef: String!) {
    node(id: $id) {
      ... on PullRequest {
        number
        title
        url
        state
        isDraft
        createdAt
        author { login avatarUrl }
        repository { nameWithOwner mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }
        bodyHTML
        baseRefName
        headRefName
        headRepository { nameWithOwner }
        baseRef { compare(headRef: $headRef) { behindBy } }
        changedFiles
        additions
        deletions
        labels(first: 10) { nodes { name color } }
        mergeable
        reviewDecision
        viewerDidAuthor
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
        }
        latestReviews(first: 30) {
          nodes { author { login } state }
        }
        comments(last: 30) {
          totalCount
          nodes { author { login avatarUrl } bodyHTML createdAt }
        }
        reviews(last: 30) {
          totalCount
          nodes { author { login avatarUrl } state bodyHTML createdAt comments { totalCount } }
        }
        commits(last: 1) {
          totalCount
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 50) {
                  totalCount
                  nodes {
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const ADD_COMMENT_MUTATION = `
  mutation ($id: ID!, $body: String!) {
    addComment(input: { subjectId: $id, body: $body }) {
      clientMutationId
    }
  }
`;

const SUBMIT_REVIEW_MUTATION = `
  mutation ($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
    addPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body }) {
      clientMutationId
    }
  }
`;

const READY_FOR_REVIEW_MUTATION = `
  mutation ($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`;

const MERGE_MUTATION = `
  mutation ($id: ID!, $method: PullRequestMergeMethod!) {
    mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method }) {
      clientMutationId
    }
  }
`;

interface IGraphQlCheckNode {
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
}

interface IGraphQlActor {
  login: string;
  avatarUrl?: string;
}

interface IGraphQlDetailsNode {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  author: IGraphQlActor | null;
  repository: {
    nameWithOwner: string;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
  };
  bodyHTML: string;
  baseRefName: string;
  headRefName: string;
  headRepository: { nameWithOwner: string } | null;
  baseRef: { compare: { behindBy: number } | null } | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  labels: { nodes: Array<{ name: string; color: string }> };
  mergeable: string;
  reviewDecision: string | null;
  viewerDidAuthor: boolean;
  reviewRequests: { nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }> };
  latestReviews: { nodes: Array<{ author: { login: string } | null; state: string }> };
  comments: {
    totalCount: number;
    nodes: Array<{ author: IGraphQlActor | null; bodyHTML: string; createdAt: string }>;
  };
  reviews: {
    totalCount: number;
    nodes: Array<{
      author: IGraphQlActor | null;
      state: string;
      bodyHTML: string;
      createdAt: string;
      comments: { totalCount: number };
    }>;
  };
  commits: {
    totalCount: number;
    nodes: Array<{
      commit: { statusCheckRollup: { contexts: { totalCount: number; nodes: IGraphQlCheckNode[] } } | null };
    }>;
  };
}

interface IGraphQlPayload<TData> {
  data?: TData;
  errors?: Array<{ message: string }>;
}

export function getSession(createIfNone: boolean): Thenable<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(GITHUB_AUTH_PROVIDER, GITHUB_SCOPES, { createIfNone });
}

async function postGraphQl<TData>(token: string, query: string, variables?: Record<string, unknown>): Promise<TData> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as IGraphQlPayload<TData>;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message);
  }
  if (!payload.data) {
    throw new Error("GitHub GraphQL response has no data");
  }
  return payload.data;
}

const REST_ENDPOINT = "https://api.github.com";
// GitHub lists at most 3000 files per PR: 30 pages of 100
const MAX_FILE_PAGES = 30;

async function getRest(token: string, path: string, accept: string): Promise<Response> {
  const response = await fetch(`${REST_ENDPOINT}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub REST request failed with status ${response.status}`);
  }
  return response;
}

interface IRestPrFile {
  filename: string;
  previous_filename?: string;
  patch?: string;
}

export async function fetchPrFilePatches(token: string, repo: string, prNumber: number): Promise<IPrFilePatch[]> {
  const patches: IPrFilePatch[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const response = await getRest(token, `/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`, "application/vnd.github+json");
    const files = (await response.json()) as IRestPrFile[];
    patches.push(...files.map((file) => ({ path: file.filename, previousPath: file.previous_filename, patch: file.patch })));
    if (files.length < 100) {
      break;
    }
  }
  return patches;
}

export async function fetchFileContent(token: string, repo: string, path: string, sha: string): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  // the raw media type streams the blob directly, avoiding the 1MB base64 JSON cap
  const response = await getRest(token, `/repos/${repo}/contents/${encodedPath}?ref=${sha}`, "application/vnd.github.raw+json");
  return response.text();
}

export async function fetchPullRequests(token: string): Promise<IPrSnapshot> {
  const data = await postGraphQl<{ toReview: { nodes: IGraphQlPrNode[] }; mine: { nodes: IGraphQlPrNode[] }; reviewed: { nodes: IGraphQlPrNode[] } }>(token, SEARCH_QUERY);
  const toReview = toPullRequests(data.toReview.nodes);
  const toReviewIds = new Set(toReview.map((pr) => pr.id));
  return {
    toReview,
    mine: toPullRequests(data.mine.nodes),
    // a re-requested PR matches both searches: the active request wins
    reviewed: toPullRequests(data.reviewed.nodes)
      .filter((pr) => !toReviewIds.has(pr.id))
      .map((pr) => ({ ...pr, isReviewedByMe: true })),
  };
}

export async function fetchPrDetails(token: string, prId: string, headRefName: string): Promise<IPrDetails> {
  const data = await postGraphQl<{ node: IGraphQlDetailsNode | null }>(token, DETAILS_QUERY, { id: prId, headRef: headRefName });
  if (!data.node) {
    throw new Error("Pull request not found");
  }
  return toPrDetails(data.node);
}

export async function addPrComment(token: string, prId: string, body: string): Promise<void> {
  await postGraphQl(token, ADD_COMMENT_MUTATION, { id: prId, body });
}

export async function submitPrReview(token: string, prId: string, event: "APPROVE" | "REQUEST_CHANGES", body: string): Promise<void> {
  await postGraphQl(token, SUBMIT_REVIEW_MUTATION, { id: prId, event, body: body || null });
}

export async function mergePr(token: string, prId: string, method: MergeMethod): Promise<void> {
  await postGraphQl(token, MERGE_MUTATION, { id: prId, method });
}

export async function markPrReadyForReview(token: string, prId: string): Promise<void> {
  await postGraphQl(token, READY_FOR_REVIEW_MUTATION, { id: prId });
}

const UPDATE_BRANCH_MUTATION = `
  mutation ($id: ID!, $method: PullRequestBranchUpdateMethod!) {
    updatePullRequestBranch(input: { pullRequestId: $id, updateMethod: $method }) {
      clientMutationId
    }
  }
`;

export async function updatePrBranch(token: string, prId: string, method: UpdateBranchMethod): Promise<void> {
  await postGraphQl(token, UPDATE_BRANCH_MUTATION, { id: prId, method });
}

const PR_FILES_QUERY = `
  query ($id: ID!, $after: String) {
    node(id: $id) {
      ... on PullRequest {
        files(first: 100, after: $after) {
          nodes { path additions deletions changeType viewerViewedState }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

interface IGraphQlFileNode {
  path: string;
  additions: number;
  deletions: number;
  changeType: FileChangeType;
  viewerViewedState: FileViewedState;
}

interface IGraphQlFilesPage {
  node: {
    files: {
      nodes: IGraphQlFileNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export async function fetchPrFiles(token: string, prId: string): Promise<IPrFile[]> {
  const files: IPrFile[] = [];
  let after: string | null = null;
  do {
    const data: IGraphQlFilesPage = await postGraphQl<IGraphQlFilesPage>(token, PR_FILES_QUERY, { id: prId, after });
    if (!data.node) {
      throw new Error("Pull request not found");
    }
    const page = data.node.files;
    files.push(
      ...page.nodes.map((node) => ({
        path: node.path,
        changeType: node.changeType,
        additions: node.additions,
        deletions: node.deletions,
        viewedState: node.viewerViewedState,
      })),
    );
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return files;
}

const REVIEW_THREADS_QUERY = `
  query ($id: ID!) {
    viewer { login }
    node(id: $id) {
      ... on PullRequest {
        reviewThreads(first: 100) {
          nodes {
            id
            path
            line
            startLine
            diffSide
            startDiffSide
            isResolved
            isOutdated
            subjectType
            comments(first: 50) {
              nodes { id author { login } body createdAt state }
            }
          }
        }
        reviews(states: [PENDING], first: 10) {
          nodes { id author { login } comments { totalCount } }
        }
      }
    }
  }
`;

interface IGraphQlThreadCommentNode {
  id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
  state: string;
}

interface IGraphQlThreadNode {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: DiffSide;
  startDiffSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  subjectType: "LINE" | "FILE";
  comments: { nodes: IGraphQlThreadCommentNode[] };
}

interface IGraphQlThreadsPayload {
  viewer: { login: string };
  node: {
    // ponytail: first 100 threads / 50 comments each — matches the SEARCH_PAGE_SIZE cap philosophy
    reviewThreads: { nodes: IGraphQlThreadNode[] };
    reviews: { nodes: Array<{ id: string; author: { login: string } | null; comments: { totalCount: number } }> };
  } | null;
}

export async function fetchReviewThreads(token: string, prId: string): Promise<IReviewThreadsSnapshot> {
  const data = await postGraphQl<IGraphQlThreadsPayload>(token, REVIEW_THREADS_QUERY, { id: prId });
  if (!data.node) {
    throw new Error("Pull request not found");
  }
  const pendingReview = data.node.reviews.nodes.find((review) => review.author?.login === data.viewer.login);
  return {
    threads: data.node.reviewThreads.nodes.map((thread) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      startLine: thread.startLine,
      side: thread.diffSide,
      startSide: thread.startDiffSide,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      subjectType: thread.subjectType,
      comments: thread.comments.nodes.map((comment) => ({
        id: comment.id,
        author: comment.author?.login ?? "unknown",
        bodyMarkdown: comment.body,
        createdAt: comment.createdAt,
        isPending: comment.state === "PENDING",
      })),
    })),
    pendingReviewId: pendingReview?.id ?? null,
    pendingCommentCount: pendingReview?.comments.totalCount ?? 0,
  };
}

const ADD_PENDING_REVIEW_MUTATION = `
  mutation ($id: ID!) {
    addPullRequestReview(input: { pullRequestId: $id }) {
      pullRequestReview { id }
    }
  }
`;

/** Creates the viewer's PENDING review (no event) and returns its id. */
export async function addPendingReview(token: string, prId: string): Promise<string> {
  const data = await postGraphQl<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(token, ADD_PENDING_REVIEW_MUTATION, { id: prId });
  return data.addPullRequestReview.pullRequestReview.id;
}

const ADD_REVIEW_THREAD_MUTATION = `
  mutation ($input: AddPullRequestReviewThreadInput!) {
    addPullRequestReviewThread(input: $input) {
      clientMutationId
    }
  }
`;

export interface IAddReviewThreadInput {
  prId: string;
  body: string;
  path: string;
  subjectType: "LINE" | "FILE";
  line?: number;
  startLine?: number;
  side?: DiffSide;
  startSide?: DiffSide;
}

/** Adds a draft thread; with pullRequestId GitHub attaches it to (or creates) the viewer's pending review. */
export async function addReviewThread(token: string, input: IAddReviewThreadInput): Promise<void> {
  const { prId, ...thread } = input;
  await postGraphQl(token, ADD_REVIEW_THREAD_MUTATION, { input: { pullRequestId: prId, ...thread } });
}

const ADD_THREAD_REPLY_MUTATION = `
  mutation ($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      clientMutationId
    }
  }
`;

export async function addReviewThreadReply(token: string, threadId: string, body: string): Promise<void> {
  await postGraphQl(token, ADD_THREAD_REPLY_MUTATION, { threadId, body });
}

const SUBMIT_PENDING_REVIEW_MUTATION = `
  mutation ($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
    submitPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body }) {
      clientMutationId
    }
  }
`;

export async function submitPendingReview(token: string, prId: string, event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body: string): Promise<void> {
  await postGraphQl(token, SUBMIT_PENDING_REVIEW_MUTATION, { id: prId, event, body: body || null });
}

const DISCARD_PENDING_REVIEW_MUTATION = `
  mutation ($reviewId: ID!) {
    deletePullRequestReview(input: { pullRequestReviewId: $reviewId }) {
      clientMutationId
    }
  }
`;

export async function discardPendingReview(token: string, reviewId: string): Promise<void> {
  await postGraphQl(token, DISCARD_PENDING_REVIEW_MUTATION, { reviewId });
}

const MARK_VIEWED_MUTATION = `
  mutation ($id: ID!, $path: String!) {
    markFileAsViewed(input: { pullRequestId: $id, path: $path }) {
      clientMutationId
    }
  }
`;

const UNMARK_VIEWED_MUTATION = `
  mutation ($id: ID!, $path: String!) {
    unmarkFileAsViewed(input: { pullRequestId: $id, path: $path }) {
      clientMutationId
    }
  }
`;

export async function setFileViewed(token: string, prId: string, path: string, viewed: boolean): Promise<void> {
  await postGraphQl(token, viewed ? MARK_VIEWED_MUTATION : UNMARK_VIEWED_MUTATION, { id: prId, path });
}

const RESOLVE_THREAD_MUTATION = `
  mutation ($id: ID!) {
    resolveReviewThread(input: { threadId: $id }) {
      clientMutationId
    }
  }
`;

const UNRESOLVE_THREAD_MUTATION = `
  mutation ($id: ID!) {
    unresolveReviewThread(input: { threadId: $id }) {
      clientMutationId
    }
  }
`;

export async function resolveThread(token: string, threadId: string): Promise<void> {
  await postGraphQl(token, RESOLVE_THREAD_MUTATION, { id: threadId });
}

export async function unresolveThread(token: string, threadId: string): Promise<void> {
  await postGraphQl(token, UNRESOLVE_THREAD_MUTATION, { id: threadId });
}

const REPO_SEARCH_QUERY = `
  query ($text: String!) {
    search(query: $text, type: REPOSITORY, first: 15) {
      nodes { ... on Repository { nameWithOwner } }
    }
  }
`;

export async function searchRepositories(token: string, text: string): Promise<string[]> {
  const data = await postGraphQl<{ search: { nodes: Array<{ nameWithOwner?: string }> } }>(token, REPO_SEARCH_QUERY, { text });
  return data.search.nodes.map((node) => node.nameWithOwner).filter((name): name is string => Boolean(name));
}

function toPullRequests(nodes: IGraphQlPrNode[]): IPullRequest[] {
  return nodes.filter((node): node is IGraphQlPrNode & { id: string } => Boolean(node?.id)).map(toPullRequest);
}

function toPullRequest(node: IGraphQlPrNode & { id: string }): IPullRequest {
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? "unknown",
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    ciState: toCiState(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    reviewDecision: node.reviewDecision,
    viewerReviewState: node.viewerLatestReview?.state ?? null,
    headRefName: node.headRefName,
    baseRefOid: node.baseRefOid,
    headRefOid: node.headRefOid,
  };
}

function isSameRepoPr(node: IGraphQlDetailsNode): boolean {
  return !node.headRepository || node.headRepository.nameWithOwner === node.repository.nameWithOwner;
}

function toPrDetails(node: IGraphQlDetailsNode): IPrDetails {
  const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
  // GitHub attaches one CheckRun per workflow run, so re-triggered workflows (e.g. pull_request_target
  // on edited) duplicate same-named checks on the same commit. Like the GitHub UI, keep only the
  // latest run per name (nodes arrive in creation order).
  const latestCheckByName = new Map<string, IPrCheck>();
  const rawChecks = (contexts?.nodes ?? []).map(toCheck).filter((check): check is IPrCheck => Boolean(check));
  for (const check of rawChecks) {
    latestCheckByName.set(check.name, check);
  }
  const checks = [...latestCheckByName.values()];
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? "unknown",
    authorAvatarUrl: node.author?.avatarUrl ?? "",
    state: toPrState(node.state),
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    bodyHtml: node.bodyHTML,
    baseRefName: node.baseRefName,
    headRefName: node.headRefName,
    headRepo: node.headRepository?.nameWithOwner ?? node.repository.nameWithOwner,
    // Ref.compare works without branch protection; mergeStateStatus only reports BEHIND with strict protection.
    // compare(headRef:) resolves the name inside the BASE repo, so on a cross-fork PR a same-named
    // base-repo branch would be compared instead — skip the check entirely for forks.
    isBehindBase: isSameRepoPr(node) && (node.baseRef?.compare?.behindBy ?? 0) > 0,
    commitsCount: node.commits.totalCount,
    changedFiles: node.changedFiles,
    additions: node.additions,
    deletions: node.deletions,
    labels: node.labels.nodes,
    mergeable: toMergeableState(node.mergeable),
    mergeMethods: toMergeMethods(node.repository),
    reviewDecision: node.reviewDecision,
    viewerDidAuthor: node.viewerDidAuthor,
    reviewers: toReviewers(node),
    checks,
    // Subtract the collapsed duplicates so the "N more checks" hint only counts nodes beyond the fetch cap.
    checksTotal: (contexts?.totalCount ?? 0) - (rawChecks.length - checks.length),
    timeline: toTimeline(node),
    timelineTruncated: node.comments.totalCount > node.comments.nodes.length || node.reviews.totalCount > node.reviews.nodes.length,
  };
}

function toPrState(state: string): PrState {
  if (state === "MERGED" || state === "CLOSED") {
    return state;
  }
  return "OPEN";
}

function toMergeMethods(repository: IGraphQlDetailsNode["repository"]): MergeMethod[] {
  const methods: MergeMethod[] = [];
  // squash first: it is the preferred default when allowed
  if (repository.squashMergeAllowed) {
    methods.push("SQUASH");
  }
  if (repository.mergeCommitAllowed) {
    methods.push("MERGE");
  }
  if (repository.rebaseMergeAllowed) {
    methods.push("REBASE");
  }
  return methods;
}

function toTimeline(node: IGraphQlDetailsNode): IPrTimelineItem[] {
  const comments: IPrTimelineItem[] = node.comments.nodes.map((comment) => ({
    kind: "comment",
    author: comment.author?.login ?? "unknown",
    avatarUrl: comment.author?.avatarUrl ?? "",
    bodyHtml: comment.bodyHTML,
    createdAt: comment.createdAt,
  }));
  const reviews: IPrTimelineItem[] = node.reviews.nodes
    // hide empty COMMENTED shells; state-bearing reviews always show
    .filter((review) => review.state !== "COMMENTED" || review.bodyHTML !== "" || review.comments.totalCount > 0)
    .map((review) => ({
      kind: "review",
      author: review.author?.login ?? "unknown",
      avatarUrl: review.author?.avatarUrl ?? "",
      bodyHtml: review.bodyHTML,
      createdAt: review.createdAt,
      reviewState: review.state,
      codeCommentsCount: review.comments.totalCount,
    }));
  return [...comments, ...reviews].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

function toReviewers(node: IGraphQlDetailsNode): IPrReviewer[] {
  const stateByReviewer = new Map<string, string>();
  for (const review of node.latestReviews.nodes) {
    const login = review.author?.login;
    if (login) {
      stateByReviewer.set(login, review.state);
    }
  }
  // a re-requested reviewer appears in both lists: the pending request wins
  for (const request of node.reviewRequests.nodes) {
    const name = request.requestedReviewer?.login ?? request.requestedReviewer?.name;
    if (name) {
      stateByReviewer.set(name, "REQUESTED");
    }
  }
  return [...stateByReviewer.entries()].map(([name, state]) => ({ name, state }));
}

function toCheck(checkNode: IGraphQlCheckNode): IPrCheck | undefined {
  if (checkNode.context) {
    return { name: checkNode.context, status: checkNode.state ?? "PENDING", url: checkNode.targetUrl ?? undefined };
  }
  if (checkNode.name) {
    const isCompleted = checkNode.status === "COMPLETED";
    return {
      name: checkNode.name,
      status: isCompleted ? (checkNode.conclusion ?? "PENDING") : "PENDING",
      url: checkNode.detailsUrl ?? undefined,
    };
  }
  return undefined;
}

function toMergeableState(mergeable: string): MergeableState {
  if (mergeable === "MERGEABLE" || mergeable === "CONFLICTING") {
    return mergeable;
  }
  return "UNKNOWN";
}

function toCiState(rollupState: string | undefined): CiState {
  if (rollupState === "SUCCESS") {
    return "SUCCESS";
  }
  if (rollupState === "FAILURE" || rollupState === "ERROR") {
    return "FAILURE";
  }
  if (rollupState === "PENDING" || rollupState === "EXPECTED") {
    return "PENDING";
  }
  return "NONE";
}
