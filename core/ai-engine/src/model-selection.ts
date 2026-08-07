import type { ModelRouter, RoutingRequest, RoutingDecision } from "@ryper/model-router";
import type { ProviderRegistry } from "./providers/registry.js";
import type { AIProvider } from "./types.js";

export interface ModelSelectionRequest extends RoutingRequest {
  /** User- or caller-specified provider id; honored when that provider matches the router's local/cloud decision. */
  readonly preferredProviderId?: string | undefined;
}

export interface ModelSelectionResult {
  readonly provider: AIProvider;
  readonly decision: RoutingDecision;
}

/**
 * `@ryper/model-router` decides *local vs. cloud*; this engine takes that
 * decision and picks a concrete `AIProvider` from the registry — the piece
 * the architecture calls the "Model Selection Engine". It never modifies
 * `ModelRouter` itself, only composes with its public `decide()` output, so
 * a new provider (a second cloud vendor, a second local runtime) is added
 * purely by registering it, with no change here.
 */
export class ModelSelectionEngine {
  constructor(
    private readonly router: ModelRouter,
    private readonly registry: ProviderRegistry,
  ) {}

  select(request: ModelSelectionRequest): ModelSelectionResult {
    const decision = this.router.decide(request);

    if (request.preferredProviderId && this.registry.has(request.preferredProviderId)) {
      const preferred = this.registry.get(request.preferredProviderId);
      const preferredIsCloud = preferred.kind !== "local";
      const decisionWantsCloud = decision.target === "cloud";
      if (preferredIsCloud === decisionWantsCloud) {
        return { provider: preferred, decision };
      }
      // Preferred provider contradicts the routing decision (e.g. asked for
      // a cloud vendor while offline) — fall through to an eligible default
      // rather than silently honoring a request that can't work right now.
    }

    const candidates = this.registry
      .list()
      .filter((p) => (decision.target === "cloud" ? p.kind !== "local" : p.kind === "local"));
    const chosen = candidates[0];
    if (!chosen) {
      throw new Error(`no provider registered that can serve routing target "${decision.target}"`);
    }
    return { provider: chosen, decision };
  }
}

export function createModelSelectionEngine(
  router: ModelRouter,
  registry: ProviderRegistry,
): ModelSelectionEngine {
  return new ModelSelectionEngine(router, registry);
}
