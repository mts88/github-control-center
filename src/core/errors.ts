/** Shared across extension.ts and PrTreeProvider.ts: both need to turn a caught `unknown` into user-facing text. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
