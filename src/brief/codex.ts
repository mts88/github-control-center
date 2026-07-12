import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killChildTree, prepareSpawn, useShell } from "./spawn";

const DEFAULT_TIMEOUT_MS = 120_000;
const DETECT_TIMEOUT_MS = 10_000;
const STDERR_TAIL_CHARS = 400;

// Best-effort lockdown: unlike Claude's single `--tools ""`, Codex has no master tool
// kill-switch — each built-in tool is disabled individually and this is NOT a guarantee.
// `--sandbox read-only` blocks writes but not reads, and file-read may be intrinsic to the
// agent and survive every flag below. See CLAUDE.md's AI brief section for the accepted
// residual risk (a malicious PR could still make the model read and echo local files).
// ponytail: re-audit whenever the Codex CLI is bumped — a new default-on tool widens the
// untrusted surface further.
export const LOCKDOWN_ARGS = [
  "--sandbox",
  "read-only", // blocks writes; does NOT block reads (documented semantics)
  "--skip-git-repo-check", // the temp cwd is not a git repo
  "--ephemeral", // do not persist session rollout files
  "--ignore-user-config", // skip $CODEX_HOME/config.toml (persona/memory/MCP-server leak)
  "--ignore-rules", // skip user/project execpolicy rules
  "-c",
  "features.shell_tool=false",
  "-c",
  "features.web_search=false",
  "-c",
  "tools.view_image=false",
  "-c",
  "project_doc_max_bytes=0", // best-effort: zero out any AGENTS.md/TEAM_GUIDE.md content Codex
  // might pick up walking the cwd's ancestor chain — --ignore-user-config is confirmed only for
  // config.toml, NOT for project-doc discovery (a separate, less-documented mechanism)
];

export function detectCodex(command: string, timeoutMs = DETECT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const prepared = prepareSpawn(command, ["--version"]);
    const child = spawn(prepared.command, prepared.args, { shell: useShell() });
    let settled = false;
    function finish(available: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(available);
    }
    // a wedged CLI must never leave availability undetermined and the probe process leaked
    const timer = setTimeout(() => {
      killChildTree(child);
      finish(false);
    }, timeoutMs);
    child.on("error", () => finish(false));
    child.on("close", (exitCode) => finish(exitCode === 0));
    // close stdin so a child that reads it does not block; a fast exit can EPIPE the end()
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });
}

function toFailureMessage(exitCode: number | null, stderr: string): string {
  if (/unknown option|unrecognized argument/i.test(stderr)) {
    return "The configured Codex CLI does not support the required flags — please update the Codex CLI.";
  }
  const tail = stderr.trim().slice(-STDERR_TAIL_CHARS) || `exit code ${exitCode}`;
  return `Codex CLI failed: ${tail}`;
}

export function runCodexPrompt(command: string, systemPrompt: string, prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    // Codex has no separate system-prompt flag: combine into one message. The untrusted-data
    // framing already lives inside buildBriefPrompt (brief/briefPrompt.ts) — this is a
    // mitigation, not a wall, since Codex also has no distinct "system" role to lean on.
    const combinedPrompt = `${systemPrompt}\n\n${prompt}`;

    // a fresh, empty mkdtemp cwd per run: Codex discovers no project AGENTS.md walking up from
    // an empty directory; mkdtemp also means concurrent runs never share a cwd
    let cwd: string;
    try {
      cwd = mkdtempSync(join(tmpdir(), "github-control-center-codex-"));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    // "-" sentinel: codex exec reads the whole prompt from stdin, never argv (mirrors Claude;
    // avoids win32 newline/injection issues)
    const args = ["exec", "-", ...LOCKDOWN_ARGS];
    const prepared = prepareSpawn(command, args);
    const child = spawn(prepared.command, prepared.args, { cwd, shell: useShell() });

    let stdout = "";
    let stderr = "";
    let settled = false;

    function settle(error: Error | undefined, value?: string): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // best-effort cleanup: a leftover temp directory must never mask the real outcome
      }
      if (error) {
        reject(error);
      } else {
        resolve(value ?? "");
      }
    }

    const timer = setTimeout(() => {
      killChildTree(child);
      settle(new Error(`Codex CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => settle(error));
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        settle(undefined, stdout.trim());
      } else {
        settle(new Error(toFailureMessage(exitCode, stderr)));
      }
    });

    // codex exec (given no positional prompt and reading stdin via "-") hangs in some
    // non-TTY environments unless stdin actually reaches EOF; writing then ending stdin
    // avoids that documented hang. A child that exits before draining stdin emits EPIPE on
    // the stream; without a listener that is an uncaught exception — the outcome is decided
    // by the close handler either way, the listener only keeps the failure on the friendly path.
    child.stdin.on("error", () => {});
    child.stdin.write(combinedPrompt);
    child.stdin.end();
  });
}
