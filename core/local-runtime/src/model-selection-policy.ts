import type { DeviceCapabilities, ModelMetadata, ModelType } from "./types.js";
import type { ModelRegistry } from "./model-registry.js";

export interface SelectionContext {
  readonly taskType: ModelType;
  readonly device: DeviceCapabilities;
  readonly privacySensitive?: boolean | undefined;
  readonly preferredModelId?: string | undefined;
  readonly requireInstalled?: boolean | undefined;
}

/** Returns candidates ordered best-first; an empty array means nothing is eligible. */
export type ModelSelectionPolicy = (
  candidates: readonly ModelMetadata[],
  context: SelectionContext,
) => readonly ModelMetadata[];

function meetsResourceRequirements(model: ModelMetadata, device: DeviceCapabilities): boolean {
  if (model.requirements.minRamGB > device.freeRamGB) return false;
  if (model.requirements.requiresGpu && !device.hasGpu) return false;
  return true;
}

/**
 * Default policy: filter to models the device can actually run, then rank
 * the user's preferred model first (if eligible), then prefer smaller
 * models (faster to load, less memory pressure) as a reasonable default
 * for "just pick something that'll work well." Callers needing different
 * priorities (fastest inference, highest quality) supply their own policy
 * of the same shape.
 */
export const defaultModelSelectionPolicy: ModelSelectionPolicy = (candidates, context) => {
  const eligible = candidates
    .filter((m) => m.type === context.taskType)
    .filter((m) => meetsResourceRequirements(m, context.device));

  return [...eligible].sort((a, b) => {
    if (context.preferredModelId) {
      if (a.id === context.preferredModelId) return -1;
      if (b.id === context.preferredModelId) return 1;
    }
    return a.requirements.approxDiskBytes - b.requirements.approxDiskBytes;
  });
};

/**
 * Wraps a registry + policy into a single "pick the best model for this
 * task" call. Kept separate from `ModelRegistry` so alternate policies
 * (battery-aware, quality-first) can be swapped per deployment without
 * touching the registry.
 */
export class ModelSelector {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly policy: ModelSelectionPolicy = defaultModelSelectionPolicy,
  ) {}

  select(context: SelectionContext): ModelMetadata | undefined {
    const candidates = this.registry.query({
      type: context.taskType,
      installedOnly: context.requireInstalled ?? true,
    });
    const ranked = this.policy(candidates, context);
    return ranked[0];
  }

  selectRanked(context: SelectionContext): readonly ModelMetadata[] {
    const candidates = this.registry.query({
      type: context.taskType,
      installedOnly: context.requireInstalled ?? true,
    });
    return this.policy(candidates, context);
  }
}

export function createModelSelector(
  registry: ModelRegistry,
  policy?: ModelSelectionPolicy,
): ModelSelector {
  return new ModelSelector(registry, policy);
}
