import { createLogger } from "@ryper/logging";
import type { CapabilityDescriptor, CapabilityDomain } from "./types.js";

const log = createLogger("platform-capability:registry");

export class CapabilityRegistrationError extends Error {}

/**
 * Holds `CapabilityDescriptor` metadata for every domain the platform
 * knows about. Registration is open to anyone — including a plugin
 * registering a brand-new abstract capability, per the brief's Plugin
 * Integration section — because a `CapabilityDomain` is just a string
 * (see `types.ts`); this registry is what turns a string into something
 * with a name, description, version, and permission mapping.
 */
export class CapabilityRegistry {
  private readonly descriptors = new Map<CapabilityDomain, CapabilityDescriptor>();

  register(descriptor: CapabilityDescriptor): void {
    if (this.descriptors.has(descriptor.domain)) {
      throw new CapabilityRegistrationError(
        `capability domain "${descriptor.domain}" is already registered`,
      );
    }
    this.descriptors.set(descriptor.domain, descriptor);
    log.info("capability registered", { domain: descriptor.domain, version: descriptor.version });
  }

  /** Registers a new version of an already-known domain, replacing its descriptor. */
  update(descriptor: CapabilityDescriptor): void {
    this.descriptors.set(descriptor.domain, descriptor);
  }

  unregister(domain: CapabilityDomain): boolean {
    return this.descriptors.delete(domain);
  }

  get(domain: CapabilityDomain): CapabilityDescriptor | undefined {
    return this.descriptors.get(domain);
  }

  has(domain: CapabilityDomain): boolean {
    return this.descriptors.has(domain);
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.descriptors.values()];
  }
}

export function createCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry();
}
