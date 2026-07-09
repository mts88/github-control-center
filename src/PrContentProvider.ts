import * as vscode from "vscode";
import { decodePrUriParts, encodePrUriParts, PR_URI_SCHEME, type IPrFileRef } from "./prUri";

// ponytail: memory ceiling — sha-pinned content is immutable so small files cache forever,
// bodies above this stay uncached and re-fetch on each render
const MAX_CACHED_BODY_BYTES = 1_048_576;

export function toPrUri(ref: IPrFileRef): vscode.Uri {
  const { path, query } = encodePrUriParts(ref);
  return vscode.Uri.from({ scheme: PR_URI_SCHEME, path, query });
}

export function fromPrUri(uri: vscode.Uri): IPrFileRef {
  return decodePrUriParts(uri.path, uri.query);
}

export class PrContentProvider implements vscode.TextDocumentContentProvider {
  private readonly cache = new Map<string, string>();

  constructor(private readonly fetchContent: (ref: IPrFileRef) => Promise<string>) {}

  // fetch errors intentionally propagate: opening a diff is user-initiated,
  // so the editor surfaces the failure (unlike the silent poll loop)
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = fromPrUri(uri);
    if (ref.isEmpty) {
      return "";
    }
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const content = await this.fetchContent(ref);
    if (content.length <= MAX_CACHED_BODY_BYTES) {
      this.cache.set(key, content);
    }
    return content;
  }
}
