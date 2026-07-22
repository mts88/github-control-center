import type { IPrFile, IPrFilePatch } from "./types";

/** patch bytes included in a prompt before degrading to list-only entries */
export const PATCH_BUDGET_BYTES = 60_000;
/** file-list lines are cheap but a generated-code PR can ship thousands: cap the least-useful signal */
export const MAX_FILE_LINES = 300;

export function churnOf(file: IPrFile): number {
  return file.additions + file.deletions;
}

export function sortByChurnDescending(files: IPrFile[]): IPrFile[] {
  return [...files].sort((left, right) => churnOf(right) - churnOf(left));
}

export function formatFileLine(file: IPrFile): string {
  return `- ${file.path} (+${file.additions}/-${file.deletions}, ${file.changeType})`;
}

// highest-churn files first so the cap drops the least-informative entries, not the core change
export function listFileLines(byChurnDescending: IPrFile[], maxLines = MAX_FILE_LINES): string[] {
  if (byChurnDescending.length <= maxLines) {
    return byChurnDescending.map(formatFileLine);
  }
  const lines = byChurnDescending.slice(0, maxLines).map(formatFileLine);
  lines.push(`- … ${byChurnDescending.length - maxLines} more files not shown`);
  return lines;
}

// keep the highest-churn file represented even when its own patch exceeds the whole budget:
// truncate at the last hunk boundary that fits rather than dropping it entirely
export function truncatePatchToBudget(patch: string, budget: number): string {
  if (patch.length <= budget) {
    return patch;
  }
  const head = patch.slice(0, budget);
  const lastHunk = head.lastIndexOf("\n@@ ");
  const body = lastHunk > 0 ? head.slice(0, lastHunk) : head;
  return `${body}\n… patch truncated (over size budget) …`;
}

export function renderPatchSection(byChurnDescending: IPrFile[], patches: Map<string, IPrFilePatch>, budget = PATCH_BUDGET_BYTES): string {
  const sections: string[] = [];
  let usedBytes = 0;
  for (const file of byChurnDescending) {
    const patch = patches.get(file.path)?.patch;
    if (!patch) {
      continue;
    }
    const remaining = budget - usedBytes;
    if (remaining <= 0) {
      break;
    }
    const included = truncatePatchToBudget(patch, remaining);
    usedBytes += included.length;
    sections.push(`=== ${file.path} ===\n${included}`);
  }
  return sections.join("\n\n");
}
