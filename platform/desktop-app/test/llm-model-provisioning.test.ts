import { describe, expect, it, vi } from "vitest";
import { InMemoryFileSystem } from "@ryper/local-runtime";
import type { ProcessHandle, ProcessResult, ProcessRunner } from "@ryper/local-runtime";
import {
  LlamaServerManager,
  LlamaServerStartError,
  defaultLlamaServerPaths,
  detectLlamaModelStatus,
  type LlamaServerPaths,
} from "../electron/llm-model-provisioning.js";

const paths: LlamaServerPaths = {
  binaryPath: "/opt/llama/llama-server",
  modelPath: "/opt/llama/model.gguf",
  port: 8090,
};

function fs(files: Record<string, string> = {}): InMemoryFileSystem {
  const memfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    void memfs.writeFile(path, new TextEncoder().encode(content));
  }
  return memfs;
}

/** Deterministic fake — not a real llama-server process. See voice-runtime.real.test.ts for the real counterpart. */
function fakeProcessRunner(behavior: () => Promise<Partial<ProcessResult>> | "never"): {
  runner: ProcessRunner;
  killed: string[];
} {
  const killed: string[] = [];
  const runner: ProcessRunner = () => {
    const outcome = behavior();
    const resultPromise: Promise<ProcessResult> =
      outcome === "never"
        ? new Promise(() => {})
        : outcome.then((partial) => ({
            stdout: partial.stdout ?? new Uint8Array(0),
            stderr: partial.stderr ?? "",
            exitCode: partial.exitCode ?? 0,
            signal: partial.signal ?? null,
          }));
    const handle: ProcessHandle = {
      result: resultPromise,
      writeStdin: () => {},
      endStdin: () => {},
      kill: (signal) => killed.push(signal ?? "SIGTERM"),
    };
    return handle;
  };
  return { runner, killed };
}

function fakeHttpFetch(behavior: (url: string) => Promise<{ ok: boolean }>) {
  return async (url: string) => {
    const result = await behavior(url);
    return {
      ok: result.ok,
      status: result.ok ? 200 : 503,
      statusText: result.ok ? "OK" : "Service Unavailable",
      text: async () => "",
      body: () => null,
    };
  };
}

describe("defaultLlamaServerPaths", () => {
  it("resolves real, app-scoped default paths", () => {
    const result = defaultLlamaServerPaths("/home/user/.config/ryper");
    expect(result.binaryPath.replace(/\\/g, "/")).toContain("/home/user/.config/ryper");
    expect(result.modelPath.replace(/\\/g, "/")).toContain("/home/user/.config/ryper");
    expect(result.port).toBeGreaterThan(0);
  });

  it("falls back to a real OS temp directory rather than crashing on an empty userDataDir", () => {
    expect(() => defaultLlamaServerPaths("")).not.toThrow();
  });
});

describe("detectLlamaModelStatus", () => {
  it("reports binary-missing when nothing is installed", async () => {
    const status = await detectLlamaModelStatus(fs(), paths);
    expect(status.status).toBe("binary-missing");
  });

  it("reports model-missing with an actionable detail — 'installed but model missing', not a bare failure", async () => {
    const status = await detectLlamaModelStatus(fs({ "/opt/llama/llama-server": "bin" }), paths);
    expect(status.status).toBe("model-missing");
    expect(status.detail).toContain("installed");
    expect(status.detail).toContain(paths.modelPath);
  });

  it("reports installed when both binary and model exist", async () => {
    const status = await detectLlamaModelStatus(
      fs({ "/opt/llama/llama-server": "bin", "/opt/llama/model.gguf": "model" }),
      paths,
    );
    expect(status.status).toBe("installed");
  });
});

