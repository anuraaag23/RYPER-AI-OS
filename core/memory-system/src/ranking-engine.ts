import type { ScoredMemory } from "./semantic-search.js";

export interface RankingWeights {
  readonly relevance: number;
  readonly importance: number;
  readonly recency: number;
  readonly pinnedBoost: number;
}

export const defaultRankingWeights: RankingWeights = {
  relevance: 0.5,
  importance: 0.3,
  recency: 0.15,
  pinnedBoost: 0.05,
};

function recencyScore(updatedAt: string, now: number, halfLifeMs: number): number {
  const ageMs = Math.max(0, now - new Date(updatedAt).getTime());
  // Exponential decay: score is 0.5 at exactly one half-life old.
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Takes `SemanticSearchEngine`'s relevance-only results and re-ranks them
 * by a weighted blend of relevance, importance, recency, and a pinned
 * bonus — this is what actually determines final ordering shown to the
 * user or fed into a prompt, keeping "how relevant is this to the query"
 * and "how should we ultimately order results" as separate, individually
 * testable concerns.
 */
export class MemoryRankingEngine {
  constructor(
    private readonly weights: RankingWeights = defaultRankingWeights,
    private readonly recencyHalfLifeMs = 7 * 24 * 60 * 60 * 1000, // 7 days
  ) {}

  rank(scored: readonly ScoredMemory[], now: number = Date.now()): ScoredMemory[] {
    return [...scored]
      .map(({ record, score }) => {
        const finalScore =
          this.weights.relevance * score +
          this.weights.importance * record.importance +
          this.weights.recency * recencyScore(record.updatedAt, now, this.recencyHalfLifeMs) +
          (record.pinned ? this.weights.pinnedBoost : 0);
        return { record, score: finalScore };
      })
      .sort((a, b) => b.score - a.score);
  }
}

export function createMemoryRankingEngine(
  weights?: RankingWeights,
  recencyHalfLifeMs?: number,
): MemoryRankingEngine {
  return new MemoryRankingEngine(weights, recencyHalfLifeMs);
}
