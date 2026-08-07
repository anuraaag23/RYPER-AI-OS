import type { CapabilityBroker } from "@ryper/security";
import { createLogger } from "@ryper/logging";
import type { ToolPermissionRequirement, ToolSpec } from "./types.js";

const log = createLogger("tool-framework:permissions");

export interface PermissionCheckResult {
  readonly requirement: ToolPermissionRequirement;
  readonly granted: boolean;
}

/**
 * `@ryper/security`'s `CapabilityBroker` has no notion of temporary vs.
 * permanent grants — a grant persists until explicitly `revoke()`d. This
 * module layers temporary-grant expiry on top of the broker by
 * composition (tracking an expiry timestamp here and calling
 * `broker.revoke()` once it passes) rather than modifying the broker
 * itself, which is an existing, unrelated package.
 */
export class ToolPermissionManager {
  private readonly expiries = new Map<string, number>();

  constructor(
    private readonly broker: CapabilityBroker,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(actorId: string, requirement: ToolPermissionRequirement): string {
    return `${actorId}::${requirement.capability}`;
  }

  private expireIfNeeded(actorId: string, requirement: ToolPermissionRequirement): void {
    const key = this.key(actorId, requirement);
    const expiresAt = this.expiries.get(key);
    if (expiresAt !== undefined && this.now() >= expiresAt) {
      this.broker.revoke(actorId, requirement.capability);
      this.expiries.delete(key);
    }
  }

  /** Requests every capability a tool's spec declares, recording temporary-grant expiry where declared. */
  async requestAll(
    spec: ToolSpec,
    actorId: string,
    justification: string,
  ): Promise<readonly PermissionCheckResult[]> {
    const results: PermissionCheckResult[] = [];
    for (const requirement of spec.permissions) {
      const grant = await this.broker.requestCapability({
        actorId,
        capability: requirement.capability,
        justification,
      });
      const granted = grant.decision === "granted";
      if (granted && requirement.temporary) {
        const ttl = requirement.ttlMs ?? 5 * 60_000;
        this.expiries.set(this.key(actorId, requirement), this.now() + ttl);
      }
      if (!granted) {
        log.warn("tool permission denied", { tool: spec.id, capability: requirement.capability });
      }
      results.push({ requirement, granted });
    }
    return results;
  }

  /** Checks (without re-prompting) that every permission a tool declares is currently granted. */
  checkAll(spec: ToolSpec, actorId: string): readonly PermissionCheckResult[] {
    return spec.permissions.map((requirement) => {
      this.expireIfNeeded(actorId, requirement);
      return { requirement, granted: this.broker.hasGrant(actorId, requirement.capability) };
    });
  }

  revokeAll(spec: ToolSpec, actorId: string): void {
    for (const requirement of spec.permissions) {
      this.broker.revoke(actorId, requirement.capability);
      this.expiries.delete(this.key(actorId, requirement));
    }
  }
}

export function createToolPermissionManager(
  broker: CapabilityBroker,
  now?: () => number,
): ToolPermissionManager {
  return new ToolPermissionManager(broker, now);
}
