import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeMediaSessionFixture,
  launchMediaSessionFixture,
  resolveEdgeExecutable,
} from "./media-session-fixture-launcher.js";

const ORIGINAL_EDGE_ENV = process.env["RYPER_EDGE_BINARY"];

describe("resolveEdgeExecutable (docs/adr/0027)", () => {
  afterEach(() => {
    if (ORIGINAL_EDGE_ENV === undefined) delete process.env["RYPER_EDGE_BINARY"];
    else process.env["RYPER_EDGE_BINARY"] = ORIGINAL_EDGE_ENV;
    vi.restoreAllMocks();
  });

  it("uses RYPER_EDGE_BINARY when set and the file genuinely exists", async () => {
    // This test's own source file is a real, always-present file on
    // disk — used here purely as "a real path that exists," not as a
    // real Edge binary.
    process.env["RYPER_EDGE_BINARY"] = fileURLToPath(import.meta.url);
    const exec = vi.fn();
    const resolution = await resolveEdgeExecutable(exec);
    expect(resolution.method).toBe("RYPER_EDGE_BINARY");
    // Real proof no PowerShell call was needed for this path.
    expect(exec).not.toHaveBeenCalled();
  });

  it("throws a clear, actionable error when RYPER_EDGE_BINARY is set but the file does not exist", async () => {
    process.env["RYPER_EDGE_BINARY"] = String.raw`C:\definitely\not\real\msedge.exe`;
    const exec = vi.fn();
    await expect(resolveEdgeExecutable(exec)).rejects.toThrow(/RYPER_EDGE_BINARY/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("resolves via the real Windows registry App Paths key when no override is set", async () => {
    delete process.env["RYPER_EDGE_BINARY"];
    const exec = vi.fn(async (command: string) => {
      expect(command).toContain("App Paths\\msedge.exe");
      expect(command).toContain("Get-ItemProperty");
      return {
        stdout: JSON.stringify({ path: String.raw`C:\Custom\Edge\msedge.exe` }),
        stderr: "",
        exitCode: 0,
      };
    });
    const resolution = await resolveEdgeExecutable(exec);
    expect(resolution).toEqual({
      method: "registry",
      path: String.raw`C:\Custom\Edge\msedge.exe`,
    });
  });

  it("falls back to PATH via Get-Command when the registry key and standard paths are both empty", async () => {
    delete process.env["RYPER_EDGE_BINARY"];
    const exec = vi.fn(async (command: string) => {
      if (command.includes("Get-ItemProperty")) {
        return { stdout: JSON.stringify({ path: null }), stderr: "", exitCode: 0 };
      }
      expect(command).toContain("Get-Command msedge.exe");
      return {
        stdout: JSON.stringify({ path: String.raw`C:\Somewhere\On\Path\msedge.exe` }),
        stderr: "",
        exitCode: 0,
      };
    });
    const resolution = await resolveEdgeExecutable(exec);
    expect(resolution).toEqual({
      method: "PATH",
      path: String.raw`C:\Somewhere\On\Path\msedge.exe`,
    });
  });

  it(
    "throws a clear, actionable error framed as a test-environment prerequisite " +
      "(not a RYPER failure) when Edge cannot be found anywhere",
    async () => {
      delete process.env["RYPER_EDGE_BINARY"];
      const exec = vi.fn(async () => ({
        stdout: JSON.stringify({ path: null }),
        stderr: "",
        exitCode: 0,
      }));
      await expect(resolveEdgeExecutable(exec)).rejects.toThrow(/test-environment prerequisite/i);
      await expect(resolveEdgeExecutable(exec)).rejects.toThrow(/not a RYPER implementation/);
    },
  );
});

describe("launchMediaSessionFixture / closeMediaSessionFixture", () => {
  beforeEach(() => {
    delete process.env["RYPER_EDGE_BINARY"];
  });
  afterEach(() => {
    if (ORIGINAL_EDGE_ENV === undefined) delete process.env["RYPER_EDGE_BINARY"];
    else process.env["RYPER_EDGE_BINARY"] = ORIGINAL_EDGE_ENV;
  });

  it("resolves the real Edge path first, then Start-Process's -FilePath uses that resolved path (never a bare 'msedge.exe')", async () => {
    const exec = vi.fn(async (command: string) => {
      if (command.includes("Get-ItemProperty")) {
        return {
          stdout: JSON.stringify({ path: String.raw`C:\Real\Edge\msedge.exe` }),
          stderr: "",
          exitCode: 0,
        };
      }
      expect(command).toContain("Start-Process");
      expect(command).toContain(String.raw`-FilePath 'C:\Real\Edge\msedge.exe'`);
      expect(command).toContain("--autoplay-policy=no-user-gesture-required");
      expect(command).toContain("--new-window");
      expect(command).toContain("file:///C:/fixture.html");
      expect(command).toContain("-PassThru");
      return { stdout: JSON.stringify({ pid: 999 }), stderr: "", exitCode: 0 };
    });

    const result = await launchMediaSessionFixture(exec, "file:///C:/fixture.html");
    expect(result.pid).toBe(999);
    expect(result.edge).toEqual({ method: "registry", path: String.raw`C:\Real\Edge\msedge.exe` });
  });

  it("propagates the real resolved path in its error message when the launch itself fails", async () => {
    const exec = vi.fn(async (command: string) => {
      if (command.includes("Get-ItemProperty")) {
        return {
          stdout: JSON.stringify({ path: String.raw`C:\Real\Edge\msedge.exe` }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "access denied", exitCode: 1 };
    });
    await expect(launchMediaSessionFixture(exec, "file:///C:/fixture.html")).rejects.toThrow(
      /C:\\Real\\Edge\\msedge\.exe/,
    );
  });

  it("propagates the honest missing-Edge error from launchMediaSessionFixture when no browser can be found", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({ path: null }),
      stderr: "",
      exitCode: 0,
    }));
    await expect(launchMediaSessionFixture(exec, "file:///C:/fixture.html")).rejects.toThrow(
      /test-environment prerequisite/i,
    );
  });

  it("closeMediaSessionFixture sends a real Stop-Process for the given PID and never throws on an already-gone process", async () => {
    const exec = vi.fn(async (command: string) => {
      expect(command).toContain("Stop-Process");
      expect(command).toContain("-Id 12345");
      expect(command).toContain("-Force");
      expect(command).toContain("SilentlyContinue");
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await expect(closeMediaSessionFixture(exec, 12345)).resolves.toBeUndefined();
  });
});
