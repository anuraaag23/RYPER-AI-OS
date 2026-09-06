import type { Capability } from "@ryper/security";
import type { PluginRuntime } from "@ryper/plugin-runtime";
import { createLogger } from "@ryper/logging";

const log = createLogger("planner:plugin-registry");

/**
 * A plugin-declared task type: the planner-facing counterpart of
 * `@ryper/plugin-runtime`'s `PluginAction`. `PluginRuntime` itself only
 * exposes plugin *manifests* publicly (`listPlugins()`), not per-action
 * schemas, so plugins register their planner-relevant schema here in
 * addition to registering the executable action with `PluginRuntime` —
 * two registrations for two different consumers of the same capability,
 * matching the brief's "plugins register capabilities, task schemas,
 * execution handlers, validation rules" against the interfaces that
 * actually exist today.
 */
export interface PluginTaskSchema {
  readonly pluginId: string;
  readonly operation: string;
  readonly description: string;
  readonly parameterNames: readonly string[];
  readonly requiredCapability?: Capability;
  readonly validate?: (parameters: Readonly<Record<string, unknown>>) => boolean;
}

export class PluginSchemaError extends Error {}

/**
 * Dynamic discovery point for plugin-defined task types. The planner
 * consults this registry (never a hardcoded plugin list) whenever it
 * needs to know what a `"plugin"`-typed task's `operation` actually means.
 */
export class PlannerPluginRegistry {
  private readonly schemas = new Map<string, PluginTaskSchema>();

  register(schema: PluginTaskSchema): void {
    if (this.schemas.has(schema.operation)) {
      throw new PluginSchemaError(
        `a plugin task schema for operation "${schema.operation}" is already registered`,
      );
    }
    this.schemas.set(schema.operation, schema);
    log.info("plugin task schema registered", {
      plugin: schema.pluginId,
      operation: schema.operation,
    });
  }

  unregister(operation: string): boolean {
    return this.schemas.delete(operation);
  }

  find(operation: string): PluginTaskSchema | undefined {
    return this.schemas.get(operation);
  }

  list(): readonly PluginTaskSchema[] {
    return [...this.schemas.values()];
  }

  /**
   * Cross-checks every registered schema against `PluginRuntime`'s live
   * plugin list and returns only schemas whose owning plugin is actually
   * loaded right now — a schema registered by a plugin that was later
   * unregistered shouldn't silently keep matching new plans.
   */
  discoverActive(pluginRuntime: PluginRuntime): readonly PluginTaskSchema[] {
    const loadedIds = new Set(pluginRuntime.listPlugins().map((manifest) => manifest.id));
    return this.list().filter((schema) => loadedIds.has(schema.pluginId));
  }
}

export function createPlannerPluginRegistry(): PlannerPluginRegistry {
  return new PlannerPluginRegistry();
}
