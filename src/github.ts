import * as vscode from "vscode";
import type {
  CiState,
  IPrCheck,
  IPrDetails,
  IPrReviewer,
  IPrSnapshot,
  IPrTimelineItem,
  IPullRequest,
  MergeMethod,
  MergeableState,
  PrState,
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
    title
    url
    isDraft
    createdAt
    reviewDecision
    headRefName
    author { login }
    repository { nameWithOwner }
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
  }
`;

interface IGraphQlPrNode {
  id?: string;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  headRefName: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
}

const DETAILS_QUERY = `
  query ($id: ID!) {
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
        mergeStateStatus
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
  mergeStateStatus: string;
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

export async function fetchPullRequests(token: string): Promise<IPrSnapshot> {
  const data = await postGraphQl<{ toReview: { nodes: IGraphQlPrNode[] }; mine: { nodes: IGraphQlPrNode[] } }>(token, SEARCH_QUERY);
  return {
    toReview: toPullRequests(data.toReview.nodes),
    mine: toPullRequests(data.mine.nodes),
  };
}

export async function fetchPrDetails(token: string, prId: string): Promise<IPrDetails> {
  const data = await postGraphQl<{ node: IGraphQlDetailsNode | null }>(token, DETAILS_QUERY, { id: prId });
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
  mutation ($id: ID!) {
    updatePullRequestBranch(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`;

export async function updatePrBranch(token: string, prId: string): Promise<void> {
  await postGraphQl(token, UPDATE_BRANCH_MUTATION, { id: prId });
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
  return nodes.filter((node) => Boolean(node?.id)).map(toPullRequest);
}

function toPullRequest(node: IGraphQlPrNode): IPullRequest {
  return {
    id: node.id as string,
    title: node.title,
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? "unknown",
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    ciState: toCiState(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    reviewDecision: node.reviewDecision,
    headRefName: node.headRefName,
  };
}

function toPrDetails(node: IGraphQlDetailsNode): IPrDetails {
  const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
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
    isBehindBase: node.mergeStateStatus === "BEHIND",
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
    checks: (contexts?.nodes ?? []).map(toCheck).filter((check): check is IPrCheck => Boolean(check)),
    checksTotal: contexts?.totalCount ?? 0,
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
