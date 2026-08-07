import { describe, expect, it, vi } from "vitest";
import {
  PowerShellExecutionError,
  PowerShellWindowsSystemApi,
  unavailableShellExec,
} from "../src/powershell-system-api.js";
import type { ShellExec, ShellExecResult } from "../src/types.js";

function ok(stdout: string): ShellExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): ShellExecResult {
  return { stdout: "", stderr, exitCode };
}

describe("unavailableShellExec", () => {
  it("always rejects, explaining there is no native Windows toolchain here", async () => {
    await expect(unavailableShellExec("Get-Process")).rejects.toThrow(
      /no native Windows toolchain/,
    );
  });
});

describe("PowerShellWindowsSystemApi", () => {
  it("defaults to unavailableShellExec and fails honestly when invoked", async () => {
    const api = new PowerShellWindowsSystemApi();
    await expect(api.detectWindowsVersion()).rejects.toThrow(PowerShellExecutionError);
  });

  it("builds a Get-CimInstance command and parses its JSON output for version detection", async () => {
    const exec = vi.fn(async (command: string) => {
      expect(command).toContain("Win32_OperatingSystem");
      return ok(JSON.stringify({ build: "22631", caption: "Microsoft Windows 11 Pro" }));
    });
    const api = new PowerShellWindowsSystemApi(exec);
    const version = await api.detectWindowsVersion();
    expect(version).toEqual({
      release: "windows-11",
      buildNumber: "22631",
      displayName: "Microsoft Windows 11 Pro",
    });
  });

  it("classifies a Windows 10 build number correctly", async () => {
    const exec: ShellExec = async () =>
      ok(JSON.stringify({ build: "19045", caption: "Windows 10 Pro" }));
    const api = new PowerShellWindowsSystemApi(exec);
    await expect(api.detectWindowsVersion()).resolves.toMatchObject({ release: "windows-10" });
  });

  it("throws a PowerShellExecutionError with the command and stderr when a command fails", async () => {
    const exec: ShellExec = async () => fail("Access is denied.", 5);
    const api = new PowerShellWindowsSystemApi(exec);
    await expect(api.killProcess(1234, false)).rejects.toMatchObject({
      stderr: "Access is denied.",
    });
  });

  it("quotes single quotes in string parameters to avoid PowerShell injection", async () => {
    const exec = vi.fn(async (command: string) => {
      expect(command).toContain("''; Remove-Item -Recurse -Force C:\\''");
      return ok("");
    });
    const api = new PowerShellWindowsSystemApi(exec);
    await api.writeFile("C:\\file.txt", "'; Remove-Item -Recurse -Force C:\\'");
    expect(exec).toHaveBeenCalledOnce();
  });

  it("builds Get-Service commands for status queries", async () => {
    const exec = vi.fn(async (command: string) => {
      expect(command).toContain("Get-Service -Name 'Spooler'");
      return ok(JSON.stringify({ status: "running" }));
    });
    const api = new PowerShellWindowsSystemApi(exec);
    await expect(api.getServiceStatus("Spooler")).resolves.toBe("running");
  });

  it("throws when JSON parsing fails", async () => {
    const exec: ShellExec = async () => ok("not json");
    const api = new PowerShellWindowsSystemApi(exec);
    await expect(api.getSystemInfo()).rejects.toThrow(/could not parse/);
  });

  it("subscribeToEvents is honestly a no-op and says so", async () => {
    const api = new PowerShellWindowsSystemApi(unavailableShellExec);
    const handler = vi.fn();
    const unsubscribe = api.subscribeToEvents(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
