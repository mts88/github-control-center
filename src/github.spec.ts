import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  addPendingReview,
  addPrComment,
  addReviewThread,
  addReviewThreadReply,
  discardPendingReview,
  fetchFileContent,
  fetchPrDetails,
  fetchPrFilePatches,
  fetchPrFiles,
  fetchPullRequests,
  fetchReviewThreads,
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
    number: 1,
    title: overrides.title ?? "A title",
    url: "https://github.com/acme/repo/pull/1",
    isDraft: overrides.isDraft ?? false,
    createdAt: "2026-07-01T00:00:00Z",
    reviewDecision: overrides.reviewDecision ?? null,
    headRefName: "feature/thing",
    baseRefOid: "base-oid",
    headRefOid: "head-oid",
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
        number: 1,
        title: "A title",
        url: "https://github.com/acme/repo/pull/1",
        repo: "acme/repo",
        author: "jane",
        isDraft: false,
        createdAt: "2026-07-01T00:00:00Z",
        ciState: "SUCCESS",
        reviewDecision: "APPROVED",
        headRefName: "feature/thing",
        baseRefOid: "base-oid",
        headRefOid: "head-oid",
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

  it("should deduplicate same-named check runs keeping the latest run", async () => {
    stubFetch({
      data: {
        node: buildDetailsNode({
          statusCheckRollup: {
            contexts: {
              totalCount: 3,
              nodes: [
                { name: "Validate PR title", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci.example/run/21" },
                { name: "check", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example/run/35" },
                { name: "Validate PR title", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example/run/22" },
              ],
            },
          },
        }),
      },
    });

    const details = await fetchPrDetails("token", "PR_42", "feature/thing");

    expect(details.checks).toEqual([
      { name: "Validate PR title", status: "SUCCESS", url: "https://ci.example/run/22" },
      { name: "check", status: "SUCCESS", url: "https://ci.example/run/35" },
    ]);
    expect(details.checksTotal).toBe(2);
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

describe("fetchPrFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function buildFilesPage(nodes: unknown[], endCursor: string | null = null) {
    return {
      data: {
        node: {
          files: {
            nodes,
            pageInfo: { hasNextPage: endCursor !== null, endCursor },
          },
        },
      },
    };
  }

  const fileNode = {
    path: "src/app.ts",
    additions: 10,
    deletions: 2,
    changeType: "MODIFIED",
    viewerViewedState: "UNVIEWED",
  };

  it("should send a node query with the pull request id and map the files", async () => {
    stubFetch(buildFilesPage([fileNode]));

    const files = await fetchPrFiles("token", "PR_42");

    const requestBody = JSON.parse((fetch as Mock).mock.calls[0][1].body as string);
    expect(requestBody.query).toContain("files(");
    expect(requestBody.variables).toEqual({ id: "PR_42", after: null });
    expect(files).toEqual([
      { path: "src/app.ts", additions: 10, deletions: 2, changeType: "MODIFIED", viewedState: "UNVIEWED" },
    ]);
  });

  it("should follow pagination with the end cursor", async () => {
    const firstPage = buildFilesPage([fileNode], "CURSOR_1");
    const secondPage = buildFilesPage([{ ...fileNode, path: "src/other.ts" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => secondPage });
    vi.stubGlobal("fetch", fetchMock);

    const files = await fetchPrFiles("token", "PR_42");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.variables).toEqual({ id: "PR_42", after: "CURSOR_1" });
    expect(files.map((file) => file.path)).toEqual(["src/app.ts", "src/other.ts"]);
  });

  it("should throw when the pull request node is not found", async () => {
    stubFetch({ data: { node: null } });

    await expect(fetchPrFiles("token", "PR_42")).rejects.toThrow("Pull request not found");
  });
});

describe("fetchPrFilePatches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const restFile = {
    filename: "src/app.ts",
    status: "modified",
    additions: 10,
    deletions: 2,
    patch: "@@ -1,2 +1,3 @@",
  };

  function stubRestPages(...pages: unknown[][]): Mock {
    const fetchMock = vi.fn();
    for (const page of pages) {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("should call the pulls files endpoint with per_page 100 and the token header", async () => {
    const fetchMock = stubRestPages([restFile]);

    await fetchPrFilePatches("token", "acme/repo", 42);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/repo/pulls/42/files?per_page=100&page=1");
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("should map previous_filename to previousPath and keep patch undefined when absent", async () => {
    stubRestPages([
      { filename: "src/renamed.ts", previous_filename: "src/old.ts", patch: "@@ -1 +1 @@" },
      { filename: "assets/logo.png" },
    ]);

    const patches = await fetchPrFilePatches("token", "acme/repo", 42);

    expect(patches).toEqual([
      { path: "src/renamed.ts", previousPath: "src/old.ts", patch: "@@ -1 +1 @@" },
      { path: "assets/logo.png", previousPath: undefined, patch: undefined },
    ]);
  });

  it("should follow pagination while a full page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (unused, fileIndex) => ({ ...restFile, filename: `src/file${fileIndex}.ts` }));
    const fetchMock = stubRestPages(fullPage, [restFile]);

    const patches = await fetchPrFilePatches("token", "acme/repo", 42);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
    expect(patches).toHaveLength(101);
  });

  it("should throw on a non-ok response", async () => {
    stubFetch({}, 404);

    await expect(fetchPrFilePatches("token", "acme/repo", 42)).rejects.toThrow("404");
  });
});

describe("fetchFileContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("should request the contents endpoint with the raw media type and return the body text", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "file body" }));
    vi.stubGlobal("fetch", fetchMock);

    const content = await fetchFileContent("token", "acme/repo", "src/nested/app.ts", "abc123");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.github.com/repos/acme/repo/contents/src/nested/app.ts?ref=abc123");
    expect(init.headers.Accept).toBe("application/vnd.github.raw+json");
    expect(content).toBe("file body");
  });

  it("should escape special characters in the file path", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFileContent("token", "acme/repo", "docs/my file #1.md", "abc123");

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.github.com/repos/acme/repo/contents/docs/my%20file%20%231.md?ref=abc123");
  });

  it("should throw on a non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFileContent("token", "acme/repo", "src/app.ts", "abc123")).rejects.toThrow("404");
  });
});

