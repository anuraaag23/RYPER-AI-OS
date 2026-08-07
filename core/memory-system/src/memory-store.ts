import { randomUUID } from "node:crypto";
import type {
  CreateMemoryInput,
  MemoryLifecycleState,
  MemoryRecord,
  UpdateMemoryInput,
} from "./types.js";

/**
 * Where records live between process runs. `InMemoryPersistence` is used
 * by this package's own tests; a platform shell supplies a real
 * implementation (encrypted SQLite, per `docs/SECRETS.md`'s "database
 * itself is encrypted at rest" requirement — `MemoryEncryption` in this
 * package handles the field-level encryption layered on top of whatever
 * this interface writes to).
 */
export interface MemoryPersistence {
  save(record: MemoryRecord): Promise<void>;
  load(id: string): Promise<MemoryRecord | undefined>;
  loadAll(): Promise<readonly MemoryRecord[]>;
  remove(id: string): Promise<void>;
}

export class InMemoryPersistence implements MemoryPersistence {
  private readonly records = new Map<string, MemoryRecord>();

  async save(record: MemoryRecord): Promise<void> {
    this.records.set(record.id, record);
  }
  async load(id: string): Promise<MemoryRecord | undefined> {
    return this.records.get(id);
  }
  async loadAll(): Promise<readonly MemoryRecord[]> {
    return [...this.records.values()];
  }
  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

/**
 * The persistent store for every `MemoryRecord`. Holds an in-memory cache
 * as the source of truth for reads (so search/index/ranking never pay
 * async persistence latency) and writes through to `MemoryPersistence` on
 * every mutation. Delete is soft (`lifecycleState: "deleted"`) so
 * `MemoryBackupService`/version history can still recover a record; a
 * hard delete is `purge()`.
 */
export class MemoryStore {
  private readonly cache = new Map<string, MemoryRecord>();
  private hydrated = false;

  constructor(private readonly persistence: MemoryPersistence) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const all = await this.persistence.loadAll();
    for (const record of all) this.cache.set(record.id, record);
    this.hydrated = true;
  }

  async create(input: CreateMemoryInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      type: input.type,
      content: input.content,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      importance: input.importance ?? 0.5,
      pinned: input.pinned ?? false,
      lifecycleState: "active",
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.cache.set(record.id, record);
    await this.persistence.save(record);
    return record;
  }

  get(id: string): MemoryRecord | undefined {
    return this.cache.get(id);
  }

  async update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord> {
    const existing = this.requireActive(id);
    const updated: MemoryRecord = {
      ...existing,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    this.cache.set(id, updated);
    await this.persistence.save(updated);
    return updated;
  }

  /** Replaces a record wholesale — used by version-history rollback and sync merges, which already have a full record to apply. */
  async put(record: MemoryRecord): Promise<void> {
    this.cache.set(record.id, record);
    await this.persistence.save(record);
  }

  async setLifecycleState(id: string, state: MemoryLifecycleState): Promise<MemoryRecord> {
    const existing = this.mustGet(id);
    const updated: MemoryRecord = {
      ...existing,
      lifecycleState: state,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    await this.persistence.save(updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.cache.has(id)) return false;
    await this.setLifecycleState(id, "deleted");
    return true;
  }

  /** Irreversibly removes a record — only for user-initiated hard delete or expired-record cleanup, never the default. */
  async purge(id: string): Promise<boolean> {
    if (!this.cache.has(id)) return false;
    this.cache.delete(id);
    await this.persistence.remove(id);
    return true;
  }

  listActive(): readonly MemoryRecord[] {
    return [...this.cache.values()].filter((r) => r.lifecycleState === "active");
  }

  listAll(): readonly MemoryRecord[] {
    return [...this.cache.values()];
  }

  private mustGet(id: string): MemoryRecord {
    const record = this.cache.get(id);
    if (!record) throw new Error(`memory "${id}" not found`);
    return record;
  }

  private requireActive(id: string): MemoryRecord {
    const record = this.mustGet(id);
    if (record.lifecycleState === "deleted") {
      throw new Error(`memory "${id}" has been deleted`);
    }
    return record;
  }
}

export function createMemoryStore(
  persistence: MemoryPersistence = new InMemoryPersistence(),
): MemoryStore {
  return new MemoryStore(persistence);
}
