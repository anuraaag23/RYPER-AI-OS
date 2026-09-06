import type {
  CapabilityDomain,
  DeviceInfo,
  PlatformAdapter,
  PlatformId,
  RuntimeLimitation,
} from "./types.js";

export class UnsupportedCapabilityError extends Error {}

/**
 * A real, fully functional `PlatformAdapter` that honestly supports
 * nothing. This is what `PlatformResolver` falls back to for a platform
 * with no registered adapter yet — every real Windows/macOS/Linux/
 * Android/iOS/Browser adapter is future-phase work, per the brief
 * ("Do NOT implement the operating-system-specific logic yet"). Using
 * this instead of leaving "no adapter" unhandled means every downstream
 * caller (Planner, Tool Framework, Plugins) always gets a real,
 * predictable "unsupported, here's why" answer rather than a crash.
 */
export function createNullAdapter(platform: PlatformId): PlatformAdapter {
  const runtimeLimitations: RuntimeLimitation[] = [
    { domain: "*", reason: `no adapter is registered for platform "${platform}" yet` },
  ];

  return {
    platform,
    adapterVersion: "0.0.0",
    supports: () => false,
    describeCapability: () => undefined,
    invoke: async (domain: CapabilityDomain, operation: string) => {
      throw new UnsupportedCapabilityError(
        `capability "${domain}.${operation}" is not available on "${platform}": no adapter is registered`,
      );
    },
    getDeviceInfo: (): DeviceInfo => ({
      platform,
      platformVersion: "unknown",
      deviceType: "unknown",
      hardwareFeatures: [],
    }),
    getRuntimeLimitations: () => runtimeLimitations,
  };
}
