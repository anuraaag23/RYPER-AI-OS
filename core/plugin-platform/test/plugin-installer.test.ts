import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { PluginRuntime } from "@ryper/plugin-runtime";
import type { DefinePluginOptions } from "@ryper/plugin-sdk";
import { createExtensionManifest } from "../src/manifest.js";
import { PluginEventBridge } from "../src/event-bridge.js";
import { PluginDiagnostics, PluginMetrics } from "../src/plugin-diagnostics.js";
import { PluginInstallError, PluginInstaller } from "../src/plugin-installer.js";
import { PluginLifecycleManager } from "../src/lifecycle.js";
import { PluginLoader } from "../src/plugin-loader.js";
import { PluginLoggerFactory } from "../src/plugin-logger.js";
import { PluginConfigurationManager } from "../src/plugin-configuration.js";
import { PluginPermissionManager } from "../src/permission-manager.js";
import { PluginPlatformRegistry } from "../src/plugin-registry.js";
import { buildCapabilityBroker, buildMemoryManager, testPlugin } from "./helpers.js";
import type { PluginPackage } from "../src/types.js";

function buildPackage(overrides: Partial<DefinePluginOptions> = {}): PluginPackage {
  const defined = testPlugin(overrides);
  return { defined, extensionManifest: createExtensionManifest(defined) };
}

function setup() {
  const broker = buildCapabilityBroker(() => true);
  const bus = new EventBus();
  const runtime = new PluginRuntime(broker, bus, true);
  const registry = new PluginPlatformRegistry();
  const memory = buildMemoryManager();
  const configuration = new PluginConfigurationManager(memory);
  const diagnostics = new PluginDiagnostics();
  const metrics = new PluginMetrics();
  const loggerFactory = new PluginLoggerFactory();
  const events = new PluginEventBridge(bus);
  const permissions = new PluginPermissionManager(broker);
  const lifecycle = new PluginLifecycleManager(registry, events, metrics);
  const loader = new PluginLoader({
    runtime,
    registry,
    configuration,
    diagnostics,
    loggerFactory,
    events,
    memory,
  });
  const installer = new PluginInstaller({
    runtime,
    registry,
    loader,
    lifecycle,
    permissions,
    events,
  });
  return { runtime, registry, installer, permissions, lifecycle };
}

describe("PluginInstaller.install", () => {
  it("installs a valid plugin through to the enabled state", async () => {
    const { installer, registry } = setup();
    const context = await installer.install(buildPackage());
    expect(context.pluginId).toBe("test-plugin");
    expect(registry.get("test-plugin")?.state).toBe("enabled");
  });

  it("requests every permission the manifest declares", async () => {
    const { installer, permissions } = setup();
    await installer.install(buildPackage({ requestedCapabilities: ["network"] }));
    expect(permissions.checkForPlugin("test-plugin", ["network"])).toBe(true);
  });

  it("rejects an invalid manifest before touching the runtime", async () => {
    const { installer, runtime } = setup();
    const pkg = buildPackage();
    const invalidPkg: PluginPackage = {
      ...pkg,
      extensionManifest: {
        ...pkg.extensionManifest,
        minSdkVersion: "99.0.0",
        maxSdkVersion: "100.0.0",
      },
    };
    await expect(installer.install(invalidPkg)).rejects.toThrow(PluginInstallError);
    expect(runtime.listPlugins()).toHaveLength(0);
  });

  it("rejects installing a plugin whose dependency isn't already installed", async () => {
    const { installer } = setup();
    const pkg = buildPackage({
      extended: { dependencies: [{ id: "missing-plugin", version: "1.0.0" }] },
    });
    await expect(installer.install(pkg)).rejects.toThrow();
  });
});

describe("PluginInstaller.update", () => {
  it("updates an installed plugin to a newer version", async () => {
    const { installer, registry } = setup();
    await installer.install(buildPackage({ version: "1.0.0" }));
    const context = await installer.update(buildPackage({ version: "1.1.0" }));
    expect(context.pluginId).toBe("test-plugin");
    expect(registry.get("test-plugin")?.manifest.version).toBe("1.1.0");
    expect(registry.get("test-plugin")?.state).toBe("enabled");
  });

  it("rejects updating to a version that isn't newer", async () => {
    const { installer } = setup();
    await installer.install(buildPackage({ version: "1.0.0" }));
    await expect(installer.update(buildPackage({ version: "1.0.0" }))).rejects.toThrow(
      PluginInstallError,
    );
  });

  it("rejects updating a plugin that was never installed", async () => {
    const { installer } = setup();
    await expect(installer.update(buildPackage({ version: "2.0.0" }))).rejects.toThrow(
      PluginInstallError,
    );
  });
});

describe("PluginInstaller.uninstall", () => {
  it("uninstalls an enabled plugin, revoking permissions and unregistering it", async () => {
    const { installer, registry, runtime, permissions } = setup();
    await installer.install(buildPackage({ requestedCapabilities: ["network"] }));
    await installer.uninstall("test-plugin", {});
    expect(registry.get("test-plugin")?.state).toBe("uninstalled");
    expect(runtime.listPlugins()).toHaveLength(0);
    expect(permissions.checkForPlugin("test-plugin", ["network"])).toBe(false);
  });

  it("rejects uninstalling a plugin that was never installed", async () => {
    const { installer } = setup();
    await expect(installer.uninstall("never-installed", {})).rejects.toThrow(PluginInstallError);
  });
});
