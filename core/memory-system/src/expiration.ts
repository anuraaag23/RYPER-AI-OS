import type { MemoryRecord, RetentionPolicyMap } from "./types.js";

/**
 * Two independent expiry mechanisms, both driven by `RetentionPolicyMap`:
 * an explicit `expiresAt` on the record always wins when present; absent
 * that, a type's `defaultTtlMs` (age since `updatedAt`) applies. A type's
 * `maxItems` is enforced separately by `findOverflow`, since "too old" and
 * "too many" are different reasons to prune.
 */
export class MemoryExpirationManager {
  constructor(private readonly policies: RetentionPolicyMap = {}) {}

  isExpired(record: MemoryRecord, now: number = Date.now()): boolean {
    if (record.pinned) return false;

    if (record.expiresAt !== undefined) {
      return new Date(record.expiresAt).getTime() <= now;
    }

    const policy = this.policies[record.type];
    if (!policy?.autoExpire || policy.defaultTtlMs === undefined) return false;
    return now - new Date(record.updatedAt).getTime() >= policy.defaultTtlMs;
  }

  findExpired(records: readonly MemoryRecord[], now: number = Date.now()): readonly MemoryRecord[] {
    return records.filter((r) => this.isExpired(r, now));
  }

  /** Records beyond a type's `maxItems` cap, oldest-updated first (excluding pinned records, which never count against the cap). */
  findOverflow(records: readonly MemoryRecord[]): readonly MemoryRecord[] {
    const overflow: MemoryRecord[] = [];
    const byType = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      if (record.pinned) continue;
      const bucket = byType.get(record.type) ?? [];
      bucket.push(record);
      byType.set(record.type, bucket);
    }

    for (const [type, bucket] of byType) {
      const maxItems = this.policies[type as MemoryRecord["type"]]?.maxItems;
      if (maxItems === undefined || bucket.length <= maxItems) continue;
      const sorted = [...bucket].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      );
      overflow.push(...sorted.slice(0, sorted.length - maxItems));
    }

    return overflow;
  }
}

export function createMemoryExpirationManager(
  policies?: RetentionPolicyMap,
): MemoryExpirationManager {
  return new MemoryExpirationManager(policies);
}
