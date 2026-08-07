# @ryper/memory-system — the Memory System

Phase 5 of RYPER AI OS. This package is the assistant's permanent brain:
intelligent memory creation, retrieval, ranking, editing, deletion,
synchronization, and semantic search, fully user-controlled and
privacy-first.

It composes `@ryper/memory` (reusing `ShortTermMemory`/`estimateTokens`
directly rather than reimplementing sliding-window turn storage) and
`@ryper/sync` (reusing `SyncStore`'s CRDT merge rather than reimplementing
cross-device conflict resolution). No file in either package, or any other
existing package, was modified.

## Why a new package instead of extending `core/memory`

`@ryper/memory`'s `LongTermMemory` (Phase 1/2) is already depended on by
`@ryper/ai-engine`'s `ContextManager` and `@ryper/conversation` — both
tested, approved, unrelated-to-this-phase modules. Phase 5 needs a much
larger surface (16 memory types, tags, versioning, encryption, pin/archive,
conflict resolution, sync) that doesn't fit `LongTermMemory`'s existing
shape without breaking changes. Consistent with how Phase 3
(`@ryper/ai-engine`) and Phase 4 (`@ryper/local-runtime`) each added a new
package that _builds on_ earlier ones rather than rewriting them,
`@ryper/memory-system` does the same: it's the full persistent-memory layer,
while `@ryper/memory`'s `ShortTermMemory` continues to serve exactly the
short-term/working-memory role it always has — `MemoryManager` composes it
rather than duplicating it (see `getShortTermMemory`).

## Memory types

All 16 requested types are supported. `short_term` and `working` are
`@ryper/memory`'s `ShortTermMemory`, reused via
`MemoryManager.getShortTermMemory(sessionId)`. The other 14 —
`long_term`, `episodic`, `semantic`, `preference`, `project`, `task`,
`contact`, `calendar`, `knowledge`, `conversation`, `document`, `image`,
`file`, `automation` — are values of the `MemoryType` union
(`src/types.ts`) stored as `MemoryRecord`s in `MemoryStore`.

## Component map

| Component                                            | File                                 |
| ---------------------------------------------------- | ------------------------------------ |
| Memory Manager (the facade)                          | `memory-manager.ts`                  |
| Memory Store                                         | `memory-store.ts`                    |
| Memory Index                                         | `memory-index.ts`                    |
| Memory Retrieval Engine / Semantic Search            | `semantic-search.ts`                 |
| Memory Ranking Engine                                | `ranking-engine.ts`                  |
| Embedding Service                                    | `embedding-service.ts`               |
| Memory Compression                                   | `compression.ts`                     |
| Memory Expiration                                    | `expiration.ts`                      |
| Memory Deduplication                                 | `deduplication.ts`                   |
| Memory Categorization                                | `categorization.ts`                  |
| Memory Importance Scoring                            | `importance-scoring.ts`              |
| Memory Conflict Resolution                           | `conflict-resolution.ts`             |
| Memory Encryption                                    | `encryption.ts`                      |
| Memory Backup / Restore / Export / Import            | `backup-restore.ts`                  |
| Audit logs / Version history / Recovery              | `audit-log.ts`, `version-history.ts` |
| User control (enable/disable/permissions)            | `permissions.ts`                     |
| Sync (offline-first, selective, conflict resolution) | `sync.ts` (built on `@ryper/sync`)   |
| Statistics                                           | `statistics.ts`                      |

## Operations supported

Create, Read, Update, Delete (soft, recoverable), Merge, Split, Archive,
Restore, Pin/Unpin, Search (keyword/vector/hybrid/metadata), Filter, Tag —
every one is a `MemoryManager` method. See `MemoryManager`'s doc comments
for the full list; `core/memory-system/test/memory-manager.test.ts`
exercises each one end-to-end.

## Security

- **Encryption at rest**: `MemoryEncryption` (AES-256-GCM, authenticated —
  tampering is detected on decrypt, not silently ignored).
- **Secure key storage**: `SecureKeyStore` interface, backed by the
  platform's Keychain/DPAPI/Secret Service/Android Keystore in production,
  per `docs/SECRETS.md` — this package never persists a raw key itself.
- **Permission checks**: `MemoryPermissions` — a global enable/disable
  switch (disabled means every read/write is refused, not just hidden) plus
  per-operation grants (view/edit/delete/export/import), independently
  typed from `@ryper/security`'s `Capability` union so this phase never
  needed to modify that package.
- **Audit logs**: `MemoryAuditLog`, append-only.
- **Version history / recovery**: `MemoryVersionHistory` snapshots every
  record before an update; `MemoryStore.delete` is soft by default so
  `restoreMemory` can undo it.

## Sync

`MemorySyncService` wraps `@ryper/sync`'s existing last-write-wins CRDT
store. Offline-first and conflict resolution (by `updatedAt`, tie-broken by
device id) are exactly `SyncStore`'s existing, already-tested behavior —
this package adds only what's memory-specific: a selective-sync filter
(`excludeTypes(...)`) so some memory types can be scoped to stay
device-local, and wiring into the shared event bus.

## Integration: how future modules use this

```ts
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
  MemoryEncryption,
  InMemoryKeyStore,
  MemoryBackupService,
  MemorySyncService,
  MemoryManager,
} from "@ryper/memory-system";

const store = new MemoryStore(realPersistence); // e.g. an encrypted-SQLite-backed implementation
await store.hydrate();
const index = new MemoryIndex();
const embeddingService = new EmbeddingService((text) =>
  localRuntimeManager.embed({ text }).then((r) => r.vector),
);
// ... construct the rest per the constructor list above ...

const memory = new MemoryManager({ store, index, search, ranking /* ...*/ });

// Core AI Engine's ContextManager (Phase 3) calls this instead of talking
// to LongTermMemory directly, once wired in a later integration pass:
const relevant = await memory.searchMemories(userMessage, { limit: 5 });

// A future Documents module:
await memory.createMemory({
  type: "document",
  content: extractedSummary,
  metadata: { sourcePath },
});

// A future Automation module:
await memory.createMemory({ type: "automation", content: "runs backup every Sunday at 2am" });

// The platform shell's Memory Viewer UI:
const stats = memory.getStatistics();
const all = memory.filterMemories({});
await memory.disable(); // the user's global off-switch
```

Every module that needs to remember something across sessions goes through
`MemoryManager` — never through `MemoryStore` or the other components
directly — so permission checks, audit logging, and sync staging are never
accidentally bypassed.
