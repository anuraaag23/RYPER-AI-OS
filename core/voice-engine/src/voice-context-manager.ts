import type { MemoryManager } from "@ryper/memory-system";

/**
 * Thin bridge into `@ryper/memory-system`'s `MemoryManager` — this class
 * owns no storage of its own. It records each voice turn as a
 * `conversation`-type memory (so it's searchable/retrievable like any
 * other conversation) and fetches recent relevant memories to give the
 * pipeline conversational context before calling the Core AI Engine.
 */
export class VoiceContextManager {
  constructor(private readonly memory: MemoryManager) {}

  async recordUserUtterance(sessionId: string, text: string): Promise<void> {
    await this.memory.createMemory({
      type: "conversation",
      content: text,
      metadata: { sessionId, role: "user", channel: "voice" },
    });
  }

  async recordAssistantUtterance(sessionId: string, text: string): Promise<void> {
    await this.memory.createMemory({
      type: "conversation",
      content: text,
      metadata: { sessionId, role: "assistant", channel: "voice" },
    });
  }

  async getRelevantContext(query: string, limit = 5): Promise<readonly string[]> {
    const results = await this.memory.searchMemories(query, {
      filter: { type: "conversation" },
      limit,
    });
    return results.map((r) => r.record.content);
  }
}

export function createVoiceContextManager(memory: MemoryManager): VoiceContextManager {
  return new VoiceContextManager(memory);
}
