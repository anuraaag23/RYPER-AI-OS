import type { CapabilityBroker } from "@ryper/security";
import type { ToolExecutionContext } from "@ryper/tool-framework";
import { createLogger } from "@ryper/logging";
import type { AdapterRegistry } from "./adapter-registry.js";
import { createAdapterRegistry } from "./adapter-registry.js";
import { createCapabilityDiagnostics, createCapabilityMetrics } from "./capability-diagnostics.js";
import type { CapabilityDiagnostics, CapabilityMetrics } from "./capability-diagnostics.js";
import { createCapabilityDiscovery } from "./capability-discovery.js";
import type { CapabilityDiscovery } from "./capability-discovery.js";
import { createCapabilityPermissions } from "./capability-permissions.js";
import type { CapabilityPermissions } from "./capability-permissions.js";
import { createCapabilityRegistry } from "./capability-registry.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import { createCapabilityResolver } from "./capability-resolver.js";
import type { CapabilityResolver } from "./capability-resolver.js";
import { createCapabilityValidator } from "./capability-validator.js";
import type { CapabilityValidator } from "./capability-validator.js";
import {
  defaultPlatformCapabilityConfig,
  type PlatformCapabilityConfig,
} from "./capability-configuration.js";
import { createPlatformResolver } from "./platform-resolver.js";
import type { PlatformDetector, PlatformResolver } from "./platform-resolver.js";
import type {
  CapabilityDescriptor,
  CapabilityDomain,
  CapabilitySupportStatus,
  DiscoveryReport,
  PlatformAdapter,
  PlatformId,
} from "./types.js";
import { toPlatformId } from "./types.js";

const log = createLogger("platform-capability:manager");

export interface CapabilityManagerOptions {
  readonly broker: CapabilityBroker;
  readonly config?: PlatformCapabilityConfig;
  readonly platformDetector?: PlatformDetector;
}

/**
 * The single stable API the brief requires everything above it — the AI
 * Engine, Planner, Tool Framework, Plugins — to go through instead of
 * ever calling a Windows/Android/iOS/macOS/Linux API directly. Nothing in
 * this class contains OS-specific logic; every real action happens inside
 * whichever `PlatformAdapter` is registered for the active platform.
 */
export class CapabilityManager {
  readonly config: PlatformCapabilityConfig;
  readonly adapters: AdapterRegistry = createAdapterRegistry();
  readonly registry: CapabilityRegistry = createCapabilityRegistry();
  readonly resolver: CapabilityResolver;
  readonly validator: CapabilityValidator = createCapabilityValidator();
  readonly permissions: CapabilityPermissions;
  readonly discovery: CapabilityDiscovery;
  readonly diagnostics: CapabilityDiagnostics;
  readonly metrics: CapabilityMetrics = createCapabilityMetrics();
  readonly platformResolver: PlatformResolver;

  constructor(options: CapabilityManagerOptions) {
    this.config = options.config ?? defaultPlatformCapabilityConfig;
    this.resolver = createCapabilityResolver(this.registry);
    this.permissions = createCapabilityPermissions(options.broker, this.registry);
    this.discovery = createCapabilityDiscovery(this.registry, this.resolver, this.permissions);
    this.diagnostics = createCapabilityDiagnostics(this.config.diagnosticsHistorySize);
    this.platformResolver = createPlatformResolver(this.adapters, options.platformDetector);
  }

  registerCapability(descriptor: CapabilityDescriptor): void {
    const validation = this.validator.validateDescriptor(descriptor);
    if (!validation.valid) {
      throw new Error(
        `invalid capability descriptor "${descriptor.domain}": ${validation.errors.join("; ")}`,
      );
    }
    this.registry.register(descriptor);
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.register(adapter);
  }

  activeAdapter(platform?: PlatformId): PlatformAdapter {
    return this.platformResolver.resolveAdapter(platform);
  }

  /** The core query the Planner consults before generating a plan: "can the active adapter do this?" */
  resolve(domain: CapabilityDomain, platform?: PlatformId): CapabilitySupportStatus {
    return this.resolver.resolve(domain, this.activeAdapter(platform));
  }

  resolveAll(
    domains: readonly CapabilityDomain[],
    platform?: PlatformId,
  ): readonly CapabilitySupportStatus[] {
    return this.resolver.resolveAll(domains, this.activeAdapter(platform));
  }

  discover(actorId: string, platform?: PlatformId): DiscoveryReport {
    return this.discovery.discover(this.activeAdapter(platform), actorId);
  }

  /**
   * The only path anything above this layer uses to actually run a
   * capability: permission check → parameter validation → adapter
   * invocation → diagnostics/metrics. No caller ever reaches
   * `PlatformAdapter.invoke()` directly.
   */
  async invoke(
    domain: CapabilityDomain,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const startedAt = Date.now();
    const adapter = this.activeAdapter(toPlatformId(context.platform));
    const descriptor = this.registry.get(domain);

    if (descriptor) {
      const granted = await this.permissions.requestPermission(
        domain,
        context.actorId,
        `invoke ${domain}.${operation}`,
        operation,
      );
      if (!granted) {
        const durationMs = Date.now() - startedAt;
        const outcome = {
          domain,
          operation,
          platform: adapter.platform,
          ok: false,
          durationMs,
          errorMessage: "permission denied",
        };
        this.diagnostics.record(outcome);
        this.metrics.record(outcome);
        throw new Error(`capability "${domain}" was not granted for actor "${context.actorId}"`);
      }
      const validation = this.validator.validateParameters(descriptor, parameters);
      if (!validation.valid) {
        const durationMs = Date.now() - startedAt;
        const outcome = {
          domain,
          operation,
          platform: adapter.platform,
          ok: false,
          durationMs,
          errorMessage: validation.errors.join("; "),
        };
        this.diagnostics.record(outcome);
        this.metrics.record(outcome);
        throw new Error(
          `invalid parameters for "${domain}.${operation}": ${validation.errors.join("; ")}`,
        );
      }
    }

    try {
      const result = await adapter.invoke(domain, operation, parameters, context);
      const durationMs = Date.now() - startedAt;
      const outcome = { domain, operation, platform: adapter.platform, ok: true, durationMs };
      this.diagnostics.record(outcome);
      this.metrics.record(outcome);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const outcome = {
        domain,
        operation,
        platform: adapter.platform,
        ok: false,
        durationMs,
        errorMessage: String(err),
      };
      this.diagnostics.record(outcome);
      this.metrics.record(outcome);
      log.warn("capability invocation failed", { domain, operation, error: String(err) });
      throw err;
    }
  }
}

export function createCapabilityManager(options: CapabilityManagerOptions): CapabilityManager {
  return new CapabilityManager(options);
}
