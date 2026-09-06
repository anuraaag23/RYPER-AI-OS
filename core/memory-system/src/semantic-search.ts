import type { MemoryRecord } from "./types.js";
import type { MemoryFilter, MemoryIndex } from "./memory-index.js";
import type { EmbeddingService } from "./embedding-service.js";

export interface ScoredMemory {
  readonly record: MemoryRecord;
  readonly score: number;
}

export interface SearchOptions {
  readonly filter?: MemoryFilter;
  readonly limit?: number;
  readonly hybridWeight?: number; // 0 = pure keyword, 1 = pure vector
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(query: string, content: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const haystack = content.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

function metadataMatches(record: MemoryRecord, query: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(query).every(([key, value]) => record.metadata[key] === value);
}

/**
 * Implements every search mode the brief calls for over one shared scoring
 * primitive: vector search alone (`hybridWeight: 1`), keyword search alone
 * (`hybridWeight: 0`), and hybrid (anything between) are the same
 * `search()` call with a different weight — there's no separate code path
 * to drift out of sync.
 */
export class SemanticSearchEngine {
  constructor(
    private readonly index: MemoryIndex,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(
    query: string,
    records: readonly MemoryRecord[],
    options: SearchOptions = {},
  ): Promise<ScoredMemory[]> {
    const limit = options.limit ?? 10;
    const hybridWeight = options.hybridWeight ?? 0.6;
    const candidateIds = this.index.matchIds(options.filter ?? {}, records);
    const candidates = records.filter((r) => candidateIds.has(r.id));

    const queryEmbedding =
      hybridWeight > 0 ? await this.embeddingService.embedText(query) : undefined;

    const scored = candidates.map((record) => {
      const vectorScore =
        queryEmbedding && record.embedding ? cosineSimilarity(queryEmbedding, record.embedding) : 0;
      const kwScore = keywordScore(query, record.content);
      const score = hybridWeight * vectorScore + (1 - hybridWeight) * kwScore;
      return { record, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Metadata-only search: no scoring, just exact-match filtering on metadata fields. */
  searchByMetadata(
    records: readonly MemoryRecord[],
    query: Readonly<Record<string, unknown>>,
  ): readonly MemoryRecord[] {
    return records.filter((r) => metadataMatches(r, query));
  }

  /** Finds memories most similar to a given one — "related memories" — by embedding distance alone. */
  findRelated(target: MemoryRecord, records: readonly MemoryRecord[], limit = 5): ScoredMemory[] {
    if (!target.embedding) return [];
    const targetEmbedding = target.embedding;
    return records
      .filter((r) => r.id !== target.id && r.embedding)
      .map((record) => ({ record, score: cosineSimilarity(targetEmbedding, record.embedding!) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export function createSemanticSearchEngine(
  index: MemoryIndex,
  embeddingService: EmbeddingService,
): SemanticSearchEngine {
  return new SemanticSearchEngine(index, embeddingService);
}
