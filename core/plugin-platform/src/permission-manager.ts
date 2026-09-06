import type { Capability, CapabilityBroker } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type { PermissionGroup, PluginAuditEntry } from "./types.js";

const log = createLogger("plugin-platform:permissions");

/** Named bundles of capabilities a manifest can request in one line instead of listing every capability. */
export const BUILTIN_PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { name: "filesystem", capabilities: ["filesystem.read", "filesystem.write"] },
  { name: "connectivity", capabilities: ["network"] },
  { name: "media", capabilities: ["camera", "microphone"] },
  { name: "automation", capabilities: ["automation.execute"] },
];

/**
 * Wraps `@ryper/security`'s `CapabilityBroker` with the plugin-facing
 * concerns the brief calls for that the broker itself doesn't track:
 * named permission groups, and a full audit trail of every grant/deny/
 * revoke this platform has driven (as opposed to the broker's own
 * generic audit surface, if any — this trail is specifically about
 * plugin capability decisions).
 */
export class PluginPermissionManager {
  private readonly audit: PluginAuditEntry[] = [];
  private readonly groups = new Map<string, PermissionGroup>(
    BUILTIN_PERMISSION_GROUPS.map((group) => [group.name, group]),
  );

  constructor(private readonly broker: CapabilityBroker) {}

  registerGroup(group: PermissionGroup): void {
    this.groups.set(group.name, group);
  }

  resolveGroup(name: string): readonly Capability[] {
    return this.groups.get(name)?.capabilities ?? [];
  }

  async requestForPlugin(
    pluginId: string,
    capabilities: readonly Capability[],
    justification: string,
  ): Promise<boolean> {
    let allGranted = true;
    for (const capability of capabilities) {
      const grant = await this.broker.requestCapability({
        actorId: pluginId,
        capability,
        justification,
      });
      const granted = grant.decision === "granted";
      allGranted &&= granted;
      this.record(pluginId, capability, granted ? "granted" : "denied");
    }
    return allGranted;
  }

  checkForPlugin(pluginId: string, capabilities: readonly Capability[]): boolean {
    return capabilities.every((capability) => this.broker.hasGrant(pluginId, capability));
  }

  revokeForPlugin(pluginId: string, capabilities: readonly Capability[]): void {
    for (const capability of capabilities) {
      this.broker.revoke(pluginId, capability);
      this.record(pluginId, capability, "revoked");
    }
  }

  auditLog(pluginId?: string): readonly PluginAuditEntry[] {
    return pluginId ? this.audit.filter((entry) => entry.pluginId === pluginId) : [...this.audit];
  }

  private record(
    pluginId: string,
    capability: Capability,
    action: PluginAuditEntry["action"],
  ): void {
    const entry: PluginAuditEntry = { pluginId, capability, action, at: new Date().toISOString() };
    this.audit.push(entry);
    log.info("plugin permission event", { ...entry });
  }
}

export function createPluginPermissionManager(broker: CapabilityBroker): PluginPermissionManager {
  return new PluginPermissionManager(broker);
}
