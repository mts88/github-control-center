import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { addPrComment, fetchPrDetails, fetchPullRequests, markPrReadyForReview, mergePr, searchRepositories, submitPrReview, updatePrBranch } from "./github";

interface IGraphQlNodeOverrides {
  id?: string;
  title?: string;
  author?: { login: string } | null;
  rollupState?: string | null;
  isDraft?: boolean;
  reviewDecision?: string | null;
}

function buildNode(overrides: IGraphQlNodeOverrides = {}) {
  return {
    id: overrides.id ?? "PR_1",
    title: overrides.title ?? "A title",
    url: "https://github.com/acme/repo/pull/1",
    isDraft: overrides.isDraft ?? false,
    createdAt: "2026-07-01T00:00:00Z",
    reviewDecision: overrides.reviewDecision ?? null,
    headRefName: "feature/thing",
    author: overrides.author === undefined ? { login: "jane" } : overrides.author,
    repository: { nameWithOwner: "acme/repo" },
    commits: {
      nodes: [{ commit: { statusCheckRollup: overrides.rollupState ? { state: overrides.rollupState } : null } }],
    },
  };
}

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

function stubGraphQlData(toReviewNodes: unknown[], mineNodes: unknown[] = []): void {
  stubFetch({ data: { toReview: { nodes: toReviewNodes }, mine: { nodes: mineNodes } } });
}

describe("fetchPullRequests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("should map a GraphQL node to a pull request", async () => {
    stubGraphQlData([buildNode({ rollupState: "SUCCESS", reviewDecision: "APPROVED" })]);

    const snapshot = await fetchPullRequests("token");

    expect(snapshot.toReview).toEqual([
      {
        id: "PR_1",
        title: "A title",
        url: "https://github.com/acme/repo/pull/1",
        repo: "acme/repo",
        author: "jane",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00Z",
        ciState: "SUCCESS",
        reviewDecision: "APPROVED",
        headRefName: "feature/thing",
      },
    ]);
  });

  it("should split results between toReview and mine sections", async () => {
    stubGraphQlData([buildNode({ id: "PR_1" })], [buildNode({ id: "PR_2" })]);

    const snapshot = await fetchPullRequests("token");

    expect(snapshot.toReview.map((pr) => pr.id)).toEqual(["PR_1"]);
    expect(snapshot.mine.map((pr) => pr.id)).toEqual(["PR_2"]);
  });

  describe("CI state mapping", () => {
    it.each([
      ["SUCCESS", "SUCCESS"],
      ["FAILURE", "FAILURE"],
      ["ERROR", "FAILURE"],
      ["PENDING", "PENDING"],
      ["EXPECTED", "PENDING"],
    ])("should map rollup state %s to ciState %s", async (rollupState, expectedCiState) => {
      stubGraphQlData([buildNode({ rollupState })]);

      const snapshot = await fetchPullRequests("token");

      expect(snapshot.toReview[0].ciState).toBe(expectedCiState);
    });

    it("should map a missing status check rollup to NONE", async () => {
      stubGraphQlData([buildNode({ rollupState: null })]);

      const snapshot = await fetchPullRequests("token");

      expect(snapshot.toReview[0].ciState).toBe("NONE");
    });
  });

  it("should fall back to 'unknown' when the author is missing", async () => {
    stubGraphQlData([buildNode({ author: null })]);

    const snapshot = await fetchPullRequests("token");

    expect(snapshot.toReview[0].author).toBe("unknown");
  });

  it("should drop empty search nodes", async () => {
    stubGraphQlData([{}, buildNode({ id: "PR_1" })]);

    const snapshot = await fetchPullRequests("token");

    expect(snapshot.toReview.map((pr) => pr.id)).toEqual(["PR_1"]);
  });

  it("should throw when the HTTP response is not ok", async () => {
    stubFetch({}, 401);

    await expect(fetchPullRequests("token")).rejects.toThrow("401");
  });

  it("should throw the first GraphQL error message", async () => {
    stubFetch({ errors: [{ message: "Bad credentials" }] });

    await expect(fetchPullRequests("token")).rejects.toThrow("Bad credentials");
  });
});

