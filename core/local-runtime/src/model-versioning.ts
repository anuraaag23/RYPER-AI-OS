/** Minimal semver comparison — good enough for "is this an update", not a full semver-range parser. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((n) => parseInt(n, 10) || 0);
  const partsB = b.split(".").map((n) => parseInt(n, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export interface VersionRecord {
  readonly version: string;
  readonly localPath: string;
  readonly installedAt: string;
}

/**
 * Tracks every version of a model ever installed, per model id, so
 * `ModelManager.update` can keep the previous version's files on disk
 * until the new one is confirmed working, and `rollback` can repoint the
 * "active" version without re-downloading anything.
 */
export class VersionManager {
  private readonly history = new Map<string, VersionRecord[]>();
  private readonly active = new Map<string, string>();

  recordInstall(modelId: string, record: VersionRecord): void {
    const records = this.history.get(modelId) ?? [];
    records.push(record);
    this.history.set(modelId, records);
    this.active.set(modelId, record.version);
  }

  getActiveVersion(modelId: string): string | undefined {
    return this.active.get(modelId);
  }

  getHistory(modelId: string): readonly VersionRecord[] {
    return this.history.get(modelId) ?? [];
  }

  /** Repoints "active" to the version installed immediately before the current one. Returns it, or undefined if there isn't one. */
  rollback(modelId: string): VersionRecord | undefined {
    const records = this.history.get(modelId) ?? [];
    const currentVersion = this.active.get(modelId);
    const currentIndex = records.findIndex((r) => r.version === currentVersion);
    const previous = currentIndex > 0 ? records[currentIndex - 1] : undefined;
    if (previous) {
      this.active.set(modelId, previous.version);
    }
    return previous;
  }

  forget(modelId: string): void {
    this.history.delete(modelId);
    this.active.delete(modelId);
  }
}

export function createVersionManager(): VersionManager {
  return new VersionManager();
}
