import { createLogger } from "@ryper/logging";
import type { ModelMetadata } from "./types.js";
import type { ModelRegistry } from "./model-registry.js";

const log = createLogger("local-runtime:discovery");

/**
 * A source of model metadata — a remote catalog JSON endpoint, a scan of a
 * local directory of already-downloaded model files, a bundled offline
 * catalog shipped with the app, etc. `ModelDiscoveryService` doesn't care
 * which; it just merges whatever each registered source returns.
 */
export interface ModelSource {
  readonly id: string;
  list(): Promise<readonly ModelMetadata[]>;
}

export class ModelDiscoveryService {
  private readonly sources: ModelSource[] = [];

  constructor(private readonly registry: ModelRegistry) {}

  addSource(source: ModelSource): void {
    this.sources.push(source);
  }

  /** Queries every registered source and merges results into the registry. Later sources win on id conflicts. */
  async discover(): Promise<{ discovered: number; sourcesQueried: number; sourcesFailed: number }> {
    let discovered = 0;
    let sourcesFailed = 0;

    for (const source of this.sources) {
      try {
        const models = await source.list();
        for (const model of models) {
          this.registry.addToCatalog(model);
          discovered += 1;
        }
      } catch (err) {
        sourcesFailed += 1;
        log.warn("model source failed during discovery", { source: source.id, error: String(err) });
      }
    }

    log.info("discovery complete", {
      discovered,
      sourcesQueried: this.sources.length,
      sourcesFailed,
    });
    return { discovered, sourcesQueried: this.sources.length, sourcesFailed };
  }
}

export function createModelDiscoveryService(registry: ModelRegistry): ModelDiscoveryService {
  return new ModelDiscoveryService(registry);
}
