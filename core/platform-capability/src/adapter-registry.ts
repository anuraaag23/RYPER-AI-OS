import { createLogger } from "@ryper/logging";
import type { PlatformAdapter, PlatformId } from "./types.js";

const log = createLogger("platform-capability:adapter-registry");

export const SUPPORTED_PLATFORMS: readonly PlatformId[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "browser",
];

export class AdapterRegistrationError extends Error {}

/**
 * Thread-safe in the JS sense that matters here: every operation is a
 * single synchronous `Map` read/write, so there's no window for a torn
 * read even under concurrent async callers (no `await` inside a
 * mutating method).
 */
export class AdapterRegistry {
  private readonly adapters = new Map<PlatformId, PlatformAdapter>();

  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new AdapterRegistrationError(
        `an adapter for platform "${adapter.platform}" is already registered`,
      );
    }
    this.adapters.set(adapter.platform, adapter);
    log.info("adapter registered", { platform: adapter.platform, version: adapter.adapterVersion });
  }

  /** Replaces an already-registered adapter — used when a stub is swapped for a real implementation. */
  replace(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    log.info("adapter replaced", { platform: adapter.platform, version: adapter.adapterVersion });
  }

  unregister(platform: PlatformId): boolean {
    return this.adapters.delete(platform);
  }

  get(platform: PlatformId): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  has(platform: PlatformId): boolean {
    return this.adapters.has(platform);
  }

  list(): readonly PlatformAdapter[] {
    return [...this.adapters.values()];
  }

  registeredPlatforms(): readonly PlatformId[] {
    return [...this.adapters.keys()];
  }
}

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}
