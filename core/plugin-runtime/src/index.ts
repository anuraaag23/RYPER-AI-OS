import type { EventBus } from "@ryper/event-bus";
import type { CapabilityBroker, Capability } from "@ryper/security";
import { createLogger } from "@ryper/logging";

const log = createLogger("plugin-runtime");

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly requestedCapabilities: readonly Capability[];
  readonly signed: boolean;
}

export interface PluginActionContext {
  readonly emit: EventBus["emit"];
}

export interface PluginAction {
  readonly name: string;
  readonly requiredCapability?: Capability;
  handler(input: unknown, context: PluginActionContext): Promise<unknown> | unknown;
}

export interface RegisteredPlugin {
  readonly manifest: PluginManifest;
  readonly actions: ReadonlyMap<string, PluginAction>;
}

export class PluginLoadError extends Error {}

/**
 * The Plugin Runtime is the only path by which a plugin's declared actions
 * become callable. It refuses unsigned plugins outside of an explicit
 * developer mode, and every action invocation re-checks the capability
 * broker rather than trusting the plugin's own claim of having permission.
 */
export class PluginRuntime {
  private readonly plugins = new Map<string, RegisteredPlugin>();

  constructor(
    private readonly broker: CapabilityBroker,
    private readonly eventBus: EventBus,
    private readonly allowUnsigned = false,
  ) {}

  register(manifest: PluginManifest, actions: readonly PluginAction[]): RegisteredPlugin {
    if (!manifest.signed && !this.allowUnsigned) {
      throw new PluginLoadError(
        `plugin "${manifest.id}" is unsigned and developer mode is not enabled`,
      );
    }
    if (this.plugins.has(manifest.id)) {
      throw new PluginLoadError(`plugin "${manifest.id}" is already registered`);
    }

    const actionMap = new Map(actions.map((action) => [action.name, action]));
    const registered: RegisteredPlugin = { manifest, actions: actionMap };
    this.plugins.set(manifest.id, registered);
    log.info("plugin registered", {
      id: manifest.id,
      version: manifest.version,
      signed: manifest.signed,
    });
    return registered;
  }

  unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  async invoke(pluginId: string, actionName: string, input: unknown): Promise<unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`plugin "${pluginId}" is not registered`);

    const action = plugin.actions.get(actionName);
    if (!action) throw new Error(`plugin "${pluginId}" has no action "${actionName}"`);

    if (action.requiredCapability) {
      this.broker.assertGranted(pluginId, action.requiredCapability);
    }

    const context: PluginActionContext = {
      emit: (type, payload, source) => this.eventBus.emit(type, payload, source ?? pluginId),
    };
    return action.handler(input, context);
  }

  listPlugins(): readonly PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }
}

export function createPluginRuntime(
  broker: CapabilityBroker,
  eventBus: EventBus,
  allowUnsigned = false,
): PluginRuntime {
  return new PluginRuntime(broker, eventBus, allowUnsigned);
}
