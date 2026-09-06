import type { CreateMemoryInput, MemoryRecord, MemoryType } from "./types.js";

export type SummarizeFn = (records: readonly MemoryRecord[]) => string | Promise<string>;

export interface CompressionCandidateOptions {
  readonly type: MemoryType;
  readonly olderThanMs: number;
  readonly maxImportance: number;
  readonly minGroupSize?: number;
}

export interface CompressionResult {
  readonly summaryInput: CreateMemoryInput;
  readonly compressedIds: readonly string[];
}

/**
 * Rolls up old, low-importance memories of one type into a single summary
 * record, the same policy `@ryper/memory`'s `ShortTermMemory.compress`
 * uses for conversation turns, applied here to persistent memory instead.
 * Summarization itself is injected (it may call a local or cloud model)
 * — this class owns only the candidate-selection and consolidation policy.
 */
export class MemoryCompressor {
  selectCandidates(
    records: readonly MemoryRecord[],
    options: CompressionCandidateOptions,
    now: number = Date.now(),
  ): MemoryRecord[] {
    const minGroupSize = options.minGroupSize ?? 3;
    const candidates = records.filter(
      (r) =>
        r.type === options.type &&
        !r.pinned &&
        r.lifecycleState === "active" &&
        r.importance <= options.maxImportance &&
        now - new Date(r.updatedAt).getTime() >= options.olderThanMs,
    );
    return candidates.length >= minGroupSize ? candidates : [];
  }

  async compress(
    candidates: readonly MemoryRecord[],
    summarize: SummarizeFn,
  ): Promise<CompressionResult | undefined> {
    if (candidates.length === 0) return undefined;

    const summaryText = await summarize(candidates);
    const type = candidates[0]!.type;
    const combinedMetadata = { compressedFrom: candidates.map((c) => c.id) };

    return {
      summaryInput: {
        type,
        content: summaryText,
        importance: Math.max(...candidates.map((c) => c.importance)),
        metadata: combinedMetadata,
      },
      compressedIds: candidates.map((c) => c.id),
    };
  }
}

export function createMemoryCompressor(): MemoryCompressor {
  return new MemoryCompressor();
}
