import {
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
  MemoryManager,
} from "@ryper/memory-system";
import type { EventBus } from "@ryper/event-bus";

/**
 * Assembles a real `@ryper/memory-system` `MemoryManager` — every
 * sub-component is real production code from that package; nothing here
 * is a mock. The one honestly-labeled placeholder is the embedding
 * function (`async (text) => [text.length]`), which is the exact same
 * placeholder `@ryper/web-shell`'s `createWebShell()` already uses and
 * documents for its own `VectorStore` — a real embedding model is a
 * separate, future integration (see `@ryper/local-runtime`'s lack of any
 * production provider, noted in `docs/adr/0015`), not something this
 * phase fabricates a fake "real-looking" implementation of.
 *
 * Storage is `InMemoryPersistence` — `@ryper/memory-system` does not yet
 * ship a file-backed `MemoryPersistence` implementation (only the
 * interface + this one reference implementation exist), so voice-derived
 * memories do not currently survive an app restart. This is a real,
 * pre-existing gap in `@ryper/memory-system` itself, not something
 * introduced by the desktop app — recorded in `docs/PROJECT_STATE.md`.
 */
export function bootstrapMemoryManager(eventBus?: EventBus): MemoryManager {
  const store = new MemoryStore(new InMemoryPersistence());
  const index = new MemoryIndex();
  const embeddingService = new EmbeddingService(async (text) => [text.length]);
  const search = new SemanticSearchEngine(index, embeddingService);
  const ranking = new MemoryRankingEngine();
  const permissions = new MemoryPermissions();
  const expiration = new MemoryExpirationManager();
  const statistics = new MemoryStatistics(expiration);

  return new MemoryManager({
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
    ...(eventBus ? { eventBus } : {}),
  });
}
