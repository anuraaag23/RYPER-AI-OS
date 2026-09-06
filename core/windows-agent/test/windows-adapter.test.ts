import { describe, expect, it } from "vitest";
import { UnsupportedCapabilityError } from "@ryper/platform-capability";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { WindowsAdapter, createWindowsAdapter } from "../src/windows-adapter.js";
import { buildToolContext, allowAllConfirmer, denyConfirmer } from "./helpers.js";

describe("WindowsAdapter", () => {
  it("reports platform, adapter version, and support for every known domain", async () => {
    const adapter = await createWindowsAdapter();
    expect(adapter.platform).toBe("windows");
    expect(adapter.adapterVersion).toBeTruthy();
    for (const domain of [
      "application_control",
      "window_management",
      "clipboard",
      "notifications",
      "audio",
      "display",
      "filesystem",
      "device_information",
      "process_management",
      "background_services",
      "registry",
      "security",
      "diagnostics",
      "performance_monitoring",
    ]) {
      expect(adapter.supports(domain)).toBe(true);
    }
    expect(adapter.supports("not_a_real_domain")).toBe(false);
  });

  it("describes every known capability domain", async () => {
    const adapter = await createWindowsAdapter();
    expect(adapter.describeCapability("filesystem")?.name).toBe("Filesystem");
    expect(adapter.describeCapability("not_a_real_domain")).toBeUndefined();
  });

  it("dispatches application_control.launch through to the ApplicationManager", async () => {
    const adapter = await createWindowsAdapter();
    const result = await adapter.invoke(
      "application_control",
      "launch",
      { appId: "microsoft.windows.calculator" },
      buildToolContext(),
    );
    expect(result).toMatchObject({ name: "Calculator.exe" });
  });

  it("dispatches window_management.snap and reflects the change through get_metadata", async () => {
    const adapter = await createWindowsAdapter();
    const windows = (await adapter.invoke(
      "window_management",
      "enumerate",
      {},
      buildToolContext(),
    )) as {
      handle: string;
    }[];
    const [window] = windows;
    if (!window) throw new Error("expected a seeded window");

    await adapter.invoke(
      "window_management",
      "snap",
      { handle: window.handle, position: "right" },
      buildToolContext(),
    );
    const updated = (await adapter.invoke(
      "window_management",
      "get_metadata",
      { handle: window.handle },
      buildToolContext(),
    )) as { bounds: { x: number } };
    expect(updated.bounds.x).toBeGreaterThan(0);
  });

  it("routes filesystem.delete through the destructive action gate", async () => {
    const systemApi = new InMemoryWindowsSystemApi();
    const denyingAdapter = await createWindowsAdapter({
      systemApi,
      destructiveActionConfirmer: denyConfirmer,
    });
    const folder = await systemApi.getWellKnownFolderPath("downloads");
    await systemApi.writeFile(`${folder}\\a.txt`, "x");

    await expect(
      denyingAdapter.invoke(
        "filesystem",
        "delete",
        { path: `${folder}\\a.txt` },
        buildToolContext(),
      ),
    ).rejects.toThrow(/not confirmed/);
  });

  it("allows filesystem.delete once confirmed", async () => {
    const systemApi = new InMemoryWindowsSystemApi();
    const allowingAdapter = await createWindowsAdapter({
      systemApi,
      destructiveActionConfirmer: allowAllConfirmer,
    });
    const folder = await systemApi.getWellKnownFolderPath("downloads");
    await systemApi.writeFile(`${folder}\\a.txt`, "x");

    await allowingAdapter.invoke(
      "filesystem",
      "delete",
      { path: `${folder}\\a.txt` },
      buildToolContext(),
    );
    await expect(systemApi.readFile(`${folder}\\a.txt`)).rejects.toThrow();
  });

  it("throws UnsupportedCapabilityError for an unimplemented operation", async () => {
    const adapter = await createWindowsAdapter();
    await expect(
      adapter.invoke("filesystem", "not_a_real_operation", {}, buildToolContext()),
    ).rejects.toThrow(UnsupportedCapabilityError);
  });

  it("gracefully degrades clipboard.history on Windows 10", async () => {
    const systemApi = new InMemoryWindowsSystemApi({
      windowsVersion: {
        release: "windows-10",
        buildNumber: "10.0.19045",
        displayName: "Windows 10 22H2",
      },
    });
    const adapter = await createWindowsAdapter({ systemApi });
    await expect(adapter.invoke("clipboard", "history", {}, buildToolContext())).rejects.toThrow(
      UnsupportedCapabilityError,
    );
    expect(adapter.getRuntimeLimitations().some((l) => l.domain === "clipboard")).toBe(true);
  });

  it("allows clipboard.history on Windows 11", async () => {
    const systemApi = new InMemoryWindowsSystemApi({
      windowsVersion: {
        release: "windows-11",
        buildNumber: "10.0.22631",
        displayName: "Windows 11 23H2",
      },
    });
    const adapter = await createWindowsAdapter({ systemApi });
    await expect(adapter.invoke("clipboard", "history", {}, buildToolContext())).resolves.toEqual(
      [],
    );
  });

  it("reports device info with the detected Windows version", async () => {
    const adapter = await createWindowsAdapter();
    const info = adapter.getDeviceInfo();
    expect(info.platform).toBe("windows");
    expect(info.deviceType).toBe("desktop");
    expect(info.platformVersion).toContain("Windows");
  });

  it("always reports the registry-writes-disabled runtime limitation by default", async () => {
    const adapter = await createWindowsAdapter();
    expect(adapter.getRuntimeLimitations().some((l) => l.domain === "registry")).toBe(true);
  });

  it("records every invocation (success and failure) with the DiagnosticsManager", async () => {
    const adapter = await createWindowsAdapter();
    await adapter.invoke("audio", "get_volume", {}, buildToolContext());
    await adapter
      .invoke("filesystem", "not_a_real_operation", {}, buildToolContext())
      .catch(() => undefined);

    const recent = adapter.diagnosticsManager.recentInvocations();
    expect(recent.some((r) => r.domain === "audio" && r.ok)).toBe(true);
    expect(recent.some((r) => r.domain === "filesystem" && !r.ok)).toBe(true);
  });

  it("falls back to a plugin-registered handler for an unknown operation", async () => {
    const adapter = await createWindowsAdapter();
    adapter.pluginCapabilities.register({
      pluginId: "acme.tray-icons",
      domain: "tray_icons",
      operation: "set_icon",
      handler: async (params) => ({ iconSet: params.iconName }),
    });

    expect(adapter.supports("tray_icons")).toBe(true);
    const result = await adapter.invoke(
      "tray_icons",
      "set_icon",
      { iconName: "sync" },
      buildToolContext(),
    );
    expect(result).toEqual({ iconSet: "sync" });
  });

  it("still throws for a domain no plugin has registered", async () => {
    const adapter = await createWindowsAdapter();
    await expect(
      adapter.invoke("nonexistent_domain", "op", {}, buildToolContext()),
    ).rejects.toThrow(UnsupportedCapabilityError);
  });
});

describe("WindowsAdapter.create with an unsupported Windows release", () => {
  it("does not throw, but reports the release as a runtime limitation and refuses invocation", async () => {
    const systemApi = new InMemoryWindowsSystemApi({
      windowsVersion: { release: "unsupported", buildNumber: "6.1.7601", displayName: "Windows 7" },
    });
    const adapter = await WindowsAdapter.create({ systemApi });
    expect(
      adapter.getRuntimeLimitations().some((l) => l.reason.includes("not a supported release")),
    ).toBe(true);
    await expect(
      adapter.invoke("application_control", "enumerate_installed", {}, buildToolContext()),
    ).rejects.toThrow(UnsupportedCapabilityError);
  });
});
