import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SYSTEM_PROMPT_FILENAME = "github-control-center-brief-system-prompt.txt";
const DEFAULT_TIMEOUT_MS = 120_000;
const DETECT_TIMEOUT_MS = 10_000;
const STDERR_TAIL_CHARS = 400;

function useShell(): boolean {
  // npm installs claude as a .cmd shim on Windows, which spawn cannot run without a shell.
  // Safe: nothing untrusted enters the command line — the prompt travels via stdin.
  return process.platform === "win32";
}

function quoteForShell(argument: string): string {
  const needsQuoting = argument === "" || /[\s"]/.test(argument);
  if (!needsQuoting) {
    return argument;
  }
  return `"${argument.replaceAll('"', '\\"')}"`;
}

function prepareSpawn(command: string, args: string[]): { command: string; args: string[] } {
  if (!useShell()) {
    return { command, args };
  }
  return { command: quoteForShell(command), args: args.map(quoteForShell) };
}

export function detectAi(command: string, timeoutMs = DETECT_TIMEOUT_MS): Promise<boolean> {
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
    // a wedged CLI (network update check, stuck login, a wrapper reading stdin) must never leave
    // availability undetermined and the probe process leaked
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

function killChildTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    // shell: true wraps the CLI in cmd.exe, and child.kill() would only terminate the
    // wrapper — taskkill walks the tree so the actual claude process dies too
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  child.kill();
}

function toFailureMessage(exitCode: number | null, stderr: string): string {
  if (/unknown option/i.test(stderr)) {
    return "The configured Claude Code CLI does not support the required flags — please update Claude Code.";
  }
  const tail = stderr.trim().slice(-STDERR_TAIL_CHARS) || `exit code ${exitCode}`;
  return `Claude CLI failed: ${tail}`;
}

export function runAiPrompt(
  command: string,
  model: string,
  systemPrompt: string,
  prompt: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // --system-prompt-file instead of --system-prompt: the prompt contains newlines,
    // which the win32 shell path cannot carry safely on a command line.
    // mkdtemp gives every run its own private directory: concurrent VSCode windows cannot
    // swap each other's prompt, and a predictable /tmp name cannot be planted by another user.
    let systemPromptDir: string;
    try {
      systemPromptDir = mkdtempSync(join(tmpdir(), "github-control-center-"));
      writeFileSync(join(systemPromptDir, SYSTEM_PROMPT_FILENAME), systemPrompt);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const systemPromptPath = join(systemPromptDir, SYSTEM_PROMPT_FILENAME);

    // --tools "": PR content is untrusted; the model must never execute anything.
    // --setting-sources "": drop user/project CLAUDE.md, hooks, and settings — verified
    // empirically to be what actually prevents persona/memory contamination.
    const args = ["-p", "--tools", "", "--setting-sources", "", "--system-prompt-file", systemPromptPath];
    if (model) {
      args.push("--model", model);
    }

    const prepared = prepareSpawn(command, args);
    const child = spawn(prepared.command, prepared.args, { cwd: tmpdir(), shell: useShell() });

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
        rmSync(systemPromptDir, { recursive: true, force: true });
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
      settle(new Error(`Claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
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

    // a child that exits before draining stdin (old CLI rejecting a flag) emits EPIPE on the
    // stream; without a listener that is an uncaught exception. The outcome is decided by the
    // close handler either way — the listener only keeps the failure on the friendly path.
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
