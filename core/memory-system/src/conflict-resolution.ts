import type { MemoryRecord } from "./types.js";

export interface ConflictGroup {
  readonly subjectKey: string;
  readonly subjectValue: unknown;
  readonly records: readonly MemoryRecord[];
}

export type ConflictStrategy = "most-recent-wins" | "highest-importance-wins" | "manual";

export interface ConflictResolution {
  readonly winner: MemoryRecord | undefined; // undefined only for "manual"
  readonly losers: readonly MemoryRecord[];
  readonly strategy: ConflictStrategy;
}

/**
 * "Conflict" here means two active records of the same `MemoryType` that
 * share a caller-designated metadata key (e.g. `subject: "coffee
 * preference"`) but disagree in content — detecting that grouping is the
 * caller's job (it knows what field identifies "the same subject" for a
 * given type), this class's job is finding groups sharing that key with
 * more than one distinct content, and resolving them.
 */
export class ConflictResolver {
  constructor(private readonly defaultStrategy: ConflictStrategy = "most-recent-wins") {}

  findConflicts(records: readonly MemoryRecord[], subjectKey: string): readonly ConflictGroup[] {
    const groups = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const subjectValue = record.metadata[subjectKey];
      if (subjectValue === undefined) continue;
      const groupKey = `${record.type}::${JSON.stringify(subjectValue)}`;
      const bucket = groups.get(groupKey) ?? [];
      bucket.push(record);
      groups.set(groupKey, bucket);
    }

    const conflicts: ConflictGroup[] = [];
    for (const bucket of groups.values()) {
      const distinctContents = new Set(bucket.map((r) => r.content.trim()));
      if (distinctContents.size > 1) {
        conflicts.push({
          subjectKey,
          subjectValue: bucket[0]!.metadata[subjectKey],
          records: bucket,
        });
      }
    }
    return conflicts;
  }

  resolve(
    group: ConflictGroup,
    strategy: ConflictStrategy = this.defaultStrategy,
  ): ConflictResolution {
    if (strategy === "manual") {
      return { winner: undefined, losers: group.records, strategy };
    }

    const sorted = [...group.records].sort((a, b) => {
      if (strategy === "highest-importance-wins") {
        return b.importance - a.importance;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const [winner, ...losers] = sorted;
    return { winner, losers, strategy };
  }
}

export function createConflictResolver(defaultStrategy?: ConflictStrategy): ConflictResolver {
  return new ConflictResolver(defaultStrategy);
}
