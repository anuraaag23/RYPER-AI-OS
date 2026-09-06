import type { MemoryRecord, MemoryType } from "./types.js";
import type { MemoryExpirationManager } from "./expiration.js";

export interface MemoryStatisticsSnapshot {
  readonly totalActive: number;
  readonly totalArchived: number;
  readonly totalDeleted: number;
  readonly pinnedCount: number;
  readonly countByType: Readonly<Partial<Record<MemoryType, number>>>;
  readonly oldestUpdatedAt?: string;
  readonly newestUpdatedAt?: string;
  readonly expiringSoonCount: number;
}

/**
 * Pure computation over whatever record set is passed in — no storage of
 * its own — so it always reflects the store's current state and never
 * risks drifting out of sync with it.
 */
export class MemoryStatistics {
  constructor(private readonly expiration: MemoryExpirationManager) {}

  snapshot(
    records: readonly MemoryRecord[],
    expiringSoonWindowMs = 24 * 60 * 60 * 1000,
    now: number = Date.now(),
  ): MemoryStatisticsSnapshot {
    const active = records.filter((r) => r.lifecycleState === "active");
    const archived = records.filter((r) => r.lifecycleState === "archived");
    const deleted = records.filter((r) => r.lifecycleState === "deleted");

    const countByType: Partial<Record<MemoryType, number>> = {};
    for (const record of active) {
      countByType[record.type] = (countByType[record.type] ?? 0) + 1;
    }

    const sortedByUpdated = [...active].sort(
      (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );

    const expiringSoon = active.filter((r) => {
      if (this.expiration.isExpired(r, now)) return false; // already expired, not "expiring soon"
      return this.expiration.isExpired(r, now + expiringSoonWindowMs);
    });

    return {
      totalActive: active.length,
      totalArchived: archived.length,
      totalDeleted: deleted.length,
      pinnedCount: active.filter((r) => r.pinned).length,
      countByType,
      ...(sortedByUpdated[0] ? { oldestUpdatedAt: sortedByUpdated[0].updatedAt } : {}),
      ...(sortedByUpdated.at(-1) ? { newestUpdatedAt: sortedByUpdated.at(-1)!.updatedAt } : {}),
      expiringSoonCount: expiringSoon.length,
    };
  }
}

export function createMemoryStatistics(expiration: MemoryExpirationManager): MemoryStatistics {
  return new MemoryStatistics(expiration);
}
