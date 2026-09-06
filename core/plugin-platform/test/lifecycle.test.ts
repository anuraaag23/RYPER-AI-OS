import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import type { PluginContext, PluginLifecycleHooks } from "@ryper/plugin-sdk";
import { createExtensionManifest } from "../src/manifest.js";
import { PluginEventBridge } from "../src/event-bridge.js";
import { LifecycleTransitionError, PluginLifecycleManager } from "../src/lifecycle.js";
import { PluginMetrics } from "../src/plugin-diagnostics.js";
import { PluginPlatformRegistry } from "../src/plugin-registry.js";
import { testPlugin } from "./helpers.js";

const fakeContext = { pluginId: "test-plugin" } as unknown as PluginContext;

function setup() {
  const registry = new PluginPlatformRegistry();
  registry.register(createExtensionManifest(testPlugin()));
  const bus = new EventBus();
  const events = new PluginEventBridge(bus);
  const metrics = new PluginMetrics();
  const manager = new PluginLifecycleManager(registry, events, metrics);
  return { registry, bus, events, metrics, manager };
}

describe("PluginLifecycleManager — valid transitions", () => {
  it("walks the full install -> enabled path, calling each hook in order", async () => {
    const { manager, registry } = setup();
    const calls: string[] = [];
    const hooks: PluginLifecycleHooks = {
      initialize: () => {
        calls.push("initialize");
      },
      onEnable: () => {
        calls.push("onEnable");
      },
    };

    await manager.install("test-plugin");
    await manager.load("test-plugin");
    await manager.initialize("test-plugin", hooks, fakeContext);
    await manager.enable("test-plugin", hooks, fakeContext);

    expect(registry.get("test-plugin")?.state).toBe("enabled");
    expect(calls).toEqual(["initialize", "onEnable"]);
  });

  it("supports disable -> enable and suspend -> resume cycles", async () => {
    const { manager } = setup();
    await manager.install("test-plugin");
    await manager.load("test-plugin");
    await manager.initialize("test-plugin", {}, fakeContext);
    await manager.enable("test-plugin", {}, fakeContext);

    await manager.disable("test-plugin", {}, fakeContext);
    await manager.enable("test-plugin", {}, fakeContext);
    await manager.suspend("test-plugin", {}, fakeContext);
    await manager.resume("test-plugin", {}, fakeContext);
  });

  it("reload runs disable then enable", async () => {
    const { manager } = setup();
    const calls: string[] = [];
    const hooks: PluginLifecycleHooks = {
      onDisable: () => {
        calls.push("disable");
      },
      onEnable: () => {
        calls.push("enable");
      },
    };
    await manager.install("test-plugin");
    await manager.load("test-plugin");
    await manager.initialize("test-plugin", {}, fakeContext);
    await manager.enable("test-plugin", {}, fakeContext);
    calls.length = 0;

    await manager.reload("test-plugin", hooks, fakeContext);
    expect(calls).toEqual(["disable", "enable"]);
  });

  it("emits a plugin.lifecycle.<state> event for each transition", async () => {
    const { manager, bus } = setup();
    const seen: string[] = [];
    bus.subscribe({ type: "plugin.lifecycle.installed" }, () => seen.push("installed"));
    await manager.install("test-plugin");
    expect(seen).toEqual(["installed"]);
  });
});

describe("PluginLifecycleManager — invalid transitions", () => {
  it("rejects enabling a plugin that hasn't been initialized yet", async () => {
    const { manager } = setup();
    await manager.install("test-plugin");
    await manager.load("test-plugin");
    await expect(manager.enable("test-plugin", {}, fakeContext)).rejects.toThrow(
      LifecycleTransitionError,
    );
  });

  it("rejects any transition for an unregistered plugin", async () => {
    const { manager } = setup();
    await expect(manager.install("never-registered")).rejects.toThrow(LifecycleTransitionError);
  });

  it("allows retrying install after a failure", async () => {
    const { manager, registry } = setup();
    await manager.fail("test-plugin", "boom");
    expect(registry.get("test-plugin")?.state).toBe("failed");
    await manager.install("test-plugin");
    expect(registry.get("test-plugin")?.state).toBe("installed");
  });
});
