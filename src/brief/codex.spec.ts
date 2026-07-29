import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({ mkdtempSync: vi.fn(), rmSync: vi.fn() }));

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { detectCodex, LOCKDOWN_ARGS, runCodexPrompt } from "./codex";

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

const FAKE_CWD = join(tmpdir(), "ghcc-fake-codex-cwd");
const spawnMock = vi.mocked(spawn);
let child: IFakeChild;

beforeEach(() => {
  child = buildFakeChild();
  spawnMock.mockReturnValue(child as never);
  vi.mocked(mkdtempSync).mockReturnValue(FAKE_CWD);
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

describe("detectCodex", () => {
  it("should resolve true when the binary exits 0", async () => {
    const result = detectCodex("codex");
    child.emit("close", 0);

    await expect(result).resolves.toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("codex", ["--version"], expect.objectContaining({ shell: false }));
  });

  it("should resolve false when the binary is missing", async () => {
    const result = detectCodex("codex");
    child.emit("error", new Error("ENOENT"));

    await expect(result).resolves.toBe(false);
  });

  it("should resolve false on a non-zero exit", async () => {
    const result = detectCodex("codex");
    child.emit("close", 1);

    await expect(result).resolves.toBe(false);
  });

  it("should close stdin so a probe that reads it cannot block", () => {
    detectCodex("codex");

    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("should resolve false and kill a probe that hangs past the timeout", async () => {
    vi.useFakeTimers();
    const result = detectCodex("codex", 5_000);
    vi.advanceTimersByTime(5_001);

    await expect(result).resolves.toBe(false);
    expect(child.kill).toHaveBeenCalled();
  });
});

describe("runCodexPrompt", () => {
  it("should spawn headlessly with the stdin sentinel and every lockdown arg", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(0, "summary");

    await expect(result).resolves.toBe("summary");
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "-", ...LOCKDOWN_ARGS],
      expect.objectContaining({ cwd: FAKE_CWD, shell: false }),
    );
  });

  it("should isolate the run in a fresh empty temp cwd per run", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(mkdtempSync).toHaveBeenCalledWith(join(tmpdir(), "github-control-center-codex-"));
  });

  it("should remove the temp cwd when the run succeeds", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(rmSync).toHaveBeenCalledWith(FAKE_CWD, { recursive: true, force: true });
  });

  it("should remove the temp cwd when the run fails", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(1, "", "boom");

    await expect(result).rejects.toThrow();
    expect(rmSync).toHaveBeenCalledWith(FAKE_CWD, { recursive: true, force: true });
  });

  it("should combine the system prompt and the user prompt into one message delivered via stdin, then close it", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(0, "ok");

    await result;
    expect(child.stdin.written).toBe("SYSTEM\n\nPROMPT");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("should survive a stdin write failure and still report the close failure", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    child.stdin.emit("error", new Error("write EPIPE"));
    finish(1, "", "error: unrecognized argument '--ignore-rules'");

    await expect(result).rejects.toThrow(/update the codex cli/i);
  });

  it("should resolve with trimmed stdout", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(0, "  summary text\n");

    await expect(result).resolves.toBe("summary text");
  });

  it("should reject with the stderr tail on a non-zero exit", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(1, "", "Please run codex login first");

    await expect(result).rejects.toThrow(/login/);
  });

  it("should map an unknown-option failure to an update hint", async () => {
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
    finish(1, "", "error: unknown option '--ephemeral'");

    await expect(result).rejects.toThrow(/update the codex cli/i);
  });

  it("should reject when spawning fails outright", async () => {
    const result = runCodexPrompt("missing-binary", "SYSTEM", "PROMPT");
    child.emit("error", new Error("spawn missing-binary ENOENT"));

    await expect(result).rejects.toThrow(/ENOENT/);
  });

  it("should kill the process and reject on timeout", async () => {
    vi.useFakeTimers();
    const result = runCodexPrompt("codex", "SYSTEM", "PROMPT", 5_000);
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

    it("should spawn through a shell", async () => {
      const result = runCodexPrompt("codex", "SYSTEM", "PROMPT");
      finish(0, "ok");

      await result;
      const [, , options] = spawnMock.mock.calls[0] as [string, string[], { shell: boolean }];
      expect(options.shell).toBe(true);
    });

    it("should kill the whole process tree on timeout, not just the shell wrapper", async () => {
      vi.useFakeTimers();
      const result = runCodexPrompt("codex", "SYSTEM", "PROMPT", 5_000);
      const expectation = expect(result).rejects.toThrow(/timed out/i);
      vi.advanceTimersByTime(5_001);

      await expectation;
      expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/T", "/F"]);
      expect(child.kill).not.toHaveBeenCalled();
    });
  });
});
