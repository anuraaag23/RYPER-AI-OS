import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import { ShortTermMemory, estimateTokens } from "@ryper/memory";

import type { CreateMemoryInput, MemoryRecord, MemoryType, UpdateMemoryInput } from "./types.js";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryIndex, MemoryFilter } from "./memory-index.js";
import type { EmbeddingService } from "./embedding-service.js";
import type { SemanticSearchEngine, ScoredMemory, SearchOptions } from "./semantic-search.js";
import type { MemoryRankingEngine } from "./ranking-engine.js";
import type { ImportanceScorer } from "./importance-scoring.js";
import type { MemoryCategorizer } from "./categorization.js";
import type { MemoryDeduplicator, DuplicateGroup } from "./deduplication.js";
import type { ConflictResolver } from "./conflict-resolution.js";
import {
  MemoryCompressor,
  type SummarizeFn,
  type CompressionCandidateOptions,
} from "./compression.js";
import type { MemoryExpirationManager } from "./expiration.js";
import type { MemoryAuditLog } from "./audit-log.js";
import type { MemoryVersionHistory } from "./version-history.js";
import type {
  MemoryBackupService,
  MemoryExportBundle,
  MemoryBackupBundle,
} from "./backup-restore.js";
import type { MemoryPermissions } from "./permissions.js";
import type { MemorySyncService } from "./sync.js";
import type { MemoryStatistics, MemoryStatisticsSnapshot } from "./statistics.js";

const log = createLogger("memory-system:manager");

export interface MemoryManagerOptions {
  readonly store: MemoryStore;
  readonly index: MemoryIndex;
  readonly search: SemanticSearchEngine;
  readonly ranking: MemoryRankingEngine;
  readonly importanceScorer: ImportanceScorer;
  readonly categorizer: MemoryCategorizer;
  readonly deduplicator: MemoryDeduplicator;
  readonly conflictResolver: ConflictResolver;
  readonly expiration: MemoryExpirationManager;
  readonly auditLog: MemoryAuditLog;
  readonly versionHistory: MemoryVersionHistory;
  readonly permissions: MemoryPermissions;
  readonly statistics: MemoryStatistics;
  readonly embeddingService?: EmbeddingService;
  readonly backupService?: MemoryBackupService;
  readonly syncService?: MemorySyncService;
  readonly eventBus?: EventBus;
  readonly shortTermTokenBudget?: number;
}

export interface MaintenanceReport {
  readonly expiredPurged: number;
  readonly overflowPurged: number;
  readonly duplicateGroupsFound: number;
}

/**
 * The Memory Manager: every other module (Core AI Engine's Context
 * Manager, the future Documents/Automation modules, platform shells'
 * Memory Viewer UI) talks to memory through this class, never through the
 * individual components it composes directly. See the package README for
 * the full integration contract.
 */
export class MemoryManager {
  private readonly shortTermSessions = new Map<string, ShortTermMemory>();

  constructor(private readonly options: MemoryManagerOptions) {}

  // ---- lifecycle gate ----

  private assertEnabled(): void {
    if (!this.options.permissions.isEnabled()) {
      throw new Error("memory is disabled — enable it before performing this operation");
    }
  }

  async enable(): Promise<void> {
    await this.options.permissions.enable();
  }

  async disable(): Promise<void> {
    await this.options.permissions.disable();
  }

  isEnabled(): boolean {
    return this.options.permissions.isEnabled();
  }

  // ---- short-term / working memory ----

  /** One `ShortTermMemory` per session — the sliding-window turn store `@ryper/memory` already implements, reused rather than duplicated. */
  getShortTermMemory(sessionId: string): ShortTermMemory {
    let session = this.shortTermSessions.get(sessionId);
    if (!session) {
      session = new ShortTermMemory(this.options.shortTermTokenBudget ?? 4000);
      this.shortTermSessions.set(sessionId, session);
    }
    return session;
  }

  endShortTermSession(sessionId: string): void {
    this.shortTermSessions.delete(sessionId);
  }

  // ---- CRUD ----

  async createMemory(input: CreateMemoryInput, actor = "user"): Promise<MemoryRecord> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");

    const importance =
      input.importance ??
      this.options.importanceScorer.score({
        type: input.type,
        pinned: input.pinned ?? false,
        accessCount: 0,
      });

    const record = await this.options.store.create({ ...input, importance });
    const withEmbedding = await this.attachEmbedding(record);