describe("fetchReviewThreads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  interface IThreadsPayloadOptions {
    threads?: unknown[];
    pendingReviews?: unknown[];
    viewerLogin?: string;
  }

  function stubThreadsPayload(options: IThreadsPayloadOptions = {}): void {
    stubFetch({
      data: {
        viewer: { login: options.viewerLogin ?? "me" },
        node: {
          reviewThreads: { nodes: options.threads ?? [] },
          reviews: { nodes: options.pendingReviews ?? [] },
        },
      },
    });
  }

  const graphQlThread = {
    id: "RT_1",
    path: "src/app.ts",
    line: 10,
    startLine: null,
    diffSide: "RIGHT",
    startDiffSide: null,
    isResolved: false,
    isOutdated: false,
    subjectType: "LINE",
    comments: {
      nodes: [{ id: "C_1", author: { login: "jane" }, body: "Fix this", createdAt: "2026-07-01T00:00:00Z", state: "SUBMITTED" }],
    },
  };

  it("should map review threads with comments and pending flags", async () => {
    stubThreadsPayload({
      threads: [
        {
          ...graphQlThread,
          comments: { nodes: [...graphQlThread.comments.nodes, { id: "C_2", author: null, body: "draft", createdAt: "2026-07-02T00:00:00Z", state: "PENDING" }] },
        },
      ],
    });

    const snapshot = await fetchReviewThreads("token", "PR_42");

    expect(snapshot.threads).toEqual([
      {
        id: "RT_1",
        path: "src/app.ts",
        line: 10,
        startLine: null,
        side: "RIGHT",
        startSide: null,
        isResolved: false,
        isOutdated: false,
        subjectType: "LINE",
        comments: [
          { id: "C_1", author: "jane", bodyMarkdown: "Fix this", createdAt: "2026-07-01T00:00:00Z", isPending: false },
          { id: "C_2", author: "unknown", bodyMarkdown: "draft", createdAt: "2026-07-02T00:00:00Z", isPending: true },
        ],
      },
    ]);
  });

  it("should expose the viewer pending review id and comment count", async () => {
    stubThreadsPayload({
      pendingReviews: [{ id: "REV_9", author: { login: "me" }, comments: { totalCount: 3 } }],
    });

    const snapshot = await fetchReviewThreads("token", "PR_42");

    expect(snapshot.pendingReviewId).toBe("REV_9");
    expect(snapshot.pendingCommentCount).toBe(3);
  });

  it("should ignore pending reviews from other users", async () => {
    stubThreadsPayload({
      pendingReviews: [{ id: "REV_OTHER", author: { login: "someone-else" }, comments: { totalCount: 5 } }],
    });

    const snapshot = await fetchReviewThreads("token", "PR_42");

    expect(snapshot.pendingReviewId).toBeNull();
    expect(snapshot.pendingCommentCount).toBe(0);
  });

  it("should return a null pending review when none exists", async () => {
    stubThreadsPayload();

    const snapshot = await fetchReviewThreads("token", "PR_42");

    expect(snapshot.pendingReviewId).toBeNull();
  });

  it("should throw when the pull request node is not found", async () => {
    stubFetch({ data: { viewer: { login: "me" }, node: null } });

    await expect(fetchReviewThreads("token", "PR_42")).rejects.toThrow("Pull request not found");
  });
});