interface IDetailsNodeOverrides {
  mergeable?: string;
  state?: string;
  headRepository?: { nameWithOwner: string } | null;
  baseRef?: { compare: { behindBy: number } | null } | null;
  statusCheckRollup?: unknown;
  reviewRequests?: unknown[];
  latestReviews?: unknown[];
  comments?: { totalCount: number; nodes: unknown[] };
  reviews?: { totalCount: number; nodes: unknown[] };
  repository?: unknown;
}

function buildDetailsNode(overrides: IDetailsNodeOverrides = {}) {
  return {
    number: 42,
    title: "A title",
    url: "https://github.com/acme/repo/pull/42",
    state: overrides.state ?? "OPEN",
    isDraft: false,
    createdAt: "2026-07-01T00:00:00Z",
    author: { login: "jane", avatarUrl: "https://avatars.example/jane" },
    repository: overrides.repository ?? {
      nameWithOwner: "acme/repo",
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
    },
    bodyHTML: "<p>Hello</p>",
    baseRefName: "main",
    headRefName: "feature/thing",
    headRepository: overrides.headRepository ?? { nameWithOwner: "acme/repo" },
    baseRef: overrides.baseRef !== undefined ? overrides.baseRef : { compare: { behindBy: 0 } },
    changedFiles: 3,
    additions: 10,
    deletions: 4,
    labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
    mergeable: overrides.mergeable ?? "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    viewerDidAuthor: false,
    reviewRequests: { nodes: overrides.reviewRequests ?? [{ requestedReviewer: { login: "mario" } }] },
    latestReviews: { nodes: overrides.latestReviews ?? [{ author: { login: "luigi" }, state: "APPROVED" }] },
    comments: overrides.comments ?? {
      totalCount: 1,
      nodes: [{ author: { login: "mario", avatarUrl: "https://avatars.example/mario" }, bodyHTML: "<p>Nice</p>", createdAt: "2026-07-02T00:00:00Z" }],
    },
    reviews: overrides.reviews ?? {
      totalCount: 1,
      nodes: [
        {
          author: { login: "luigi", avatarUrl: "https://avatars.example/luigi" },
          state: "APPROVED",
          bodyHTML: "<p>LGTM</p>",
          createdAt: "2026-07-03T00:00:00Z",
          comments: { totalCount: 2 },
        },
      ],
    },
    commits: {
      totalCount: 3,
      nodes: [
        {
          commit: {
            statusCheckRollup:
              overrides.statusCheckRollup !== undefined
                ? overrides.statusCheckRollup
                : {
                    contexts: {
                      totalCount: 2,
                      nodes: [
                        { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
                        { context: "ci/legacy", state: "FAILURE" },
                      ],
                    },
                  },
          },
        },
      ],
    },
  };
}

describe("fetchPrDetails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("should map the GraphQL node to PR details", async () => {
    stubFetch({ data: { node: buildDetailsNode() } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details).toEqual({
      number: 42,
      title: "A title",
      url: "https://github.com/acme/repo/pull/42",
      repo: "acme/repo",
      author: "jane",
      authorAvatarUrl: "https://avatars.example/jane",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-07-01T00:00:00Z",
      bodyHtml: "<p>Hello</p>",
      baseRefName: "main",
      headRefName: "feature/thing",
      headRepo: "acme/repo",
      isBehindBase: false,
      commitsCount: 3,
      changedFiles: 3,
      additions: 10,
      deletions: 4,
      labels: [{ name: "bug", color: "d73a4a" }],
      mergeable: "MERGEABLE",
      mergeMethods: ["SQUASH", "MERGE"],
      reviewDecision: "REVIEW_REQUIRED",
      viewerDidAuthor: false,
      reviewers: [
        { name: "luigi", state: "APPROVED" },
        { name: "mario", state: "REQUESTED" },
      ],
      checks: [
        { name: "build", status: "SUCCESS" },
        { name: "ci/legacy", status: "FAILURE" },
      ],
      checksTotal: 2,
      timeline: [
        {
          kind: "comment",
          author: "mario",
          avatarUrl: "https://avatars.example/mario",
          bodyHtml: "<p>Nice</p>",
          createdAt: "2026-07-02T00:00:00Z",
        },
        {
          kind: "review",
          author: "luigi",
          avatarUrl: "https://avatars.example/luigi",
          bodyHtml: "<p>LGTM</p>",
          createdAt: "2026-07-03T00:00:00Z",
          reviewState: "APPROVED",
          codeCommentsCount: 2,
        },
      ],
      timelineTruncated: false,
    });
  });

  it("should sort the timeline chronologically across comments and reviews", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          comments: {
            totalCount: 1,
            nodes: [{ author: { login: "late" }, bodyHTML: "<p>after</p>", createdAt: "2026-07-05T00:00:00Z" }],
          },
          reviews: {
            totalCount: 1,
            nodes: [{ author: { login: "early" }, state: "APPROVED", bodyHTML: "<p>before</p>", createdAt: "2026-07-04T00:00:00Z", comments: { totalCount: 0 } }],
          },
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.timeline.map((item) => item.author)).toEqual(["early", "late"]);
  });

  it("should hide empty COMMENTED review shells but keep state-bearing reviews", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          reviews: {
            totalCount: 2,
            nodes: [
              { author: { login: "ghost" }, state: "COMMENTED", bodyHTML: "", createdAt: "2026-07-04T00:00:00Z", comments: { totalCount: 0 } },
              { author: { login: "judge" }, state: "CHANGES_REQUESTED", bodyHTML: "", createdAt: "2026-07-05T00:00:00Z", comments: { totalCount: 0 } },
            ],
          },
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.timeline.filter((item) => item.kind === "review").map((item) => item.author)).toEqual(["judge"]);
  });

  it("should flag the timeline as truncated when older items exist", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({ comments: { totalCount: 45, nodes: [{ author: { login: "mario" }, bodyHTML: "<p>x</p>", createdAt: "2026-07-02T00:00:00Z" }] } }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.timelineTruncated).toBe(true);
  });

  it("should map no allowed merge methods to an empty list", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          repository: { nameWithOwner: "acme/repo", mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false },
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.mergeMethods).toEqual([]);
  });

  it("should let a pending re-request win over the reviewer's previous review", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          reviewRequests: [{ requestedReviewer: { login: "luigi" } }],
          latestReviews: [{ author: { login: "luigi" }, state: "CHANGES_REQUESTED" }],
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.reviewers).toEqual([{ name: "luigi", state: "REQUESTED" }]);
  });

  it("should map check URLs from detailsUrl and targetUrl", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          statusCheckRollup: {
            contexts: {
              totalCount: 2,
              nodes: [
                { name: "build", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci.example/run/1" },
                { context: "ci/legacy", state: "SUCCESS", targetUrl: "https://ci.example/legacy" },
              ],
            },
          },
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.checks).toEqual([
      { name: "build", status: "FAILURE", url: "https://ci.example/run/1" },
      { name: "ci/legacy", status: "SUCCESS", url: "https://ci.example/legacy" },
    ]);
  });

  it("should map a missing status check rollup to no checks", async () => {
    stubFetch({ data: { node: buildDetailsNode({ statusCheckRollup: null }) } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.checks).toEqual([]);
    expect(details.checksTotal).toBe(0);
  });

  it("should flag the PR as behind base only when the base has commits the head lacks", async () => {
    stubFetch({ data: { node: buildDetailsNode({ baseRef: { compare: { behindBy: 3 } } }) } });
    const behind = await fetchPrDetails("token", "PR_42", "feature/thing");

    stubFetch({ data: { node: buildDetailsNode({ baseRef: { compare: { behindBy: 0 } } }) } });
    const upToDate = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(behind.isBehindBase).toBe(true);
    expect(upToDate.isBehindBase).toBe(false);
  });

  it("should never flag a cross-fork PR as behind, even when a same-named base-repo branch is behind", async () => {
    stubFetch({ data: { node: buildDetailsNode({ headRepository: { nameWithOwner: "someone-else/repo" }, baseRef: { compare: { behindBy: 3 } } }) } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.isBehindBase).toBe(false);
  });

  it("should treat a missing comparison (fork head ref) as not behind", async () => {
    stubFetch({ data: { node: buildDetailsNode({ baseRef: { compare: null } }) } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.isBehindBase).toBe(false);
  });

  it("should send the head ref name as a query variable", async () => {
    stubFetch({ data: { node: buildDetailsNode() } });

    await fetchPrDetails("token", "PR_42", "feature/thing");

    const requestBody = JSON.parse((fetch as Mock).mock.calls[0][1].body as string);
    expect(requestBody.variables).toEqual({ id: "PR_42", headRef: "feature/thing" });
  });

  it("should fall back to the base repo when headRepository is missing", async () => {
    stubFetch({ data: { node: buildDetailsNode({ headRepository: null }) } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.headRepo).toBe("acme/repo");
  });

  it("should map an unexpected mergeable value to UNKNOWN", async () => {
    stubFetch({ data: { node: buildDetailsNode({ mergeable: "WHATEVER" }) } });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.mergeable).toBe("UNKNOWN");
  });

  it("should throw when the node is not found", async () => {
    stubFetch({ data: { node: null } });

    await expect(fetchPrDetails("token", "PR_42", "feature/thing")).rejects.toThrow("Pull request not found");
  });
});

describe("searchRepositories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("should map repository names and drop non-repository nodes", async () => {
    stubFetch({ data: { search: { nodes: [{ nameWithOwner: "acme/repo" }, {}] } } });

    const repositories = await searchRepositories("token", "acme");

    expect(repositories).toEqual(["acme/repo"]);
  });
});

