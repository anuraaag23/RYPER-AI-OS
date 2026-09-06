import type { PluginCapabilityAccess } from "@ryper/plugin-sdk";
import type { CapabilityManager } from "./capability-manager.js";

/**
 * Implements `@ryper/plugin-sdk`'s `PluginCapabilityAccess` interface —
 * the brief's Plugin Integration requirements ("declare required
 * capabilities, query available capabilities, register new abstract
 * capabilities, request capability permissions") — against a real
 * `CapabilityManager`. `PluginLoader` (in `@ryper/plugin-platform`) is
 * the natural place to attach this to a plugin's `PluginContext`, the
 * same way it already attaches `tools`/`memory`/etc.
 */
export function createPluginCapabilityContext(
  manager: CapabilityManager,
  pluginId: string,
): PluginCapabilityAccess {
  const declared = new Set<string>();

  return {
    declareRequired(domains: readonly string[]): void {
      for (const domain of domains) declared.add(domain);
    },
    query(domain: string) {
      const status = manager.resolve(domain);
      return status.reason
        ? { supported: status.supported, reason: status.reason }
        : { supported: status.supported };
    },
    registerCapability(descriptor) {
      manager.registerCapability({ ...descriptor });
    },
    requestPermission(domain: string): Promise<boolean> {
      return manager.permissions.requestPermission(
        domain,
        pluginId,
        `plugin "${pluginId}" requested "${domain}"`,
      );
    },
  };
}
