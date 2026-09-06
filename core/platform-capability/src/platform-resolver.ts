import { createNullAdapter } from "./adapter-contract.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { PlatformAdapter, PlatformId } from "./types.js";

export type PlatformDetector = () => PlatformId;

/**
 * There is no real OS-detection API available in this build environment
 * (no native toolchain — the same honest constraint every prior phase's
 * hardware-adjacent module has documented), so the default detector is
 * injectable and defaults to `"web"` — the one platform this repo's own
 * test/CI environment (Node) can honestly claim to run under.
 */
export const defaultPlatformDetector: PlatformDetector = () => "browser";

/**
 * Determines the active platform and resolves it to a registered
 * `PlatformAdapter`, or the honest `createNullAdapter()` fallback if none
 * is registered yet. This is the seam `CapabilityManager` and, through
 * it, the Planner/Tool Framework/Plugins query — never a raw OS check.
 */
export class PlatformResolver {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly detector: PlatformDetector = defaultPlatformDetector,
  ) {}

  activePlatform(): PlatformId {
    return this.detector();
  }

  resolveAdapter(platform: PlatformId = this.activePlatform()): PlatformAdapter {
    return this.registry.get(platform) ?? createNullAdapter(platform);
  }
}

export function createPlatformResolver(
  registry: AdapterRegistry,
  detector?: PlatformDetector,
): PlatformResolver {
  return new PlatformResolver(registry, detector);
}
