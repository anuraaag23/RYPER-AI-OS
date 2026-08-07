import type { EventBus } from "@ryper/event-bus";
import { createLogger } from "@ryper/logging";

const log = createLogger("sync");

export interface SyncedRecord<T> {
  readonly key: string;
  readonly value: T;
  readonly updatedAt: number; // logical/physical clock, ms since epoch
  readonly deviceId: string;
}

/**
 * A minimal last-write-wins CRDT store, keyed by record key. This is the
 * simplest member of the CRDT family that still gives deterministic,
 * commutative merges across devices without a central coordinator — a full
 * op-based CRDT (e.g. for rich-text conversation edits) can replace the
 * value type later without changing this merge contract.
 */
export class SyncStore<T> {
  private readonly records = new Map<string, SyncedRecord<T>>();

  constructor(
    private readonly deviceId: string,
    private readonly eventBus?: EventBus,
  ) {}

  set(key: string, value: T, updatedAt: number = Date.now()): SyncedRecord<T> {
    const record: SyncedRecord<T> = { key, value, updatedAt, deviceId: this.deviceId };
    this.records.set(key, record);
    return record;
  }

  get(key: string): SyncedRecord<T> | undefined {
    return this.records.get(key);
  }

  /** Merges a batch of remote records; later `updatedAt` wins, ties broken by deviceId for determinism. */
  merge(remote: readonly SyncedRecord<T>[]): { applied: number; ignored: number } {
    let applied = 0;
    let ignored = 0;
    for (const incoming of remote) {
      const local = this.records.get(incoming.key);
      const incomingWins =
        !local ||
        incoming.updatedAt > local.updatedAt ||
        (incoming.updatedAt === local.updatedAt && incoming.deviceId > local.deviceId);

      if (incomingWins) {
        this.records.set(incoming.key, incoming);
        applied += 1;
      } else {
        ignored += 1;
      }
    }
    log.info("merge complete", { applied, ignored });
    void this.eventBus?.emit("sync.merged", { applied, ignored }, "sync");
    return { applied, ignored };
  }

  snapshot(): readonly SyncedRecord<T>[] {
    return [...this.records.values()];
  }
}

export function createSyncStore<T>(deviceId: string, eventBus?: EventBus): SyncStore<T> {
  return new SyncStore<T>(deviceId, eventBus);
}
