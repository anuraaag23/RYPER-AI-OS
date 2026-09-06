import { access } from "node:fs/promises";
import type { ShellExec } from "@ryper/windows-agent";

/**
 * Real, native resolution of the Microsoft Edge executable — none of
 * this repository's other real Windows tooling, and no third-party
 * dependency.
 *
 * PREVIOUS BUG, explained honestly: this file originally invoked
 * `Start-Process -FilePath 'msedge.exe'` on the (wrong) assumption
 * that Windows' "App Paths" registry redirection
 * (`HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe`)
 * would resolve the bare executable name the same way the Start Menu
 * or `cmd.exe`'s `start` verb do. It does not: `Start-Process` calls
 * .NET's `Process.Start()`, which only searches the current directory
 * and the `PATH` environment variable — it never consults App Paths
 * registry redirection, which is a `ShellExecuteEx`-level mechanism
 * (Explorer, `start`, the Run dialog), not a `CreateProcess`-level
 * one. On a real machine where Edge is installed but not on `PATH`
 * (a common, unremarkable case — Edge's installer does not always add
 * it), this call would fail with exactly the "cannot find the file
 * specified" error a real run surfaced. This resolver reads the same
 * registry key for real, but correctly, via `Get-ItemProperty`
 * (a real registry read, not a process-launch assumption).
 */
export interface EdgeResolution {
  readonly path: string;
  readonly method: "RYPER_EDGE_BINARY" | "registry" | "standard-path" | "PATH";
}

const STANDARD_EDGE_PATHS = [
  String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
  String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
];

async function realFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a real Microsoft Edge executable path, checked in this
 * order (each a real check against the real machine, never assumed):
 *
 * 1. `RYPER_EDGE_BINARY` — an explicit override for a machine where
 *    Edge is installed somewhere non-standard, or where the person
 *    wants to point this at a specific build.
 * 2. The Windows registry's "App Paths" key for `msedge.exe` — the
 *    real, canonical mechanism every properly-installed Windows app
 *    registers, read directly via `Get-ItemProperty` rather than
 *    assumed to apply to a bare `Start-Process` call (see this file's
 *    top comment for why that assumption was wrong).
 * 3. The two standard `Program Files`/`Program Files (x86)` install
 *    locations.
 * 4. A real `Get-Command msedge.exe` `PATH` lookup, as a last resort.
 *
 * Throws a clear, actionable error — explicitly framed as a
 * **test-environment prerequisite**, not a RYPER implementation
 * failure — if none of the above find a real executable. Never
 * substitutes a different browser (Chrome, Firefox, Brave, ...): this
 * fixture's physical verification specifically depends on Chromium/
 * Edge's `MediaSession`-to-SMTC integration, which has not been
 * proven equivalent across browser engines — see docs/adr/0027.
 */
export async function resolveEdgeExecutable(exec: ShellExec): Promise<EdgeResolution> {
  const explicit = process.env["RYPER_EDGE_BINARY"];
  if (explicit) {
    if (await realFileExists(explicit)) {
      return { path: explicit, method: "RYPER_EDGE_BINARY" };
    }
    throw new Error(
      `RYPER_EDGE_BINARY is set to "${explicit}", but no file exists there. This is a ` +
        "test-environment prerequisite, not a RYPER implementation failure — fix the path " +
        "or unset RYPER_EDGE_BINARY to fall back to automatic discovery.",
    );
  }

  const registryResult = await exec(
    "$p = (Get-ItemProperty -Path " +
      "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe' " +
      "-ErrorAction SilentlyContinue).'(default)'; " +
      "if ($p -and (Test-Path -LiteralPath $p)) { @{ path = $p } | ConvertTo-Json -Compress } " +
      "else { @{ path = $null } | ConvertTo-Json -Compress }",
  );
  const registryParsed = JSON.parse(registryResult.stdout || "{}") as { path: string | null };
  if (registryParsed.path) {
    return { path: registryParsed.path, method: "registry" };
  }

  for (const candidate of STANDARD_EDGE_PATHS) {
    if (await realFileExists(candidate)) {
      return { path: candidate, method: "standard-path" };
    }
  }

  const pathResult = await exec(
    "$cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue; " +
      "if ($cmd) { @{ path = $cmd.Source } | ConvertTo-Json -Compress } " +
      "else { @{ path = $null } | ConvertTo-Json -Compress }",
  );
  const pathParsed = JSON.parse(pathResult.stdout || "{}") as { path: string | null };
  if (pathParsed.path) {
    return { path: pathParsed.path, method: "PATH" };
  }

  throw new Error(
    "Microsoft Edge executable not found. Checked, in order: the RYPER_EDGE_BINARY " +
      "environment variable, the Windows registry App Paths key, the standard " +
      `Program Files/Program Files (x86) install locations (${STANDARD_EDGE_PATHS.join(", ")}), ` +
      "and PATH. This is a TEST-ENVIRONMENT PREREQUISITE, not a RYPER implementation " +
      "failure: install Microsoft Edge, or set RYPER_EDGE_BINARY to a valid executable " +
      "path, to run this real-hardware media-session fixture test.",
  );
}

/**
 * Launches a real, visible Microsoft Edge window pointed at the
 * media-session test fixture (docs/adr/0026) via a real, native
 * PowerShell `Start-Process`, using the real, resolved executable path
 * from `resolveEdgeExecutable()` — never a bare `msedge.exe` name (see
 * this file's top comment for why that failed). Returns the real
 * process ID and the resolved path/method actually used, so a test can
 * log it as real evidence.
 *
 * `--autoplay-policy=no-user-gesture-required` is a real, documented,
 * first-party Edge/Chromium flag for exactly this kind of automated
 * scenario — not a workaround or exploit.
 *
 * `Start-Process ... -PassThru` returns immediately with the new,
 * independent process's real PID; the PowerShell process this repo's
 * `ShellExec` contract runs to launch it exits right away, while Edge
 * itself keeps running until explicitly closed by
 * `closeMediaSessionFixture()`.
 */
export async function launchMediaSessionFixture(
  exec: ShellExec,
  fixtureFileUrl: string,
): Promise<{ pid: number; edge: EdgeResolution }> {
  const edge = await resolveEdgeExecutable(exec);
  const command =
    "$ErrorActionPreference = 'Stop'; " +
    `$p = Start-Process -FilePath '${edge.path}' -ArgumentList ` +
    "'--autoplay-policy=no-user-gesture-required','--new-window'," +
    `'${fixtureFileUrl}' -PassThru; ` +
    "@{ pid = $p.Id } | ConvertTo-Json -Compress";
  const result = await exec(command);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to launch the real Edge media-session fixture at "${edge.path}" ` +
        `(exit ${result.exitCode}): ${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as { pid: number };
  return { pid: parsed.pid, edge };
}

/**
 * Terminates the real Edge process started by
 * `launchMediaSessionFixture()`. Never throws on a process that's
 * already gone (`-ErrorAction SilentlyContinue`) — this is cleanup,
 * called from a real test's `finally` block, and must not itself mask
 * or interrupt reporting of the test's own real result.
 */
export async function closeMediaSessionFixture(exec: ShellExec, pid: number): Promise<void> {
  await exec(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
}
