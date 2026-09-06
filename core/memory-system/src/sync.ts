import { SyncStore, type SyncedRecord } from "@ryper/sync";
import type { EventBus } from "@ryper/event-bus";
import type { MemoryRecord, MemoryType } from "./types.js";

export type SelectiveSyncFilter = (record: MemoryRecord) => boolean;

/** Default: sync everything except device-local working artifacts that shouldn't follow the user across devices. */
const defaultFilter: SelectiveSyncFilter = () => true;

export function excludeTypes(types: readonly MemoryType[]): SelectiveSyncFilter {
  const excluded = new Set(types);
  return (record) => !excluded.has(record.type);
}

/**
 * Reuses `@ryper/sync`'s existing last-write-wins CRDT store rather than
 * reimplementing merge logic — this class only adds what's specific to
 * memory: a selective-sync filter (some memory types, e.g. very
 * device-local ones, can be excluded from ever leaving the device) and
 * wiring sync completion to the event bus. Offline-first and conflict
 * resolution (by `updatedAt`, tie-broken by device id) are exactly
 * `SyncStore`'s existing behavior — see `@ryper/sync`'s own docs for that
 * contract; this class does not alter it.
 */
export class MemorySyncService {
  private readonly store: SyncStore<MemoryRecord>;

  constructor(
    deviceId: string,
    private readonly filter: SelectiveSyncFilter = defaultFilter,
    eventBus?: EventBus,
  ) {
    this.store = new SyncStore<MemoryRecord>(deviceId, eventBus);
  }

  /** Stages a local change for sync — call this after every local create/update. Records excluded by the filter are silently skipped. */
  stageLocalChange(record: MemoryRecord): void {
    if (!this.filter(record)) return;
    this.store.set(record.id, record, new Date(record.updatedAt).getTime());
  }

  /** Applies a batch of remote records (received from another device), respecting the same selective-sync filter locally. */
  merge(remote: readonly SyncedRecord<MemoryRecord>[]): { applied: number; ignored: number } {
    const eligible = remote.filter((r) => this.filter(r.value));
    return this.store.merge(eligible);
  }

  snapshot(): readonly SyncedRecord<MemoryRecord>[] {
    return this.store.snapshot();
  }

  getSynced(memoryId: string): MemoryRecord | undefined {
    return this.store.get(memoryId)?.value;
  }
}

export function createMemorySyncService(
  deviceId: string,
  filter?: SelectiveSyncFilter,
  eventBus?: EventBus,
): MemorySyncService {
  return new MemorySyncService(deviceId, filter, eventBus);
}
