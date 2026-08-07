import { createLogger } from "@ryper/logging";

const log = createLogger("memory-system:embedding-service");

export type EmbedFn = (text: string) => Promise<readonly number[]>;

/**
 * Wraps an injected embedding function (a local model via
 * `@ryper/local-runtime`'s `embed()`, or a cloud embedding API) with a
 * cache keyed by content hash-equivalent (the exact string), so repeated
 * embedding lookups for unchanged content are free. This package never
 * calls a model directly — the embed function is always supplied by the
 * caller, matching the injection pattern used throughout the codebase.
 */
export class EmbeddingService {
  private readonly cache = new Map<string, readonly number[]>();

  constructor(private readonly embed: EmbedFn) {}

  async embedText(text: string): Promise<readonly number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const vector = await this.embed(text);
    this.cache.set(text, vector);
    return vector;
  }

  /** Exposed for `MemoryStatistics`/diagnostics — how many distinct strings have been embedded this session. */
  cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
    log.debug("embedding cache cleared");
  }
}

export function createEmbeddingService(embed: EmbedFn): EmbeddingService {
  return new EmbeddingService(embed);
}