describe("LlamaServerManager", () => {
  it("resolves with a real base URL once the health check succeeds", async () => {
    let healthChecked = false;
    const { runner } = fakeProcessRunner(() => "never"); // long-running server process, never exits on its own
    const httpFetch = fakeHttpFetch(async (url) => {
      expect(url).toContain("/health");
      healthChecked = true;
      return { ok: true };
    });

    const manager = new LlamaServerManager(runner, httpFetch);
    const baseUrl = await manager.start(paths, 1000);

    expect(baseUrl).toBe(`http://127.0.0.1:${paths.port}/v1`);
    expect(healthChecked).toBe(true);
    expect(manager.isRunning()).toBe(true);
    manager.stop();
  });

  it("throws LlamaServerStartError when the real process exits before becoming ready", async () => {
    const { runner } = fakeProcessRunner(async () => ({ exitCode: 1 }));
    const httpFetch = fakeHttpFetch(async () => ({ ok: false }));

    const manager = new LlamaServerManager(runner, httpFetch);
    await expect(manager.start(paths, 2000)).rejects.toThrow(LlamaServerStartError);
  });

  it("throws LlamaServerStartError on a real timeout when health checks never succeed", async () => {
    vi.useFakeTimers();
    try {
      const { runner, killed } = fakeProcessRunner(() => "never");
      const httpFetch = fakeHttpFetch(async () => ({ ok: false }));
      const manager = new LlamaServerManager(runner, httpFetch);

      const promise = manager.start(paths, 500);
      const assertion = expect(promise).rejects.toThrow(LlamaServerStartError);
      await vi.advanceTimersByTimeAsync(600);
      await assertion;
      expect(killed).toContain("SIGTERM"); // real cleanup on timeout, not a leaked process
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() sends a real kill signal and resets running state", async () => {
    const { runner, killed } = fakeProcessRunner(() => "never");
    const httpFetch = fakeHttpFetch(async () => ({ ok: true }));
    const manager = new LlamaServerManager(runner, httpFetch);

    await manager.start(paths, 1000);
    manager.stop();

    expect(killed).toContain("SIGTERM");
    expect(manager.isRunning()).toBe(false);
    expect(manager.getBaseUrl()).toBeUndefined();
  });

  it("returns the same base URL on a second start() call rather than spawning a duplicate process", async () => {
    let spawnCount = 0;
    const runner: ProcessRunner = () => {
      spawnCount++;
      return {
        result: new Promise(() => {}),
        writeStdin: () => {},
        endStdin: () => {},
        kill: () => {},
      };
    };
    const httpFetch = fakeHttpFetch(async () => ({ ok: true }));
    const manager = new LlamaServerManager(runner, httpFetch);

    await manager.start(paths, 1000);
    await manager.start(paths, 1000);

    expect(spawnCount).toBe(1);
  });

  it("fails fast with a clear error — not a 60s hang or an unhandled rejection — when the binary genuinely can't be spawned", async () => {
    // Reproduces a real `ProcessSpawnError` (e.g. ENOENT for a missing
    // binary) exactly as `process-runner.ts` actually rejects
    // `ProcessHandle.result` in that case — this is the real bug found
    // running `llm-runtime.real.test.ts` with a nonexistent binary
    // path: `start()` only attached a *resolution* handler to
    // `handle.result`, so a rejection here was never noticed. That
    // left `exited` permanently `false`, so `start()` polled a health
    // endpoint that could never succeed for the *entire* timeout
    // instead of failing immediately, and the unobserved rejection
    // became an unhandled promise rejection.
    let rejectResult!: (err: Error) => void;
    const runner: ProcessRunner = () => ({
      result: new Promise<ProcessResult>((_resolve, reject) => {
        rejectResult = reject;
      }),
      writeStdin: () => {},
      endStdin: () => {},
      kill: () => {},
    });
    const httpFetch = fakeHttpFetch(async () => ({ ok: false }));
    const manager = new LlamaServerManager(runner, httpFetch);

    const promise = manager.start(paths, 60_000);
    rejectResult(new Error("spawn /opt/llama/llama-server ENOENT"));

    await expect(promise).rejects.toThrow(LlamaServerStartError);
    await expect(promise).rejects.toThrow(/ENOENT/);
    expect(manager.isRunning()).toBe(false);
  });
});
