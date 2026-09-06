import type { EventBus } from "@ryper/event-bus";
import type { CapabilityBroker } from "@ryper/security";
import type { MemoryManager } from "@ryper/memory-system";
import type { PlannerPluginRegistry } from "@ryper/planner";
import type { ToolPluginBridge } from "@ryper/tool-framework";
import type { VoiceCommandRouter } from "@ryper/voice-engine";
import { PluginRuntime } from "@ryper/plugin-runtime";
import { createLogger } from "@ryper/logging";
import { createDependencyResolver } from "./dependency-resolver.js";
import { createPluginEventBridge, type PluginEventBridge } from "./event-bridge.js";
import { createExtensionManifest } from "./manifest.js";
import { createManifestValidator } from "./manifest-validator.js";
import {
  createPluginConfigurationManager,
  type PluginConfigurationAccess,
} from "./plugin-configuration.js";
import {
  createPluginDiagnostics,
  createPluginMetrics,
  type PluginDiagnostics,
  type PluginMetrics,
} from "./plugin-diagnostics.js";
import type { PluginInstaller } from "./plugin-installer.js";
import { createPluginInstaller } from "./plugin-installer.js";
import { createPluginLifecycleManager, type PluginLifecycleManager } from "./lifecycle.js";
import type { PluginLoader } from "./plugin-loader.js";
import { createPluginLoader } from "./plugin-loader.js";
import { createPluginLoggerFactory, type PluginLoggerFactory } from "./plugin-logger.js";
import {
  createPluginPermissionManager,
  type PluginPermissionManager,
} from "./permission-manager.js";
import { createPluginPlatformRegistry, type PluginPlatformRegistry } from "./plugin-registry.js";
import { createPluginSandbox, type PluginSandbox } from "./sandbox.js";
import {
  defaultPluginPlatformConfig,
  type PluginPlatformConfig,
} from "./plugin-platform-config.js";
import type { PluginPackage } from "./types.js";
import type { DefinedPlugin, PluginContext } from "@ryper/plugin-sdk";

const log = createLogger("plugin-platform:manager");

export interface PluginManagerOptions {
  readonly broker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory?: MemoryManager;
  readonly toolBridge?: ToolPluginBridge;
  readonly plannerRegistry?: PlannerPluginRegistry;
  readonly voiceRouter?: VoiceCommandRouter;
  readonly config?: PluginPlatformConfig;
  readonly allowUnsignedPlugins?: boolean;
}

/**
 * The extension platform's single entry point. Owns one `PluginRuntime`
 * internally (this platform is the runtime's lifecycle owner) and
 * composes every other module — registry, loader, sandbox, permissions,
 * lifecycle, diagnostics/metrics/logging — behind install/update/
 * uninstall/enable/disable and a sandboxed `invokeAction`.
 */
export class PluginManager {
  readonly config: PluginPlatformConfig;
  readonly runtime: PluginRuntime;
  readonly registry: PluginPlatformRegistry = createPluginPlatformRegistry();
  readonly diagnostics: PluginDiagnostics;
  readonly metrics: PluginMetrics = createPluginMetrics();
  readonly loggerFactory: PluginLoggerFactory = createPluginLoggerFactory();
  readonly events: PluginEventBridge;
  readonly sandbox: PluginSandbox;
  readonly permissions: PluginPermissionManager;
  readonly configuration: PluginConfigurationAccess | undefined;
  readonly lifecycle: PluginLifecycleManager;

  private readonly loader: PluginLoader;
  private readonly installer: PluginInstaller;
  private readonly contexts = new Map<string, PluginContext>();

  constructor(options: PluginManagerOptions) {
    this.config = options.config ?? defaultPluginPlatformConfig;
    this.runtime = new PluginRuntime(
      options.broker,
      options.eventBus,
      options.allowUnsignedPlugins ?? false,
    );
    this.diagnostics = createPluginDiagnostics(this.config.diagnosticsHistorySize);
    this.events = createPluginEventBridge(options.eventBus);
    this.sandbox = createPluginSandbox(this.runtime, this.config.sandboxLimits);
    this.permissions = createPluginPermissionManager(options.broker);
    this.configuration = options.memory
      ? createPluginConfigurationManager(options.memory)
      : undefined;
    this.lifecycle = createPluginLifecycleManager(this.registry, this.events, this.metrics);

    this.loader = createPluginLoader({
      runtime: this.runtime,
      registry: this.registry,
      configuration: this.configuration ?? createNoopConfiguration(),
      diagnostics: this.diagnostics,
      loggerFactory: this.loggerFactory,
      events: this.events,
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.toolBridge ? { toolBridge: options.toolBridge } : {}),
      ...(options.plannerRegistry ? { plannerRegistry: options.plannerRegistry } : {}),
      ...(options.voiceRouter ? { voiceRouter: options.voiceRouter } : {}),
    });

