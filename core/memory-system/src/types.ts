/**
 * Every kind of memory the system stores. `short_term` and `working` are
 * represented by `@ryper/memory`'s `ShortTermMemory` (a sliding turn
 * window is the right shape for them) rather than by `MemoryRecord` — see
 * `MemoryManager.shortTerm` — so they're intentionally excluded from this
 * union, which covers everything the persistent `MemoryStore` manages.
 */
export type MemoryType =
  | "long_term"
  | "episodic"
  | "semantic"
  | "preference"
  | "project"
  | "task"
  | "contact"
  | "calendar"
  | "knowledge"
  | "conversation"
  | "document"
  | "image"
  | "file"
  | "automation";

export type MemoryLifecycleState = "active" | "archived" | "deleted";

export interface MemoryTag {
  readonly name: string;
}

export interface MemoryMetadata {
  readonly sourceConversationId?: string;
  readonly sourceDeviceId?: string;
  readonly [key: string]: unknown;
}

export interface MemoryRecord {
  readonly id: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly tags: readonly string[];
  readonly metadata: MemoryMetadata;
  readonly importance: number; // 0..1, see ImportanceScorer
  readonly pinned: boolean;
  readonly lifecycleState: MemoryLifecycleState;
  readonly embedding?: readonly number[];
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CreateMemoryInput {
  readonly type: MemoryType;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly metadata?: MemoryMetadata;
  readonly importance?: number;
  readonly pinned?: boolean;
  readonly expiresAt?: string;
}

export interface UpdateMemoryInput {
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly metadata?: MemoryMetadata;
  readonly importance?: number;
  readonly pinned?: boolean;
  readonly expiresAt?: string;
}

/** Per-`MemoryType` default retention, feeding `MemoryExpirationManager`. */
export interface RetentionPolicy {
  readonly defaultTtlMs?: number;
  readonly maxItems?: number;
  readonly autoExpire: boolean;
}

export type RetentionPolicyMap = Readonly<Partial<Record<MemoryType, RetentionPolicy>>>;
