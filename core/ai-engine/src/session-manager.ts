import type { LongTermMemory } from "@ryper/memory";
import type { VectorStore } from "@ryper/rag";
import { createLogger } from "@ryper/logging";
import { ContextManager, type ContextManagerOptions } from "./context-manager.js";

const log = createLogger("ai-engine:session-manager");

export interface Session {
  readonly id: string;
  readonly context: ContextManager;
  readonly createdAt: string;
  lastActiveAt: string;
}

/**
 * One `Session` per active conversation. Long-term memory is shared across
 * a user's sessions (it's the user's persistent memory, not per-chat), so
 * it's injected once; each session gets its own `ContextManager` for
 * short-term/working state and its own scratch space.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly sharedLongTermMemory: LongTermMemory,
    private readonly vectorStore: VectorStore | undefined,
    private readonly contextOptions: ContextManagerOptions = {},
  ) {}

  getOrCreate(sessionId: string): Session {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActiveAt = new Date().toISOString();
      return existing;
    }

    const now = new Date().toISOString();
    const session: Session = {
      id: sessionId,
      context: new ContextManager(this.sharedLongTermMemory, this.vectorStore, this.contextOptions),
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, session);
    log.info("session created", { sessionId });
    return session;
  }

  end(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    if (removed) log.info("session ended", { sessionId });
    return removed;
  }

  /** Ends every session whose last activity is older than `maxIdleMs`. Returns the ended session ids. */
  evictIdle(maxIdleMs: number, now: Date = new Date()): string[] {
    const evicted: string[] = [];
    for (const session of this.sessions.values()) {
      if (now.getTime() - new Date(session.lastActiveAt).getTime() > maxIdleMs) {
        this.sessions.delete(session.id);
        evicted.push(session.id);
      }
    }
    if (evicted.length > 0) log.info("evicted idle sessions", { count: evicted.length });
    return evicted;
  }

  list(): readonly Session[] {
    return [...this.sessions.values()];
  }
}

export function createSessionManager(
  sharedLongTermMemory: LongTermMemory,
  vectorStore?: VectorStore,
  contextOptions?: ContextManagerOptions,
): SessionManager {
  return new SessionManager(sharedLongTermMemory, vectorStore, contextOptions);
}
