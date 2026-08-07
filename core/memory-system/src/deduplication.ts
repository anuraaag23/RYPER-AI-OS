import type { MemoryRecord } from "./types.js";

export interface DuplicateGroup {
  readonly keep: MemoryRecord;
  readonly duplicates: readonly MemoryRecord[];
  readonly reason: "exact-content" | "high-similarity";
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

/** Which of two duplicate records to keep as canonical — the more recently updated one wins by default. */
function pickCanonical(a: MemoryRecord, b: MemoryRecord): MemoryRecord {
  return new Date(a.updatedAt) >= new Date(b.updatedAt) ? a : b;
}

/**
 * Finds duplicates within the *same* `MemoryType` only — two records of
 * different types are never considered duplicates of each other even if
 * their text happens to match, since they mean different things in this
 * system (e.g. a `task` and a `conversation` mentioning the same words).
 */
export class MemoryDeduplicator {
  constructor(private readonly similarityThreshold = 0.95) {}

  findDuplicates(records: readonly MemoryRecord[]): readonly DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const consumed = new Set<string>();
    const byType = new Map<string, MemoryRecord[]>();

    for (const record of records) {
      const bucket = byType.get(record.type) ?? [];
      bucket.push(record);
      byType.set(record.type, bucket);
    }

    for (const bucket of byType.values()) {
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i]!;
        if (consumed.has(a.id)) continue;
        const duplicates: MemoryRecord[] = [];
        let canonical = a;
        let reason: DuplicateGroup["reason"] = "exact-content";

        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j]!;
          if (consumed.has(b.id)) continue;

          if (a.content.trim() === b.content.trim()) {
            duplicates.push(b);
            consumed.add(b.id);
            canonical = pickCanonical(canonical, b);
          } else if (a.embedding && b.embedding) {
            const similarity = cosineSimilarity(a.embedding, b.embedding);
            if (similarity >= this.similarityThreshold) {
              duplicates.push(b);
              consumed.add(b.id);
              canonical = pickCanonical(canonical, b);
              reason = "high-similarity";
            }
          }
        }

        if (duplicates.length > 0) {
          consumed.add(a.id);
          groups.push({ keep: canonical, duplicates, reason });
        }
      }
    }

    return groups;
  }
}

export function createMemoryDeduplicator(similarityThreshold?: number): MemoryDeduplicator {
  return new MemoryDeduplicator(similarityThreshold);
}
