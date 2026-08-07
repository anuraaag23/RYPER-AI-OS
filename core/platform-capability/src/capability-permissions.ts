import type { Capability, CapabilityBroker } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { CapabilityDomain } from "./types.js";

const log = createLogger("platform-capability:permissions");

export interface PermissionDiagnosticEntry {
  readonly domain: CapabilityDomain;
  readonly actorId: string;
  readonly capability: Capability;
  readonly granted: boolean;
  readonly at: string;
}

/**
 * Bridges capability domains to `@ryper/security`'s `CapabilityBroker` —
 * the same "wrap the broker, don't re-implement it" pattern
 * `@ryper/tool-framework`'s `ToolPermissionManager` and
 * `@ryper/plugin-platform`'s `PluginPermissionManager` already use. A
 * domain's permission requirement comes from its `CapabilityDescriptor`
 * (registered in `CapabilityRegistry`), so this class needs the registry
 * to look descriptors up, not a second, parallel mapping table.
 */
export class CapabilityPermissions {
  private readonly diagnostics: PermissionDiagnosticEntry[] = [];

  constructor(
    private readonly broker: CapabilityBroker,
    private readonly registry: CapabilityRegistry,
  ) {}

  async requestPermission(
    domain: CapabilityDomain,
    actorId: string,
    justification: string,
  ): Promise<boolean> {
    const descriptor = this.registry.get(domain);
    if (!descriptor?.requiredCapability) return true;
    const grant = await this.broker.requestCapability({
      actorId,
      capability: descriptor.requiredCapability,
      justification,
    });
    const granted = grant.decision === "granted";
    this.record(domain, actorId, descriptor.requiredCapability, granted);
    return granted;
  }

  checkPermission(domain: CapabilityDomain, actorId: string): boolean {
    const descriptor = this.registry.get(domain);
    if (!descriptor?.requiredCapability) return true;
    return this.broker.hasGrant(actorId, descriptor.requiredCapability);
  }

  availablePermissions(actorId: string): readonly Capability[] {
    const capabilities = new Set<Capability>();
    for (const descriptor of this.registry.list()) {
      if (
        descriptor.requiredCapability &&
        this.broker.hasGrant(actorId, descriptor.requiredCapability)
      ) {
        capabilities.add(descriptor.requiredCapability);
      }
    }
    return [...capabilities];
  }

  private record(
    domain: CapabilityDomain,
    actorId: string,
    capability: Capability,
    granted: boolean,
  ): void {
    const entry: PermissionDiagnosticEntry = {
      domain,
      actorId,
      capability,
      granted,
      at: new Date().toISOString(),
    };
    this.diagnostics.push(entry);
    log.info("capability permission event", { ...entry });
  }

  permissionDiagnostics(actorId?: string): readonly PermissionDiagnosticEntry[] {
    return actorId
      ? this.diagnostics.filter((entry) => entry.actorId === actorId)
      : [...this.diagnostics];
  }
}

export function createCapabilityPermissions(
  broker: CapabilityBroker,
  registry: CapabilityRegistry,
): CapabilityPermissions {
  return new CapabilityPermissions(broker, registry);
}