describe("mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function lastRequestBody(): { query: string; variables: Record<string, unknown> } {
    return JSON.parse((fetch as Mock).mock.calls[0][1].body as string);
  }

  it("should post the comment mutation with the PR id and body", async () => {
    stubFetch({ data: { addComment: { clientMutationId: null } } });

    await addPrComment("token", "PR_42", "Nice work");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("addComment");
    expect(requestBody.variables).toEqual({ id: "PR_42", body: "Nice work" });
  });

  it("should post the review mutation with event and body", async () => {
    stubFetch({ data: { addPullRequestReview: { clientMutationId: null } } });

    await submitPrReview("token", "PR_42", "REQUEST_CHANGES", "Please fix");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("addPullRequestReview");
    expect(requestBody.variables).toEqual({ id: "PR_42", event: "REQUEST_CHANGES", body: "Please fix" });
  });

  it("should send a null body for an approve without comment", async () => {
    stubFetch({ data: { addPullRequestReview: { clientMutationId: null } } });

    await submitPrReview("token", "PR_42", "APPROVE", "");

    expect(lastRequestBody().variables).toEqual({ id: "PR_42", event: "APPROVE", body: null });
  });

  it("should post the merge mutation with the merge method", async () => {
    stubFetch({ data: { mergePullRequest: { clientMutationId: null } } });

    await mergePr("token", "PR_42", "SQUASH");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("mergePullRequest");
    expect(requestBody.variables).toEqual({ id: "PR_42", method: "SQUASH" });
  });

  it("should post the update-branch mutation with the PR id and update method", async () => {
    stubFetch({ data: { updatePullRequestBranch: { clientMutationId: null } } });

    await updatePrBranch("token", "PR_42", "REBASE");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("updatePullRequestBranch");
    expect(requestBody.variables).toEqual({ id: "PR_42", method: "REBASE" });
  });

  it("should post the ready-for-review mutation with the PR id", async () => {
    stubFetch({ data: { markPullRequestReadyForReview: { clientMutationId: null } } });

    await markPrReadyForReview("token", "PR_42");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("markPullRequestReadyForReview");
    expect(requestBody.variables).toEqual({ id: "PR_42" });
  });

  it("should throw the GraphQL error message on failure", async () => {
    stubFetch({ errors: [{ message: "Pull request is not mergeable" }] });

    await expect(mergePr("token", "PR_42", "SQUASH")).rejects.toThrow("Pull request is not mergeable");
  });
});
