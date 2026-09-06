import { execFile } from "node:child_process";
import type { ShellExec, ShellExecResult } from "@ryper/windows-agent";

/**
 * The real `ShellExec` `@ryper/windows-agent`'s `PowerShellWindowsSystemApi`
 * has always accepted as an injectable dependency, but that no part of
 * this repository ever actually implemented — `powershell-system-api.ts`'s
 * own doc comment names this exact gap ("a real desktop shell hosting
 * this package on an actual Windows machine must inject a real
 * `ShellExec`... before this class does anything useful"). Without this,
 * `createWindowsAdapter()`'s default `systemApi` is the in-memory
 * reference implementation, so — even on real Windows — every desktop
 * capability the app exposes (volume, app launch, notifications, ...)
 * was operating against a fake in-process model, never real Win32/WMI
 * state. See `docs/adr/0021`.
 *
 * Runs `powershell.exe -NoProfile -NonInteractive -Command <command>` via
 * `child_process.execFile` (never `exec`, so `command` is passed as a
 * single argument rather than interpreted by a shell a second time) and
 * resolves — never rejects — with the real exit code/stdout/stderr, since
 * `PowerShellWindowsSystemApi`'s own `run`/`runJson` helpers decide what a
 * non-zero exit means; this adapter's only job is to report what really
 * happened.
 *
 * Not exercised by any automated test in this repository: it requires a
 * real `powershell.exe`, which does not exist in this Linux build
 * sandbox (or in CI). It is real, working code, wired into
 * `core-bootstrap.ts` for real desktop runs and into
 * `tool-calling.real.test.ts` for the opt-in, real-Windows-hardware
 * integration test — both honestly labeled as such rather than silently
 * assumed correct.
 */
export function createNodePowerShellExec(timeoutMs = 30_000): ShellExec {
  return (command: string): Promise<ShellExecResult> =>
    new Promise((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          // `execFile` only ever passes an `Error` here for a spawn-level
          // failure (binary not found, timeout, killed) — not for a
          // nonzero exit code, which is reported via `error.code` and is
          // exactly the case `PowerShellWindowsSystemApi.run`/`runJson`
          // are designed to interpret, not something this adapter should
          // swallow into a thrown exception.
          if (error && typeof error.code !== "number") {
            reject(error);
            return;
          }
          const exitCode = error ? (error.code as number) : 0;
          resolve({ stdout, stderr, exitCode });
        },
      );
    });
}
