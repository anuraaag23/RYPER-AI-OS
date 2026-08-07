import type { PluginRuntime } from "@ryper/plugin-runtime";
import { createLogger } from "@ryper/logging";
import type { ToolRegistry } from "./tool-registry.js";
import type { ToolDefinition, ToolSpec } from "./types.js";

const log = createLogger("tool-framework:plugin-bridge");

export interface PluginToolDeclaration {
  readonly pluginId: string;
  readonly actionName: string;
  readonly spec: ToolSpec;
}

/**
 * The plugin-facing half of tool registration. A plugin already registers
 * its callable action with `@ryper/plugin-runtime`'s `PluginRuntime`
 * (capability checks, signing, invocation) — this bridge wraps that same
 * action as a `ToolDefinition` so it's discoverable/invocable through the
 * universal framework too, without duplicating execution logic: every
 * call here delegates straight to `PluginRuntime.invoke()`.
 */
export class ToolPluginBridge {
  private readonly toolsByPlugin = new Map<string, Set<string>>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly pluginRuntime: PluginRuntime,
  ) {}

  private toDefinition(declaration: PluginToolDeclaration): ToolDefinition {
    return {
      spec: declaration.spec,
      execute: (parameters: Readonly<Record<string, unknown>>) =>
        this.pluginRuntime.invoke(declaration.pluginId, declaration.actionName, parameters),
    };
  }

  registerPluginTool(declaration: PluginToolDeclaration): void {
    this.registry.register(this.toDefinition(declaration));
    const set = this.toolsByPlugin.get(declaration.pluginId) ?? new Set<string>();
    set.add(declaration.spec.id);
    this.toolsByPlugin.set(declaration.pluginId, set);
    log.info("plugin tool registered", {
      plugin: declaration.pluginId,
      toolId: declaration.spec.id,
    });
  }

  /** Updates a plugin tool in place — used for version bumps or a changed schema. */
  updatePluginTool(declaration: PluginToolDeclaration): void {
    this.registry.update(this.toDefinition(declaration));
    const set = this.toolsByPlugin.get(declaration.pluginId) ?? new Set<string>();
    set.add(declaration.spec.id);
    this.toolsByPlugin.set(declaration.pluginId, set);
  }

  unregisterPluginTool(toolId: string): boolean {
    for (const set of this.toolsByPlugin.values()) set.delete(toolId);
    return this.registry.unregister(toolId);
  }

  /** Cascades: every tool a plugin registered is unregistered in one call. */
  unregisterAllForPlugin(pluginId: string): number {
    const toolIds = this.toolsByPlugin.get(pluginId);
    if (!toolIds) return 0;
    let removed = 0;
    for (const toolId of toolIds) {
      if (this.registry.unregister(toolId)) removed += 1;
    }
    this.toolsByPlugin.delete(pluginId);
    return removed;
  }

  toolIdsForPlugin(pluginId: string): readonly string[] {
    return [...(this.toolsByPlugin.get(pluginId) ?? [])];
  }

  /** Every plugin-registered tool whose owning plugin is still loaded in `PluginRuntime`. */
  discoverActive(): readonly ToolSpec[] {
    const loadedIds = new Set(this.pluginRuntime.listPlugins().map((manifest) => manifest.id));
    const active: ToolSpec[] = [];
    for (const [pluginId, toolIds] of this.toolsByPlugin) {
      if (!loadedIds.has(pluginId)) continue;
      for (const toolId of toolIds) {
        const tool = this.registry.get(toolId);
        if (tool) active.push(tool.spec);
      }
    }
    return active;
  }
}

export function createToolPluginBridge(
  registry: ToolRegistry,
  pluginRuntime: PluginRuntime,
): ToolPluginBridge {
  return new ToolPluginBridge(registry, pluginRuntime);
}