    this.reindex();
    this.options.auditLog.record("create", record.id, actor);
    this.options.syncService?.stageLocalChange(withEmbedding);
    await this.options.eventBus?.emit(
      "memory_system.created",
      { id: record.id, type: record.type },
      "memory-system",
    );
    return withEmbedding;
  }

  /** Convenience creator that infers the type via `MemoryCategorizer` when the caller doesn't already know it. */
  async createMemoryAuto(
    content: string,
    overrides: Partial<Omit<CreateMemoryInput, "content" | "type">> & { type?: MemoryType } = {},
    actor = "user",
  ): Promise<MemoryRecord> {
    const type = overrides.type ?? this.options.categorizer.categorize(content);
    return this.createMemory({ ...overrides, type, content }, actor);
  }

  getMemory(id: string, actor = "user"): MemoryRecord | undefined {
    this.assertEnabled();
    this.options.permissions.assertGranted("view");
    this.options.auditLog.record("read", id, actor);
    return this.options.store.get(id);
  }

  async updateMemory(id: string, input: UpdateMemoryInput, actor = "user"): Promise<MemoryRecord> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");

    const existing = this.options.store.get(id);
    if (existing) this.options.versionHistory.snapshot(existing);

    const updated = await this.options.store.update(id, input);
    const withEmbedding =
      input.content !== undefined ? await this.attachEmbedding(updated) : updated;

    this.reindex();
    this.options.auditLog.record("update", id, actor);
    this.options.syncService?.stageLocalChange(withEmbedding);
    await this.options.eventBus?.emit("memory_system.updated", { id }, "memory-system");
    return withEmbedding;
  }

  async deleteMemory(id: string, actor = "user"): Promise<boolean> {
    this.assertEnabled();
    this.options.permissions.assertGranted("delete");
    const existing = this.options.store.get(id);
    if (existing) this.options.versionHistory.snapshot(existing);

    const deleted = await this.options.store.delete(id);
    if (deleted) {
      this.reindex();
      this.options.auditLog.record("delete", id, actor);
      await this.options.eventBus?.emit("memory_system.deleted", { id }, "memory-system");
    }
    return deleted;
  }

  async purgeMemory(id: string, actor = "user"): Promise<boolean> {
    this.assertEnabled();
    this.options.permissions.assertGranted("delete");
    const purged = await this.options.store.purge(id);
    if (purged) {
      this.reindex();
      this.options.versionHistory.forget(id);
      this.options.auditLog.record("purge", id, actor);
    }
    return purged;
  }

  async archiveMemory(id: string, actor = "user"): Promise<MemoryRecord> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");
    const archived = await this.options.store.setLifecycleState(id, "archived");
    this.reindex();
    this.options.auditLog.record("archive", id, actor);
    return archived;
  }

  async restoreMemory(id: string, actor = "user"): Promise<MemoryRecord> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");
    const restored = await this.options.store.setLifecycleState(id, "active");
    this.reindex();
    this.options.auditLog.record("restore", id, actor);
    return restored;
  }

  async pinMemory(id: string, actor = "user"): Promise<MemoryRecord> {
    return this.updateMemory(id, { pinned: true }, actor);
  }

  async unpinMemory(id: string, actor = "user"): Promise<MemoryRecord> {
    return this.updateMemory(id, { pinned: false }, actor);
  }

  async tagMemory(id: string, tags: readonly string[], actor = "user"): Promise<MemoryRecord> {
    const existing = this.mustGetActive(id);
    const merged = [...new Set([...existing.tags, ...tags])];
    return this.updateMemory(id, { tags: merged }, actor);
  }

  // ---- merge / split ----

  /** Combines multiple records into one, keeping the highest importance and union of tags; originals are soft-deleted, not purged, so they remain recoverable. */
  async mergeMemories(
    ids: readonly string[],
    mergedContent: string,
    actor = "user",
  ): Promise<MemoryRecord> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");
    const records = ids.map((id) => this.mustGetActive(id));
    const type = records[0]!.type;
    const tags = [...new Set(records.flatMap((r) => r.tags))];
    const importance = Math.max(...records.map((r) => r.importance));

    const merged = await this.createMemory(
      { type, content: mergedContent, tags, importance },
      actor,
    );
    for (const record of records) {
      await this.options.store.delete(record.id);
      this.options.auditLog.record("merge", record.id, actor);
    }
    this.reindex();
    return merged;
  }

  /** The inverse: creates several new records from one, then archives (not purges) the source. */
  async splitMemory(
    id: string,
    parts: readonly CreateMemoryInput[],
    actor = "user",
  ): Promise<readonly MemoryRecord[]> {
    this.assertEnabled();
    this.options.permissions.assertGranted("edit");
    this.mustGetActive(id);

    const created: MemoryRecord[] = [];
    for (const part of parts) {
      created.push(await this.createMemory(part, actor));
    }
    await this.archiveMemory(id, actor);
    this.options.auditLog.record("split", id, actor);
    return created;
  }

  // ---- search / filter ----

  async searchMemories(
    query: string,
    options: SearchOptions = {},
    actor = "user",
  ): Promise<ScoredMemory[]> {
    this.assertEnabled();
    this.options.permissions.assertGranted("view");
    this.options.auditLog.record("read", "*search*", actor);
    const scored = await this.options.search.search(
      query,
      this.options.store.listActive(),
      options,
    );
    return this.options.ranking.rank(scored);
  }

  filterMemories(filter: MemoryFilter, actor = "user"): readonly MemoryRecord[] {
    this.assertEnabled();
    this.options.permissions.assertGranted("view");
    const records = this.options.store.listActive();
    const ids = this.options.index.matchIds(filter, records);
    this.options.auditLog.record("read", "*filter*", actor);
    return records.filter((r) => ids.has(r.id));
  }

  findRelated(memoryId: string, limit = 5): ScoredMemory[] {
    const target = this.mustGetActive(memoryId);
    return this.options.search.findRelated(target, this.options.store.listActive(), limit);
  }

  // ---- dedup / conflicts / compression / expiration ----

  findDuplicates(): readonly DuplicateGroup[] {
    return this.options.deduplicator.findDuplicates(this.options.store.listActive());
  }

  async resolveDuplicates(actor = "user"): Promise<number> {
    const groups = this.findDuplicates();
    for (const group of groups) {
      for (const dup of group.duplicates) {
        await this.deleteMemory(dup.id, actor);
      }
    }
    return groups.length;
  }

  findConflicts(subjectKey: string): ReturnType<ConflictResolver["findConflicts"]> {
    return this.options.conflictResolver.findConflicts(this.options.store.listActive(), subjectKey);
  }

  async compressOldMemories(
    candidateOptions: CompressionCandidateOptions,
    summarize: SummarizeFn,
    actor = "user",
  ): Promise<MemoryRecord | undefined> {
    const compressor = new MemoryCompressor();
    const candidates = compressor.selectCandidates(
      this.options.store.listActive(),
      candidateOptions,
    );
    const result = await compressor.compress(candidates, summarize);
    if (!result) return undefined;

    const summary = await this.createMemory(result.summaryInput, actor);
    for (const id of result.compressedIds) {
      await this.options.store.delete(id);
    }
    this.reindex();
    return summary;
  }

  /** Background maintenance: prunes expired/overflowing records and reports duplicate groups for the caller to act on. Safe to run on a timer. */
  async runMaintenance(): Promise<MaintenanceReport> {
    const active = this.options.store.listActive();

    const expired = this.options.expiration.findExpired(active);
    for (const record of expired) await this.options.store.purge(record.id);

    const overflow = this.options.expiration.findOverflow(this.options.store.listActive());
    for (const record of overflow) await this.options.store.purge(record.id);

    this.reindex();
    const duplicateGroups = this.findDuplicates();

    const report: MaintenanceReport = {
      expiredPurged: expired.length,
      overflowPurged: overflow.length,
      duplicateGroupsFound: duplicateGroups.length,
    };
    log.info("maintenance run complete", { ...report });
    return report;
  }

  // ---- export / import / backup / restore ----

  exportMemories(actor = "user"): MemoryExportBundle {
    this.options.permissions.assertGranted("export");
    this.options.auditLog.record("export", "*all*", actor);
    return { exportedAt: new Date().toISOString(), records: this.options.store.listActive() };
  }

  async importMemories(bundle: MemoryExportBundle, actor = "user"): Promise<number> {
    this.assertEnabled();
    this.options.permissions.assertGranted("import");
    for (const record of bundle.records) {
      await this.options.store.put(record);
    }
    this.reindex();
    this.options.auditLog.record("import", "*all*", actor);
    return bundle.records.length;
  }

  async backup(actor = "user"): Promise<MemoryBackupBundle> {
    if (!this.options.backupService) throw new Error("no backup service configured");
    this.options.permissions.assertGranted("export");
    this.options.auditLog.record("backup", "*all*", actor);
    return this.options.backupService.backup(this.options.store.listActive());
  }

  async restore(bundle: MemoryBackupBundle, actor = "user"): Promise<number> {
    if (!this.options.backupService) throw new Error("no backup service configured");
    this.assertEnabled();
    this.options.permissions.assertGranted("import");
    const records = await this.options.backupService.restore(bundle);
    for (const record of records) await this.options.store.put(record);
    this.reindex();
    this.options.auditLog.record("import", "*restore*", actor);
    return records.length;
  }

  // ---- statistics ----

  getStatistics(): MemoryStatisticsSnapshot {
    return this.options.statistics.snapshot(this.options.store.listAll());
  }

  getAuditLog(memoryId?: string): ReturnType<MemoryAuditLog["all"]> {
    return memoryId ? this.options.auditLog.forMemory(memoryId) : this.options.auditLog.all();
  }

  getVersionHistory(memoryId: string): readonly MemoryRecord[] {
    return this.options.versionHistory.getHistory(memoryId);
  }

  // ---- internal ----

  private mustGetActive(id: string): MemoryRecord {
    const record = this.options.store.get(id);
    if (!record || record.lifecycleState !== "active") {
      throw new Error(`memory "${id}" not found or not active`);
    }
    return record;
  }

  private async attachEmbedding(record: MemoryRecord): Promise<MemoryRecord> {
    if (!this.options.embeddingService) return record;
    const embedding = await this.options.embeddingService.embedText(record.content);
    const withEmbedding = { ...record, embedding };
    await this.options.store.put(withEmbedding);
    return withEmbedding;
  }

  private reindex(): void {
    this.options.index.rebuild(this.options.store.listAll());
  }
}

export function createMemoryManager(options: MemoryManagerOptions): MemoryManager {
  return new MemoryManager(options);
}

export { ShortTermMemory, estimateTokens };
