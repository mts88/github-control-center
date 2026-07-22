import { HUNK_HEADER } from "./diffPatch";
import type { DiffSide, IPrFile, IPrFilePatch } from "../core/types";

export type FindingSeverity = "info" | "warning" | "issue";
const SEVERITIES: readonly FindingSeverity[] = ["info", "warning", "issue"];

/** the model's raw finding, already field-validated but not yet anchored to a real diff line */
export interface IRawFinding {
  path: string;
  side: DiffSide;
  /** verbatim source text of the target line, used to resolve the real line number */
  snippet: string;
  /** the model's own line guess — only a fallback hint, snippet resolution is authoritative */
  line: number;
  severity: FindingSeverity;
  comment: string;
}

export type IParsedFindings = { kind: "findings"; findings: IRawFinding[] } | { kind: "report"; text: string };

export type IAnchoredFinding =
  | { subjectType: "LINE"; path: string; side: DiffSide; line: number; severity: FindingSeverity; comment: string }
  | { subjectType: "FILE"; path: string; severity: FindingSeverity; comment: string }
  /** valid shape but the path does not match any file in the PR — a hallucination, never offered for insertion */
  | { subjectType: "UNANCHORABLE"; path: string; severity: FindingSeverity; comment: string };

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function toRawFinding(item: unknown): IRawFinding | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }
  const { path, side, snippet, line, severity, comment } = item as Record<string, unknown>;
  if (typeof path !== "string" || !path.trim()) {
    return undefined;
  }
  if (side !== "LEFT" && side !== "RIGHT") {
    return undefined;
  }
  if (typeof snippet !== "string" || !snippet.trim()) {
    return undefined;
  }
  if (typeof comment !== "string" || !comment.trim()) {
    return undefined;
  }
  const resolvedSeverity = SEVERITIES.includes(severity as FindingSeverity) ? (severity as FindingSeverity) : "issue";
  const resolvedLine = typeof line === "number" && Number.isFinite(line) ? line : 0;
  return { path, side, snippet, line: resolvedLine, severity: resolvedSeverity, comment };
}

/**
 * The model is instructed to respond with only a JSON array (reviewPrompt.ts), but that is a
 * request, not a guarantee. A parse failure or a non-array response degrades to a plain-text
 * report instead of losing the model's output entirely.
 */
export function parseFindings(raw: string): IParsedFindings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { kind: "report", text: raw };
  }
  if (!Array.isArray(parsed)) {
    return { kind: "report", text: raw };
  }
  const findings = parsed.map(toRawFinding).filter((item): item is IRawFinding => item !== undefined);
  return { kind: "findings", findings };
}

// same line-number bookkeeping as diffPatch.ts's commentableRanges, but matching line content
// instead of collecting ranges: the model's line guess is unreliable, the snippet is not
function findSnippetLine(patch: string, side: DiffSide, snippet: string): number | undefined {
  const target = snippet.trim();
  if (!target) {
    return undefined;
  }
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
      if (side === "RIGHT" && line.slice(1).trim() === target) {
        return newLine;
      }
      newLine++;
      continue;
    }
    if (line.startsWith("-")) {
      if (side === "LEFT" && line.slice(1).trim() === target) {
        return oldLine;
      }
      oldLine++;
      continue;
    }
    if (line.startsWith(" ")) {
      const lineNumber = side === "RIGHT" ? newLine : oldLine;
      if (line.slice(1).trim() === target) {
        return lineNumber;
      }
      oldLine++;
      newLine++;
    }
  }
  return undefined;
}

/**
 * Resolves each raw finding against the real PR diff. GitHub rejects out-of-diff line comments,
 * so a finding only gets a LINE anchor when its snippet is actually found on that side of the
 * patch; otherwise it degrades to a FILE-level comment (always accepted) rather than being
 * dropped. A path that matches no file in the PR is a hallucination and is never offered for
 * insertion at all.
 */
export function anchorFindings(findings: IRawFinding[], files: IPrFile[], patches: Map<string, IPrFilePatch>): IAnchoredFinding[] {
  const knownPaths = new Set(files.map((file) => file.path));
  return findings.map((raw) => {
    if (!knownPaths.has(raw.path)) {
      return { subjectType: "UNANCHORABLE", path: raw.path, severity: raw.severity, comment: raw.comment };
    }
    const patch = patches.get(raw.path)?.patch;
    const resolvedLine = patch ? findSnippetLine(patch, raw.side, raw.snippet) : undefined;
    if (resolvedLine !== undefined) {
      return { subjectType: "LINE", path: raw.path, side: raw.side, line: resolvedLine, severity: raw.severity, comment: raw.comment };
    }
    return { subjectType: "FILE", path: raw.path, severity: raw.severity, comment: raw.comment };
  });
}
