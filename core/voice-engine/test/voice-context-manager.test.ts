import { describe, expect, it } from "vitest";
import {
  MemoryManager,
  MemoryStore,
  InMemoryPersistence,
  MemoryIndex,
  EmbeddingService,
  SemanticSearchEngine,
  MemoryRankingEngine,
  ImportanceScorer,
  MemoryCategorizer,
  MemoryDeduplicator,
  ConflictResolver,
  MemoryExpirationManager,
  MemoryAuditLog,
  MemoryVersionHistory,
  MemoryPermissions,
  MemoryStatistics,
} from "@ryper/memory-system";
import { VoiceContextManager } from "../src/voice-context-manager.js";

function buildMemoryManager(): MemoryManager {
  const store = new MemoryStore(new InMemoryPersistence());
  const index = new MemoryIndex();
  const embeddingService = new EmbeddingService(async (text) => [text.length]);
  return new MemoryManager({
    store,
    index,
    search: new SemanticSearchEngine(index, embeddingService),
    ranking: new MemoryRankingEngine(),
    importanceScorer: new ImportanceScorer(),
    categorizer: new MemoryCategorizer(),
    deduplicator: new MemoryDeduplicator(),
    conflictResolver: new ConflictResolver(),
    expiration: new MemoryExpirationManager(),
    auditLog: new MemoryAuditLog(),
    versionHistory: new MemoryVersionHistory(),
    permissions: new MemoryPermissions(),
    statistics: new MemoryStatistics(new MemoryExpirationManager()),
    embeddingService,
  });
}

describe("VoiceContextManager", () => {
  it("records user and assistant utterances as conversation memories", async () => {
    const memory = buildMemoryManager();
    const context = new VoiceContextManager(memory);

    await context.recordUserUtterance("session-1", "what's the weather like");
    await context.recordAssistantUtterance("session-1", "it's sunny today");

    const all = memory.filterMemories({ type: "conversation" });
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.metadata.role)).toEqual(["user", "assistant"]);
  });

  it("getRelevantContext returns matching conversation memory content", async () => {
    const memory = buildMemoryManager();
    const context = new VoiceContextManager(memory);
    await context.recordUserUtterance("session-1", "I love hiking in the mountains");

    const results = await context.getRelevantContext("hiking");
    expect(results.some((c) => c.includes("hiking"))).toBe(true);
  });
});
