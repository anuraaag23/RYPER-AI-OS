import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";
import { ToolPluginBridge } from "../src/plugin-integration.js";
import type { ToolSpec } from "../src/types.js";
import { buildPluginRuntime } from "./helpers.js";

function spec(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id: "weather.forecast",
    name: "Weather Forecast",
    description: "gets a forecast",
    category: "plugin",
    version: "1.0.0",
    author: "weather-plugin",
    capabilities: [],
    permissions: [],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    examples: [],
    errorCodes: [],
    executionCost: "low",
    timeoutMs: 1000,
    cancellationSupport: false,
    streamingSupport: false,
    ...overrides,
  };
}

describe("ToolPluginBridge", () => {
  it("registers a plugin tool that delegates execution to PluginRuntime.invoke", async () => {
    const runtime = buildPluginRuntime();
    runtime.register(
      {
        id: "weather-plugin",
        name: "Weather",
        version: "1.0.0",
        requestedCapabilities: [],
        signed: false,
      },
      [
        {
          name: "get_forecast",
          handler: (input) => ({ city: (input as Record<string, unknown>)["city"], sunny: true }),
        },
      ],
    );

    const registry = new ToolRegistry();
    const bridge = new ToolPluginBridge(registry, runtime);
    bridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: spec(),
    });

    const tool = registry.get("weather.forecast");
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      { city: "Varanasi" },
      { invocationId: "i1", actorId: "a", sessionId: "s", platform: "windows" },
    );
    expect(result).toEqual({ city: "Varanasi", sunny: true });
  });

  it("updates a plugin tool in place for a version bump", () => {
    const runtime = buildPluginRuntime();
    const registry = new ToolRegistry();
    const bridge = new ToolPluginBridge(registry, runtime);
    bridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: spec({ version: "1.0.0" }),
    });
    bridge.updatePluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: spec({ version: "2.0.0" }),
    });
    expect(registry.get("weather.forecast")?.spec.version).toBe("2.0.0");
  });

  it("unregisters a single plugin tool", () => {
    const runtime = buildPluginRuntime();
    const registry = new ToolRegistry();
    const bridge = new ToolPluginBridge(registry, runtime);
    bridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: spec(),
    });
    expect(bridge.unregisterPluginTool("weather.forecast")).toBe(true);
    expect(registry.has("weather.forecast")).toBe(false);
  });

  it("cascades unregistration of every tool a plugin registered", () => {
    const runtime = buildPluginRuntime();
    const registry = new ToolRegistry();
    const bridge = new ToolPluginBridge(registry, runtime);
    bridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_forecast",
      spec: spec({ id: "weather.forecast" }),
    });
    bridge.registerPluginTool({
      pluginId: "weather-plugin",
      actionName: "get_alerts",
      spec: spec({ id: "weather.alerts" }),
    });
    expect(bridge.unregisterAllForPlugin("weather-plugin")).toBe(2);
    expect(registry.has("weather.forecast")).toBe(false);
    expect(registry.has("weather.alerts")).toBe(false);
  });

  it("only reports tools whose owning plugin is still loaded", () => {
    const runtime = buildPluginRuntime();
    runtime.register(
      {
        id: "loaded-plugin",
        name: "Loaded",
        version: "1.0.0",
        requestedCapabilities: [],
        signed: false,
      },
      [],
    );
    const registry = new ToolRegistry();
    const bridge = new ToolPluginBridge(registry, runtime);
    bridge.registerPluginTool({
      pluginId: "loaded-plugin",
      actionName: "op",
      spec: spec({ id: "a" }),
    });
    bridge.registerPluginTool({
      pluginId: "unloaded-plugin",
      actionName: "op",
      spec: spec({ id: "b" }),
    });

    const active = bridge.discoverActive();
    expect(active.map((s) => s.id)).toEqual(["a"]);
  });
});
