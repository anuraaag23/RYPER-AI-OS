import type { MemoryRecord, MemoryType } from "./types.js";

/** Default relative weight per type — pure heuristic, override via `ImportanceScorer`'s constructor for a different policy. */
export const defaultTypeWeights: Readonly<Record<MemoryType, number>> = {
  preference: 0.8,
  project: 0.7,
  task: 0.6,
  contact: 0.6,
  calendar: 0.6,
  knowledge: 0.7,
  semantic: 0.6,
  long_term: 0.5,
  episodic: 0.4,
  conversation: 0.3,
  document: 0.4,
  image: 0.3,
  file: 0.3,
  automation: 0.5,
};

export interface ImportanceInput {
  readonly type: MemoryType;
  readonly explicitImportance?: number;
  readonly pinned: boolean;
  readonly accessCount: number;
}

/**
 * A single heuristic, not a model call — importance scoring is explainable
 * on purpose, since it directly affects what the assistant chooses to
 * remember and surface. `explicitImportance` (a user- or caller-set value)
 * always wins when present; otherwise the score blends type weight,
 * pin status, and access frequency.
 */
export class ImportanceScorer {
  constructor(
    private readonly typeWeights: Readonly<Record<MemoryType, number>> = defaultTypeWeights,
  ) {}

  score(input: ImportanceInput): number {
    if (input.explicitImportance !== undefined) {
      return clamp01(input.explicitImportance);
    }

    const typeWeight = this.typeWeights[input.type] ?? 0.5;
    const pinBoost = input.pinned ? 0.2 : 0;
    const accessBoost = Math.min(0.2, input.accessCount * 0.02);

    return clamp01(typeWeight + pinBoost + accessBoost);
  }

  scoreRecord(record: MemoryRecord, accessCount = 0): number {
    return this.score({ type: record.type, pinned: record.pinned, accessCount });
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createImportanceScorer(
  typeWeights?: Readonly<Record<MemoryType, number>>,
): ImportanceScorer {
  return new ImportanceScorer(typeWeights);
}
