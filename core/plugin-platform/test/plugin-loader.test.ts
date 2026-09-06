import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { PluginRuntime } from "@ryper/plugin-runtime";
import { ToolPluginBridge, ToolRegistry } from "@ryper/tool-framework";
import { PlannerPluginRegistry } from "@ryper/planner";
import type { DefinePluginOptions } from "@ryper/plugin-sdk";
import { createExtensionManifest } from "../src/manifest.js";
import { PluginEventBridge } from "../src/event-bridge.js";
import { PluginDiagnostics } from "../src/plugin-diagnostics.js";
import { PluginLoader, type PluginLoaderDeps } from "../src/plugin-loader.js";
import { PluginLoggerFactory } from "../src/plugin-logger.js";
import { PluginConfigurationManager } from "../src/plugin-configuration.js";
import { PluginPlatformRegistry } from "../src/plugin-registry.js";
import { buildCapabilityBroker, buildMemoryManager, testPlugin } from "./helpers.js";
import type { PluginPackage } from "../src/types.js";

function buildLoader(overrides: Partial<PluginLoaderDeps> = {}) {
  const runtime =
    overrides.runtime ?? new PluginRuntime(buildCapabilityBroker(), new EventBus(), true);
  const registry = new PluginPlatformRegistry();
  const memory = buildMemoryManager();
  const configuration = new PluginConfigurationManager(memory);
  const diagnostics = new PluginDiagnostics();
  const loggerFactory = new PluginLoggerFactory();
  const events = new PluginEventBridge(new EventBus());
  const loader = new PluginLoader({
    runtime,
    registry,
    configuration,
    diagnostics,
    loggerFactory,
    events,
    memory,
    ...overrides,
  });
  return { runtime, registry, memory, configuration, diagnostics, events, loader };
}

function buildPackage(overrides: Partial<DefinePluginOptions> = {}): PluginPackage {
  const defined = testPlugin(overrides);
  return { defined, extensionManifest: createExtensionManifest(defined) };
}

describe("PluginLoader", () => {
  it("registers the plugin's manifest with the platform registry and the runtime", () => {
    const { loader, registry, runtime } = buildLoader();
    loader.load(buildPackage());
    expect(registry.has("test-plugin")).toBe(true);
    expect(runtime.listPlugins().map((m) => m.id)).toEqual(["test-plugin"]);
  });

  it("cross-registers a tool from toolRegistrations with ToolPluginBridge", () => {
    const toolRegistry = new ToolRegistry();
    const toolRuntime = new PluginRuntime(buildCapabilityBroker(), new EventBus(), true);
    const toolBridge = new ToolPluginBridge(toolRegistry, toolRuntime);
    const { loader } = buildLoader({ runtime: toolRuntime, toolBridge });

    const pkg = buildPackage({
      actions: [{ name: "get_forecast", handler: () => ({ sunny: true }) }],
      extended: {
        toolRegistrations: [
          {
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
          },
        ],
      },
    });
    loader.load(pkg);
    expect(toolRegistry.has("weather.forecast")).toBe(true);
  });

  it("cross-registers a planner task schema with PlannerPluginRegistry", () => {
    const plannerRegistry = new PlannerPluginRegistry();
    const { loader } = buildLoader({ plannerRegistry });
    const pkg = buildPackage({
      extended: {
        plannerTaskSchemas: [{ operation: "custom.op", description: "d", parameterNames: [] }],
      },
    });
    loader.load(pkg);
    expect(plannerRegistry.find("custom.op")?.pluginId).toBe("test-plugin");
  });

  it("builds a PluginContext whose memory access is scoped to the plugin", async () => {
    const { loader } = buildLoader();
    const context = loader.load(buildPackage());
    await context.memory.remember("hello world");
    const recalled = await context.memory.recall("hello");
    expect(recalled).toContain("hello world");
  });

  it("builds a PluginContext whose settings access validates against the manifest's settingsSchema", async () => {
    const { loader } = buildLoader();
    const pkg = buildPackage({
      extended: { settingsSchema: { type: "string", enum: ["a", "b"] } },
    });
    const context = loader.load(pkg);
    await expect(context.settings.set("mode", "z")).rejects.toThrow();
    await context.settings.set("mode", "a");
    expect(context.settings.get("mode")).toBe("a");
  });

  it("builds a PluginContext whose logging/diagnostics/notifications are functional", () => {
    const { loader, diagnostics } = buildLoader();
    const context = loader.load(buildPackage());
    context.diagnostics.report("something happened", { detail: 1 });
    expect(diagnostics.recent("test-plugin").some((e) => e.event === "something happened")).toBe(
      true,
    );
    expect(() => context.logging.info("hello")).not.toThrow();
  });
});
