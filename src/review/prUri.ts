import type { DiffSide } from "../core/types";

export const PR_URI_SCHEME = "ghcc-pr";

export interface IPrFileRef {
  prId: string;
  repo: string;
  prNumber: number;
  path: string;
  /** git oid the content is pinned to: base oid for LEFT, head oid for RIGHT */
  sha: string;
  /** always the PR head oid — the patch-cache key, regardless of side */
  headOid: string;
  side: DiffSide;
  /** synthetic empty side: LEFT of an added file, RIGHT of a deleted one */
  isEmpty: boolean;
}

export function encodePrUriParts(ref: IPrFileRef): { path: string; query: string } {
  const query = new URLSearchParams({
    prId: ref.prId,
    repo: ref.repo,
    number: String(ref.prNumber),
    sha: ref.sha,
    headOid: ref.headOid,
    side: ref.side,
  });
  if (ref.isEmpty) {
    query.set("empty", "1");
  }
  return { path: `/${ref.path}`, query: query.toString() };
}

export function decodePrUriParts(path: string, query: string): IPrFileRef {
  const params = new URLSearchParams(query);
  const prId = params.get("prId");
  const repo = params.get("repo");
  const prNumber = params.get("number");
  const sha = params.get("sha");
  const headOid = params.get("headOid");
  const side = params.get("side");
  if (!prId || !repo || !prNumber || !sha || !headOid || (side !== "LEFT" && side !== "RIGHT")) {
    throw new Error(`Malformed ${PR_URI_SCHEME} uri query: ${query}`);
  }
  return {
    prId,
    repo,
    prNumber: Number(prNumber),
    path: path.replace(/^\//, ""),
    sha,
    headOid,
    side,
    isEmpty: params.get("empty") === "1",
  };
}
