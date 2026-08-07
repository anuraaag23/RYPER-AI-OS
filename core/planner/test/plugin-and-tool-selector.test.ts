import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { PluginRuntime } from "@ryper/plugin-runtime";
import { PlannerPluginRegistry, PluginSchemaError } from "../src/plugin-registry.js";
import { ToolSelector } from "../src/tool-selector.js";
import type { TaskNode } from "../src/types.js";

function task(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "t1",
    taskType: "browser",
    operation: "navigate",
    description: "navigate",
    parameters: {},
    dependsOn: [],
    priority: "normal",
    ...overrides,
  };
}

describe("PlannerPluginRegistry", () => {
  it("registers and finds a schema by operation", () => {
    const registry = new PlannerPluginRegistry();
    registry.register({
      pluginId: "weather-plugin",
      operation: "weather.get_forecast",
      description: "Gets a weather forecast",
      parameterNames: ["city"],
    });
    expect(registry.find("weather.get_forecast")?.pluginId).toBe("weather-plugin");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects a duplicate operation registration", () => {
    const registry = new PlannerPluginRegistry();
    const schema = {
      pluginId: "p1",
      operation: "op",
      description: "d",
      parameterNames: [],
    };
    registry.register(schema);
    expect(() => registry.register(schema)).toThrow(PluginSchemaError);
  });

  it("only reports schemas whose plugin is currently loaded", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const runtime = new PluginRuntime(broker, bus, true);
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

    const registry = new PlannerPluginRegistry();
    registry.register({
      pluginId: "loaded-plugin",
      operation: "op-a",
      description: "d",
      parameterNames: [],
    });
    registry.register({
      pluginId: "unloaded-plugin",
      operation: "op-b",
      description: "d",
      parameterNames: [],
    });

    const active = registry.discoverActive(runtime);
    expect(active.map((s) => s.pluginId)).toEqual(["loaded-plugin"]);
  });
});

describe("ToolSelector", () => {
  it("routes a non-plugin task to its mapped platform agent", () => {
    const selector = new ToolSelector();
    const route = selector.select(task({ taskType: "browser" }));
    expect(route).toEqual({ kind: "platform_agent", agent: "browser-agent" });
  });

  it("routes a plugin task to a registered schema", () => {
    const registry = new PlannerPluginRegistry();
    registry.register({
      pluginId: "weather-plugin",
      operation: "weather.get_forecast",
      description: "d",
      parameterNames: [],
    });
    const selector = new ToolSelector(registry);
    const route = selector.select(task({ taskType: "plugin", operation: "weather.get_forecast" }));
    expect(route).toEqual({
      kind: "plugin",
      pluginId: "weather-plugin",
      operation: "weather.get_forecast",
    });
  });

  it("reports unresolved when a plugin task has no matching schema", () => {
    const selector = new ToolSelector(new PlannerPluginRegistry());
    const route = selector.select(task({ taskType: "plugin", operation: "unknown.op" }));
    expect(route.kind).toBe("unresolved");
  });
});
