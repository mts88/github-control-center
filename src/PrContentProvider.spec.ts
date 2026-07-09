import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { PrContentProvider } from "./PrContentProvider";
import { encodePrUriParts, PR_URI_SCHEME, type IPrFileRef } from "./prUri";

function buildRef(overrides: Partial<IPrFileRef> = {}): IPrFileRef {
  return {
    prId: overrides.prId ?? "PR_42",
    repo: overrides.repo ?? "acme/repo",
    prNumber: overrides.prNumber ?? 42,
    path: overrides.path ?? "src/app.ts",
    sha: overrides.sha ?? "abc123",
    headOid: overrides.headOid ?? "head456",
    side: overrides.side ?? "RIGHT",
    isEmpty: overrides.isEmpty ?? false,
  };
}

function toUri(ref: IPrFileRef): vscode.Uri {
  const { path, query } = encodePrUriParts(ref);
  return vscode.Uri.from({ scheme: PR_URI_SCHEME, path, query });
}

describe("PrContentProvider", () => {
  it("should return an empty string for the empty side without fetching", async () => {
    const fetchContent = vi.fn();
    const provider = new PrContentProvider(fetchContent);

    const content = await provider.provideTextDocumentContent(toUri(buildRef({ isEmpty: true })));

    expect(content).toBe("");
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("should fetch and return the pinned file content", async () => {
    const fetchContent = vi.fn(async () => "file body");
    const provider = new PrContentProvider(fetchContent);

    const content = await provider.provideTextDocumentContent(toUri(buildRef()));

    expect(content).toBe("file body");
    expect(fetchContent).toHaveBeenCalledWith(buildRef());
  });

  it("should cache content by uri and not fetch twice", async () => {
    const fetchContent = vi.fn(async () => "file body");
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    await provider.provideTextDocumentContent(uri);
    await provider.provideTextDocumentContent(uri);

    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("should not cache bodies larger than one megabyte", async () => {
    const bigBody = "x".repeat(1_048_577);
    const fetchContent = vi.fn(async () => bigBody);
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    await provider.provideTextDocumentContent(uri);
    await provider.provideTextDocumentContent(uri);

    expect(fetchContent).toHaveBeenCalledTimes(2);
  });

  it("should propagate fetch errors so the editor surfaces them", async () => {
    const fetchContent = vi.fn(async () => {
      throw new Error("404");
    });
    const provider = new PrContentProvider(fetchContent);

    await expect(provider.provideTextDocumentContent(toUri(buildRef()))).rejects.toThrow("404");
  });
});
