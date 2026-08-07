import type { MemoryRecord, MemoryType } from "./types.js";

export interface MemoryFilter {
  readonly type?: MemoryType;
  readonly tag?: string;
  readonly pinnedOnly?: boolean;
  readonly lifecycleState?: MemoryRecord["lifecycleState"];
}

/**
 * Rebuilt from the store's current records rather than incrementally
 * maintained — for the record counts this system is designed around
 * (a user's personal memory, not a multi-tenant database), a full rebuild
 * is fast enough to be simpler and never drift out of sync with the store.
 * `MemoryManager` calls `rebuild()` after any mutation that changed
 * indexable fields.
 */
export class MemoryIndex {
  private byType = new Map<MemoryType, Set<string>>();
  private byTag = new Map<string, Set<string>>();
  private pinned = new Set<string>();

  rebuild(records: readonly MemoryRecord[]): void {
    this.byType = new Map();
    this.byTag = new Map();
    this.pinned = new Set();

    for (const record of records) {
      this.addToSetMap(this.byType, record.type, record.id);
      for (const tag of record.tags) this.addToSetMap(this.byTag, tag, record.id);
      if (record.pinned) this.pinned.add(record.id);
    }
  }

  private addToSetMap<K>(map: Map<K, Set<string>>, key: K, id: string): void {
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  }

  idsForType(type: MemoryType): ReadonlySet<string> {
    return this.byType.get(type) ?? new Set();
  }

  idsForTag(tag: string): ReadonlySet<string> {
    return this.byTag.get(tag) ?? new Set();
  }

  pinnedIds(): ReadonlySet<string> {
    return this.pinned;
  }

  /** Intersects every provided filter dimension; a filter with no active dimensions matches everything. */
  matchIds(filter: MemoryFilter, allRecords: readonly MemoryRecord[]): Set<string> {
    let candidateIds: Set<string> | undefined;

    if (filter.type) candidateIds = new Set(this.idsForType(filter.type));
    if (filter.tag) {
      const tagIds = this.idsForTag(filter.tag);
      candidateIds = candidateIds ? intersect(candidateIds, tagIds) : new Set(tagIds);
    }
    if (filter.pinnedOnly) {
      candidateIds = candidateIds ? intersect(candidateIds, this.pinned) : new Set(this.pinned);
    }

    if (!candidateIds) {
      candidateIds = new Set(allRecords.map((r) => r.id));
    }

    if (filter.lifecycleState) {
      const stateIds = new Set(
        allRecords.filter((r) => r.lifecycleState === filter.lifecycleState).map((r) => r.id),
      );
      candidateIds = intersect(candidateIds, stateIds);
    }

    return candidateIds;
  }
}

function intersect(a: Set<string>, b: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const id of a) if (b.has(id)) result.add(id);
  return result;
}

export function createMemoryIndex(): MemoryIndex {
  return new MemoryIndex();
}
