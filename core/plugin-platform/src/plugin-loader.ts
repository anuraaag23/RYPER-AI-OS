import type { MemoryManager } from "@ryper/memory-system";
import type { PluginRuntime } from "@ryper/plugin-runtime";
import type { PluginContext } from "@ryper/plugin-sdk";
import type { PlannerPluginRegistry } from "@ryper/planner";
import type { ToolPluginBridge, ToolSpec } from "@ryper/tool-framework";
import type { VoiceCommandRouter } from "@ryper/voice-engine";
import { createLogger } from "@ryper/logging";
import { toPluginManifest } from "./manifest.js";
import type { PluginEventBridge } from "./event-bridge.js";
import type { PluginConfigurationAccess } from "./plugin-configuration.js";
import type { PluginDiagnostics } from "./plugin-diagnostics.js";
import type { PluginLoggerFactory } from "./plugin-logger.js";
import type { PluginPlatformRegistry } from "./plugin-registry.js";
import type { ExtensionManifest, PluginPackage } from "./types.js";

const log = createLogger("plugin-platform:loader");

export interface PluginLoaderDeps {
  readonly runtime: PluginRuntime;
  readonly registry: PluginPlatformRegistry;
  readonly configuration: PluginConfigurationAccess;
  readonly diagnostics: PluginDiagnostics;
  readonly loggerFactory: PluginLoggerFactory;
  readonly events: PluginEventBridge;
  readonly memory?: MemoryManager;
  readonly toolBridge?: ToolPluginBridge;
  readonly plannerRegistry?: PlannerPluginRegistry;
  readonly voiceRouter?: VoiceCommandRouter;
}

function memoryTag(pluginId: string): string {
  return `plugin_memory:${pluginId}`;
}

/**
 * Loads a `PluginPackage` across every system a plugin can touch:
 * `PluginRuntime` (real action invocation), `ToolPluginBridge` (Phase 8),
 * `PlannerPluginRegistry` (Phase 7), and — if provided —
 * `VoiceCommandRouter`. Nothing here re-implements what those packages
 * already do; this class only calls their real public APIs and builds
 * the `PluginContext` a plugin's lifecycle hooks receive.
 */
export class PluginLoader {
  constructor(private readonly deps: PluginLoaderDeps) {}

  load(pkg: PluginPackage): PluginContext {
    const { defined, extensionManifest } = pkg;
    const pluginId = extensionManifest.id;

    this.deps.registry.register(extensionManifest);
    this.deps.runtime.register(toPluginManifest(extensionManifest), defined.actions);

    for (const registration of extensionManifest.toolRegistrations) {
      this.deps.toolBridge?.registerPluginTool({
        pluginId,
        actionName: registration.actionName,
        spec: registration.spec as ToolSpec,
      });
    }
    for (const schema of defined.extended.plannerTaskSchemas ?? []) {
      this.deps.plannerRegistry?.register({ ...schema, pluginId });
    }

    this.deps.diagnostics.record(pluginId, "loaded");
    log.info("plugin loaded", { pluginId });
    return this.buildContext(pluginId, extensionManifest);
  }

  buildContext(pluginId: string, manifest: ExtensionManifest): PluginContext {
    const logger = this.deps.loggerFactory.forPlugin(pluginId);
    const memory = this.deps.memory;
    const toolBridge = this.deps.toolBridge;
    const plannerRegistry = this.deps.plannerRegistry;
    const voiceRouter = this.deps.voiceRouter;
    const events = this.deps.events;
    const configuration = this.deps.configuration;
    const diagnostics = this.deps.diagnostics;

    return {
      pluginId,
      tools: {
        registerTool: (actionName, spec) => {
          if (!toolBridge) {
            logger.warn("registerTool called but no ToolPluginBridge is configured", {
              actionName,
            });
            return;
          }
          toolBridge.registerPluginTool({ pluginId, actionName, spec });
        },
      },
      memory: {
        remember: async (content, tags = []) => {
          if (!memory) {
            logger.warn("memory.remember called but no MemoryManager is configured");
            return;
          }
          await memory.createMemoryAuto(
            content,
            { type: "task", tags: [memoryTag(pluginId), ...tags] },
            pluginId,
          );
        },
        recall: async (query, limit = 5) => {
          if (!memory) return [];
          const results = await memory.searchMemories(
            query,
            { filter: { tag: memoryTag(pluginId) }, limit },
            pluginId,
          );
          return results.map((r) => r.record.content);
        },
        forget: async (tag) => {
          if (!memory) return 0;
          const matches = memory
            .filterMemories({ tag: memoryTag(pluginId) })
            .filter((r) => r.tags.includes(tag));
          await Promise.all(matches.map((match) => memory.deleteMemory(match.id, pluginId)));
          return matches.length;
        },
      },
      plannerIntegration: {
        registerTaskSchema: (schema) => {
          if (!plannerRegistry) {
            logger.warn("registerTaskSchema called but no PlannerPluginRegistry is configured");
            return;
          }
          plannerRegistry.register({ ...schema, pluginId });
        },
      },
      voice: {
        registerCommand: (handler) => {
          if (!voiceRouter) {
            logger.warn("registerCommand called but no VoiceCommandRouter is configured");
            return;
          }
          voiceRouter.register(handler);
        },
      },
      settings: {
        get: (key) => configuration.get(pluginId, key),
        set: (key, value) => configuration.set(pluginId, key, value, manifest.settingsSchema),
      },
      events: {
        on: (category, type, handler) => events.subscribe(pluginId, category, type, handler),
        emit: (type, payload) => events.emit(type, payload, `plugin:${pluginId}`),
      },
      logging: logger,
      diagnostics: {
        report: (message, data) =>
          diagnostics.record(pluginId, message, data ? JSON.stringify(data) : undefined),
      },
      notifications: {
        notify: (title, body) =>
          events.emit("plugin.notification", { pluginId, title, body }, `plugin:${pluginId}`),
      },
    };
  }
}

export function createPluginLoader(deps: PluginLoaderDeps): PluginLoader {
  return new PluginLoader(deps);
}
