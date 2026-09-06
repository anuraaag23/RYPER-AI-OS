import type { Capability } from "@ryper/security";
import type { PluginAction, PluginActionContext, PluginManifest } from "@ryper/plugin-runtime";
import type { Unsubscribe } from "@ryper/event-bus";
import type { LogFields } from "@ryper/logging";
import type { PluginTaskSchema } from "@ryper/planner";
import type { ToolSpec } from "@ryper/tool-framework";
import type { VoiceCommandHandler } from "@ryper/voice-engine";
export type { Capability, PluginAction, PluginActionContext, PluginManifest };

export interface DefinePluginOptions {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly requestedCapabilities?: readonly Capability[];
  readonly signed?: boolean;
  readonly actions: readonly PluginAction[];
  /** Optional richer metadata for the Plugin Platform (Phase 9) — never merged into `.manifest`. */
  readonly extended?: PluginExtendedMetadata;
  /** Optional lifecycle hooks the Plugin Platform's `PluginLifecycleManager` calls at the right time. */
  readonly lifecycle?: PluginLifecycleHooks;
}

export interface DefinedPlugin {
  readonly manifest: PluginManifest;
  readonly actions: readonly PluginAction[];
  readonly extended: PluginExtendedMetadata;
  readonly lifecycle: PluginLifecycleHooks;
}

/**
 * The single entry point third-party plugin packages call. It exists so
 * plugin authors write against a small, stable surface (`definePlugin`)
 * rather than importing Core internals directly — the Plugin Runtime is an
 * implementation detail the SDK insulates them from.
 *
 * `extended`/`lifecycle` are additive (Phase 9): existing callers that only
 * pass `id`/`name`/`version`/`actions` get back exactly the same
 * `manifest`/`actions` shape as before — nothing here changes what those
 * fields contain.
 */
export function definePlugin(options: DefinePluginOptions): DefinedPlugin {
  if (!/^[a-z0-9-]+$/.test(options.id)) {
    throw new Error(`plugin id "${options.id}" must be lowercase kebab-case`);
  }
  if (options.actions.length === 0) {
    throw new Error(`plugin "${options.id}" must declare at least one action`);
  }

  const manifest: PluginManifest = {
    id: options.id,
    name: options.name,
    version: options.version,
    requestedCapabilities: options.requestedCapabilities ?? [],
    signed: options.signed ?? false,
  };

  return {
    manifest,
    actions: options.actions,
    extended: options.extended ?? {},
    lifecycle: options.lifecycle ?? {},
  };
}

export function defineAction(action: PluginAction): PluginAction {
  return action;
}

// ---- Phase 9: richer, additive plugin metadata + host-provided context ----

export interface PluginDependency {
  readonly id: string;
  /** An exact version this plugin depends on; range grammar is out of scope (see plugin-platform's semver module). */
  readonly version: string;
}

/**
 * Metadata the brief's versioned manifest calls for, beyond what
 * `@ryper/plugin-runtime`'s `PluginManifest` needs to invoke an action.
 * Kept entirely separate from `.manifest` so the Plugin Runtime's
 * contract — and every existing caller of `definePlugin` — is unaffected.
 */
export interface PluginExtendedMetadata {
  readonly author?: string;
  readonly description?: string;
  readonly dependencies?: readonly PluginDependency[];
  readonly minSdkVersion?: string;
  readonly maxSdkVersion?: string;
  readonly supportedPlatforms?: readonly string[];
  /** Validated with `@ryper/tool-framework`'s `ToolValidator` by the Plugin Platform — not re-implemented here. */
  readonly settingsSchema?: ToolSpec["inputSchema"];
  readonly pluginType?: string;
  readonly toolRegistrations?: readonly { readonly actionName: string; readonly spec: ToolSpec }[];
  readonly plannerTaskSchemas?: readonly Omit<PluginTaskSchema, "pluginId">[];
}

