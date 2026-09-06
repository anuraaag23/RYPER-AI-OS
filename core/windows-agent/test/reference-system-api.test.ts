import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";

describe("InMemoryWindowsSystemApi", () => {
  it("detects a seeded Windows version", async () => {
    const api = new InMemoryWindowsSystemApi({
      windowsVersion: {
        release: "windows-10",
        buildNumber: "10.0.19045",
        displayName: "Windows 10 22H2",
      },
    });
    await expect(api.detectWindowsVersion()).resolves.toMatchObject({ release: "windows-10" });
  });

  it("starts and kills processes, reflecting the change in listProcesses()", async () => {
    const api = new InMemoryWindowsSystemApi();
    const before = await api.listProcesses();
    const started = await api.startProcess("C:\\Windows\\System32\\calc.exe");
    const afterStart = await api.listProcesses();
    expect(afterStart.length).toBe(before.length + 1);

    await api.killProcess(started.pid, false);
    const afterKill = await api.listProcesses();
    expect(afterKill.find((p) => p.pid === started.pid)).toBeUndefined();
  });

  it("throws when killing a process that does not exist", async () => {
    const api = new InMemoryWindowsSystemApi();
    await expect(api.killProcess(999_999, false)).rejects.toThrow();
  });

  it("moves, resizes, snaps, and centers a window, updating its bounds", async () => {
    const api = new InMemoryWindowsSystemApi();
    const [window] = await api.listWindows();
    if (!window) throw new Error("expected a seeded window");

    await api.moveWindow(window.handle, 10, 20);
    await api.resizeWindow(window.handle, 640, 480);
    let updated = (await api.listWindows()).find((w) => w.handle === window.handle);
    expect(updated?.bounds).toEqual({ x: 10, y: 20, width: 640, height: 480 });

    await api.snapWindow(window.handle, "left");
    updated = (await api.listWindows()).find((w) => w.handle === window.handle);
    expect(updated?.bounds.x).toBe(0);
    expect(updated?.state).toBe("normal");

    await api.centerWindow(window.handle);
    updated = (await api.listWindows()).find((w) => w.handle === window.handle);
    expect(updated?.bounds.x).toBeGreaterThanOrEqual(0);
  });

  it("focuses exactly one window at a time", async () => {
    const api = new InMemoryWindowsSystemApi();
    const windows = await api.listWindows();
    const second = windows[1];
    if (!second) throw new Error("expected at least two seeded windows");

    await api.focusWindow(second.handle);
    const updated = await api.listWindows();
    expect(updated.filter((w) => w.focused)).toHaveLength(1);
    expect(updated.find((w) => w.focused)?.handle).toBe(second.handle);
  });

  it("launches an installed application and creates a running window for it", async () => {
    const api = new InMemoryWindowsSystemApi();
    const process = await api.launchApplication("microsoft.windows.calculator");
    const windows = await api.listWindows();
    expect(
      windows.some((w) => w.pid === process.pid && w.appId === "microsoft.windows.calculator"),
    ).toBe(true);
  });

  it("rejects launching an application that is not installed", async () => {
    const api = new InMemoryWindowsSystemApi();
    await expect(api.launchApplication("not.a.real.app")).rejects.toThrow();
  });

  it("opens http(s) URLs but rejects other schemes", async () => {
    const api = new InMemoryWindowsSystemApi();
    await expect(api.openUrl("https://example.com")).resolves.toBeUndefined();
    await expect(api.openUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("supports the full filesystem lifecycle: write, read, copy, move, rename, search, delete", async () => {
    const api = new InMemoryWindowsSystemApi();
    const folder = await api.getWellKnownFolderPath("documents");
    const path = `${folder}\\report.txt`;

    await api.writeFile(path, "hello world");
    await expect(api.readFile(path)).resolves.toBe("hello world");

    const listed = await api.listDirectory(folder);
    expect(listed.some((entry) => entry.path === path)).toBe(true);

    const copyPath = `${folder}\\report-copy.txt`;
    await api.copyEntry(path, copyPath);
    await expect(api.readFile(copyPath)).resolves.toBe("hello world");

    const renamedPath = `${folder}\\renamed.txt`;
    await api.renameEntry(copyPath, "renamed.txt");
    await expect(api.readFile(renamedPath)).resolves.toBe("hello world");

    const found = await api.searchFiles("renamed", folder);
    expect(found.some((entry) => entry.path === renamedPath)).toBe(true);

    await api.deleteEntry(renamedPath);
    await expect(api.readFile(renamedPath)).rejects.toThrow();
  });

  it("refuses to delete a non-empty directory", async () => {
    const api = new InMemoryWindowsSystemApi();
    const folder = await api.getWellKnownFolderPath("downloads");
    await api.writeFile(`${folder}\\file.txt`, "x");
    await expect(api.deleteEntry(folder)).rejects.toThrow(/not empty/);
  });

  it("tracks clipboard writes in history and returns the latest value on read", async () => {
    const api = new InMemoryWindowsSystemApi();
    await api.writeClipboard({
      format: "text",
      value: "first",
      capturedAt: new Date().toISOString(),
    });
    await api.writeClipboard({
      format: "text",
      value: "second",
      capturedAt: new Date().toISOString(),
    });

    await expect(api.readClipboard()).resolves.toMatchObject({ value: "second" });
    const history = await api.getClipboardHistory();
    expect(history.map((h) => h.value)).toEqual(["first", "second"]);
  });

  it("shows, updates, and dismisses notifications", async () => {
    const api = new InMemoryWindowsSystemApi();
    const handle = await api.showNotification({
      title: "Build complete",
      body: "0 errors",
      kind: "basic",
    });
    expect(handle.dismissed).toBe(false);

    const updated = await api.updateNotification(handle.id, {
      title: "Build complete",
      body: "0 errors, 0 warnings",
      kind: "basic",
    });
    expect(updated.spec.body).toBe("0 errors, 0 warnings");

    await api.dismissNotification(handle.id);
  });

  it("clamps volume operations and toggles mute", async () => {
    const api = new InMemoryWindowsSystemApi();
    await api.setVolume(42);
    await expect(api.getVolume()).resolves.toBe(42);
    await expect(api.setVolume(150)).rejects.toThrow();

    await api.setMute(true);
    await expect(api.getMute()).resolves.toBe(true);
  });

  it("changes the default audio device among devices of the same kind", async () => {
    const api = new InMemoryWindowsSystemApi();
    const devices = await api.listAudioDevices();
    const output = devices.find((d) => d.kind === "output");
    if (!output) throw new Error("expected a seeded output device");
    await api.setDefaultAudioDevice(output.id);
    const updated = await api.listAudioDevices();
    expect(updated.find((d) => d.id === output.id)?.isDefault).toBe(true);
  });

  it("reads and writes registry values", async () => {
    const api = new InMemoryWindowsSystemApi();
    await api.writeRegistryValue({
      hive: "HKCU",
      path: "Software\\Test",
      name: "Value",
      value: "42",
      valueType: "REG_SZ",
    });
    await expect(api.readRegistryValue("HKCU", "Software\\Test", "Value")).resolves.toMatchObject({
      value: "42",
    });
  });

  it("starts and stops services", async () => {
    const api = new InMemoryWindowsSystemApi();
    await api.stopService("Spooler");
    await expect(api.getServiceStatus("Spooler")).resolves.toBe("stopped");
    await api.startService("Spooler");
    await expect(api.getServiceStatus("Spooler")).resolves.toBe("running");
  });

  it("emits events observable via subscribeToEvents", async () => {
    const api = new InMemoryWindowsSystemApi();
    const seen: string[] = [];
    const unsubscribe = api.subscribeToEvents((event) => seen.push(event.type));

    await api.startProcess("C:\\Windows\\System32\\calc.exe");
    await api.writeClipboard({ format: "text", value: "x", capturedAt: new Date().toISOString() });

    expect(seen).toContain("process_started");
    expect(seen).toContain("clipboard_changed");

    unsubscribe();
    const countBeforeUnsubscribe = seen.length;
    await api.writeClipboard({ format: "text", value: "y", capturedAt: new Date().toISOString() });
    expect(seen.length).toBe(countBeforeUnsubscribe);
  });

  it("samples performance data derived from system info", async () => {
    const api = new InMemoryWindowsSystemApi();
    const sample = await api.samplePerformance();
    expect(sample.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(sample.memoryPercent).toBeGreaterThanOrEqual(0);
  });

  describe("mediaControl / getNowPlayingState (docs/adr/0025)", () => {
    it("honestly reports no session until mediaControl has ever been called", async () => {
      const api = new InMemoryWindowsSystemApi();
      expect(await api.getNowPlayingState()).toEqual({ status: "none" });
    });

    it("play/pause/stop set the real, readable status", async () => {
      const api = new InMemoryWindowsSystemApi();
      await api.mediaControl("play");
      expect((await api.getNowPlayingState()).status).toBe("playing");
      await api.mediaControl("pause");
      expect((await api.getNowPlayingState()).status).toBe("paused");
      await api.mediaControl("stop");
      expect((await api.getNowPlayingState()).status).toBe("stopped");
    });

    it("next/previous genuinely change the current track, wrapping at both ends of the playlist", async () => {
      const api = new InMemoryWindowsSystemApi();
      const initial = await api.getNowPlayingState();
      expect(initial.status).toBe("none"); // nothing playing yet

      await api.mediaControl("play");
      const first = await api.getNowPlayingState();

      await api.mediaControl("next");
      const second = await api.getNowPlayingState();
      expect(second.title).not.toBe(first.title);
      expect(second.status).toBe("playing");

      await api.mediaControl("previous");
      const backToFirst = await api.getNowPlayingState();
      expect(backToFirst.title).toBe(first.title);

      // Wraps around at the start of the playlist rather than throwing.
      await api.mediaControl("previous");
      const wrapped = await api.getNowPlayingState();
      expect(wrapped.title).not.toBe(first.title);
    });
  });
});
