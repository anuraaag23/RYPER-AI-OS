import { describe, expect, it } from "vitest";
import {
  ProcessSpawnError,
  createNodeProcessRunner,
} from "../../src/runtime-providers/process-runner.js";

/**
 * REAL PROVIDER TEST — unlike whisper-cpp.test.ts/piper.test.ts (which
 * exercise a fake `ProcessRunner`), these spawn genuine OS processes
 * (`echo`, `false`, `cat`) through the real `child_process`-backed
 * implementation. This is real proof `createNodeProcessRunner()` itself
 * works — it is not proof whisper.cpp/Piper specifically work, since
 * neither binary is installed in this environment (see
 * docs/PROJECT_STATE.md's Phase 13.7 section).
 */
describe("createNodeProcessRunner (real child_process)", () => {
  it("captures real stdout from a real process", async () => {
    const runner = createNodeProcessRunner();
    const handle = runner(process.execPath, ["-e", "process.stdout.write('hello world')"]);
    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe("hello world");
  });

  it("captures a real non-zero exit code without throwing", async () => {
    const runner = createNodeProcessRunner();
    const handle = runner(process.execPath, ["-e", "process.exit(1)"]);
    const result = await handle.result;
    expect(result.exitCode).toBe(1);
  });

  it("writes real stdin and the process reads it back", async () => {
    const runner = createNodeProcessRunner();
    const handle = runner(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      stdin: new TextEncoder().encode("piped in"),
    });
    const result = await handle.result;
    expect(new TextDecoder().decode(result.stdout)).toBe("piped in");
  });

  it("kill() sends a real signal that actually stops a real long-running process", async () => {
    const runner = createNodeProcessRunner();
    const handle = runner(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    const startedAt = Date.now();
    handle.kill("SIGTERM");
    const result = await handle.result;
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(5000); // real proof it didn't wait out the full 30s sleep
    if (process.platform !== "win32") {
      expect(result.signal).toBe("SIGTERM");
    }
  });

  it("rejects with ProcessSpawnError for a real nonexistent binary, rather than hanging", async () => {
    const runner = createNodeProcessRunner();
    const handle = runner("this-binary-does-not-exist-anywhere", []);
    await expect(handle.result).rejects.toThrow(ProcessSpawnError);
  });
});
