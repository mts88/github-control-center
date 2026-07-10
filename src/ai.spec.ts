import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({ writeFileSync: vi.fn(), mkdtempSync: vi.fn(), rmSync: vi.fn() }));

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { detectAi, runAiPrompt, SYSTEM_PROMPT_FILENAME } from "./ai";

interface IFakeStdin extends EventEmitter {
  written: string;
  write: (chunk: string) => void;
  end: ReturnType<typeof vi.fn>;
}

interface IFakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: IFakeStdin;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

function buildFakeChild(): IFakeChild {
  const child = new EventEmitter() as IFakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as IFakeStdin;
  stdin.written = "";
  stdin.write = (chunk: string) => {
    stdin.written += chunk;
  };
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.pid = 4242;
  child.kill = vi.fn();
  return child;
}

const FAKE_PROMPT_DIR = join(tmpdir(), "ghcc-fake-prompt-dir");
const spawnMock = vi.mocked(spawn);
let child: IFakeChild;

beforeEach(() => {
  child = buildFakeChild();
  spawnMock.mockReturnValue(child as never);
  vi.mocked(mkdtempSync).mockReturnValue(FAKE_PROMPT_DIR);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function finish(exitCode: number, stdout = "", stderr = ""): void {
  if (stdout) {
    child.stdout.emit("data", stdout);
  }
  if (stderr) {
    child.stderr.emit("data", stderr);
  }
  child.emit("close", exitCode);
}

describe("detectAi", () => {
  it("should resolve true when the binary exits 0", async () => {
    const result = detectAi("claude");
    child.emit("close", 0);

    await expect(result).resolves.toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("claude", ["--version"], expect.objectContaining({ shell: false }));
  });

  it("should resolve false when the binary is missing", async () => {
    const result = detectAi("claude");
    child.emit("error", new Error("ENOENT"));

    await expect(result).resolves.toBe(false);
  });

  it("should resolve false on a non-zero exit", async () => {
    const result = detectAi("claude");
    child.emit("close", 1);

    await expect(result).resolves.toBe(false);
  });
});

describe("runAiPrompt", () => {
  it("should spawn with headless flags, isolated settings, system prompt file, and model", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(0, "summary");

    await expect(result).resolves.toBe("summary");
    const systemPromptPath = join(FAKE_PROMPT_DIR, SYSTEM_PROMPT_FILENAME);
    expect(writeFileSync).toHaveBeenCalledWith(systemPromptPath, "SYSTEM");
    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      ["-p", "--tools", "", "--setting-sources", "", "--system-prompt-file", systemPromptPath, "--model", "sonnet"],
      expect.objectContaining({ cwd: tmpdir(), shell: false }),
    );
  });

  it("should isolate the system prompt in a fresh private temp directory per run", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(mkdtempSync).toHaveBeenCalledWith(join(tmpdir(), "github-control-center-"));
    expect(writeFileSync).toHaveBeenCalledWith(join(FAKE_PROMPT_DIR, SYSTEM_PROMPT_FILENAME), "SYSTEM");
  });

  it("should remove the temp directory when the run succeeds", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(rmSync).toHaveBeenCalledWith(FAKE_PROMPT_DIR, { recursive: true, force: true });
  });

  it("should remove the temp directory when the run fails", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(1, "", "boom");

    await expect(result).rejects.toThrow();
    expect(rmSync).toHaveBeenCalledWith(FAKE_PROMPT_DIR, { recursive: true, force: true });
  });

  it("should survive a stdin write failure and still report the close failure", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    child.stdin.emit("error", new Error("write EPIPE"));
    finish(1, "", "error: unknown option '--setting-sources'");

    await expect(result).rejects.toThrow(/update Claude Code/i);
  });

  it("should omit --model when the model is empty", async () => {
    const result = runAiPrompt("claude", "", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).not.toContain("--model");
  });

  it("should deliver the prompt via stdin and close it", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(child.stdin.written).toBe("PROMPT");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("should resolve with trimmed stdout", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(0, "  summary text\n");

    await expect(result).resolves.toBe("summary text");
  });

  it("should reject with the stderr tail on a non-zero exit", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(1, "", "Please run /login first");

    await expect(result).rejects.toThrow(/login/);
  });

  it("should map an unknown-option failure to an update hint", async () => {
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
    finish(1, "", "error: unknown option '--setting-sources'");

    await expect(result).rejects.toThrow(/update Claude Code/i);
  });

  it("should reject when spawning fails outright", async () => {
    const result = runAiPrompt("missing-binary", "sonnet", "SYSTEM", "PROMPT");
    child.emit("error", new Error("spawn missing-binary ENOENT"));

    await expect(result).rejects.toThrow(/ENOENT/);
  });

  it("should kill the process and reject on timeout", async () => {
    vi.useFakeTimers();
    const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT", 5_000);
    const expectation = expect(result).rejects.toThrow(/timed out/i);
    vi.advanceTimersByTime(5_001);

    await expectation;
    expect(child.kill).toHaveBeenCalled();
  });

  describe("on win32", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should spawn through a shell and quote empty and spaced arguments", async () => {
      const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT");
      finish(0, "ok");

      await result;
      const [, args, options] = spawnMock.mock.calls[0] as [string, string[], { shell: boolean }];
      expect(options.shell).toBe(true);
      expect(args).toContain('""');
      expect(args).not.toContain("");
    });

    it("should kill the whole process tree on timeout, not just the shell wrapper", async () => {
      vi.useFakeTimers();
      const result = runAiPrompt("claude", "sonnet", "SYSTEM", "PROMPT", 5_000);
      const expectation = expect(result).rejects.toThrow(/timed out/i);
      vi.advanceTimersByTime(5_001);

      await expectation;
      expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/T", "/F"]);
      expect(child.kill).not.toHaveBeenCalled();
    });
  });
});
