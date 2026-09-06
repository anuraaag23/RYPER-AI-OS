import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { ToolPluginBridge, ToolRegistry } from "@ryper/tool-framework";
import { PlannerPluginRegistry } from "@ryper/planner";
import { definePlugin } from "@ryper/plugin-sdk";
import { PluginManager } from "../src/plugin-manager.js";
import { buildCapabilityBroker, buildMemoryManager } from "./helpers.js";

describe("PluginManager — install through to invocation", () => {
  it("installs a plugin and invokes its action through the sandboxed path", async () => {
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "echo-plugin",
      name: "Echo Plugin",
      version: "1.0.0",
      actions: [{ name: "echo", handler: (input) => input }],
    });

    const context = await manager.install(plugin);
    expect(context.pluginId).toBe("echo-plugin");
    expect(manager.registry.get("echo-plugin")?.state).toBe("enabled");

    const result = await manager.invokeAction("echo-plugin", "echo", { hi: "there" });
    expect(result).toEqual({ hi: "there" });
    expect(manager.metrics.snapshot("echo-plugin")?.callCount).toBe(1);
  });

  it("records a failed invocation in metrics without crashing the manager", async () => {
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "throwing-plugin",
      name: "Throwing Plugin",
      version: "1.0.0",
      actions: [
        {
          name: "boom",
          handler: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    await manager.install(plugin);
    await expect(manager.invokeAction("throwing-plugin", "boom", {})).rejects.toThrow();
    expect(manager.metrics.snapshot("throwing-plugin")?.errorCount).toBe(1);
  });
});

describe("PluginManager — full lifecycle cycle", () => {
  it("disables, re-enables, and uninstalls a plugin", async () => {
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "lifecycle-plugin",
      name: "Lifecycle Plugin",
      version: "1.0.0",
      actions: [{ name: "noop", handler: () => null }],
    });
    await manager.install(plugin);

    await manager.disable("lifecycle-plugin");
    expect(manager.registry.get("lifecycle-plugin")?.state).toBe("disabled");

    await manager.enable("lifecycle-plugin");
    expect(manager.registry.get("lifecycle-plugin")?.state).toBe("enabled");

    await manager.uninstall("lifecycle-plugin");
    expect(manager.registry.get("lifecycle-plugin")?.state).toBe("uninstalled");
  });

  it("calls a plugin's lifecycle hooks in the right order", async () => {
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      allowUnsignedPlugins: true,
    });
    const calls: string[] = [];
    const plugin = definePlugin({
      id: "hooked-plugin",
      name: "Hooked Plugin",
      version: "1.0.0",
      actions: [{ name: "noop", handler: () => null }],
      lifecycle: {
        initialize: () => {
          calls.push("initialize");
        },
        onEnable: () => {
          calls.push("onEnable");
        },
        onDisable: () => {
          calls.push("onDisable");
        },
        onUninstall: () => {
          calls.push("onUninstall");
        },
      },
    });
    await manager.install(plugin);
    await manager.disable("hooked-plugin", plugin.lifecycle);
    await manager.uninstall("hooked-plugin", plugin.lifecycle);
    expect(calls).toEqual(["initialize", "onEnable", "onDisable", "onUninstall"]);
  });
});

describe("PluginManager — cross-system integration", () => {
  it("a plugin's registered action is reachable through a ToolPluginBridge built on the manager's own runtime", async () => {
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "weather-plugin",
      name: "Weather",
      version: "1.0.0",
      actions: [{ name: "get_forecast", handler: () => ({ sunny: true }) }],
    });
    await manager.install(plugin);

    // Built against the *same* PluginManager.runtime the plugin actually registered with.
    const toolRegistry = new ToolRegistry();
    const toolBridge = new ToolPluginBridge(toolRegistry, manager.runtime);
    toolBridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: {
        id: "weather.forecast",
        name: "Forecast",
        description: "d",
        category: "plugin",
        version: "1.0.0",
        author: "test",
        capabilities: [],
        permissions: [],
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        examples: [],
        errorCodes: [],
        executionCost: "low",
        timeoutMs: 500,
        cancellationSupport: false,
        streamingSupport: false,
      },
    });

    const toolResult = await toolRegistry
      .get("weather.forecast")!
      .execute({}, { invocationId: "i1", actorId: "a", sessionId: "s", platform: "windows" });
    expect(toolResult).toEqual({ sunny: true });
  });

  it("wires a plugin's planner task schema into a real PlannerPluginRegistry", async () => {
    const plannerRegistry = new PlannerPluginRegistry();
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      plannerRegistry,
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "automation-plugin",
      name: "Automation",
      version: "1.0.0",
      actions: [{ name: "run_routine", handler: () => null }],
      extended: {
        plannerTaskSchemas: [
          { operation: "run_morning_routine", description: "d", parameterNames: [] },
        ],
      },
    });
    await manager.install(plugin);
    expect(plannerRegistry.find("run_morning_routine")?.pluginId).toBe("automation-plugin");
  });

  it("persists plugin settings via a real MemoryManager", async () => {
    const memory = buildMemoryManager();
    const manager = new PluginManager({
      broker: buildCapabilityBroker(),
      eventBus: new EventBus(),
      memory,
      allowUnsignedPlugins: true,
    });
    const plugin = definePlugin({
      id: "settings-plugin",
      name: "Settings",
      version: "1.0.0",
      actions: [{ name: "noop", handler: () => null }],
    });
    const context = await manager.install(plugin);
    await context.settings.set("theme", "dark");
    expect(context.settings.get("theme")).toBe("dark");
  });
});
