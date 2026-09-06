import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker, type ConsentPrompt } from "@ryper/security";
import { definePlugin, type DefinePluginOptions, type DefinedPlugin } from "@ryper/plugin-sdk";
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

export function buildCapabilityBroker(
  promptForConsent: ConsentPrompt = () => true,
): CapabilityBroker {
  return new CapabilityBroker(promptForConsent);
}

export function buildEventBus(): EventBus {
  return new EventBus();
}

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

export function testPlugin(overrides: Partial<DefinePluginOptions> = {}): DefinedPlugin {
  return definePlugin({
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    signed: true,
    actions: [{ name: "ping", handler: () => "pong" }],
    ...overrides,
  });
}
