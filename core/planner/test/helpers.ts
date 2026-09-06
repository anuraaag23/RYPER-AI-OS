import { CapabilityBroker, type ConsentPrompt } from "@ryper/security";
import {
  ConflictResolver,
  EmbeddingService,
  ImportanceScorer,
  InMemoryKeyStore,
  InMemoryPersistence,
  MemoryAuditLog,
  MemoryBackupService,
  MemoryCategorizer,
  MemoryDeduplicator,
  MemoryEncryption,
  MemoryExpirationManager,
  MemoryIndex,
  MemoryManager,
  MemoryPermissions,
  MemoryRankingEngine,
  MemoryStatistics,
  MemoryStore,
  MemoryVersionHistory,
  SemanticSearchEngine,
} from "@ryper/memory-system";

/** A real, fully in-memory `MemoryManager` — no live network/storage, per repo test conventions. */
export function buildMemoryManager(): MemoryManager {
  const store = new MemoryStore(new InMemoryPersistence());
  const index = new MemoryIndex();
  const embeddingService = new EmbeddingService(async (text) => [text.length]);
  const search = new SemanticSearchEngine(index, embeddingService);
  const expiration = new MemoryExpirationManager();
  const encryption = new MemoryEncryption(new InMemoryKeyStore());

  return new MemoryManager({
    store,
    index,
    search,
    ranking: new MemoryRankingEngine(),
    importanceScorer: new ImportanceScorer(),
    categorizer: new MemoryCategorizer(),
    deduplicator: new MemoryDeduplicator(),
    conflictResolver: new ConflictResolver(),
    expiration,
    auditLog: new MemoryAuditLog(),
    versionHistory: new MemoryVersionHistory(),
    permissions: new MemoryPermissions(),
    statistics: new MemoryStatistics(expiration),
    embeddingService,
    backupService: new MemoryBackupService(encryption),
  });
}

export function buildCapabilityBroker(
  promptForConsent: ConsentPrompt = () => true,
): CapabilityBroker {
  return new CapabilityBroker(promptForConsent);
}
