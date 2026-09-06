import type { CapabilityRegistry } from "./capability-registry.js";
import type { CapabilityDomain, CapabilitySupportStatus, PlatformAdapter } from "./types.js";

/**
 * A few domain-family hints for graceful degradation — e.g. if
 * `screen_capture` isn't supported, `notifications` is a reasonable
 * fallback for "let the user know something happened" style requests.
 * This is intentionally small and heuristic; a caller with better domain
 * knowledge (the Planner's own `RecoveryPlanner`, for instance) can layer
 * smarter suggestions on top rather than this being the final word.
 */
const FALLBACK_HINTS: Readonly<Partial<Record<CapabilityDomain, CapabilityDomain>>> = {
  screen_capture: "notifications",
  phone_calls: "messages",
  biometrics: "authentication",
  bluetooth: "wifi",
  printing: "downloads",
};

/**
 * Resolves whether a capability domain is usable on a given adapter right
 * now — dynamically, by asking the adapter itself (`adapter.supports()`),
 * never from a hardcoded per-platform table. This is what makes the
 * brief's "the framework must dynamically determine supported/unsupported
 * capabilities" real rather than aspirational.
 */
export class CapabilityResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  resolve(domain: CapabilityDomain, adapter: PlatformAdapter): CapabilitySupportStatus {
    if (adapter.supports(domain)) {
      return { domain, supported: true };
    }
    const alternative = FALLBACK_HINTS[domain];
    const alternativeSupported =
      alternative && adapter.supports(alternative) ? alternative : undefined;
    return {
      domain,
      supported: false,
      reason: `"${domain}" is not supported by the ${adapter.platform} adapter (version ${adapter.adapterVersion})`,
      ...(alternativeSupported ? { suggestedAlternative: alternativeSupported } : {}),
    };
  }

  resolveAll(
    domains: readonly CapabilityDomain[],
    adapter: PlatformAdapter,
  ): readonly CapabilitySupportStatus[] {
    return domains.map((domain) => this.resolve(domain, adapter));
  }

  /** Every registered domain the given adapter currently supports. */
  supportedDomains(adapter: PlatformAdapter): readonly CapabilityDomain[] {
    return this.registry
      .list()
      .map((descriptor) => descriptor.domain)
      .filter((domain) => adapter.supports(domain));
  }
}

export function createCapabilityResolver(registry: CapabilityRegistry): CapabilityResolver {
  return new CapabilityResolver(registry);
}
