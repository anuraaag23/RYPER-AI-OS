import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";

const log = createLogger("model-router");

export type RoutingHint = "local_only" | "cloud_ok" | "auto";

export interface DeviceState {
  readonly online: boolean;
  readonly batteryPercent?: number;
  readonly isCharging?: boolean;
  readonly thermalThrottled?: boolean;
}

export interface RoutingRequest {
  readonly hint: RoutingHint;
  readonly requiresWebSearch?: boolean | undefined;
  readonly requiresAdvancedReasoning?: boolean | undefined;
  readonly privacySensitive?: boolean | undefined;
  readonly device: DeviceState;
}

export type ModelTarget = "local" | "cloud";

export interface RoutingDecision {
  readonly target: ModelTarget;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly target: ModelTarget;
  generate(prompt: string): Promise<string>;
}

/**
 * Decides local vs. cloud per request. The decision and its human-readable
 * reason are always available to the caller (and emitted on the bus) so
 * routing is never a silent black box, per the architecture's transparency
 * requirement.
 */
export class ModelRouter {
  private readonly providers = new Map<ModelTarget, ModelProvider>();

  constructor(private readonly eventBus?: EventBus) {}

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.target, provider);
  }

  decide(request: RoutingRequest): RoutingDecision {
    const decidedAt = new Date().toISOString();

    if (request.hint === "local_only" || request.privacySensitive) {
      return this.finalize(
        "local",
        request.privacySensitive
          ? "request marked privacy-sensitive"
          : "user forced local-only routing",
        decidedAt,
      );
    }

    if (!request.device.online) {
      return this.finalize("local", "device is offline", decidedAt);
    }

    if (request.requiresWebSearch) {
      return this.finalize("cloud", "task requires live web search", decidedAt);
    }

    if (request.requiresAdvancedReasoning) {
      return this.finalize(
        "cloud",
        "task flagged as requiring advanced reasoning beyond the local model",
        decidedAt,
      );
    }

    if (
      request.device.batteryPercent !== undefined &&
      request.device.batteryPercent < 15 &&
      request.device.isCharging !== true
    ) {
      return this.finalize(
        "cloud",
        "low battery and not charging — offloading inference to save power",
        decidedAt,
      );
    }

    return this.finalize("local", "default: local model is sufficient", decidedAt);
  }

  async route(
    request: RoutingRequest,
    prompt: string,
  ): Promise<{ decision: RoutingDecision; output: string }> {
    const decision = this.decide(request);
    const provider = this.providers.get(decision.target);
    if (!provider) {
      throw new Error(`no model provider registered for target "${decision.target}"`);
    }
    const output = await provider.generate(prompt);
    return { decision, output };
  }

  private finalize(target: ModelTarget, reason: string, decidedAt: string): RoutingDecision {
    const decision: RoutingDecision = { target, reason, decidedAt };
    log.info("routing decision", { target, reason });
    void this.eventBus?.emit("model_router.decision", decision, "model-router");
    return decision;
  }
}

export function createModelRouter(eventBus?: EventBus): ModelRouter {
  return new ModelRouter(eventBus);
}
