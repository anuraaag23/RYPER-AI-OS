import { CapabilityBroker, type ConsentPrompt } from "@ryper/security";
import type { ToolExecutionContext } from "@ryper/tool-framework";
import type { DeviceInfo, PlatformAdapter, PlatformId, RuntimeLimitation } from "../src/types.js";

export function buildCapabilityBroker(
  promptForConsent: ConsentPrompt = () => true,
): CapabilityBroker {
  return new CapabilityBroker(promptForConsent);
}

export interface MockAdapterOptions {
  readonly platform?: PlatformId;
  readonly supportedDomains?: readonly string[];
  readonly deviceInfo?: Partial<DeviceInfo>;
  readonly runtimeLimitations?: readonly RuntimeLimitation[];
  readonly handlers?: Readonly<
    Record<string, (parameters: Readonly<Record<string, unknown>>) => unknown>
  >;
}

/** A real, functional test adapter — not a stub that always throws — used across the suite. */
export function buildMockAdapter(options: MockAdapterOptions = {}): PlatformAdapter {
  const platform = options.platform ?? "windows";
  const supported = new Set(options.supportedDomains ?? ["notifications"]);

  return {
    platform,
    adapterVersion: "1.0.0",
    supports: (domain) => supported.has(domain),
    describeCapability: () => undefined,
    invoke: async (domain, operation, parameters, _context: ToolExecutionContext) => {
      const handler = options.handlers?.[`${domain}.${operation}`];
      if (handler) return handler(parameters);
      if (!supported.has(domain)) {
        throw new Error(`"${domain}" is not supported by this mock adapter`);
      }
      return { ok: true };
    },
    getDeviceInfo: () => ({
      platform,
      platformVersion: "1.0",
      deviceType: "desktop",
      hardwareFeatures: [],
      ...options.deviceInfo,
    }),
    getRuntimeLimitations: () => options.runtimeLimitations ?? [],
  };
}
