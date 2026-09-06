import type { CapabilityPermissions } from "./capability-permissions.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { CapabilityResolver } from "./capability-resolver.js";
import type { DiscoveryReport, PlatformAdapter } from "./types.js";

/**
 * Answers, in one call, everything the brief's Capability Discovery
 * section asks for: supported/unsupported capabilities, available
 * permissions, platform version, device type, hardware availability, and
 * runtime limitations — all read live from the active adapter and
 * registry, never from a cached snapshot that could drift.
 */
export class CapabilityDiscovery {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly resolver: CapabilityResolver,
    private readonly permissions: CapabilityPermissions,
  ) {}

  discover(adapter: PlatformAdapter, actorId: string): DiscoveryReport {
    const allDomains = this.registry.list().map((descriptor) => descriptor.domain);
    const statuses = this.resolver.resolveAll(allDomains, adapter);
    const supportedDomains = statuses.filter((s) => s.supported).map((s) => s.domain);
    const unsupportedDomains = statuses.filter((s) => !s.supported);

    return {
      platform: adapter.platform,
      deviceInfo: adapter.getDeviceInfo(),
      supportedDomains,
      unsupportedDomains,
      runtimeLimitations: adapter.getRuntimeLimitations(),
      availablePermissions: this.permissions.availablePermissions(actorId),
    };
  }
}

export function createCapabilityDiscovery(
  registry: CapabilityRegistry,
  resolver: CapabilityResolver,
  permissions: CapabilityPermissions,
): CapabilityDiscovery {
  return new CapabilityDiscovery(registry, resolver, permissions);
}
