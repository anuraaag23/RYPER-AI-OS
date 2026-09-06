import { createLogger } from "@ryper/logging";

const log = createLogger("security");

export type Capability =
  | "filesystem.read"
  | "filesystem.write"
  | "microphone"
  | "camera"
  | "network"
  | "notifications"
  | "automation.read"
  | "automation.execute"
  | "system.power";

export interface CapabilityRequest {
  readonly actorId: string;
  readonly capability: Capability;
  readonly justification: string;
}

/**
 * Prep for the future Android agent's locked-device smart-home
 * scenario (docs/adr/0020) — **not itself lock-state enforcement**,
 * which doesn't exist anywhere in this repository yet. This purely
 * classifies today's existing capabilities as `"safe"` (fine to allow
 * while a device is locked — nothing here currently checks lock state,
 * there is no lock state to check) or `"protected"` (should require an
 * unlocked/authenticated device once lock-state awareness exists).
 * `HeuristicToolCallingProvider`/any `AIProvider` must never decide
 * this classification itself — only this table, consulted by
 * `CapabilityBroker`/`CapabilityManager`, is authoritative, matching
 * this package's existing "the LLM is an untrusted input interpreter,
 * the capability layer is the authority" boundary.
 */
export type CapabilitySensitivity = "safe" | "protected";

export const CAPABILITY_SENSITIVITY: Readonly<Record<Capability, CapabilitySensitivity>> = {
  "filesystem.read": "protected",
  "filesystem.write": "protected",
  microphone: "protected",
  camera: "protected",
  network: "safe",
  notifications: "safe",
  "automation.read": "protected",
  "automation.execute": "protected",
  // Shutdown/restart/sleep — the most system-impacting capability this
  // repo has. `"protected"` is the *capability-grant* layer; the real,
  // per-call "should this specific action really happen right now"
  // decision is a separate, independent gate
  // (`DestructiveActionGate`, see `docs/adr/0030`) that a grant here
  // does not bypass.
  "system.power": "protected",
};

export function getCapabilitySensitivity(capability: Capability): CapabilitySensitivity {
  return CAPABILITY_SENSITIVITY[capability];
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

  /** Explicit grant, mirroring onboarding / settings authorizations without interactive prompting. */
  grant(actorId: string, capability: Capability): void {
    this.grants.set(this.key(actorId, capability), "granted");
    this.record(actorId, "grant_capability", capability, "granted");
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
