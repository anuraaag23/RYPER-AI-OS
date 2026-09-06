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

  describe("audio: getVolume/setVolume/getMute/setMute (docs/adr/0024)", () => {
    it("getVolume builds real IAudioEndpointVolume COM interop, never a third-party module, and converts scalar to percent", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain("IAudioEndpointVolume");
        expect(command).toContain("IMMDeviceEnumerator");
        expect(command).toContain("Add-Type -TypeDefinition");
        // Never a third-party module or private/undocumented interface.
        expect(command).not.toContain("AudioDeviceCmdlets");
        expect(command).not.toContain("IPolicyConfig");
        return ok(JSON.stringify({ volume: 0.42 }));
      });
      const api = new PowerShellWindowsSystemApi(exec);
      const percent = await api.getVolume();
      expect(percent).toBe(42);
    });

    it("setVolume converts a 0-100 percent into the 0.0-1.0 scalar SetMasterVolumeLevelScalar expects, and clamps out-of-range input", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain("SetVolume(0.7500)");
        return ok("");
      });
      const api = new PowerShellWindowsSystemApi(exec);
      await api.setVolume(75);

      const clampExec = vi.fn(async (command: string) => {
        expect(command).toContain("SetVolume(1.0000)");
        return ok("");
      });
      await new PowerShellWindowsSystemApi(clampExec).setVolume(150);

      const clampLowExec = vi.fn(async (command: string) => {
        expect(command).toContain("SetVolume(0.0000)");
        return ok("");
      });
      await new PowerShellWindowsSystemApi(clampLowExec).setVolume(-10);
    });

    it("getMute/setMute build real COM calls, with setMute passing a real PowerShell boolean literal", async () => {
      const getExec = vi.fn(async (command: string) => {
        expect(command).toContain("GetMute()");
        return ok(JSON.stringify({ muted: true }));
      });
      expect(await new PowerShellWindowsSystemApi(getExec).getMute()).toBe(true);

      const setTrueExec = vi.fn(async (command: string) => {
        expect(command).toContain("SetMute($true)");
        return ok("");
      });
      await new PowerShellWindowsSystemApi(setTrueExec).setMute(true);

      const setFalseExec = vi.fn(async (command: string) => {
        expect(command).toContain("SetMute($false)");
        return ok("");
      });
      await new PowerShellWindowsSystemApi(setFalseExec).setMute(false);
    });

    it("propagates a real PowerShellExecutionError (with exit code/stderr) when the COM call fails", async () => {
      const exec: ShellExec = async () => fail("Activation failed: 0x80070490", 1);
      const api = new PowerShellWindowsSystemApi(exec);
      await expect(api.setVolume(50)).rejects.toMatchObject({
        stderr: "Activation failed: 0x80070490",
      });
    });
  });

  describe("audio: setDefaultAudioDevice is honestly deferred, not faked (docs/adr/0024)", () => {
    it("throws explaining the deferral, without ever invoking PowerShell", async () => {
      const exec = vi.fn(async () => ok(""));
      const api = new PowerShellWindowsSystemApi(exec);
      await expect(api.setDefaultAudioDevice("device-1")).rejects.toThrow(/not yet implemented/);
      // Real proof this is an honest deferral, not an attempted-and-failed
      // call: PowerShell was never even invoked.
      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe("audio: mediaControl (docs/adr/0024)", () => {
    it.each([
      ["play", "179"],
      ["pause", "179"],
      ["next", "176"],
      ["previous", "177"],
      ["stop", "178"],
    ] as const)(
      "sends the real virtual-key code for %s via native user32.dll keybd_event, never a third-party module",
      async (action, vkCode) => {
        const exec = vi.fn(async (command: string) => {
          expect(command).toContain("user32.dll");
          expect(command).toContain("keybd_event");
          expect(command).toContain(`keybd_event(${vkCode}, 0, 0,`);
          expect(command).toContain(`keybd_event(${vkCode}, 0, 2,`);
          expect(command).not.toContain("AudioDeviceCmdlets");
          expect(command).not.toContain("nircmd");
          return ok("");
        });
        const api = new PowerShellWindowsSystemApi(exec);
        await api.mediaControl(action);
        expect(exec).toHaveBeenCalledOnce();
      },
    );
  });

  describe("audio: getNowPlayingState (docs/adr/0025)", () => {
    it("builds a real, native GlobalSystemMediaTransportControlsSessionManager command, never a third-party module", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain("GlobalSystemMediaTransportControlsSessionManager");
        expect(command).toContain("Windows.Media.Control");
        expect(command).toContain("ContentType = WindowsRuntime");
        // The real WinRT-async-await plumbing this technique needs.
        expect(command).toContain("System.WindowsRuntimeSystemExtensions");
        expect(command).toContain("AsTask");
        expect(command).not.toContain("AudioDeviceCmdlets");
        expect(command).not.toContain("nircmd");
        return ok(
          JSON.stringify({ status: "Playing", title: "Test Track", artist: "Test Artist" }),
        );
      });
      const api = new PowerShellWindowsSystemApi(exec);
      const state = await api.getNowPlayingState();
      expect(state).toEqual({ status: "playing", title: "Test Track", artist: "Test Artist" });
    });

    it("honestly reports status 'none' — not an error — when no application has an active media session", async () => {
      const exec = vi.fn(async () => ok(JSON.stringify({ status: "none" })));
      const api = new PowerShellWindowsSystemApi(exec);
      const state = await api.getNowPlayingState();
      expect(state).toEqual({ status: "none" });
    });

    it("lowercases the WinRT PlaybackStatus enum name to match this repo's MediaPlaybackStatus union", async () => {
      const exec = vi.fn(async () => ok(JSON.stringify({ status: "Paused" })));
      const api = new PowerShellWindowsSystemApi(exec);
      expect((await api.getNowPlayingState()).status).toBe("paused");
    });
  });

  it("subscribeToEvents is honestly a no-op and says so", async () => {
    const api = new PowerShellWindowsSystemApi(unavailableShellExec);
    const handler = vi.fn();
    const unsubscribe = api.subscribeToEvents(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  describe("showNotification", () => {
    it(
      "builds a native WinRT ToastNotificationManager command, never a " +
        "third-party module this repo never installs (docs/adr/0023)",
      async () => {
        const exec = vi.fn(async (command: string) => {
          expect(command).toContain("Windows.UI.Notifications.ToastNotificationManager");
          expect(command).toContain("Windows.Data.Xml.Dom.XmlDocument");
          expect(command).toContain("ContentType = WindowsRuntime");
          // The one thing this command must never reference: a
          // third-party module this repository never provisions.
          expect(command).not.toContain("BurntToast");
          return ok("");
        });
        const api = new PowerShellWindowsSystemApi(exec);
        const handle = await api.showNotification({
          kind: "basic",
          title: "Ryper Test",
          body: "Real tool call verified.",
        });
        expect(handle.spec.title).toBe("Ryper Test");
        expect(exec).toHaveBeenCalledOnce();
      },
    );

    it("uses the pre-registered powershell.exe AppUserModelID, requiring no custom app registration", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain(
          String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`,
        );
        return ok("");
      });
      const api = new PowerShellWindowsSystemApi(exec);
      await api.showNotification({ kind: "basic", title: "t", body: "b" });
    });

    it("sets $ErrorActionPreference = 'Stop' so a WinRT activation failure is a real, non-zero-exit failure", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain("$ErrorActionPreference = 'Stop'");
        return ok("");
      });
      const api = new PowerShellWindowsSystemApi(exec);
      await api.showNotification({ kind: "basic", title: "t", body: "b" });
    });

    it("XML-escapes title/body so notification text can't break out of the toast XML payload", async () => {
      const exec = vi.fn(async (command: string) => {
        expect(command).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(command).not.toContain("<script>alert(1)</script>");
        return ok("");
      });
      const api = new PowerShellWindowsSystemApi(exec);
      await api.showNotification({
        kind: "basic",
        title: "<script>alert(1)</script>",
        body: "b",
      });
    });

    it("propagates a real PowerShellExecutionError (with exit code/stderr) when the toast command fails", async () => {
      const exec: ShellExec = async () => fail("Activation of the app failed.", 1);
      const api = new PowerShellWindowsSystemApi(exec);
      await expect(
        api.showNotification({ kind: "basic", title: "t", body: "b" }),
      ).rejects.toMatchObject({
        stderr: "Activation of the app failed.",
      });
    });
  });

  describe("filesystem operations", () => {
    it("listDirectory normalizes PowerShell PascalCase properties to FileEntry", async () => {
      const exec = vi.fn(async (cmd: string) => {
        expect(cmd).toContain("Get-ChildItem -Path 'C:\\Test'");
        return ok(
          JSON.stringify([
            { FullName: "C:\\Test\\doc.pdf", Name: "doc.pdf", Length: 1024, LastWriteTime: "2026-09-05T00:00:00Z" },
            { FullName: "C:\\Test\\sub", Name: "sub", Length: null, LastWriteTime: "2026-09-05T00:00:00Z" },
          ]),
        );
      });
      const api = new PowerShellWindowsSystemApi(exec);
      const entries = await api.listDirectory("C:\\Test");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        path: "C:\\Test\\doc.pdf",
        name: "doc.pdf",
        kind: "file",
        sizeBytes: 1024,
        modifiedAt: "2026-09-05T00:00:00Z",
      });
      expect(entries[1].kind).toBe("directory");
      expect(entries[1].sizeBytes).toBe(0);
    });

    it("searchFiles normalizes single-item output and applies wildcard filter", async () => {
      const exec = vi.fn(async (cmd: string) => {
        expect(cmd).toContain("-Filter '*pdf*'");
        return ok(
          JSON.stringify({
            FullName: "C:\\Downloads\\file.pdf",
            Name: "file.pdf",
            Length: 2048,
            LastWriteTime: "2026-09-05T00:00:00Z",
          }),
        );
      });
      const api = new PowerShellWindowsSystemApi(exec);
      const entries = await api.searchFiles("pdf", "C:\\Downloads");
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("file.pdf");
      expect(entries[0].sizeBytes).toBe(2048);
    });

    it("getWellKnownFolderPath resolves downloads to UserProfile Downloads", async () => {
      const exec = vi.fn(async (cmd: string) => {
        expect(cmd).toContain("[Environment]::GetFolderPath('UserProfile') + '\\Downloads'");
        return ok("C:\\Users\\anura\\Downloads\n");
      });
      const api = new PowerShellWindowsSystemApi(exec);
      const path = await api.getWellKnownFolderPath("downloads");
      expect(path).toBe("C:\\Users\\anura\\Downloads");
    });
  });
});
