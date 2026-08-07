import { createLogger } from "@ryper/logging";

const log = createLogger("security");

export type Capability =
  | "filesystem.read"
  | "filesystem.write"
  | "microphone"
  | "camera"
  | "network"
  | "notifications"
  | "automation.execute";

export interface CapabilityRequest {
  readonly actorId: string;
  readonly capability: Capability;
  readonly justification: string;
}

export type GrantDecision = "granted" | "denied";

export interface CapabilityGrant {
  readonly actorId: string;
  readonly capability: Capability;
  readonly decision: GrantDecision;
  readonly grantedAt: string;
}

export interface AuditEntry {
  readonly actor: string;
  readonly action: string;
  readonly capability: Capability;
  readonly result: GrantDecision | "used";
  readonly createdAt: string;
}

/** Caller supplies the actual UI prompt / policy check; the broker only enforces the outcome. */
export type ConsentPrompt = (request: CapabilityRequest) => Promise<boolean> | boolean;

/**
 * Every OS capability access in RYPER — filesystem, mic, camera, network,
 * automation actions — is mediated here. Modules and plugins never call the
 * platform API directly; they request a grant, and the broker (a) asks for
 * user consent via the supplied prompt, (b) records the decision, and
 * (c) enforces it on every subsequent use.
 */
export class CapabilityBroker {
  private readonly grants = new Map<string, GrantDecision>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly promptForConsent: ConsentPrompt;

  constructor(promptForConsent: ConsentPrompt) {
    this.promptForConsent = promptForConsent;
  }

  private key(actorId: string, capability: Capability): string {
    return `${actorId}::${capability}`;
  }

  async requestCapability(request: CapabilityRequest): Promise<CapabilityGrant> {
    const approved = await this.promptForConsent(request);
    const decision: GrantDecision = approved ? "granted" : "denied";
    this.grants.set(this.key(request.actorId, request.capability), decision);

    this.record(request.actorId, "request_capability", request.capability, decision);
    log.info("capability decision", {
      actor: request.actorId,
      capability: request.capability,
      decision,
    });

    return {
      actorId: request.actorId,
      capability: request.capability,
      decision,
      grantedAt: new Date().toISOString(),
    };
  }

  hasGrant(actorId: string, capability: Capability): boolean {
    return this.grants.get(this.key(actorId, capability)) === "granted";
  }

  revoke(actorId: string, capability: Capability): void {
    this.grants.delete(this.key(actorId, capability));
    this.record(actorId, "revoke_capability", capability, "denied");
  }

  /** Enforcement point: throws unless a prior grant exists. Call this before any OS-level action. */
  assertGranted(actorId: string, capability: Capability): void {
    if (!this.hasGrant(actorId, capability)) {
      this.record(actorId, "denied_use", capability, "denied");
      throw new Error(`capability "${capability}" is not granted to actor "${actorId}"`);
    }
    this.record(actorId, "used_capability", capability, "used");
  }

  private record(
    actor: string,
    action: string,
    capability: Capability,
    result: GrantDecision | "used",
  ): void {
    this.auditLog.push({
      actor,
      action,
      capability,
      result,
      createdAt: new Date().toISOString(),
    });
  }

  getAuditLog(): readonly AuditEntry[] {
    return this.auditLog;
  }
}

export function createCapabilityBroker(promptForConsent: ConsentPrompt): CapabilityBroker {
  return new CapabilityBroker(promptForConsent);
}
