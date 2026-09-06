import type { MemoryRecord } from "./types.js";

/**
 * Snapshots are taken by the caller (`MemoryManager`, right before it
 * applies an update) rather than derived automatically — this class just
 * stores and retrieves them. Keeps this component honest about what it
 * does: it's a history store, not a diffing engine.
 */
export class MemoryVersionHistory {
  private readonly history = new Map<string, MemoryRecord[]>();

  snapshot(record: MemoryRecord): void {
    const versions = this.history.get(record.id) ?? [];
    versions.push(record);
    this.history.set(record.id, versions);
  }

  getHistory(memoryId: string): readonly MemoryRecord[] {
    return this.history.get(memoryId) ?? [];
  }

  getVersion(memoryId: string, version: number): MemoryRecord | undefined {
    return this.history.get(memoryId)?.find((r) => r.version === version);
  }

  /** The version immediately before the current one — what "undo" restores. */
  getPreviousVersion(memoryId: string, currentVersion: number): MemoryRecord | undefined {
    const versions = this.history.get(memoryId) ?? [];
    return versions.find((r) => r.version === currentVersion - 1);
  }

  forget(memoryId: string): void {
    this.history.delete(memoryId);
  }
}

export function createMemoryVersionHistory(): MemoryVersionHistory {
  return new MemoryVersionHistory();
}
