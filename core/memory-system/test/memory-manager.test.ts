import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";

import { MemoryStore, InMemoryPersistence } from "../src/memory-store.js";
import { MemoryIndex } from "../src/memory-index.js";
import { EmbeddingService } from "../src/embedding-service.js";
import { SemanticSearchEngine } from "../src/semantic-search.js";
import { MemoryRankingEngine } from "../src/ranking-engine.js";
import { ImportanceScorer } from "../src/importance-scoring.js";
import { MemoryCategorizer } from "../src/categorization.js";
import { MemoryDeduplicator } from "../src/deduplication.js";
import { ConflictResolver } from "../src/conflict-resolution.js";
import { MemoryExpirationManager } from "../src/expiration.js";
import { MemoryAuditLog } from "../src/audit-log.js";
import { MemoryVersionHistory } from "../src/version-history.js";
import { MemoryBackupService } from "../src/backup-restore.js";
import { MemoryEncryption, InMemoryKeyStore } from "../src/encryption.js";
import { MemoryPermissions } from "../src/permissions.js";
import { MemoryStatistics } from "../src/statistics.js";
import { MemoryManager } from "../src/memory-manager.js";
import type { RetentionPolicyMap } from "../src/types.js";

function buildManager(
  options: {
    retention?: RetentionPolicyMap;
    eventBus?: EventBus;
    encryption?: MemoryEncryption;
  } = {},
) {
  const store = new MemoryStore(new InMemoryPersistence());
  const index = new MemoryIndex();
  const embeddingService = new EmbeddingService(async (text) => [text.length]);
  const search = new SemanticSearchEngine(index, embeddingService);
  const ranking = new MemoryRankingEngine();
  const permissions = new MemoryPermissions();
  const expiration = new MemoryExpirationManager(options.retention);
  const statistics = new MemoryStatistics(expiration);
  const encryption = options.encryption ?? new MemoryEncryption(new InMemoryKeyStore());

  const manager = new MemoryManager({
    store,
    index,
    search,
    ranking,
    importanceScorer: new ImportanceScorer(),
    categorizer: new MemoryCategorizer(),
    deduplicator: new MemoryDeduplicator(),
    conflictResolver: new ConflictResolver(),
    expiration,
    auditLog: new MemoryAuditLog(),
    versionHistory: new MemoryVersionHistory(),
    permissions,
    statistics,
    embeddingService,
    backupService: new MemoryBackupService(encryption),
    ...(options.eventBus ? { eventBus: options.eventBus } : {}),
  });

  return { manager, store, permissions, encryption };
}

