import { spawn, type ChildProcess } from "node:child_process";

// shared by every spawn-based AI backend (Claude Code CLI, Codex CLI, ...): the plumbing to
// launch a locally-installed CLI headlessly and tear it down cleanly on timeout/error.

export function useShell(): boolean {
  // npm installs CLIs as a .cmd shim on Windows, which spawn cannot run without a shell.
  // Safe: nothing untrusted enters the command line — the prompt travels via stdin.
  return process.platform === "win32";
}

export function quoteForShell(argument: string): string {
  const needsQuoting = argument === "" || /[\s"]/.test(argument);
  if (!needsQuoting) {
    return argument;
  }
  return `"${argument.replaceAll('"', '\\"')}"`;
}

export function prepareSpawn(command: string, args: string[]): { command: string; args: string[] } {
  if (!useShell()) {
    return { command, args };
  }
  return { command: quoteForShell(command), args: args.map(quoteForShell) };
}

export function killChildTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    // shell: true wraps the CLI in cmd.exe, and child.kill() would only terminate the
    // wrapper — taskkill walks the tree so the actual CLI process dies too
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  child.kill();
}
