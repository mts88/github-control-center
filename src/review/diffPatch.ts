import type { DiffSide } from "../core/types";

export interface IHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface ILineRange {
  /** 1-based, inclusive, in GitHub diff coordinates */
  start: number;
  end: number;
}

/** exported for reviewFindings.ts, which needs the same hunk-header detection while walking line content */
export const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(patch: string): IHunk[] {
  const hunks: IHunk[] = [];
  for (const line of patch.split("\n")) {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      hunks.push({
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
      });
    }
  }
  return hunks;
}

/**
 * The diff lines GitHub accepts review comments on, per side:
 * RIGHT = context + added lines in new-file numbering, LEFT = context + deleted
 * lines in old-file numbering. An undefined patch (binary/huge file) has none —
 * only file-level comments remain possible.
 */
export function commentableRanges(patch: string | undefined, side: DiffSide): ILineRange[] {
  if (!patch) {
    return [];
  }
  const commentableLines: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const headerMatch = HUNK_HEADER.exec(line);
    if (headerMatch) {
      oldLine = Number(headerMatch[1]);
      newLine = Number(headerMatch[3]);
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("+")) {
      if (side === "RIGHT") {
        commentableLines.push(newLine);
      }
      newLine++;
      continue;
    }
    if (line.startsWith("-")) {
      if (side === "LEFT") {
        commentableLines.push(oldLine);
      }
      oldLine++;
      continue;
    }
    if (line.startsWith(" ")) {
      commentableLines.push(side === "RIGHT" ? newLine : oldLine);
      oldLine++;
      newLine++;
    }
  }
  return toRanges(commentableLines);
}

function toRanges(sortedLines: number[]): ILineRange[] {
  const ranges: ILineRange[] = [];
  for (const line of sortedLines) {
    const lastRange = ranges[ranges.length - 1];
    if (lastRange && line === lastRange.end + 1) {
      lastRange.end = line;
    } else {
      ranges.push({ start: line, end: line });
    }
  }
  return ranges;
}