describe("MemoryManager", () => {
  it("creates a memory with a computed embedding and importance", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "preference", content: "likes tea" });
    expect(record.embedding).toBeDefined();
    expect(record.importance).toBeGreaterThan(0);
  });

  it("createMemoryAuto infers the type via the categorizer", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemoryAuto("remind me to call the bank");
    expect(record.type).toBe("task");
  });

  it("refuses every operation while memory is disabled", async () => {
    const { manager } = buildManager();
    await manager.disable();
    await expect(manager.createMemory({ type: "task", content: "x" })).rejects.toThrow(/disabled/);
    await manager.enable();
    await expect(manager.createMemory({ type: "task", content: "x" })).resolves.toBeDefined();
  });

  it("update() snapshots the previous version into history", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "task", content: "v1" });
    await manager.updateMemory(record.id, { content: "v2" });
    const history = manager.getVersionHistory(record.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe("v1");
  });

  it("delete() is recoverable via restoreMemory()", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "task", content: "x" });
    await manager.deleteMemory(record.id);
    expect(manager.getMemory(record.id)?.lifecycleState).toBe("deleted");
    const restored = await manager.restoreMemory(record.id);
    expect(restored.lifecycleState).toBe("active");
  });

  it("pin/unpin toggle the pinned flag", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "task", content: "x" });
    const pinned = await manager.pinMemory(record.id);
    expect(pinned.pinned).toBe(true);
    const unpinned = await manager.unpinMemory(record.id);
    expect(unpinned.pinned).toBe(false);
  });

  it("tagMemory adds tags without duplicating existing ones", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "task", content: "x", tags: ["work"] });
    const tagged = await manager.tagMemory(record.id, ["work", "urgent"]);
    expect(tagged.tags.sort()).toEqual(["urgent", "work"]);
  });

  it("mergeMemories combines records into one and soft-deletes the originals", async () => {
    const { manager } = buildManager();
    const a = await manager.createMemory({ type: "knowledge", content: "fact a", tags: ["x"] });
    const b = await manager.createMemory({ type: "knowledge", content: "fact b", tags: ["y"] });

    const merged = await manager.mergeMemories([a.id, b.id], "fact a and fact b combined");
    expect(merged.tags.sort()).toEqual(["x", "y"]);
    expect(manager.getMemory(a.id)?.lifecycleState).toBe("deleted");
    expect(manager.getMemory(b.id)?.lifecycleState).toBe("deleted");
  });

  it("splitMemory creates multiple records and archives the source", async () => {
    const { manager } = buildManager();
    const source = await manager.createMemory({ type: "knowledge", content: "fact a and fact b" });
    const parts = await manager.splitMemory(source.id, [
      { type: "knowledge", content: "fact a" },
      { type: "knowledge", content: "fact b" },
    ]);
    expect(parts).toHaveLength(2);
    expect(manager.getMemory(source.id)?.lifecycleState).toBe("archived");
  });

  it("searchMemories ranks results using the semantic search + ranking pipeline", async () => {
    const { manager } = buildManager();
    await manager.createMemory({ type: "knowledge", content: "the quarterly revenue report" });
    await manager.createMemory({ type: "knowledge", content: "a cat and a dog playing" });

    const results = await manager.searchMemories("revenue", { hybridWeight: 0 });
    expect(results[0]?.record.content).toContain("revenue");
  });

  it("filterMemories applies type/tag/pin filters without a query", async () => {
    const { manager } = buildManager();
    await manager.createMemory({ type: "task", content: "a", tags: ["work"] });
    await manager.createMemory({ type: "preference", content: "b", tags: ["work"] });

    const results = manager.filterMemories({ type: "task" });
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("task");
  });

  it("resolveDuplicates removes exact-content duplicates, keeping one canonical record", async () => {
    const { manager } = buildManager();
    await manager.createMemory({ type: "knowledge", content: "duplicate fact" });
    await manager.createMemory({ type: "knowledge", content: "duplicate fact" });

    const groupsResolved = await manager.resolveDuplicates();
    expect(groupsResolved).toBe(1);
    expect(manager.filterMemories({ type: "knowledge" })).toHaveLength(1);
  });

  it("runMaintenance purges expired and overflowing records", async () => {
    const { manager } = buildManager({
      retention: { task: { autoExpire: true, defaultTtlMs: 1, maxItems: 1 } },
    });
    const record = await manager.createMemory({ type: "task", content: "will expire" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const report = await manager.runMaintenance();
    expect(report.expiredPurged).toBe(1);
    expect(manager.getMemory(record.id)).toBeUndefined();
  });

  it("export/import round-trips the active memory set", async () => {
    const { manager } = buildManager();
    await manager.createMemory({ type: "task", content: "a" });
    const bundle = manager.exportMemories();

    const { manager: freshManager } = buildManager();
    const imported = await freshManager.importMemories(bundle);
    expect(imported).toBe(1);
    expect(freshManager.filterMemories({})).toHaveLength(1);
  });

  it("backup/restore round-trips through encryption", async () => {
    const { manager, encryption } = buildManager();
    await manager.createMemory({ type: "task", content: "backed up" });
    const bundle = await manager.backup();

    const { manager: freshManager } = buildManager({ encryption });
    const restoredCount = await freshManager.restore(bundle);
    expect(restoredCount).toBe(1);
  });

  it("getStatistics reflects current counts", async () => {
    const { manager } = buildManager();
    await manager.createMemory({ type: "task", content: "a" });
    await manager.createMemory({ type: "preference", content: "b" });
    const stats = manager.getStatistics();
    expect(stats.totalActive).toBe(2);
  });

  it("getAuditLog records every operation", async () => {
    const { manager } = buildManager();
    const record = await manager.createMemory({ type: "task", content: "a" });
    manager.getMemory(record.id);
    await manager.updateMemory(record.id, { content: "b" });

    const entries = manager.getAuditLog(record.id);
    expect(entries.map((e) => e.action)).toEqual(["create", "read", "update"]);
  });

  it("short-term memory sessions are independent per session id", () => {
    const { manager } = buildManager();
    const sessionA = manager.getShortTermMemory("a");
    const sessionB = manager.getShortTermMemory("b");
    sessionA.push({ role: "user", content: "hi", tokenEstimate: 1 });
    expect(sessionB.getTurns()).toHaveLength(0);
    expect(manager.getShortTermMemory("a")).toBe(sessionA); // same instance on repeat access
  });

  it("emits events on create/update/delete when an event bus is configured", async () => {
    const eventBus = new EventBus();
    const { manager } = buildManager({ eventBus });
    const seen: string[] = [];
    eventBus.on("memory_system.created", () => seen.push("created"));
    eventBus.on("memory_system.updated", () => seen.push("updated"));
    eventBus.on("memory_system.deleted", () => seen.push("deleted"));

    const record = await manager.createMemory({ type: "task", content: "a" });
    await manager.updateMemory(record.id, { content: "b" });
    await manager.deleteMemory(record.id);

    expect(seen).toEqual(["created", "updated", "deleted"]);
  });
});
