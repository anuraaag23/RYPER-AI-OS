import { createLogger } from "@ryper/logging";
import type { InstalledModel } from "./types.js";
import type { ModelRegistry } from "./model-registry.js";
import type { FileSystemLike } from "./filesystem.js";

const log = createLogger("local-runtime:cache");

export interface DiskUsageReport {
  readonly totalBytes: number;
  readonly maxBytes: number;
  readonly utilizationPercent: number;
  readonly perModel: ReadonlyArray<{ modelId: string; sizeBytes: number }>;
}

/**
 * Tracks last-used time per installed model (updated by the runtime manager
 * on every successful inference call) and evicts least-recently-used models
 * when the cache exceeds its configured size budget. Eviction never removes
 * a model that's currently marked `active` mid-request — callers are
 * expected to only call `enforceLimit` between requests.
 */
export class ModelCache {
  private readonly lastUsedAt = new Map<string, number>();

  constructor(
    private readonly registry: ModelRegistry,
    private readonly fileSystem: FileSystemLike,
    private readonly maxBytes: number,
  ) {}

  recordUse(modelId: string, now: number = Date.now()): void {
    this.lastUsedAt.set(modelId, now);
  }

  diskUsage(): DiskUsageReport {
    const installed = this.registry.listInstalled();
    const totalBytes = installed.reduce((sum, m) => sum + m.sizeBytes, 0);
    return {
      totalBytes,
      maxBytes: this.maxBytes,
      utilizationPercent: this.maxBytes > 0 ? (totalBytes / this.maxBytes) * 100 : 0,
      perModel: installed.map((m) => ({ modelId: m.metadata.id, sizeBytes: m.sizeBytes })),
    };
  }

  /** Evicts least-recently-used models (never-used models are treated as oldest) until usage is back under budget. */
  async enforceLimit(): Promise<readonly string[]> {
    const usage = this.diskUsage();
    if (usage.totalBytes <= this.maxBytes) return [];

    const installed = [...this.registry.listInstalled()].sort(
      (a, b) =>
        (this.lastUsedAt.get(a.metadata.id) ?? 0) - (this.lastUsedAt.get(b.metadata.id) ?? 0),
    );

    const evicted: string[] = [];
    let remaining = usage.totalBytes;

    for (const model of installed) {
      if (remaining <= this.maxBytes) break;
      await this.evict(model);
      remaining -= model.sizeBytes;
      evicted.push(model.metadata.id);
    }

    if (evicted.length > 0) log.info("cache eviction", { evicted });
    return evicted;
  }

  private async evict(model: InstalledModel): Promise<void> {
    await this.fileSystem.deleteFile(model.localPath);
    this.registry.markUninstalled(model.metadata.id);
    this.lastUsedAt.delete(model.metadata.id);
  }
}

export function createModelCache(
  registry: ModelRegistry,
  fileSystem: FileSystemLike,
  maxBytes: number,
): ModelCache {
  return new ModelCache(registry, fileSystem, maxBytes);
}
