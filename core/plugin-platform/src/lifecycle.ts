import type { PluginLifecycleHooks, PluginContext } from "@ryper/plugin-sdk";
import type { PluginEventBridge } from "./event-bridge.js";
import type { PluginMetrics } from "./plugin-diagnostics.js";
import type { PluginPlatformRegistry } from "./plugin-registry.js";
import type { PluginLifecycleState } from "./types.js";

export class LifecycleTransitionError extends Error {}

const ALLOWED_TRANSITIONS: Readonly<Record<PluginLifecycleState, readonly PluginLifecycleState[]>> =
  {
    registered: ["installed", "failed"],
    installed: ["loaded", "failed"],
    loaded: ["initialized", "failed"],
    initialized: ["enabled", "failed"],
    enabled: ["disabled", "suspended", "uninstalled", "failed"],
    disabled: ["enabled", "uninstalled", "failed"],
    suspended: ["enabled", "uninstalled", "failed"],
    uninstalled: [],
    failed: ["installed"],
  };

/**
 * Drives every state transition the brief's lifecycle section lists
 * (install/load/initialize/enable/disable/suspend/resume/reload/update/
 * uninstall — "resume" and "reload" are expressed as transitions through
 * this same table, not separate states) and calls whichever
 * `PluginLifecycleHooks` the plugin itself defined at the right moment.
 * A plugin that defines none of them is still perfectly valid — hooks
 * are optional everywhere here.
 */
export class PluginLifecycleManager {
  constructor(
    private readonly registry: PluginPlatformRegistry,
    private readonly events: PluginEventBridge,
    private readonly metrics?: PluginMetrics,
  ) {}

  private async transition(
    pluginId: string,
    target: PluginLifecycleState,
    hook?: () => void | Promise<void>,
  ): Promise<void> {
    const record = this.registry.get(pluginId);
    if (!record) {
      throw new LifecycleTransitionError(`plugin "${pluginId}" is not registered`);
    }
    const allowed = ALLOWED_TRANSITIONS[record.state];
    if (!allowed.includes(target)) {
      throw new LifecycleTransitionError(
        `plugin "${pluginId}" cannot transition from "${record.state}" to "${target}"`,
      );
    }
    if (hook) await hook();
    this.registry.setState(pluginId, target);
    this.metrics?.recordState(pluginId, target);
    await this.events.emit(`plugin.lifecycle.${target}`, { pluginId }, "plugin-platform");
  }

  install(pluginId: string): Promise<void> {
    return this.transition(pluginId, "installed");
  }

  load(pluginId: string): Promise<void> {
    return this.transition(pluginId, "loaded");
  }

  initialize(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "initialized", () => hooks.initialize?.(context));
  }

  enable(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "enabled", () => hooks.onEnable?.(context));
  }

  disable(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "disabled", () => hooks.onDisable?.(context));
  }

  suspend(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "suspended", () => hooks.onSuspend?.(context));
  }

  resume(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "enabled", () => hooks.onResume?.(context));
  }

  /** A "warm" reload: disable then re-enable, re-running both hooks in order. */
  async reload(
    pluginId: string,
    hooks: PluginLifecycleHooks,
    context: PluginContext,
  ): Promise<void> {
    await this.disable(pluginId, hooks, context);
    await this.enable(pluginId, hooks, context);
  }

  uninstall(pluginId: string, hooks: PluginLifecycleHooks, context: PluginContext): Promise<void> {
    return this.transition(pluginId, "uninstalled", () => hooks.onUninstall?.(context));
  }

  async fail(pluginId: string, reason: string): Promise<void> {
    const record = this.registry.get(pluginId);
    if (!record) throw new LifecycleTransitionError(`plugin "${pluginId}" is not registered`);
    this.registry.setState(pluginId, "failed");
    this.metrics?.recordState(pluginId, "failed");
    await this.events.emit("plugin.lifecycle.failed", { pluginId, reason }, "plugin-platform");
  }
}

export function createPluginLifecycleManager(
  registry: PluginPlatformRegistry,
  events: PluginEventBridge,
  metrics?: PluginMetrics,
): PluginLifecycleManager {
  return new PluginLifecycleManager(registry, events, metrics);
}
