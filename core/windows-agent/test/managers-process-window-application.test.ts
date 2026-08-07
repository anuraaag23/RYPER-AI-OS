import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { createDestructiveActionGate } from "../src/confirmation.js";
import { createProcessManager } from "../src/process-manager.js";
import { createWindowManager } from "../src/window-manager.js";
import { createApplicationManager } from "../src/application-manager.js";
import { allowAllConfirmer, denyConfirmer } from "./helpers.js";

describe("ProcessManager", () => {
  it("lists and starts processes", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createProcessManager(api, createDestructiveActionGate(allowAllConfirmer));
    const started = await manager.start("C:\\Windows\\System32\\calc.exe");
    expect((await manager.list()).some((p) => p.pid === started.pid)).toBe(true);
  });

  it("kills a non-critical process without confirmation", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createProcessManager(api, createDestructiveActionGate(denyConfirmer));
    const started = await manager.start("C:\\Windows\\System32\\calc.exe");
    await manager.kill(started.pid);
    expect(await manager.get(started.pid)).toBeUndefined();
  });

  it("requires confirmation before killing a critical process, and refuses if denied", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createProcessManager(api, createDestructiveActionGate(denyConfirmer));
    // pid 1234 (explorer.exe) is seeded as critical.
    await expect(manager.kill(1234)).rejects.toThrow(/not confirmed/);
    expect(await manager.get(1234)).toBeDefined();
  });

  it("kills a critical process when the confirmer allows it", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createProcessManager(api, createDestructiveActionGate(allowAllConfirmer));
    await manager.kill(1234);
    expect(await manager.get(1234)).toBeUndefined();
  });

  it("restarts a process (kill + relaunch)", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createProcessManager(api, createDestructiveActionGate(allowAllConfirmer));
    const started = await manager.start("C:\\Windows\\System32\\calc.exe");
    const restarted = await manager.restart(started.pid);
    expect(restarted.executablePath).toBe("C:\\Windows\\System32\\calc.exe");
    expect(await manager.get(started.pid)).toBeUndefined();
  });
});

describe("WindowManager", () => {
  it("switches focus to the next window (Alt+Tab-style)", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createWindowManager(api);
    const before = await manager.getActive();
    const next = await manager.switchToNext();
    expect(next?.handle).not.toBe(before?.handle);
  });

  it("minimizes, maximizes, and restores a window", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createWindowManager(api);
    const [window] = await manager.list();
    if (!window) throw new Error("expected a seeded window");

    await manager.minimize(window.handle);
    expect((await manager.get(window.handle))?.state).toBe("minimized");

    await manager.maximize(window.handle);
    expect((await manager.get(window.handle))?.state).toBe("maximized");

    await manager.restore(window.handle);
    expect((await manager.get(window.handle))?.state).toBe("normal");
  });

  it("rejects non-positive resize dimensions", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createWindowManager(api);
    const [window] = await manager.list();
    if (!window) throw new Error("expected a seeded window");
    await expect(manager.resize(window.handle, 0, 100)).rejects.toThrow();
  });
});

describe("ApplicationManager", () => {
  it("launches, restarts, and closes an application", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createApplicationManager(api);
    await manager.launch("microsoft.windows.calculator");
    expect(
      (await manager.listRunning()).some((a) => a.appId === "microsoft.windows.calculator"),
    ).toBe(true);

    await manager.restart("microsoft.windows.calculator");
    expect(
      (await manager.listRunning()).some((a) => a.appId === "microsoft.windows.calculator"),
    ).toBe(true);

    await manager.close("microsoft.windows.calculator");
    expect(
      (await manager.listRunning()).some((a) => a.appId === "microsoft.windows.calculator"),
    ).toBe(false);
  });

  it("opens a file via its associated application", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createApplicationManager(api);
    await api.writeFile("C:\\Users\\ryper\\Documents\\notes.txt", "hi");
    await expect(
      manager.openFile("C:\\Users\\ryper\\Documents\\notes.txt"),
    ).resolves.toBeUndefined();
  });
});