describe("thread mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function lastRequestBody(): { query: string; variables: Record<string, unknown> } {
    return JSON.parse((fetch as Mock).mock.calls[0][1].body as string);
  }

  it("should send resolveReviewThread with the thread id", async () => {
    stubFetch({ data: { resolveReviewThread: { clientMutationId: null } } });

    await resolveThread("token", "RT_1");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("resolveReviewThread");
    expect(requestBody.variables).toEqual({ id: "RT_1" });
  });

  it("should send unresolveReviewThread with the thread id", async () => {
    stubFetch({ data: { unresolveReviewThread: { clientMutationId: null } } });

    await unresolveThread("token", "RT_1");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("unresolveReviewThread");
    expect(requestBody.variables).toEqual({ id: "RT_1" });
  });
});

describe("review mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function lastRequestBody(): { query: string; variables: Record<string, unknown> } {
    return JSON.parse((fetch as Mock).mock.calls[0][1].body as string);
  }

  it("should send addPullRequestReview without an event and return the pending review id", async () => {
    stubFetch({ data: { addPullRequestReview: { pullRequestReview: { id: "REV_9" } } } });

    const reviewId = await addPendingReview("token", "PR_42");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("addPullRequestReview");
    expect(requestBody.query).not.toContain("$event");
    expect(requestBody.variables).toEqual({ id: "PR_42" });
    expect(reviewId).toBe("REV_9");
  });

  it("should send a LINE thread with line, side and body", async () => {
    stubFetch({ data: { addPullRequestReviewThread: { clientMutationId: null } } });

    await addReviewThread("token", { prId: "PR_42", body: "Fix this", path: "src/app.ts", subjectType: "LINE", line: 10, side: "RIGHT" });

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("addPullRequestReviewThread");
    expect(requestBody.variables).toEqual({
      input: { pullRequestId: "PR_42", body: "Fix this", path: "src/app.ts", subjectType: "LINE", line: 10, side: "RIGHT" },
    });
  });

  it("should send startLine and startSide for a multi-line thread", async () => {
    stubFetch({ data: { addPullRequestReviewThread: { clientMutationId: null } } });

    await addReviewThread("token", {
      prId: "PR_42",
      body: "Span",
      path: "src/app.ts",
      subjectType: "LINE",
      line: 7,
      startLine: 4,
      side: "RIGHT",
      startSide: "RIGHT",
    });

    expect(lastRequestBody().variables).toEqual({
      input: { pullRequestId: "PR_42", body: "Span", path: "src/app.ts", subjectType: "LINE", line: 7, startLine: 4, side: "RIGHT", startSide: "RIGHT" },
    });
  });

  it("should send a FILE thread without line fields", async () => {
    stubFetch({ data: { addPullRequestReviewThread: { clientMutationId: null } } });

    await addReviewThread("token", { prId: "PR_42", body: "Whole file", path: "src/app.ts", subjectType: "FILE" });

    expect(lastRequestBody().variables).toEqual({
      input: { pullRequestId: "PR_42", body: "Whole file", path: "src/app.ts", subjectType: "FILE" },
    });
  });

  it("should send a reply with the thread id and body", async () => {
    stubFetch({ data: { addPullRequestReviewThreadReply: { clientMutationId: null } } });

    await addReviewThreadReply("token", "RT_1", "Agreed");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("addPullRequestReviewThreadReply");
    expect(requestBody.variables).toEqual({ threadId: "RT_1", body: "Agreed" });
  });

  it("should submit the pending review with the event and body", async () => {
    stubFetch({ data: { submitPullRequestReview: { clientMutationId: null } } });

    await submitPendingReview("token", "PR_42", "REQUEST_CHANGES", "Please fix");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("submitPullRequestReview");
    expect(requestBody.variables).toEqual({ id: "PR_42", event: "REQUEST_CHANGES", body: "Please fix" });
  });

  it("should submit with a null body when empty", async () => {
    stubFetch({ data: { submitPullRequestReview: { clientMutationId: null } } });

    await submitPendingReview("token", "PR_42", "COMMENT", "");

    expect(lastRequestBody().variables).toEqual({ id: "PR_42", event: "COMMENT", body: null });
  });

  it("should send markFileAsViewed when marking a file viewed", async () => {
    stubFetch({ data: { markFileAsViewed: { clientMutationId: null } } });

    await setFileViewed("token", "PR_42", "src/app.ts", true);

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("markFileAsViewed");
    expect(requestBody.variables).toEqual({ id: "PR_42", path: "src/app.ts" });
  });

  it("should send unmarkFileAsViewed when marking a file unviewed", async () => {
    stubFetch({ data: { unmarkFileAsViewed: { clientMutationId: null } } });

    await setFileViewed("token", "PR_42", "src/app.ts", false);

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("unmarkFileAsViewed");
    expect(requestBody.variables).toEqual({ id: "PR_42", path: "src/app.ts" });
  });

  it("should discard the pending review by id", async () => {
    stubFetch({ data: { deletePullRequestReview: { clientMutationId: null } } });

    await discardPendingReview("token", "REV_9");

    const requestBody = lastRequestBody();
    expect(requestBody.query).toContain("deletePullRequestReview");
    expect(requestBody.variables).toEqual({ reviewId: "REV_9" });
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
