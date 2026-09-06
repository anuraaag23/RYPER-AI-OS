import { randomUUID } from "node:crypto";

export type MemoryCategory = "preference" | "project" | "contact" | "fact" | "task";

export interface MemoryItem {
  readonly id: string;
  readonly category: MemoryCategory;
  content: string;
  importance: number; // 0..1
  readonly sourceConversationId?: string | undefined;
  expiresAt?: string | undefined;
  readonly createdAt: string;
  updatedAt: string;
}

export interface MemoryItemInput {
  readonly category: MemoryCategory;
  readonly content: string;
  readonly importance?: number;
  readonly sourceConversationId?: string;
  readonly expiresAt?: string;
}

export interface SearchOptions {
  readonly category?: MemoryCategory;
  readonly limit?: number;
}

function scoreMatch(query: string, item: MemoryItem): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return item.importance;
  const haystack = item.content.toLowerCase();
  if (!haystack.includes(q)) return 0;
  // naive relevance: importance weighted by match density
  const density = q.length / Math.max(haystack.length, 1);
  return item.importance * 0.7 + density * 0.3;
}

/**
 * Long-term memory: categorized, user-editable, user-deletable, with
 * optional expiry. Retrieval is ranked (not just filtered) so callers get
 * the most relevant items first. Persistence (encrypted SQLite) is injected
 * via a repository in the platform shell — this class is the pure in-memory
 * domain model, unit-testable without a database.
 */
export class LongTermMemory {
  private readonly items = new Map<string, MemoryItem>();

  add(input: MemoryItemInput): MemoryItem {
    const now = new Date().toISOString();
    const item: MemoryItem = {
      id: randomUUID(),
      category: input.category,
      content: input.content,
      importance: input.importance ?? 0.5,
      sourceConversationId: input.sourceConversationId,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return item;
  }

  edit(
    id: string,
    patch: Partial<Pick<MemoryItem, "content" | "importance" | "expiresAt">>,
  ): MemoryItem {
    const existing = this.items.get(id);
    if (!existing) {
      throw new Error(`memory item "${id}" not found`);
    }
    const updated: MemoryItem = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  get(id: string): MemoryItem | undefined {
    return this.items.get(id);
  }

  /** Removes and returns items whose expiry has passed. */
  pruneExpired(now: Date = new Date()): MemoryItem[] {
    const expired: MemoryItem[] = [];
    for (const item of this.items.values()) {
      if (item.expiresAt !== undefined && new Date(item.expiresAt) <= now) {
        expired.push(item);
        this.items.delete(item.id);
      }
    }
    return expired;
  }

  search(query: string, options: SearchOptions = {}): MemoryItem[] {
    const limit = options.limit ?? 10;
    return [...this.items.values()]
      .filter((item) => (options.category ? item.category === options.category : true))
      .map((item) => ({ item, score: scoreMatch(query, item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => item);
  }

  all(): readonly MemoryItem[] {
    return [...this.items.values()];
  }

  /** Plain-object export for backup/portability, per the Memory Viewer's export requirement. */
  export(): readonly MemoryItem[] {
    return this.all();
  }

  import(items: readonly MemoryItem[]): void {
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }
}
