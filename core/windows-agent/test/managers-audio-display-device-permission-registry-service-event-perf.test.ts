import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { createDestructiveActionGate } from "../src/confirmation.js";
import { createAudioManager } from "../src/audio-manager.js";
import { createDisplayManager } from "../src/display-manager.js";
import { createDeviceManager } from "../src/device-manager.js";
import { createPermissionManager } from "../src/permission-manager.js";
import {
  createRegistryInterface,
  RegistryWriteNotAuthorizedError,
} from "../src/registry-interface.js";
import { createServiceManager } from "../src/service-manager.js";
import { createEventMonitor } from "../src/event-monitor.js";
import { createPerformanceMonitor } from "../src/performance-monitor.js";
import { allowAllConfirmer, allowElevation, denyConfirmer, denyElevation } from "./helpers.js";

describe("AudioManager", () => {
  it("sets volume within range and rejects out-of-range values", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createAudioManager(api);
    await manager.setVolume(30);
    await expect(manager.getVolume()).resolves.toBe(30);
    await expect(manager.setVolume(-1)).rejects.toThrow();
    await expect(manager.setVolume(101)).rejects.toThrow();
  });

  it("toggles mute", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createAudioManager(api);
    expect(await manager.toggleMute()).toBe(true);
    expect(await manager.toggleMute()).toBe(false);
  });

  it("lists devices and changes the default", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createAudioManager(api);
    const [device] = await manager.listDevices();
    if (!device) throw new Error("expected a seeded device");
    await manager.setDefaultDevice(device.id);
    expect((await manager.listDevices()).find((d) => d.id === device.id)?.isDefault).toBe(true);
  });

  it("accepts media control actions", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createAudioManager(api);
    await expect(manager.mediaControl("play")).resolves.toBeUndefined();
  });
});

describe("DisplayManager", () => {
  it("returns the primary display", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createDisplayManager(api);
    const primary = await manager.getPrimary();
    expect(primary?.primary).toBe(true);
  });
});

describe("DeviceManager", () => {
  it("returns a system info snapshot with CPU/GPU/RAM/storage/network", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createDeviceManager(api);
    const info = await manager.getSystemInfo();
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info.ram.totalBytes).toBeGreaterThan(0);
    expect(info.storage.length).toBeGreaterThan(0);
    expect(info.network).toBeDefined();
  });
});

describe("PermissionManager", () => {
  it("never elevates by default (silence means no)", async () => {
    const manager = createPermissionManager();
    expect(await manager.requestElevation("test")).toBe(false);
    expect(manager.isElevated()).toBe(false);
  });

  it("only elevates when an injected prompt grants it", async () => {
    const denying = createPermissionManager(denyElevation);
    expect(await denying.requestElevation("test")).toBe(false);

    const allowing = createPermissionManager(allowElevation);
    expect(await allowing.requestElevation("test")).toBe(true);
    expect(allowing.isElevated()).toBe(true);
  });

  it("records elevation history", async () => {
    const manager = createPermissionManager(allowElevation);
    await manager.requestElevation("install a driver");
    expect(manager.elevationHistory()).toHaveLength(1);
    expect(manager.elevationHistory()[0]?.granted).toBe(true);
  });
});

describe("RegistryInterface", () => {
  it("always allows reads", async () => {
    const api = new InMemoryWindowsSystemApi();
    const registry = createRegistryInterface(api, createDestructiveActionGate(denyConfirmer));
    const value = await registry.readValue("HKCU", "Software\\Ryper", "InstallPath");
    expect(value?.value).toBe("C:\\Program Files\\Ryper");
  });

  it("refuses writes unless allowWrites is explicitly true", async () => {
    const api = new InMemoryWindowsSystemApi();
    const registry = createRegistryInterface(api, createDestructiveActionGate(allowAllConfirmer), {
      allowWrites: false,
    });
    await expect(
      registry.writeValue({
        hive: "HKCU",
        path: "Software\\X",
        name: "Y",
        value: "1",
        valueType: "REG_SZ",
      }),
    ).rejects.toThrow(RegistryWriteNotAuthorizedError);
  });

  it("requires destructive-action confirmation even when writes are allowed", async () => {
    const api = new InMemoryWindowsSystemApi();
    const registry = createRegistryInterface(api, createDestructiveActionGate(denyConfirmer), {
      allowWrites: true,
    });
    await expect(
      registry.writeValue({
        hive: "HKCU",
        path: "Software\\X",
        name: "Y",
        value: "1",
        valueType: "REG_SZ",
      }),
    ).rejects.toThrow(/not confirmed/);
  });

  it("writes successfully when both allowWrites and confirmation are satisfied", async () => {
    const api = new InMemoryWindowsSystemApi();
    const registry = createRegistryInterface(api, createDestructiveActionGate(allowAllConfirmer), {
      allowWrites: true,
    });
    await registry.writeValue({
      hive: "HKCU",
      path: "Software\\X",
      name: "Y",
      value: "1",
      valueType: "REG_SZ",
    });
    await expect(registry.readValue("HKCU", "Software\\X", "Y")).resolves.toMatchObject({
      value: "1",
    });
  });
});

describe("ServiceManager", () => {
  it("starts and stops a non-critical service freely", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createServiceManager(api, createDestructiveActionGate(denyConfirmer));
    await manager.stop("Spooler");
    await expect(manager.status("Spooler")).resolves.toBe("stopped");
  });

  it("requires confirmation before stopping a critical service", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createServiceManager(api, createDestructiveActionGate(denyConfirmer));
    await expect(manager.stop("WinDefend")).rejects.toThrow(/not confirmed/);
    await expect(manager.status("WinDefend")).resolves.toBe("running");
  });

  it("stops a critical service once confirmed, and restart works", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createServiceManager(api, createDestructiveActionGate(allowAllConfirmer));
    await manager.restart("WinDefend");
    await expect(manager.status("WinDefend")).resolves.toBe("running");
  });
});

describe("EventMonitor", () => {
  it("re-emits system events and keeps a bounded history", async () => {
    const api = new InMemoryWindowsSystemApi();
    const monitor = createEventMonitor(api, undefined, 3);
    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      await api.startProcess(`C:\\app${i}.exe`);
    }
    expect(monitor.recent()).toHaveLength(3);
    expect(monitor.recent("process_started").length).toBeGreaterThan(0);

    monitor.stop();
    expect(monitor.isMonitoring()).toBe(false);
  });

  it("start() is idempotent", () => {
    const api = new InMemoryWindowsSystemApi();
    const monitor = createEventMonitor(api);
    monitor.start();
    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);
  });
});

describe("PerformanceMonitor", () => {
  it("samples and summarizes performance data", async () => {
    const api = new InMemoryWindowsSystemApi();
    const monitor = createPerformanceMonitor(api);
    await monitor.sample();
    await monitor.sample();
    const summary = monitor.summary();
    expect(summary.sampleCount).toBe(2);
    expect(summary.averageCpuPercent).toBeGreaterThanOrEqual(0);
  });

  it("returns a zeroed summary with no samples", () => {
    const api = new InMemoryWindowsSystemApi();
    const monitor = createPerformanceMonitor(api);
    expect(monitor.summary()).toEqual({
      sampleCount: 0,
      averageCpuPercent: 0,
      averageMemoryPercent: 0,
      peakCpuPercent: 0,
    });
  });
});
