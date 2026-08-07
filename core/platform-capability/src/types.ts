import type { Capability } from "@ryper/security";
import type { JsonSchema, ToolExecutionContext } from "@ryper/tool-framework";

// ---- Capability domains ----

/**
 * Every capability domain is an *open* string, like
 * `@ryper/tool-framework`'s `ToolCategory` — "register new abstract
 * capabilities" (the brief's Plugin Integration section) requires this to
 * never be a closed union. `BUILTIN_CAPABILITY_DOMAINS` lists the 40 the
 * brief names as typed constants for call-site safety, not a closed set.
 */
export type CapabilityDomain = string;

export type PlatformId = "windows" | "macos" | "linux" | "android" | "ios" | "browser";

/**
 * `@ryper/tool-framework`'s `ToolPlatform` and `@ryper/planner`'s
 * `SupportedPlatform` both name the sixth platform `"web"`; this layer
 * names it `"browser"` (matching the brief's adapter list). Accepts
 * either spelling so callers passing a context straight from those
 * packages don't need to convert it themselves.
 */
export function toPlatformId(platform: string): PlatformId {
  return platform === "web" ? "browser" : (platform as PlatformId);
}

// ---- Capability metadata ----

export interface CapabilityDescriptor {
  readonly domain: CapabilityDomain;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** The `@ryper/security` capability this domain is gated behind, if any — partial by design (see `capability-permissions.ts`). */
  readonly requiredCapability?: Capability;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
}

export class CapabilityDescriptorError extends Error {}

// ---- Adapter contract ----

export interface DeviceInfo {
  readonly platform: PlatformId;
  readonly platformVersion: string;
  readonly deviceType: "desktop" | "mobile" | "tablet" | "web" | "unknown";
  readonly hardwareFeatures: readonly string[];
}

export interface RuntimeLimitation {
  readonly domain: CapabilityDomain;
  readonly reason: string;
}

export type AdapterInvocationContext = ToolExecutionContext;

/**
 * The stable contract every platform adapter (Windows/macOS/Linux/
 * Android/iOS/Browser) must implement. Per the brief: "Do NOT implement
 * the operating-system-specific logic yet. Only implement stable adapter
 * contracts and registration" — this interface, `AdapterRegistry`, and
 * the honest zero-capability `NullPlatformAdapter` reference
 * implementation are what this phase delivers; real Windows/macOS/etc.
 * logic is future-phase work.
 */
export interface PlatformAdapter {
  readonly platform: PlatformId;
  readonly adapterVersion: string;
  supports(domain: CapabilityDomain): boolean;
  describeCapability(domain: CapabilityDomain): CapabilityDescriptor | undefined;
  invoke(
    domain: CapabilityDomain,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    context: AdapterInvocationContext,
  ): Promise<unknown>;
  getDeviceInfo(): DeviceInfo;
  getRuntimeLimitations(): readonly RuntimeLimitation[];
}

// ---- Discovery & resolution ----

export interface CapabilitySupportStatus {
  readonly domain: CapabilityDomain;
  readonly supported: boolean;
  readonly reason?: string;
  readonly suggestedAlternative?: string;
}

export interface DiscoveryReport {
  readonly platform: PlatformId;
  readonly deviceInfo: DeviceInfo;
  readonly supportedDomains: readonly CapabilityDomain[];
  readonly unsupportedDomains: readonly CapabilitySupportStatus[];
  readonly runtimeLimitations: readonly RuntimeLimitation[];
  readonly availablePermissions: readonly Capability[];
}

export interface CapabilityInvocationRequest {
  readonly domain: CapabilityDomain;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly actorId: string;
  readonly sessionId: string;
}