    this.installer = createPluginInstaller({
      runtime: this.runtime,
      registry: this.registry,
      loader: this.loader,
      lifecycle: this.lifecycle,
      permissions: this.permissions,
      events: this.events,
    });
  }

  /** Builds a `PluginPackage` (manifest + extension manifest) from a `definePlugin()` result — the only supported input. */
  buildPackage(defined: DefinedPlugin): PluginPackage {
    return { defined, extensionManifest: createExtensionManifest(defined) };
  }

  async install(defined: DefinedPlugin): Promise<PluginContext> {
    const pkg = this.buildPackage(defined);
    const context = await this.installer.install(pkg);
    this.contexts.set(pkg.extensionManifest.id, context);
    log.info("plugin installed", { pluginId: pkg.extensionManifest.id });
    return context;
  }

  async update(defined: DefinedPlugin): Promise<PluginContext> {
    const pkg = this.buildPackage(defined);
    const context = await this.installer.update(pkg);
    this.contexts.set(pkg.extensionManifest.id, context);
    return context;
  }

  async uninstall(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    await this.installer.uninstall(pluginId, hooks);
    this.contexts.delete(pluginId);
  }

  async disable(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    const context = this.requireContext(pluginId);
    await this.lifecycle.disable(pluginId, hooks, context);
  }

  async enable(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    const context = this.requireContext(pluginId);
    await this.lifecycle.enable(pluginId, hooks, context);
  }

  async suspend(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    const context = this.requireContext(pluginId);
    await this.lifecycle.suspend(pluginId, hooks, context);
  }

  async resume(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    const context = this.requireContext(pluginId);
    await this.lifecycle.resume(pluginId, hooks, context);
  }

  async reload(pluginId: string, hooks: DefinedPlugin["lifecycle"] = {}): Promise<void> {
    const context = this.requireContext(pluginId);
    await this.lifecycle.reload(pluginId, hooks, context);
  }

  /** The sandboxed invocation path — resource limits enforced, unlike calling `PluginRuntime.invoke` directly. */
  async invokeAction(pluginId: string, actionName: string, input: unknown): Promise<unknown> {
    try {
      const result = await this.sandbox.invoke(pluginId, actionName, input);
      this.metrics.recordCall(pluginId, false);
      this.diagnostics.record(pluginId, "action.invoked", actionName);
      return result;
    } catch (err) {
      this.metrics.recordCall(pluginId, true);
      this.diagnostics.record(pluginId, "action.failed", `${actionName}: ${String(err)}`);
      throw err;
    }
  }

  getContext(pluginId: string): PluginContext | undefined {
    return this.contexts.get(pluginId);
  }

  private requireContext(pluginId: string): PluginContext {
    const context = this.contexts.get(pluginId);
    if (!context) throw new Error(`plugin "${pluginId}" has no active context (is it installed?)`);
    return context;
  }
}

function createNoopConfiguration(): PluginConfigurationAccess {
  // A minimal in-memory stand-in used only when the host has no MemoryManager configured,
  // so `PluginLoader` always has a `PluginConfigurationAccess` to call without special-casing.
  const store = new Map<string, string>();
  return {
    async set(pluginId, key, value) {
      store.set(`${pluginId}:${key}`, value);
    },
    get(pluginId, key) {
      return store.get(`${pluginId}:${key}`);
    },
    allKeys(pluginId) {
      return [...store.keys()]
        .filter((k) => k.startsWith(`${pluginId}:`))
        .map((k) => k.slice(pluginId.length + 1));
    },
  };
}

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  return new PluginManager(options);
}

export { createManifestValidator, createDependencyResolver };