export type PluginEventCategory =
  "ai" | "voice" | "memory" | "planner" | "tool" | "system" | "automation" | "lifecycle";

export interface PluginToolAccess {
  /** Registers one of `extended.toolRegistrations` (or an ad-hoc tool) with the running `ToolPluginBridge`. */
  registerTool(actionName: string, spec: ToolSpec): void;
}

export interface PluginMemoryAccess {
  remember(content: string, tags?: readonly string[]): Promise<void>;
  /** Recall is scoped to memories this plugin itself created — never the whole user memory store. */
  recall(query: string, limit?: number): Promise<readonly string[]>;
  forget(tag: string): Promise<number>;
}

export interface PluginPlannerAccess {
  registerTaskSchema(schema: Omit<PluginTaskSchema, "pluginId">): void;
}

export interface PluginVoiceAccess {
  registerCommand(handler: VoiceCommandHandler): void;
}

export interface PluginSettingsAccess {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
}

export interface PluginEventAccess {
  on(
    category: PluginEventCategory,
    type: string,
    handler: (payload: unknown) => void | Promise<void>,
  ): Unsubscribe;
  emit(type: string, payload: unknown): Promise<void>;
}

export interface PluginLoggingAccess {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface PluginDiagnosticsAccess {
  report(message: string, data?: Record<string, unknown>): void;
}

export interface PluginNotificationsAccess {
  /** Emits a `plugin.notification` event; no real OS notification API exists in this environment (see README). */
  notify(title: string, body: string): Promise<void>;
}

/**
 * The stable, host-provided context a plugin's lifecycle hooks receive.
 * Every accessor here is an *interface* — the SDK never implements any of
 * them, so a plugin author can never reach past this surface into
 * `PluginRuntime`, `MemoryManager`, `EventBus`, or any other Core
 * internal. `@ryper/plugin-platform`'s `PluginLifecycleManager`
 * constructs the real implementation and injects it.
 */
/**
 * Phase 10 (Platform Capability Layer) addition — declare required
 * capability domains, query what's available on the active platform
 * adapter, register a brand-new abstract capability, and request its
 * permission. Optional on `PluginContext` because a host running without
 * `@ryper/platform-capability` configured has nothing to back it with;
 * every method here is a pure interface, same as every other
 * `PluginContext` accessor (see ADR 0002 in `core/plugin-platform`).
 */
export interface PluginCapabilityAccess {
  declareRequired(domains: readonly string[]): void;
  query(domain: string): { readonly supported: boolean; readonly reason?: string };
  registerCapability(descriptor: {
    readonly domain: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
  }): void;
  requestPermission(domain: string): Promise<boolean>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly tools: PluginToolAccess;
  readonly memory: PluginMemoryAccess;
  readonly plannerIntegration: PluginPlannerAccess;
  readonly voice: PluginVoiceAccess;
  readonly settings: PluginSettingsAccess;
  readonly events: PluginEventAccess;
  readonly logging: PluginLoggingAccess;
  readonly diagnostics: PluginDiagnosticsAccess;
  readonly notifications: PluginNotificationsAccess;
  readonly capabilities?: PluginCapabilityAccess;
}

/**
 * Optional lifecycle hooks matching the brief's lifecycle states
 * (install/load/initialize/enable/disable/suspend/resume/uninstall).
 * `@ryper/plugin-platform`'s `PluginLifecycleManager` calls whichever of
 * these a plugin defined, in order, at the right transition — a plugin
 * that defines none of them is still perfectly valid.
 */
export interface PluginLifecycleHooks {
  initialize?(context: PluginContext): void | Promise<void>;
  onEnable?(context: PluginContext): void | Promise<void>;
  onDisable?(context: PluginContext): void | Promise<void>;
  onSuspend?(context: PluginContext): void | Promise<void>;
  onResume?(context: PluginContext): void | Promise<void>;
  onUninstall?(context: PluginContext): void | Promise<void>;
}
